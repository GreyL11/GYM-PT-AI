// Pure movement analysis. No DOM, no MediaPipe imports — so test_exercises.mjs can run it in node.
//
// Two coordinate spaces come in per frame:
//   lm — normalized image landmarks, x/y in [0,1], y increases DOWNWARD. Aspect-distorted.
//   w  — world landmarks, metres, origin between the hips, y also increases downward.
//
// Joint angles use `w` (metric, no aspect distortion). Anything comparing a body part to the
// ground (squat depth, heel lift) uses `lm`, because world coords are hip-centred so the hip
// sits at y≈0 and "below the hip" stops meaning anything.
//
// ponytail: angles are computed on x/y only, ignoring world z. A side-on camera already puts the
// movement in the image plane, and MediaPipe's z is the noisiest channel it outputs. If you ever
// film from a 45° angle and readings drift, that's the knob to revisit.

export const IDX = {
  left:  { shoulder: 11, elbow: 13, wrist: 15, index: 19, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 },
  right: { shoulder: 12, elbow: 14, wrist: 16, index: 20, hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32 },
};

const DEG = 180 / Math.PI;

/** Interior angle at joint `b`, in degrees. */
export function angle(a, b, c) {
  const abx = a.x - b.x, aby = a.y - b.y;
  const cbx = c.x - b.x, cby = c.y - b.y;
  const mag = Math.hypot(abx, aby) * Math.hypot(cbx, cby);
  if (mag < 1e-9) return 0;
  const cos = Math.min(1, Math.max(-1, (abx * cbx + aby * cby) / mag));
  return Math.acos(cos) * DEG;
}

/** Tilt of the hip→shoulder line away from vertical, in degrees. 0 = bolt upright.
 *  Sign-agnostic on purpose: leaning left and leaning right are the same fault. */
export function torsoLean(hip, shoulder) {
  return Math.atan2(Math.abs(shoulder.x - hip.x), Math.abs(shoulder.y - hip.y)) * DEG;
}

function pick(arr, idx) {
  const o = {};
  for (const k in idx) o[k] = arr[idx[k]];
  return o;
}

/** Which side of the body is the camera actually seeing? Sum the visibility of the joints
 *  that matter for this lift and take the winner. */
function bestSide(lm, keys) {
  const score = (side) => keys.reduce((s, k) => s + (lm[IDX[side][k]]?.visibility ?? 0), 0);
  return score('left') >= score('right') ? 'left' : 'right';
}

// ── shared fault builders (each of these is used by 3+ lifts) ────────────────────────────

const lockoutFault = (cue, joint = 'elbow') => ({
  id: 'lockout',
  cue,
  phase: 'start',
  test: (c) => c.jointAngle(joint) < c.T.lockout,
});

const torsoLeanFault = (cue) => ({
  id: 'torso',
  cue,
  phase: 'any',
  test: (c) => torsoLean(c.W.hip, c.W.shoulder) > c.T.torsoLean,
});

const fastEccentricFault = (cue) => ({
  id: 'eccentric',
  cue,
  phase: 'end',
  // Time from leaving the start position to arriving at the finish position.
  test: (c) => c.st.tEnd > 0 && c.st.tLeftStart > 0 && c.st.tEnd - c.st.tLeftStart < c.T.eccentricMs,
});

// ── the lifts ────────────────────────────────────────────────────────────────────────────

