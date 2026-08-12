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

// ── shared fault builders ────────────────────────────────────────────────────────────────
// Most lifts fail in the same handful of ways, so these are parameterised rather than retyped.

const lockoutFault = (cue, joint = 'elbow', phase = 'start') => ({
  id: 'lockout', cue, phase,
  test: (c) => c.jointAngle(joint) < c.T.lockout,
});

const torsoLeanFault = (cue, id = 'torso') => ({
  id, cue, phase: 'any',
  test: (c) => torsoLean(c.W.hip, c.W.shoulder) > c.T.torsoLean,
});

const fastEccentricFault = (cue) => ({
  id: 'eccentric', cue, phase: 'end',
  // Time from leaving the start position to arriving at the finish position.
  test: (c) => c.st.tEnd > 0 && c.st.tLeftStart > 0 && c.st.tEnd - c.st.tLeftStart < c.T.eccentricMs,
});

/** Upper arm swinging away from the torso — the universal cheat on every arm isolation lift. */
const upperArmFault = (cue) => ({
  id: 'elbowDrift', cue, phase: 'any',
  test: (c) => c.jointAngle('shoulder') > c.T.upperArm,
});

/** Stopped short at the finish position. `over` = the angle is too LARGE at the bottom. */
const shortRangeFault = (cue, joint = 'elbow') => ({
  id: 'depth', cue, phase: 'end',
  test: (c) => c.jointAngle(joint) > c.T.depth,
});

/** Bar drifting away from the body — measured against leg length so it scales with the lifter. */
const barDriftFault = (cue, ref = 'knee') => ({
  id: 'barDrift', cue, phase: 'any',
  test: (c) => {
    const legLen = Math.hypot(c.W.hip.x - c.W.ankle.x, c.W.hip.y - c.W.ankle.y);
    if (legLen < 1e-6) return false;
    return Math.abs(c.W.wrist.x - c.W[ref].x) / legLen > c.T.barDrift;
  },
});

// ── the lifts ────────────────────────────────────────────────────────────────────────────
//
// `group` drives the category picker. `view` is the camera angle the rules assume; faults that
// carry their own `view` are gated to it, because guessing at something the camera physically
// cannot see is worse than staying quiet.

const ARMS_SIDE = ['shoulder', 'elbow', 'wrist', 'hip'];
const LEGS_SIDE = ['shoulder', 'hip', 'knee', 'ankle'];

