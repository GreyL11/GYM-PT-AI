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

/** Upper arm held at a FIXED angle while the elbow does the work — the rule for every
 *  overhead/lying triceps extension. Drifting off that angle turns it into a different lift. */
const fixedUpperArmFault = (cue) => ({
  id: 'upperArm', cue, phase: 'any',
  test: (c) => Math.abs(c.jointAngle('shoulder') - c.T.upperArmTarget) > c.T.upperArmTol,
});

/** Elbows travelling out away from the ribs on a row. */
const elbowPathFault = (cue) => ({
  id: 'elbowPath', cue, phase: 'end',
  test: (c) => c.jointAngle('shoulder') > c.T.elbowPath,
});

/** Stopped short at the finish position. `over` = the angle is too LARGE at the bottom. */
const shortRangeFault = (cue, joint = 'elbow') => ({
  id: 'depth', cue, phase: 'end',
  test: (c) => c.jointAngle(joint) > c.T.depth,
});

/** Lifts done leaning over: standing up out of the lean is how the weight gets cheated up.
 *  Also the rule for lifts where a lean is REQUIRED — a chest dip done upright is a triceps dip. */
const minLeanFault = (cue, id = 'heave') => ({
  id, cue, phase: 'any',
  test: (c) => torsoLean(c.W.hip, c.W.shoulder) < c.T.torsoMin,
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

/**
 * Straight-arm raises — side, front and rear delt. The delt they hit is the PLANE the arm travels
 * through, which is a camera-view difference, not a rules difference: every one of them is the
 * shoulder opening from ~15° to shoulder height with a fixed elbow.
 *
 * `hinged` swaps the torso rule round. Upright raises fault on leaning (that's swinging the weight
 * up); a rear delt raise is done hinged over, so there the fault is standing back UP out of it.
 */
const raiseLike = (name, view, cameraHint, { hinged = false, ...over } = {}) => ({
  name, group: 'Shoulders', view, cameraHint, needs: ARMS_SIDE,
  // Rotation at the shoulder, not the elbow: arm hanging down → up to shoulder height.
  rep: { start: 18, end: 82 },
  primary: (c) => c.jointAngle('shoulder'),
  thresholds: {
    maxHeight: 105, elbowStraight: 145, eccentricMs: 400,
    ...(hinged ? { torsoMin: 50 } : { torsoLean: 12 }),
    ...over,
  },
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
    hinged
      ? minLeanFault('Stay hinged over. Stop standing up into it.')
      : torsoLeanFault('No swinging. Let the weight do the work on the way down.', 'swing'),
    fastEccentricFault('Lower it under control.'),
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

  // Upper chest, lower chest and flat are the same press at a different bench angle — which the
  // rules genuinely cannot see, so they are separate lifts only so the planner and the log can
  // tell them apart. The flare tolerance is the one thing the angle actually changes.
  inclineBench: benchLike(
    'Incline bench press',
    'Phone at bench height, side-on. Both arms and the bar path in frame.',
    { flare: 70 }, // an incline naturally rides a touch more tucked
  ),

  declineBench: benchLike(
    'Decline bench press',
    'Phone at bench height, side-on. Both arms and the bar path in frame.',
    { flare: 82 }, // a decline presses wider, and that is not a fault here
  ),

  dbBench: benchLike(
    'Dumbbell bench press',
    'Phone at bench height, side-on or 45° from the foot end. Both arms in frame.',
  ),

  inclineDbPress: benchLike(
    'Incline dumbbell press',
    'Phone at bench height, side-on. Both arms in frame.',
    { flare: 70 },
  ),

  chestDip: {
    name: 'Chest dip',
    group: 'Chest',
    view: 'side',
    cameraHint: 'Phone side-on at chest height, 2 m away. Whole body in frame.',
    needs: ARMS_SIDE,
    rep: { start: 168, end: 85 },
    primary: (c) => c.jointAngle('elbow'),
    thresholds: { lockout: 162, torsoMin: 20, depth: 100, eccentricMs: 500 },
    faults: [
      // The mirror image of the triceps dip rule: here the forward lean is the whole point.
      minLeanFault('Lean forward over your hands. Upright makes this a triceps dip.', 'upright'),
      shortRangeFault('Deeper. Chest down between your hands.'),
      lockoutFault('Lock the elbows out at the top.'),
      fastEccentricFault('Control the descent.'),
    ],
  },

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
      // A bent row lives at roughly 45° from vertical; standing up is how people cheat it.
      minLeanFault('Stay hinged over. Stop standing up into it.'),
      elbowPathFault('Elbows tight to your body. Row to your hip, not your chest.'),
      lockoutFault('Full stretch at the bottom. Let the bar hang.'),
    ],
  },

  cableRow: {
    name: 'Seated cable row',
    group: 'Back',
    view: 'side',
    cameraHint: 'Phone side-on at chest height. Torso, both arms and the handle in frame.',
    needs: ARMS_SIDE,
    rep: { start: 165, end: 75 },
    primary: (c) => c.jointAngle('elbow'),
    thresholds: { lockout: 158, torsoLean: 22, elbowPath: 50, eccentricMs: 0 },
    faults: [
      torsoLeanFault('Stop rocking. Move it with your back, not your bodyweight.'),
      elbowPathFault('Elbows tight past your ribs, not out wide.'),
      lockoutFault('Let your arms straighten all the way out at the front.'),
    ],
  },

  straightArmPulldown: {
    name: 'Straight-arm pulldown',
    group: 'Back',
    view: 'side',
    cameraHint: 'Phone side-on at chest height, 2 m away. Whole torso and the working arm in frame.',
    needs: ARMS_SIDE,
    // Driven by the shoulder, not the elbow: arms sweep from overhead-forward down to the thighs.
    rep: { start: 148, end: 25 },
    primary: (c) => c.jointAngle('shoulder'),
    thresholds: { lockout: 140, elbowStraight: 155, torsoLean: 22, depth: 40, eccentricMs: 0 },
    faults: [
      {
        id: 'elbowBend',
        cue: 'Arms straight. Bending the elbow makes this a pulldown.',
        phase: 'any',
        test: (c) => c.jointAngle('elbow') < c.T.elbowStraight,
      },
      torsoLeanFault('Hold your hinge. Stop bobbing up and down.'),
      lockoutFault('Let your arms rise all the way back up for the stretch.', 'shoulder'),
      shortRangeFault('All the way to your thighs.', 'shoulder'),
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

  // Side delt: arm goes out sideways, so the movement is in the frontal plane — the camera has to
  // be in front of you or it is watching an arm come straight at it.
  lateralRaise: raiseLike(
    'Lateral raise', 'front',
    'Phone FRONT-ON at chest height. Both arms in frame — this one needs a front view.',
  ),

  // Front delt: arm goes out forwards, so this one is the side-on view instead.
  frontRaise: raiseLike(
    'Front raise', 'side',
    'Phone SIDE-ON at chest height, 2 m away. Torso and the working arm in frame.',
    { elbowStraight: 150 },
  ),

  // Rear delt: hinged over, arms out sideways. Frontal plane again, but you are folded over it, so
  // the phone goes low.
  rearDeltRaise: raiseLike(
    'Rear delt raise', 'front',
    'Phone FRONT-ON and LOW, roughly knee height, 2 m away. Hinge over facing it.',
    { hinged: true, maxHeight: 100, elbowStraight: 140 },
  ),

  // The cable versions are the same arc against constant tension, so the same rules hold. They
  // exist separately because a cable stack and a dumbbell rack are not the same gym.
  cableLateralRaise: raiseLike(
    'Cable lateral raise', 'front',
    'Phone FRONT-ON at chest height, working side nearest the stack. Both arms in frame.',
  ),

  cableFrontRaise: raiseLike(
    'Cable front raise', 'side',
    'Phone SIDE-ON at chest height, 2 m away. Torso and the working arm in frame.',
    { elbowStraight: 150 },
  ),

  // ── Biceps ─────────────────────────────────────────────────────────────────────────────
  curl: curlLike('Barbell curl', 'Phone side-on at chest height. Torso and both arms in frame.'),
  hammerCurl: curlLike('Hammer curl', 'Phone side-on at chest height. Torso and both arms in frame.'),
  cableCurl: curlLike('Cable curl', 'Phone side-on at chest height. Torso and both arms in frame.'),

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
      fixedUpperArmFault('Upper arms still. You are turning it into a pullover.'),
      lockoutFault('Lock it out at the top.'),
      shortRangeFault('Go deeper. Bring it to your forehead.'),
      fastEccentricFault('Slow the negative down.'),
    ],
  },

  overheadExtension: {
    name: 'Overhead cable extension',
    group: 'Triceps',
    view: 'side',
    cameraHint: 'Phone side-on at chest height, facing away from the stack. Full overhead reach in frame.',
    needs: ARMS_SIDE,
    rep: { start: 165, end: 65 },
    primary: (c) => c.jointAngle('elbow'),
    // Same lift as the skullcrusher, stood up: the upper arms are held overhead instead of vertical.
    thresholds: { lockout: 158, upperArmTarget: 158, upperArmTol: 22, depth: 80, eccentricMs: 500 },
    faults: [
      fixedUpperArmFault('Upper arms stay overhead. Only the elbow moves.'),
      lockoutFault('Squeeze it out straight at the top.'),
      shortRangeFault('Deeper. Let it stretch behind your head.'),
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

// ── fault severity ───────────────────────────────────────────────────────────────────────
//
// The app learns what is normal FOR YOU and stops nagging about it. That is right for technique
// preferences and catastrophically wrong for injury risk: "you have rounded the bar off your shins
// on all twenty sets" is not evidence that it is fine for you.
//
// So faults split in two. `safety` faults are never baselined away and never suppressed, no matter
// how habitual. Everything else is `efficiency` — worth mentioning, not worth nagging.
//
// Note the same fault id can be either, depending on the lift: torso lean is a spinal-load problem
// on a squat and merely sloppy on a pulldown.
const SAFETY = {
  squat: ['valgus', 'torso'],      // knees caving, folding under a loaded bar
  deadlift: ['barDrift'],          // bar away from the shins is the classic back-rounder
  rdl: ['barDrift'],
  ohp: ['arch'],                   // hyperextending the lumbar to press
  bench: ['flare', 'wrist'],       // shoulder and wrist joints
  inclineBench: ['flare', 'wrist'],
  declineBench: ['flare', 'wrist'],
  dbBench: ['flare', 'wrist'],
  inclineDbPress: ['flare', 'wrist'],
  pushup: ['plank'],               // sagging hips load the lower back
  row: ['heave'],                  // jerking a loaded bar with the spine
  curl: ['swing'],
  hammerCurl: ['swing'],
  lateralRaise: ['tooHigh'],       // above shoulder height is impingement territory
  frontRaise: ['tooHigh'],
  cableLateralRaise: ['tooHigh'],
  cableFrontRaise: ['tooHigh'],
  cableCurl: ['swing'],
  // ponytail: rear delt raise gets no safety fault. Its 'heave' is the same rule as the row's, but
  // at rear-delt loads standing up out of the hinge is sloppy, not dangerous — and marking it
  // safety would mean nagging about it forever.
};

export const isSafetyFault = (exId, faultId) => (SAFETY[exId] ?? []).includes(faultId);

// Stamp it onto the rules themselves so step() can report it without a lookup.
for (const [id, ex] of Object.entries(EXERCISES)) {
  for (const f of ex.faults) f.severity = isSafetyFault(id, f.id) ? 'safety' : 'efficiency';
}

// ── calibration ──────────────────────────────────────────────────────────────────────────

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

/** Below this the lifter clearly wasn't repping — refuse rather than save nonsense. */
export const MIN_RANGE_DEG = 25;

/**
 * Turn a recording of someone lifting into thresholds for that person.
 *
 * Only ANATOMY is calibrated: where your rep actually starts and ends, what your lockout looks
 * like, how deep your bottom position is. Technique tolerances — elbow flare, torso lean, upper-arm
 * drift — are deliberately NOT learned, because calibrating those from your own reps would bake
 * whatever you currently do wrong in as the new definition of correct.
 *
 * @param {Array} samples  the `m` object from step(), one per frame
 * @returns {object|null}  a thresholds patch, or null if there wasn't enough movement to learn from
 */
export function calibrate(exId, samples) {
  const ex = EXERCISES[exId];
  const primary = samples.map((s) => s.primary).filter(Number.isFinite).sort((a, b) => a - b);
  if (primary.length < 30) return null;

  // Percentiles, not min/max: a single bad frame should not define your range of motion.
  const lo = percentile(primary, 0.05);
  const hi = percentile(primary, 0.95);
  if (hi - lo < MIN_RANGE_DEG) return null;

  const MARGIN = 5; // sit just inside the observed extremes so the endpoints reliably trigger
  const towardsHigh = ex.rep.end > ex.rep.start;
  const patch = {
    repStart: Math.round(towardsHigh ? lo + MARGIN : hi - MARGIN),
    repEnd: Math.round(towardsHigh ? hi - MARGIN : lo + MARGIN),
  };

  // The extended position, whichever end of the arc it sits at for this lift.
  if ('lockout' in ex.thresholds) patch.lockout = Math.min(180, Math.round(hi - MARGIN));
  // The bottom position: "you stopped short" should mean short of YOUR bottom.
  if ('depth' in ex.thresholds) patch.depth = Math.max(10, Math.round(lo + MARGIN));

  return patch;
}

// ── planning metadata ────────────────────────────────────────────────────────────────────
// Kept in one table rather than sprinkled through the definitions above, because it belongs to
// the planner, not the form rules — those two never need to change together.
//
//   equipment  what you need to do it, so the planner can skip what your gym lacks
//   compound   multi-joint lifts get the heavy low-rep slots and go first in a session
//   avoidFor   injuries this lift aggravates
//   loadRatio  starting weight as a fraction of bodyweight; 0 means the lift IS your bodyweight.
//              For dumbbell lifts this is PER HAND, which is how they are loaded and logged.

const META = {
  squat:        { equipment: 'barbell',    compound: true,  avoidFor: ['knee', 'lowerBack'], loadRatio: 0.60 },
  rdl:          { equipment: 'barbell',    compound: true,  avoidFor: ['lowerBack'],         loadRatio: 0.50 },
  lunge:        { equipment: 'dumbbell',   compound: true,  avoidFor: ['knee'],              loadRatio: 0.20 },
  bench:        { equipment: 'barbell',    compound: true,  avoidFor: ['shoulder'],          loadRatio: 0.50 },
  inclineBench: { equipment: 'barbell',    compound: true,  avoidFor: ['shoulder'],          loadRatio: 0.40 },
  declineBench: { equipment: 'barbell',    compound: true,  avoidFor: ['shoulder'],          loadRatio: 0.45 },
  dbBench:      { equipment: 'dumbbell',   compound: true,  avoidFor: ['shoulder'],          loadRatio: 0.20 },
  inclineDbPress:{ equipment: 'dumbbell',  compound: true,  avoidFor: ['shoulder'],          loadRatio: 0.16 },
  chestDip:     { equipment: 'bodyweight', compound: true,  avoidFor: ['shoulder', 'elbow'], loadRatio: 0 },
  pushup:       { equipment: 'bodyweight', compound: true,  avoidFor: [],                    loadRatio: 0 },
  deadlift:     { equipment: 'barbell',    compound: true,  avoidFor: ['lowerBack'],         loadRatio: 0.75 },
  row:          { equipment: 'barbell',    compound: true,  avoidFor: ['lowerBack'],         loadRatio: 0.45 },
  latPulldown:  { equipment: 'cable',      compound: true,  avoidFor: [],                    loadRatio: 0.50 },
  // Supported and horizontal, so unlike the barbell row it survives a bad lower back — which is
  // the whole reason to keep it in the catalogue.
  cableRow:     { equipment: 'cable',      compound: true,  avoidFor: [],                    loadRatio: 0.45 },
  straightArmPulldown:
                { equipment: 'cable',      compound: false, avoidFor: [],                    loadRatio: 0.20 },
  ohp:          { equipment: 'barbell',    compound: true,  avoidFor: ['shoulder'],          loadRatio: 0.30 },
  lateralRaise: { equipment: 'dumbbell',   compound: false, avoidFor: ['shoulder'],          loadRatio: 0.06 },
  frontRaise:   { equipment: 'dumbbell',   compound: false, avoidFor: ['shoulder'],          loadRatio: 0.05 },
  rearDeltRaise:{ equipment: 'dumbbell',   compound: false, avoidFor: ['shoulder'],          loadRatio: 0.04 },
  cableLateralRaise:
                { equipment: 'cable',      compound: false, avoidFor: ['shoulder'],          loadRatio: 0.07 },
  cableFrontRaise:
                { equipment: 'cable',      compound: false, avoidFor: ['shoulder'],          loadRatio: 0.06 },
  curl:         { equipment: 'barbell',    compound: false, avoidFor: ['elbow'],             loadRatio: 0.20 },
  hammerCurl:   { equipment: 'dumbbell',   compound: false, avoidFor: ['elbow'],             loadRatio: 0.10 },
  cableCurl:    { equipment: 'cable',      compound: false, avoidFor: ['elbow'],             loadRatio: 0.20 },
  pushdown:     { equipment: 'cable',      compound: false, avoidFor: ['elbow'],             loadRatio: 0.25 },
  overheadExtension:
                { equipment: 'cable',      compound: false, avoidFor: ['elbow'],             loadRatio: 0.20 },
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

/**
 * Thresholds an exercise ships with, cloned so the settings sliders can mutate freely.
 *
 * The rep endpoints ride along as ordinary thresholds rather than living as constants, because
 * they are the most personal numbers in the whole system — your range of motion, not a textbook's.
 * That way calibration, the sliders and localStorage all reach them through one path.
 */
export function defaultThresholds(exId) {
  const ex = EXERCISES[exId];
  return { repStart: ex.rep.start, repEnd: ex.rep.end, ...ex.thresholds };
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
    faultEvents: [],  // {rep, id} per fault firing, in order — see insights.setBreakdown/faultTimeline
    repMs: [],        // duration of each completed rep; late reps slowing down is fatigue
    rejected: 0,      // movements too fast to be reps — kit being moved around, not lifting
    side: null,       // locked at the first visible frame; see step()
    sideLost: 0,
  };
}

/** Is the camera actually where this lift needs it? See cameraCheck(). */
export const VIEW_OK = { side: 0.42, front: 0.55 };

/**
 * Judge the camera angle from the lifter's own shoulders.
 *
 * Filmed side-on, the two shoulders sit almost on top of each other in the image; filmed front-on
 * they are as far apart as the lifter is wide. Comparing that spread against torso height gives a
 * scale-free read on which way the phone is pointing, so a lift that needs a side view can say so
 * before the set rather than quietly measuring distorted angles for all of it.
 *
 * @returns {{spread:number, view:'side'|'front', ok:boolean}|null}
 */
export function cameraCheck(lm, wanted) {
  const ls = lm?.[IDX.left.shoulder], rs = lm?.[IDX.right.shoulder];
  const lh = lm?.[IDX.left.hip], rh = lm?.[IDX.right.hip];
  if (!ls || !rs || !lh || !rh) return null;
  if (Math.min(ls.visibility ?? 0, rs.visibility ?? 0) < 0.4) return null;

  const midShoulderY = (ls.y + rs.y) / 2;
  const midHipY = (lh.y + rh.y) / 2;
  const torso = Math.abs(midHipY - midShoulderY);
  if (torso < 1e-3) return null;

  const spread = Math.abs(ls.x - rs.x) / torso;
  const view = spread < VIEW_OK.side ? 'side' : 'front';
  const ok = wanted === 'side' ? spread < VIEW_OK.front : spread > VIEW_OK.side;
  return { spread, view, ok };
}

// Landmarks arrive already One-Euro filtered (filter.js), so this second pass on the primary angle
// is light — just enough to settle the last of the angle-space noise without adding lag.
const EMA_ALPHA = 0.6;
const HYSTERESIS = 12;   // deg of slop around each rep endpoint, so noise cannot double-count
const HOLD_FRAMES = 3;   // a fault must survive this many frames before it is spoken

/** A joint the tracker is less sure than this about does not get to trigger a correction. */
const MIN_JOINT_VIS = 0.5;

/**
 * Which landmarks a measurement actually reads, discovered by running it against a Proxy that
 * records every property touched.
 *
 * The same trick the fault loop uses. Asking the function rather than maintaining a hand-written
 * list per lift means the two can never drift apart — a rule that changes which joints it uses
 * updates its own requirements by definition.
 */
function jointsUsedBy(fn, ctx, P, W) {
  const touched = new Set();
  const watch = (obj) => new Proxy(obj, {
    get: (t, k) => { if (typeof k === 'string') touched.add(k); return t[k]; },
  });
  const wP = watch(P);
  const wW = watch(W);
  const joints = {
    knee: () => angle(wW.hip, wW.knee, wW.ankle),
    elbow: () => angle(wW.shoulder, wW.elbow, wW.wrist),
    hip: () => angle(wW.shoulder, wW.hip, wW.knee),
    shoulder: () => angle(wW.hip, wW.shoulder, wW.elbow),
  };
  try {
    fn({ ...ctx, P: wP, W: wW, jointAngle: (j) => joints[j]() });
  } catch {
    // A measurement that throws on a half-built skeleton tells us nothing about what it needs;
    // fall back to the lift's declared list rather than guessing it needs nothing.
    return null;
  }
  return [...touched];
}

// The tracked side is locked for the set; these decide when it has genuinely been lost.
const SIDE_LOST_VIS = 0.35;
const SIDE_LOST_FRAMES = 15;

/**
 * Below this, a completed "rep" was not a rep.
 *
 * Racking a pin, loading a plate or waving at someone sweeps the same arc a lift does — an
 * overhead press starts at a bent elbow and finishes at a straight one, which is also what putting
 * a 20 tin on the sleeve looks like. Nobody moves a loaded bar through full range and back in half
 * a second, so anything faster is the gym happening around the camera, not a rep.
 */
export const MIN_REP_MS = 500;

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

  // Which side we track is decided ONCE per set, not per frame.
  //
  // Filmed side-on, your near and far limbs overlap and MediaPipe's per-side visibility scores
  // flicker between them. Re-picking every frame meant the tracked side could swap mid-rep, and the
  // measured angle jumps with it — which reads as a sudden fault. Re-pick only if the chosen side
  // genuinely disappears for a sustained stretch, e.g. you turned around.
  st.side ??= bestSide(lm, ex.needs);
  const held = ex.needs.reduce((s, k) => s + (lm[IDX[st.side][k]]?.visibility ?? 0), 0) / ex.needs.length;
  if (held < SIDE_LOST_VIS) {
    st.sideLost = (st.sideLost ?? 0) + 1;
    if (st.sideLost > SIDE_LOST_FRAMES) { st.side = bestSide(lm, ex.needs); st.sideLost = 0; }
  } else {
    st.sideLost = 0;
  }

  const side = st.side;
  const P = pick(lm, IDX[side]);
  const W = pick(w, IDX[side]);

  const JOINTS = {
    knee: () => angle(W.hip, W.knee, W.ankle),
    elbow: () => angle(W.shoulder, W.elbow, W.wrist),
    hip: () => angle(W.shoulder, W.hip, W.knee),
    shoulder: () => angle(W.hip, W.shoulder, W.elbow), // upper arm relative to the torso
  };

  const ctx = { lm, w, P, W, T, st, side, view, jointAngle: (j) => JOINTS[j]() };

  /**
   * Only what REP COUNTING needs, not every joint the lift's rules mention.
   *
   * This used to demand `ex.needs` in full — so a bench press refused to count a single rep
   * whenever the camera could not see your hip, even though reps come from shoulder/elbow/wrist
   * and the hip is only there for the elbow-flare rule. In a real gym that reads as "step back, I
   * need to see all of you" while you are already against the wall, and it is why setting the
   * phone up ate so much of a session.
   *
   * Nothing is lost by narrowing it: every fault below already records the landmarks its own test
   * touched and skips itself when they are not clear enough (see `confident`). So a half-visible
   * skeleton now counts reps and runs the rules it genuinely can, instead of refusing everything.
   */
  const primaryJoints = jointsUsedBy(ex.primary, ctx, P, W) ?? ex.needs;
  const missing = primaryJoints.filter((k) => (P[k]?.visibility ?? 1) < MIN_JOINT_VIS);
  if (missing.length) {
    st.faultFrames = {};
    return {
      visible: false, missing, angle: st.ema ?? 0, phase: st.phase,
      reps: st.reps, repCompleted: false, faults: [],
    };
  }

  const raw = ex.primary(ctx);
  st.ema = st.ema === null ? raw : st.ema + EMA_ALPHA * (raw - st.ema);
  const a = st.ema;

  // ── rep state machine ──────────────────────────────────────────────────────────────────
  // `dir` is +1 when the working phase increases the angle (pushdown, overhead press, lateral
  // raise) and -1 when it decreases it (squat, bench, curl). One machine covers both.
  const start = T.repStart ?? ex.rep.start;
  const end = T.repEnd ?? ex.rep.end;
  const dir = end > start ? 1 : -1;
  const atEnd = dir * (a - end) >= -HYSTERESIS;
  const atStart = dir * (a - start) <= HYSTERESIS;

  let repCompleted = false;
  if (st.phase === 'start') {
    if (!atStart && st.tLeftStart === 0) st.tLeftStart = tMs;
    if (atEnd) { st.phase = 'end'; st.tEnd = tMs; }
  } else if (atStart) {
    // A rep that took no time did not happen — see MIN_REP_MS. The phase still resets, so the
    // next genuine rep counts normally.
    const took = st.tLeftStart ? tMs - st.tLeftStart : Infinity;
    st.phase = 'start';
    if (took >= MIN_REP_MS) {
      st.reps += 1;
      if (st.tLeftStart) st.repMs.push(took);
      repCompleted = true;
    } else {
      st.rejected = (st.rejected ?? 0) + 1;
    }
    st.tLeftStart = 0;
    st.tEnd = 0;
  }

  // ── fault evaluation ───────────────────────────────────────────────────────────────────
  //
  // Visibility is checked per CHECK, not per exercise. The gate above only asks whether the lift's
  // core joints are visible enough to bother analysing at all; it would then happily run a
  // wrist-stacking test off a wrist the tracker is 51% sure about. Each rule instead abstains on
  // the joints it personally reads — discovered by watching which ones it touches, so the 60-odd
  // rules need no annotation and cannot drift out of sync with what they actually use.
  const faults = [];
  for (const f of ex.faults) {
    const phaseOk = f.phase === 'any' || f.phase === st.phase;
    const viewOk = !f.view || f.view === view;
    const sidesOk = !f.bothSides || ['left', 'right'].every(
      (s) => (lm[IDX[s].elbow]?.visibility ?? 0) >= MIN_JOINT_VIS,
    );

    if (!phaseOk || !viewOk || !sidesOk) {
      st.faultFrames[f.id] = 0;
      continue;
    }

    const touched = new Set();
    const watch = (obj) => new Proxy(obj, {
      get: (t, k) => { if (typeof k === 'string') touched.add(k); return t[k]; },
    });
    const wP = watch(P);
    const wW = watch(W);
    const watchedJoints = {
      knee: () => angle(wW.hip, wW.knee, wW.ankle),
      elbow: () => angle(wW.shoulder, wW.elbow, wW.wrist),
      hip: () => angle(wW.shoulder, wW.hip, wW.knee),
      shoulder: () => angle(wW.hip, wW.shoulder, wW.elbow),
    };
    const fired = f.test({ ...ctx, P: wP, W: wW, jointAngle: (j) => watchedJoints[j]() });
    const confident = [...touched].every((k) => (P[k]?.visibility ?? 1) >= MIN_JOINT_VIS);

    if (!fired || !confident) {
      st.faultFrames[f.id] = 0;
      continue;
    }
    st.faultFrames[f.id] = (st.faultFrames[f.id] ?? 0) + 1;
    if (st.faultFrames[f.id] === HOLD_FRAMES) {
      st.faultCounts[f.id] = (st.faultCounts[f.id] ?? 0) + 1;
      // `severity` was being computed (below, at module load) and then dropped here — every
      // caller downstream (app.js's haptic buzz) had nothing to branch on, so a squat knee-valgus
      // fault and a bench wrist-stacking fault buzzed identically. boxing.js already got this
      // right; this brings gym lifts in line with it.
      faults.push({ id: f.id, cue: f.cue, severity: f.severity });
      // `st.reps` already holds completed reps at this point (the rep machine above runs first),
      // so the rep in progress is st.reps + 1. This is the one thing that was being thrown away
      // every frame — see MOVEMENT_INTELLIGENCE_DESIGN.md for why it matters.
      st.faultEvents.push({ rep: st.reps + 1, id: f.id });
    }
  }

  // Raw readings for calibration, which needs to learn what YOUR angles are rather than
  // whether they tripped a textbook threshold.
  const m = {
    primary: a,
    torsoLean: torsoLean(W.hip, W.shoulder),
    shoulder: JOINTS.shoulder(),
    elbow: JOINTS.elbow(),
    knee: JOINTS.knee(),
    hip: JOINTS.hip(),
  };

  return { visible: true, angle: a, phase: st.phase, reps: st.reps, repCompleted, faults, side, m };
}