export const EXERCISES = {
  squat: {
    name: 'Back squat',
    view: 'side',
    cameraHint: 'Phone side-on at hip height, 2–3 m away. Whole body and both feet in frame.',
    needs: ['shoulder', 'hip', 'knee', 'ankle'],
    // Standing tall → bottom → standing tall.
    rep: { start: 168, end: 95 },
    primary: (c) => c.jointAngle('knee'),
    thresholds: {
      lockout: 160,      // deg — standing fully upright between reps
      torsoLean: 55,     // deg from vertical before "chest up"
      depthGap: 0.0,     // normalized units the hip must get BELOW the knee
      heelLift: 0.30,    // heel rise as a fraction of foot length
      valgusRatio: 0.82, // knee gap / ankle gap before knees count as caving
      eccentricMs: 0,    // 0 = descent-speed check off for squat
    },
    faults: [
      {
        id: 'depth',
        cue: 'Deeper. Hip crease below the knee.',
        phase: 'end',
        // y grows downward, so a hip ABOVE the knee has the SMALLER y.
        test: (c) => c.P.hip.y < c.P.knee.y - c.T.depthGap,
      },
      torsoLeanFault('Chest up. You are folding over the bar.'),
      {
        id: 'heel',
        cue: 'Heels down. Drive through the midfoot.',
        phase: 'any',
        test: (c) => {
          const footLen = Math.hypot(c.P.toe.x - c.P.heel.x, c.P.toe.y - c.P.heel.y);
          if (footLen < 1e-6) return false;
          return (c.P.toe.y - c.P.heel.y) / footLen > c.T.heelLift;
        },
      },
      {
        id: 'valgus',
        cue: 'Knees out. Do not let them cave in.',
        phase: 'any',
        view: 'front', // physically unobservable from the side — gated in step()
        test: (c) => {
          const kneeGap = Math.abs(c.lm[IDX.left.knee].x - c.lm[IDX.right.knee].x);
          const ankleGap = Math.abs(c.lm[IDX.left.ankle].x - c.lm[IDX.right.ankle].x);
          if (ankleGap < 1e-6) return false;
          return kneeGap / ankleGap < c.T.valgusRatio;
        },
      },
    ],
  },

  bench: {
    name: 'Bench press',
    view: 'side',
    cameraHint: 'Phone at bench height, side-on or 45° from the foot end. Both arms in frame.',
    needs: ['shoulder', 'elbow', 'wrist', 'hip'],
    // Locked out → bar on chest → locked out.
    rep: { start: 165, end: 80 },
    primary: (c) => c.jointAngle('elbow'),
    thresholds: {
      lockout: 163,      // deg elbow at the top
      flare: 75,         // deg between upper arm and torso at the bottom
      wristBend: 155,    // deg elbow-wrist-knuckle; below this the wrist is folding back
      asymmetry: 22,     // deg difference between left and right elbow
      eccentricMs: 600,  // ms — faster than this down to the chest is a bounce
      torsoLean: 90,     // unused for bench; kept so the slider set is uniform
    },
    faults: [
      {
        id: 'flare',
        cue: 'Tuck the elbows. Around forty-five degrees, not flared out.',
        phase: 'end',
        test: (c) => angle(c.W.hip, c.W.shoulder, c.W.elbow) > c.T.flare,
      },
      lockoutFault('Finish the lockout at the top.'),
      {
        id: 'wrist',
        cue: 'Stack your wrists. Knuckles to the ceiling.',
        phase: 'any',
        test: (c) => c.W.index && angle(c.W.elbow, c.W.wrist, c.W.index) < c.T.wristBend,
      },
      fastEccentricFault('Control the descent. Do not bounce it off your chest.'),
      {
        id: 'asymmetry',
        cue: 'One arm is lagging. Press evenly.',
        phase: 'any',
        bothSides: true,
        test: (c) => {
          const l = pick(c.w, IDX.left), r = pick(c.w, IDX.right);
          return Math.abs(angle(l.shoulder, l.elbow, l.wrist) - angle(r.shoulder, r.elbow, r.wrist)) > c.T.asymmetry;
        },
      },
    ],
  },

  pushdown: {
    name: 'Cable pushdown',
    view: 'side',
    cameraHint: 'Phone side-on at chest height. Whole torso and the working arm in frame.',
    needs: ['shoulder', 'elbow', 'wrist', 'hip'],
    // Elbow flexed at the top → locked out at the bottom → back to flexed. Inverted vs the others.
    rep: { start: 70, end: 172 },
    primary: (c) => c.jointAngle('elbow'),
    thresholds: {
      lockout: 165,     // deg at full extension
      upperArm: 35,     // deg the upper arm may swing away from the torso
      torsoLean: 18,    // deg — leaning in is using bodyweight, not triceps
      eccentricMs: 0,   // off: the eccentric here is the return, not the working phase
    },
    faults: [
      {
        id: 'elbowDrift',
        cue: 'Pin your elbows to your ribs. You are pressing, not pushing down.',
        phase: 'any',
        test: (c) => angle(c.W.hip, c.W.shoulder, c.W.elbow) > c.T.upperArm,
      },
      torsoLeanFault('Stand tall. Stop leaning your bodyweight into it.'),
      {
        id: 'lockout',
        cue: 'Full extension. Squeeze at the bottom.',
        phase: 'end',
        test: (c) => c.jointAngle('elbow') < c.T.lockout,
      },
    ],
  },

  skullcrusher: {
    name: 'Skullcrusher',
    view: 'side',
    cameraHint: 'Phone low and side-on, roughly bench height, level with your shoulder.',
    needs: ['shoulder', 'elbow', 'wrist', 'hip'],
    // Locked out → bar to forehead → locked out.
    rep: { start: 163, end: 60 },
    primary: (c) => c.jointAngle('elbow'),
    thresholds: {
      lockout: 160,       // deg at the top
      upperArmTarget: 92, // deg between torso and upper arm — should stay put all rep
      upperArmTol: 20,    // deg of drift allowed before it becomes a pullover
      depth: 72,          // deg elbow at the bottom; above this you stopped short
      eccentricMs: 700,   // ms
      torsoLean: 90,      // unused lying down
    },
    faults: [
      {
        id: 'upperArm',
        cue: 'Upper arms still. You are turning it into a pullover.',
        phase: 'any',
        test: (c) => Math.abs(angle(c.W.hip, c.W.shoulder, c.W.elbow) - c.T.upperArmTarget) > c.T.upperArmTol,
      },
      lockoutFault('Lock it out at the top.'),
      {
        id: 'depth',
        cue: 'Go deeper. Bring it to your forehead.',
        phase: 'end',
        test: (c) => c.jointAngle('elbow') > c.T.depth,
      },
      fastEccentricFault('Slow the negative down.'),
    ],
  },
};