/** Bench and its incline variant differ only in bench angle, which the rules do not see. */
const benchLike = (name, cameraHint, over = {}) => ({
  name, group: 'Chest', view: 'side', cameraHint, needs: ARMS_SIDE,
  rep: { start: 165, end: 80 },
  primary: (c) => c.jointAngle('elbow'),
  thresholds: { lockout: 163, flare: 75, wristBend: 155, asymmetry: 22, eccentricMs: 600, ...over },
  faults: [
    {
      id: 'flare',
      cue: 'Tuck the elbows. Around forty-five degrees, not flared out.',
      phase: 'end',
      test: (c) => c.jointAngle('shoulder') > c.T.flare,
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
});

/** Barbell and hammer curls differ only by grip, which pose estimation cannot see. */
const curlLike = (name, cameraHint) => ({
  name, group: 'Biceps', view: 'side', cameraHint, needs: ARMS_SIDE,
  rep: { start: 163, end: 55 },
  primary: (c) => c.jointAngle('elbow'),
  thresholds: { lockout: 155, upperArm: 28, torsoLean: 14, eccentricMs: 500 },
  faults: [
    upperArmFault('Elbows still. Stop swinging them forward.'),
    torsoLeanFault('Stop swinging. Stand still and let the biceps work.', 'swing'),
    lockoutFault('All the way down. Full stretch at the bottom.'),
    fastEccentricFault('Slow the negative down.'),
  ],
});

export const EXERCISES = {
  // ── Legs ───────────────────────────────────────────────────────────────────────────────
  squat: {
    name: 'Back squat',
    group: 'Legs',
    view: 'side',
    cameraHint: 'Phone side-on at hip height, 2–3 m away. Whole body and both feet in frame.',
    needs: LEGS_SIDE,
    rep: { start: 168, end: 95 },
    primary: (c) => c.jointAngle('knee'),
    thresholds: {
      lockout: 160, torsoLean: 55, depthGap: 0.0, heelLift: 0.30, valgusRatio: 0.82, eccentricMs: 0,
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

  rdl: {
    name: 'Romanian deadlift',
    group: 'Legs',
    view: 'side',
    cameraHint: 'Phone side-on at hip height. Whole body and the bar in frame.',
    needs: LEGS_SIDE,
    // Standing tall → hinged over → standing tall. Driven by the hip, not the knee.
    rep: { start: 165, end: 100 },
    primary: (c) => c.jointAngle('hip'),
    thresholds: { lockout: 158, kneeMin: 150, barDrift: 0.16, depth: 115, eccentricMs: 0 },
    faults: [
      {
        id: 'kneeBend',
        cue: 'Less knee bend. Push the hips back, this is a hinge.',
        phase: 'any',
        test: (c) => c.jointAngle('knee') < c.T.kneeMin,
      },
      barDriftFault('Keep the bar against your legs.', 'knee'),
      lockoutFault('Stand all the way up. Squeeze the glutes.', 'hip'),
      shortRangeFault('Hinge further. Feel the hamstrings stretch.', 'hip'),
    ],
  },

  lunge: {
    name: 'Lunge',
    group: 'Legs',
    view: 'side',
    cameraHint: 'Phone side-on at hip height, on your working leg. Both feet in frame.',
    needs: LEGS_SIDE,
    rep: { start: 165, end: 95 },
    primary: (c) => c.jointAngle('knee'),
    thresholds: { lockout: 158, torsoLean: 25, depth: 105, eccentricMs: 0 },
    faults: [
      shortRangeFault('Deeper. Back knee toward the floor.', 'knee'),
      torsoLeanFault('Chest up. Stay tall through the torso.'),
      lockoutFault('Stand all the way up between reps.', 'knee'),
    ],
  },

  // ── Chest ──────────────────────────────────────────────────────────────────────────────
  bench: benchLike(
    'Bench press',
    'Phone at bench height, side-on or 45° from the foot end. Both arms in frame.',
  ),

  inclineBench: benchLike(
    'Incline bench press',
    'Phone at bench height, side-on. Both arms and the bar path in frame.',
    { flare: 70 }, // an incline naturally rides a touch more tucked
  ),

  pushup: {
    name: 'Push-up',
    group: 'Chest',
    view: 'side',
    cameraHint: 'Phone on the floor, side-on, 2 m away. Head to heels in frame.',
    needs: ['shoulder', 'elbow', 'wrist', 'hip', 'knee'],
    rep: { start: 165, end: 90 },
    primary: (c) => c.jointAngle('elbow'),
    thresholds: { lockout: 160, flare: 70, plank: 163, depth: 100, eccentricMs: 0 },
    faults: [
      {
        id: 'plank',
        cue: 'Straight line from head to heels. Squeeze your glutes.',
        phase: 'any',
        test: (c) => angle(c.W.shoulder, c.W.hip, c.W.knee) < c.T.plank,
      },
      {
        id: 'flare',
        cue: 'Elbows back, not out to the sides.',
        phase: 'end',
        test: (c) => c.jointAngle('shoulder') > c.T.flare,
      },
      shortRangeFault('Lower all the way. Chest to the floor.'),
      lockoutFault('Push all the way up.'),
    ],
  },

  // ── Back ───────────────────────────────────────────────────────────────────────────────
  deadlift: {
    name: 'Deadlift',
    group: 'Back',
    view: 'side',
    cameraHint: 'Phone side-on at hip height, 2–3 m away. Bar, shins and whole body in frame.',
    needs: LEGS_SIDE,
    rep: { start: 165, end: 105 },
    primary: (c) => c.jointAngle('hip'),
    thresholds: { lockout: 158, barDrift: 0.14, depth: 125, torsoLean: 90, eccentricMs: 0 },
    faults: [
      barDriftFault('Bar is drifting away from your shins. Drag it up your legs.'),
      lockoutFault('Finish the lockout. Hips through, glutes tight.', 'hip'),
      shortRangeFault('Get your hips down to the bar before you pull.', 'hip'),
    ],
  },

  row: {
    name: 'Barbell row',
    group: 'Back',
    view: 'side',
    cameraHint: 'Phone side-on at hip height. Torso, bar and both arms in frame.',
    needs: ARMS_SIDE,
    rep: { start: 165, end: 75 },
    primary: (c) => c.jointAngle('elbow'),
    thresholds: { lockout: 158, torsoMin: 32, elbowPath: 55, eccentricMs: 0 },
    faults: [
      {
        id: 'heave',
        cue: 'Stay hinged over. Stop standing up into it.',
        phase: 'any',
        // A bent row lives at roughly 45° from vertical; standing up is how people cheat it.
        test: (c) => torsoLean(c.W.hip, c.W.shoulder) < c.T.torsoMin,
      },
      {
        id: 'elbowPath',
        cue: 'Elbows tight to your body. Row to your hip, not your chest.',
        phase: 'end',
        test: (c) => c.jointAngle('shoulder') > c.T.elbowPath,
      },
      lockoutFault('Full stretch at the bottom. Let the bar hang.'),
    ],
  },

  latPulldown: {
    name: 'Lat pulldown',
    group: 'Back',
    view: 'side',
    cameraHint: 'Phone side-on at chest height. Torso and both arms in frame.',
    needs: ARMS_SIDE,
    rep: { start: 168, end: 60 },
    primary: (c) => c.jointAngle('elbow'),
    thresholds: { lockout: 160, torsoLean: 28, depth: 80, eccentricMs: 0 },
    faults: [
      torsoLeanFault('Stop leaning back. Pull with your lats, not your bodyweight.'),
      lockoutFault('Full stretch at the top. Let your shoulders rise.'),
      shortRangeFault('Bar to your upper chest.'),
    ],
  },

  // ── Shoulders ──────────────────────────────────────────────────────────────────────────
  ohp: {
    name: 'Overhead press',
    group: 'Shoulders',
    view: 'side',
    cameraHint: 'Phone side-on at chest height, 2–3 m away. Full overhead reach in frame.',
    needs: ARMS_SIDE,
    // Racked at the shoulders → locked out overhead. Inverted arc, like the pushdown.
    rep: { start: 80, end: 172 },
    primary: (c) => c.jointAngle('elbow'),
    thresholds: { lockout: 165, torsoLean: 16, barPath: 0.22, eccentricMs: 0 },
    faults: [
      torsoLeanFault('Stop leaning back. Squeeze your glutes and press vertically.', 'arch'),
      {
        id: 'lockout',
        cue: 'Lock it out overhead.',
        phase: 'end',
        test: (c) => c.jointAngle('elbow') < c.T.lockout,
      },
      {
        id: 'barPath',
        cue: 'Press straight up. The bar should finish over your ears.',
        phase: 'end',
        test: (c) => {
          const torso = Math.hypot(c.W.shoulder.x - c.W.hip.x, c.W.shoulder.y - c.W.hip.y);
          if (torso < 1e-6) return false;
          return Math.abs(c.W.wrist.x - c.W.shoulder.x) / torso > c.T.barPath;
        },
      },
    ],
  },

  lateralRaise: {
    name: 'Lateral raise',
    group: 'Shoulders',
    view: 'front',
    cameraHint: 'Phone FRONT-ON at chest height. Both arms in frame — this one needs a front view.',
    needs: ARMS_SIDE,
    // Abduction at the shoulder, not the elbow: arms down → out to shoulder height.
    rep: { start: 18, end: 82 },
    primary: (c) => c.jointAngle('shoulder'),
    thresholds: { maxHeight: 105, elbowStraight: 145, torsoLean: 12, eccentricMs: 400 },
    faults: [
      {
        id: 'tooHigh',
        cue: 'Stop at shoulder height. Higher is your traps, not your delts.',
        phase: 'end',
        test: (c) => c.jointAngle('shoulder') > c.T.maxHeight,
      },
      {
        id: 'elbowBend',
        cue: 'Keep the elbow fixed. You are curling it up.',
        phase: 'any',
        test: (c) => c.jointAngle('elbow') < c.T.elbowStraight,
      },
      torsoLeanFault('No swinging. Let the weight do the work on the way down.', 'swing'),
      fastEccentricFault('Lower it under control.'),
    ],
  },

  // ── Biceps ─────────────────────────────────────────────────────────────────────────────
  curl: curlLike('Barbell curl', 'Phone side-on at chest height. Torso and both arms in frame.'),
  hammerCurl: curlLike('Hammer curl', 'Phone side-on at chest height. Torso and both arms in frame.'),

  // ── Triceps ────────────────────────────────────────────────────────────────────────────
  pushdown: {
    name: 'Cable pushdown',
    group: 'Triceps',
    view: 'side',
    cameraHint: 'Phone side-on at chest height. Whole torso and the working arm in frame.',
    needs: ARMS_SIDE,
    // Elbow flexed at the top → locked out at the bottom. Inverted arc.
    rep: { start: 70, end: 172 },
    primary: (c) => c.jointAngle('elbow'),
    thresholds: { lockout: 165, upperArm: 35, torsoLean: 18, eccentricMs: 0 },
    faults: [
      upperArmFault('Pin your elbows to your ribs. You are pressing, not pushing down.'),
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
    group: 'Triceps',
    view: 'side',
    cameraHint: 'Phone low and side-on, roughly bench height, level with your shoulder.',
    needs: ARMS_SIDE,
    rep: { start: 163, end: 60 },
    primary: (c) => c.jointAngle('elbow'),
    thresholds: { lockout: 160, upperArmTarget: 92, upperArmTol: 20, depth: 72, eccentricMs: 700 },
    faults: [
      {
        id: 'upperArm',
        cue: 'Upper arms still. You are turning it into a pullover.',
        phase: 'any',
        test: (c) => Math.abs(c.jointAngle('shoulder') - c.T.upperArmTarget) > c.T.upperArmTol,
      },
      lockoutFault('Lock it out at the top.'),
      shortRangeFault('Go deeper. Bring it to your forehead.'),
      fastEccentricFault('Slow the negative down.'),
    ],
  },

  dip: {
    name: 'Triceps dip',
    group: 'Triceps',
    view: 'side',
    cameraHint: 'Phone side-on at chest height, 2 m away. Whole body in frame.',
    needs: ARMS_SIDE,
    rep: { start: 168, end: 85 },
    primary: (c) => c.jointAngle('elbow'),
    thresholds: { lockout: 162, torsoLean: 22, depth: 100, eccentricMs: 500 },
    faults: [
      shortRangeFault('Deeper. Upper arms to parallel.'),
      torsoLeanFault('Stay upright. Leaning forward turns this into a chest dip.'),
      lockoutFault('Lock the elbows out at the top.'),
      fastEccentricFault('Control the descent.'),
    ],
  },
};

// ── planning metadata ────────────────────────────────────────────────────────────────────
// Kept in one table rather than sprinkled through the definitions above, because it belongs to
// the planner, not the form rules — those two never need to change together.
//
//   equipment  what you need to do it, so the planner can skip what your gym lacks
//   compound   multi-joint lifts get the heavy low-rep slots and go first in a session
//   avoidFor   injuries this lift aggravates
//   loadRatio  starting weight as a fraction of bodyweight; 0 means the lift IS your bodyweight

const META = {
  squat:        { equipment: 'barbell',    compound: true,  avoidFor: ['knee', 'lowerBack'], loadRatio: 0.60 },
  rdl:          { equipment: 'barbell',    compound: true,  avoidFor: ['lowerBack'],         loadRatio: 0.50 },
  lunge:        { equipment: 'dumbbell',   compound: true,  avoidFor: ['knee'],              loadRatio: 0.20 },
  bench:        { equipment: 'barbell',    compound: true,  avoidFor: ['shoulder'],          loadRatio: 0.50 },
  inclineBench: { equipment: 'barbell',    compound: true,  avoidFor: ['shoulder'],          loadRatio: 0.40 },
  pushup:       { equipment: 'bodyweight', compound: true,  avoidFor: [],                    loadRatio: 0 },
  deadlift:     { equipment: 'barbell',    compound: true,  avoidFor: ['lowerBack'],         loadRatio: 0.75 },
  row:          { equipment: 'barbell',    compound: true,  avoidFor: ['lowerBack'],         loadRatio: 0.45 },
  latPulldown:  { equipment: 'cable',      compound: true,  avoidFor: [],                    loadRatio: 0.50 },
  ohp:          { equipment: 'barbell',    compound: true,  avoidFor: ['shoulder'],          loadRatio: 0.30 },
  lateralRaise: { equipment: 'dumbbell',   compound: false, avoidFor: ['shoulder'],          loadRatio: 0.06 },
  curl:         { equipment: 'barbell',    compound: false, avoidFor: ['elbow'],             loadRatio: 0.20 },
  hammerCurl:   { equipment: 'dumbbell',   compound: false, avoidFor: ['elbow'],             loadRatio: 0.10 },
  pushdown:     { equipment: 'cable',      compound: false, avoidFor: ['elbow'],             loadRatio: 0.25 },
  skullcrusher: { equipment: 'barbell',    compound: false, avoidFor: ['elbow'],             loadRatio: 0.20 },
  dip:          { equipment: 'bodyweight', compound: true,  avoidFor: ['shoulder', 'elbow'], loadRatio: 0 },
};

for (const [id, m] of Object.entries(META)) Object.assign(EXERCISES[id], m);

export const EQUIPMENT = ['barbell', 'dumbbell', 'cable', 'bodyweight'];
export const INJURIES = ['shoulder', 'elbow', 'lowerBack', 'knee'];

/** Exercises grouped for the category picker, in a sensible training order. */
export const GROUPS = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Legs'];

export function byGroup(group) {
  return Object.entries(EXERCISES).filter(([, ex]) => ex.group === group).map(([id, ex]) => ({ id, ...ex }));
}

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
    repMs: [],        // duration of each completed rep; late reps slowing down is fatigue
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

  const JOINTS = {
    knee: () => angle(W.hip, W.knee, W.ankle),
    elbow: () => angle(W.shoulder, W.elbow, W.wrist),
    hip: () => angle(W.shoulder, W.hip, W.knee),
    shoulder: () => angle(W.hip, W.shoulder, W.elbow), // upper arm relative to the torso
  };

  const ctx = { lm, w, P, W, T, st, side, view, jointAngle: (j) => JOINTS[j]() };

  const raw = ex.primary(ctx);
  st.ema = st.ema === null ? raw : st.ema + EMA_ALPHA * (raw - st.ema);
  const a = st.ema;

  // ── rep state machine ──────────────────────────────────────────────────────────────────
  // `dir` is +1 when the working phase increases the angle (pushdown, overhead press, lateral
  // raise) and -1 when it decreases it (squat, bench, curl). One machine covers both.
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
    if (st.tLeftStart) st.repMs.push(tMs - st.tLeftStart);
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