/** Thresholds an exercise ships with, cloned so the settings sliders can mutate freely. */
export function defaultThresholds(exId) {
  return { ...EXERCISES[exId].thresholds };
}

export function createState() {
  return {
    phase: 'start',   // 'start' = at the rack/lockout position, 'end' = at the finish position
    reps: 0,
    ema: null,        // smoothed primary angle
    tLeftStart: 0,    // ms timestamp the lifter left the start position
    tEnd: 0,          // ms timestamp they arrived at the finish position
    faultFrames: {},  // consecutive frames each fault has held
    faultCounts: {},  // total times each fault fired this set — feeds progression
    lastRepFaults: [],
  };
}

const EMA_ALPHA = 0.4;   // heavier = twitchier. 0.4 kills MediaPipe jitter without lagging a fast rep.
const HYSTERESIS = 12;   // deg of slop around each rep endpoint, so noise cannot double-count
const HOLD_FRAMES = 3;   // a fault must survive this many frames before it is spoken

/**
 * Advance one frame.
 *
 * @param {string} exId          key into EXERCISES
 * @param {object} frame         { lm, w, tMs, view } — normalized landmarks, world landmarks,
 *                               timestamp in ms, and 'side' | 'front'
 * @param {object} st            state from createState(), mutated in place
 * @param {object} T             thresholds
 * @returns {{visible:boolean, angle:number, phase:string, reps:number, repCompleted:boolean, faults:Array}}
 */
export function step(exId, frame, st, T) {
  const ex = EXERCISES[exId];
  const { lm, w, tMs } = frame;
  const view = frame.view ?? ex.view;

  const side = bestSide(lm, ex.needs);
  const P = pick(lm, IDX[side]);
  const W = pick(w, IDX[side]);

  // Bail out rather than coach off half a skeleton.
  const seen = ex.needs.every((k) => (P[k]?.visibility ?? 1) >= 0.5);
  if (!seen) {
    st.faultFrames = {};
    return { visible: false, angle: st.ema ?? 0, phase: st.phase, reps: st.reps, repCompleted: false, faults: [] };
  }

  const ctx = {
    lm, w, P, W, T, st, side, view,
    jointAngle: (j) => (j === 'knee' ? angle(W.hip, W.knee, W.ankle) : angle(W.shoulder, W.elbow, W.wrist)),
  };

  const raw = ex.primary(ctx);
  st.ema = st.ema === null ? raw : st.ema + EMA_ALPHA * (raw - st.ema);
  const a = st.ema;

  // ── rep state machine ──────────────────────────────────────────────────────────────────
  // `dir` is +1 when the working phase increases the angle (pushdown) and -1 when it
  // decreases it (squat, bench, skullcrusher). One machine covers both.
  const { start, end } = ex.rep;
  const dir = end > start ? 1 : -1;
  const atEnd = dir * (a - end) >= -HYSTERESIS;
  const atStart = dir * (a - start) <= HYSTERESIS;

  let repCompleted = false;
  if (st.phase === 'start') {
    if (!atStart && st.tLeftStart === 0) st.tLeftStart = tMs;
    if (atEnd) { st.phase = 'end'; st.tEnd = tMs; }
  } else if (atStart) {
    st.phase = 'start';
    st.reps += 1;
    st.tLeftStart = 0;
    st.tEnd = 0;
    repCompleted = true;
  }

  // ── fault evaluation ───────────────────────────────────────────────────────────────────
  const faults = [];
  for (const f of ex.faults) {
    const phaseOk = f.phase === 'any' || f.phase === st.phase;
    const viewOk = !f.view || f.view === view;
    const sidesOk = !f.bothSides || ['left', 'right'].every(
      (s) => (lm[IDX[s].elbow]?.visibility ?? 0) >= 0.5,
    );

    if (!phaseOk || !viewOk || !sidesOk || !f.test(ctx)) {
      st.faultFrames[f.id] = 0;
      continue;
    }
    st.faultFrames[f.id] = (st.faultFrames[f.id] ?? 0) + 1;
    if (st.faultFrames[f.id] === HOLD_FRAMES) {
      st.faultCounts[f.id] = (st.faultCounts[f.id] ?? 0) + 1;
      faults.push({ id: f.id, cue: f.cue });
    }
  }

  return { visible: true, angle: a, phase: st.phase, reps: st.reps, repCompleted, faults, side };
}
