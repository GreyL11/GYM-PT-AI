// Self-check for the angle maths and the rep state machine — the only non-obvious logic here.
// Run: node test_exercises.mjs
//
// Landmarks are synthesised, not recorded. Each body() is geometrically consistent for the joint
// under test and roughly plausible everywhere else, which is all the pure functions can tell.

import assert from 'node:assert/strict';
import {
  EXERCISES, GROUPS, byGroup, defaultThresholds, createState, step, calibrate, cameraCheck,
  angle, torsoLean, IDX,
} from './www/exercises.js';

const rad = (d) => (d * Math.PI) / 180;
const norm = (v) => { const m = Math.hypot(v.x, v.y) || 1; return { x: v.x / m, y: v.y / m }; };
const rot = (v, deg) => ({
  x: v.x * Math.cos(rad(deg)) - v.y * Math.sin(rad(deg)),
  y: v.x * Math.sin(rad(deg)) + v.y * Math.cos(rad(deg)),
});
const add = (p, v, s = 1) => ({ x: p.x + v.x * s, y: p.y + v.y * s });

/** Build a 33-landmark frame. y grows downward, matching MediaPipe. */
function body({
  kneeAngle = 170, elbowAngle = 170, elbowAngleRight = null, shoulderAngle = 20,
  lean = 0, hipY = 0.22, heelLift = 0, spread = 0.06, kneeSpread = null, visibility = 1, wristAngle = 180,
} = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility }));
  const knee = { x: 0.5, y: 0.5 };
  const hip = { x: 0.5 + Math.sin(rad(lean)) * 0.0, y: hipY };

  // Ankle placed so that angle(hip, knee, ankle) is exactly kneeAngle.
  const ankle = add(knee, rot(norm({ x: hip.x - knee.x, y: hip.y - knee.y }), kneeAngle), 0.45);
  // Shoulder sits up the torso, tilted by `lean` degrees off vertical.
  const shoulder = add(hip, { x: Math.sin(rad(lean)), y: -Math.cos(rad(lean)) }, 0.36);

  const arm = (elbAng) => {
    const torsoDir = norm({ x: hip.x - shoulder.x, y: hip.y - shoulder.y });
    const elbow = add(shoulder, rot(torsoDir, shoulderAngle), 0.30);
    const upper = norm({ x: shoulder.x - elbow.x, y: shoulder.y - elbow.y });
    const wrist = add(elbow, rot(upper, elbAng), 0.28);
    const fore = norm({ x: elbow.x - wrist.x, y: elbow.y - wrist.y });
    const index = add(wrist, rot(fore, wristAngle), 0.08);
    return { elbow, wrist, index };
  };

  const heel = { x: ankle.x - 0.04, y: ankle.y + 0.05 - heelLift };
  const toe = { x: ankle.x + 0.14, y: ankle.y + 0.05 };

  for (const side of ['left', 'right']) {
    const dx = (side === 'left' ? -1 : 1) * spread;
    const kdx = (side === 'left' ? -1 : 1) * (kneeSpread ?? spread);
    const a = arm(side === 'right' && elbowAngleRight !== null ? elbowAngleRight : elbowAngle);
    const put = (name, p, ddx = dx) => Object.assign(lm[IDX[side][name]], { x: p.x + ddx, y: p.y });
    put('hip', hip); put('knee', knee, kdx); put('ankle', ankle);
    put('shoulder', shoulder); put('elbow', a.elbow); put('wrist', a.wrist); put('index', a.index);
    put('heel', heel); put('toe', toe);
  }
  return lm;
}

/** Feed frames through step(), collecting every fault id emitted along the way.
 *
 *  Frames are spaced 100ms apart, not one 30fps frame apart. These sequences are a dozen or two
 *  poses describing a whole rep, so at 33ms each a squat took 0.6s — faster than anyone has ever
 *  squatted, and below the floor step() now uses to tell a rep from someone shifting a plate.
 *  The spacing describes the tempo being modelled, not the camera's frame rate. */
function run(exId, frames, opts = {}) {
  const st = createState();
  const T = { ...defaultThresholds(exId), ...(opts.thresholds ?? {}) };
  const seen = [];
  let last;
  frames.forEach((lm, i) => {
    // Same array for lm and w: the synthetic frame is already metric-ish and undistorted.
    last = step(exId, { lm, w: lm, tMs: i * 100, view: opts.view }, st, T);
    for (const f of last.faults) seen.push(f.id);
  });
  return { st, faults: seen, last };
}

const hold = (n, mk) => Array.from({ length: n }, mk);
const ok = [];
const check = (name, fn) => { fn(); ok.push(name); };

// ── geometry primitives ──────────────────────────────────────────────────────────────────

check('angle() measures the interior angle at the middle point', () => {
  assert.equal(Math.round(angle({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 })), 90);
  assert.equal(Math.round(angle({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 0, y: -1 })), 180);
});

check('torsoLean() is 0 upright and symmetric left/right', () => {
  assert.equal(Math.round(torsoLean({ x: 0.5, y: 1 }, { x: 0.5, y: 0 })), 0);
  const l = torsoLean({ x: 0.5, y: 1 }, { x: 0.2, y: 0 });
  const r = torsoLean({ x: 0.5, y: 1 }, { x: 0.8, y: 0 });
  assert.equal(Math.round(l), Math.round(r));
  assert.ok(l > 15);
});

// ── rep counting ─────────────────────────────────────────────────────────────────────────

check('squat counts one rep for a full down-and-up, not for a partial', () => {
  const down = [170, 150, 130, 110, ...Array(5).fill(90)];
  const up = [110, 130, 150, ...Array(6).fill(170)];
  const cycle = (a) => body({ kneeAngle: a, hipY: a < 120 ? 0.55 : 0.22 });

  const full = run('squat', [...down, ...up].map(cycle));
  assert.equal(full.st.reps, 1, 'one full rep');

  const partial = run('squat', [...hold(3, () => cycle(170)), ...[150, 140, 145, 150].map(cycle)]);
  assert.equal(partial.st.reps, 0, 'never reached the bottom, so no rep');
});

check('pushdown counts reps on the inverted arc (flexed → locked → flexed)', () => {
  const frames = [
    ...hold(3, () => body({ elbowAngle: 70 })),
    ...hold(6, () => body({ elbowAngle: 175 })),
    ...hold(6, () => body({ elbowAngle: 70 })),
  ];
  assert.equal(run('pushdown', frames).st.reps, 1);
});

check('kit being moved around is not a set of reps', () => {
  // Reported from a real gym: setting the seat and loading plates for an overhead press counted
  // four reps before the first one. An OHP starts at a bent elbow and finishes at a straight one,
  // which is also what putting a plate on the sleeve looks like — the difference is that nobody
  // does it slowly.
  // Same pose sequence as the overhead-press rep-counting test; only the clock differs. Fewer
  // frames than this and the smoothing never reaches the end position, so nothing completes.
  const poses = [
    ...hold(3, () => body({ elbowAngle: 78 })),
    ...hold(6, () => body({ elbowAngle: 176 })),
    ...hold(6, () => body({ elbowAngle: 78 })),
  ];
  const swing = (ms) => poses.map((lm, i) => ({ lm, tMs: (i * ms) / poses.length }));

  const runTimed = (frames) => {
    const st = createState();
    const T = defaultThresholds('ohp');
    for (const f of frames) step('ohp', { lm: f.lm, w: f.lm, tMs: f.tMs, view: 'side' }, st, T);
    return st;
  };

  assert.equal(runTimed(swing(300)).reps, 0, 'a third of a second is someone moving a weight');
  assert.equal(runTimed(swing(300)).rejected, 1, 'and it is counted as rejected, not lost');
  assert.equal(runTimed(swing(2000)).reps, 1, 'two seconds is a rep');
});

check('jitter around one endpoint does not double-count', () => {
  const frames = hold(30, (_, i) => body({ kneeAngle: 168 + (i % 2 ? 6 : -6) }));
  assert.equal(run('squat', frames).st.reps, 0);
});

// ── faults ───────────────────────────────────────────────────────────────────────────────

check('squat flags a shallow bottom and stays quiet at depth', () => {
  const toBottom = [170, 140, 110].map((a) => body({ kneeAngle: a, hipY: 0.22 }));
  const shallow = run('squat', [...toBottom, ...hold(6, () => body({ kneeAngle: 92, hipY: 0.42 }))]);
  assert.ok(shallow.faults.includes('depth'), 'hip above the knee is shallow');

  const deep = run('squat', [...toBottom, ...hold(6, () => body({ kneeAngle: 92, hipY: 0.58 }))]);
  assert.ok(!deep.faults.includes('depth'), 'hip below the knee is not');
});

check('squat flags folding over, and heels coming up', () => {
  const leaning = run('squat', hold(6, () => body({ kneeAngle: 120, lean: 62 })));
  assert.ok(leaning.faults.includes('torso'));

  const upright = run('squat', hold(6, () => body({ kneeAngle: 120, lean: 20 })));
  assert.ok(!upright.faults.includes('torso'));

  const heels = run('squat', hold(6, () => body({ kneeAngle: 120, heelLift: 0.10 })));
  assert.ok(heels.faults.includes('heel'));
});

// ── movement intelligence: severity propagation, rep-indexed fault events ─────────────────
// `f.severity` was computed at module load and stamped on the RULE (squat: torso/valgus are
// 'safety'), but step() dropped it before it ever reached a caller — every gym-lift fault buzzed
// identically regardless of severity. These check the fix directly against what step() returns,
// not against the rule table, since the rule table was never the part that was broken.

check('a fired fault carries its severity, not just an id and a cue', () => {
  const st = createState();
  const T = defaultThresholds('squat');
  let seenTorso = null;
  let seenHeel = null;
  for (let i = 0; i < 6; i += 1) {
    const out = step('squat', { lm: body({ kneeAngle: 120, lean: 62, heelLift: 0.10 }), w: body({ kneeAngle: 120, lean: 62, heelLift: 0.10 }), tMs: i * 100 }, st, T);
    seenTorso ??= out.faults.find((f) => f.id === 'torso');
    seenHeel ??= out.faults.find((f) => f.id === 'heel');
  }
  assert.equal(seenTorso?.severity, 'safety', 'folding over a loaded squat is a safety fault, not a style note');
  assert.equal(seenHeel?.severity, 'efficiency', 'heels lifting is technique, not injury risk');
});

check('a fault event records which rep it happened on, not just that it happened', () => {
  const down = (lean) => [170, 150, 130, 110, ...Array(5).fill(90)]
    .map((a) => body({ kneeAngle: a, hipY: a < 120 ? 0.55 : 0.22, lean }));
  const up = (lean) => [110, 130, 150, ...Array(6).fill(170)]
    .map((a) => body({ kneeAngle: a, hipY: a < 120 ? 0.55 : 0.22, lean }));

  // Rep 1 clean, rep 2 folds over at the bottom. Only rep 2 should show up against 'torso'.
  const frames = [...down(20), ...up(20), ...down(62), ...up(20)];
  const r = run('squat', frames);
  assert.equal(r.st.reps, 2, 'both reps should have completed');

  const torsoEvents = r.st.faultEvents.filter((e) => e.id === 'torso');
  assert.ok(torsoEvents.length > 0, 'the fold-over should have fired at least once');
  assert.ok(torsoEvents.every((e) => e.rep === 2), `expected every torso event at rep 2, got ${JSON.stringify(torsoEvents)}`);
});

check('faultEvents is present but empty on a clean set, not absent', () => {
  const clean = run('squat', hold(6, () => body({ kneeAngle: 120, lean: 20 })));
  assert.deepEqual(clean.st.faultEvents, [], 'no faults fired, but the field itself must still exist for insights.js to read');
});

check('knee cave-in only fires when the camera is actually front-on', () => {
  const caving = () => body({ kneeAngle: 120, spread: 0.10, kneeSpread: 0.02 });
  assert.ok(run('squat', hold(6, caving), { view: 'front' }).faults.includes('valgus'));
  assert.ok(!run('squat', hold(6, caving), { view: 'side' }).faults.includes('valgus'),
    'unobservable from the side, so it must not be guessed at');
});

check('bench flags flared elbows at the chest and a soft lockout at the top', () => {
  const toChest = [165, 130, 100].map((a) => body({ elbowAngle: a, shoulderAngle: 88 }));
  const flared = run('bench', [...toChest, ...hold(6, () => body({ elbowAngle: 78, shoulderAngle: 88 }))]);
  assert.ok(flared.faults.includes('flare'));

  const tucked = run('bench', [...toChest, ...hold(6, () => body({ elbowAngle: 78, shoulderAngle: 45 }))]);
  assert.ok(!tucked.faults.includes('flare'));

  assert.ok(run('bench', hold(6, () => body({ elbowAngle: 140 }))).faults.includes('lockout'));
});

check('bench flags one arm lagging behind the other', () => {
  const lopsided = run('bench', hold(6, () => body({ elbowAngle: 150, elbowAngleRight: 110 })));
  assert.ok(lopsided.faults.includes('asymmetry'));
  assert.ok(!run('bench', hold(6, () => body({ elbowAngle: 150 }))).faults.includes('asymmetry'));
});

check('skullcrusher flags the upper arm drifting into a pullover', () => {
  const drift = run('skullcrusher', hold(6, () => body({ elbowAngle: 120, shoulderAngle: 135 })));
  assert.ok(drift.faults.includes('upperArm'));
  const held = run('skullcrusher', hold(6, () => body({ elbowAngle: 120, shoulderAngle: 92 })));
  assert.ok(!held.faults.includes('upperArm'));
});

check('pushdown flags elbows swinging off the ribs', () => {
  assert.ok(run('pushdown', hold(6, () => body({ elbowAngle: 120, shoulderAngle: 55 }))).faults.includes('elbowDrift'));
  assert.ok(!run('pushdown', hold(6, () => body({ elbowAngle: 120, shoulderAngle: 15 }))).faults.includes('elbowDrift'));
});

// ── guards ───────────────────────────────────────────────────────────────────────────────

check('a fault must persist before it is called out', () => {
  const bad = () => body({ kneeAngle: 120, lean: 62 });
  assert.equal(run('squat', hold(2, bad)).faults.length, 0, 'two frames is jitter');
  assert.ok(run('squat', hold(3, bad)).faults.includes('torso'), 'three frames is a fault');
});

check('half a skeleton coaches nothing', () => {
  const r = run('squat', hold(6, () => body({ kneeAngle: 120, lean: 62, visibility: 0.2 })));
  assert.equal(r.faults.length, 0);
  assert.equal(r.last.visible, false);
});

// ── the wider catalogue ──────────────────────────────────────────────────────────────────

check('every exercise belongs to a real category, and no category is empty', () => {
  for (const [id, ex] of Object.entries(EXERCISES)) {
    assert.ok(GROUPS.includes(ex.group), `${id} has group "${ex.group}", not in GROUPS`);
    assert.ok(ex.name && ex.cameraHint && ex.faults.length, `${id} is missing metadata`);
  }
  for (const g of GROUPS) assert.ok(byGroup(g).length > 0, `category ${g} is empty`);
});

check('overhead press counts on the inverted arc, like the pushdown', () => {
  const frames = [
    ...hold(3, () => body({ elbowAngle: 78 })),
    ...hold(6, () => body({ elbowAngle: 176 })),
    ...hold(6, () => body({ elbowAngle: 78 })),
  ];
  assert.equal(run('ohp', frames).st.reps, 1);
});

check('deadlift counts off the hip hinge, not the elbow', () => {
  // `lean` tilts the torso, so the hip angle is roughly 180 - lean.
  const frames = [
    ...hold(3, () => body({ lean: 12 })),   // standing, hip ~168
    ...hold(6, () => body({ lean: 85 })),   // hinged over, hip ~95
    ...hold(6, () => body({ lean: 12 })),
  ];
  assert.equal(run('deadlift', frames).st.reps, 1);
});

check('curl flags swinging elbows and a swinging torso', () => {
  assert.ok(run('curl', hold(6, () => body({ elbowAngle: 90, shoulderAngle: 45 }))).faults.includes('elbowDrift'));
  assert.ok(!run('curl', hold(6, () => body({ elbowAngle: 90, shoulderAngle: 10 }))).faults.includes('elbowDrift'));
  assert.ok(run('curl', hold(6, () => body({ elbowAngle: 90, shoulderAngle: 10, lean: 25 }))).faults.includes('swing'));
});

check('lateral raise flags going above shoulder height', () => {
  const high = run('lateralRaise', hold(6, () => body({ shoulderAngle: 125, elbowAngle: 170 })), { view: 'front' });
  assert.ok(high.faults.includes('tooHigh'));
  const level = run('lateralRaise', hold(6, () => body({ shoulderAngle: 88, elbowAngle: 170 })), { view: 'front' });
  assert.ok(!level.faults.includes('tooHigh'));
});

check('front raise counts on the shoulder, same arc as the lateral', () => {
  const frames = [
    ...hold(3, () => body({ shoulderAngle: 12, elbowAngle: 170 })),
    ...hold(6, () => body({ shoulderAngle: 88, elbowAngle: 170 })),
    ...hold(6, () => body({ shoulderAngle: 12, elbowAngle: 170 })),
  ];
  assert.equal(run('frontRaise', frames).st.reps, 1);
});

check('the two dips disagree about leaning forward, which is the whole difference', () => {
  // `lean` tilts the torso off vertical, so 35 is a lifter leaning well over their hands.
  const leaning = hold(6, () => body({ elbowAngle: 95, lean: 35 }));
  const upright = hold(6, () => body({ elbowAngle: 95, lean: 5 }));

  assert.ok(run('chestDip', upright).faults.includes('upright'), 'chest dip wants the lean');
  assert.ok(!run('chestDip', leaning).faults.includes('upright'));

  assert.ok(run('dip', leaning).faults.includes('torso'), 'triceps dip does not');
  assert.ok(!run('dip', upright).faults.includes('torso'));
});

check('rear delt raise faults on standing up out of the hinge, not on leaning', () => {
  const hinged = (over) => hold(6, () => body({ shoulderAngle: 75, elbowAngle: 165, lean: over }));
  assert.ok(run('rearDeltRaise', hinged(65), { view: 'front' }).faults.length === 0, 'hinged over is correct');
  assert.ok(run('rearDeltRaise', hinged(20), { view: 'front' }).faults.includes('heave'), 'stood up out of it');
});

check('straight-arm pulldown counts off the shoulder and wants the elbow locked', () => {
  const frames = [
    ...hold(3, () => body({ shoulderAngle: 150, elbowAngle: 175 })),
    ...hold(6, () => body({ shoulderAngle: 20, elbowAngle: 175 })),
    ...hold(6, () => body({ shoulderAngle: 150, elbowAngle: 175 })),
  ];
  const clean = run('straightArmPulldown', frames);
  assert.equal(clean.st.reps, 1);
  assert.ok(!clean.faults.includes('elbowBend'));

  const bent = run('straightArmPulldown', hold(6, () => body({ shoulderAngle: 80, elbowAngle: 120 })));
  assert.ok(bent.faults.includes('elbowBend'), 'a bent elbow makes it a pulldown');
});

check('overhead extension holds the upper arms overhead, the skullcrusher holds them vertical', () => {
  // Same fault, same rule, different target angle — so each must accept its own position only.
  const overhead = hold(6, () => body({ elbowAngle: 100, shoulderAngle: 160 }));
  const vertical = hold(6, () => body({ elbowAngle: 100, shoulderAngle: 92 }));

  assert.ok(!run('overheadExtension', overhead).faults.includes('upperArm'));
  assert.ok(run('overheadExtension', vertical).faults.includes('upperArm'));
  assert.ok(!run('skullcrusher', vertical).faults.includes('upperArm'));
  assert.ok(run('skullcrusher', overhead).faults.includes('upperArm'));
});

// ── camera angle and side locking ────────────────────────────────────────────────────────

/** Dim one side, as happens when it is hidden behind the other. */
function dim(lm, side, visibility) {
  const out = lm.map((p) => ({ ...p }));
  for (const i of Object.values(IDX[side])) out[i].visibility = visibility;
  return out;
}

check('the camera check tells side-on from front-on by shoulder spread', () => {
  const sideOn = cameraCheck(body({ spread: 0.04 }), 'side');
  assert.equal(sideOn.view, 'side');
  assert.equal(sideOn.ok, true, 'a side-on lift filmed side-on is fine');

  const frontOn = cameraCheck(body({ spread: 0.12 }), 'side');
  assert.equal(frontOn.view, 'front');
  assert.equal(frontOn.ok, false, 'a side-on lift filmed from the front is not');

  assert.equal(cameraCheck(body({ spread: 0.12 }), 'front').ok, true);
  assert.equal(cameraCheck(body({ spread: 0.04 }), 'front').ok, false);
});

check('the camera check abstains rather than guessing', () => {
  assert.equal(cameraCheck(null, 'side'), null);
  assert.equal(cameraCheck(dim(body(), 'left', 0.1).map((p, i) => (
    i === IDX.right.shoulder ? { ...p, visibility: 0.1 } : p
  )), 'side'), null, 'cannot judge the angle without seeing both shoulders');
});

check('the tracked side is locked for the set, not re-picked every frame', () => {
  const st = createState();
  const T = defaultThresholds('squat');
  const frame = (lm, i) => step('squat', { lm, w: lm, tMs: i * 100 }, st, T);

  // Start with the left side clearly the visible one.
  for (let i = 0; i < 5; i += 1) frame(dim(body({ kneeAngle: 165 }), 'right', 0.6), i);
  assert.equal(st.side, 'left');

  // Now the right side scores higher — the old code would have swapped mid-rep, and the measured
  // angle would jump with it. The left side is still perfectly visible, so it must be kept.
  for (let i = 5; i < 20; i += 1) frame(dim(body({ kneeAngle: 120 }), 'left', 0.6), i);
  assert.equal(st.side, 'left', 'must not flip while the locked side is still visible');
});

check('but a side that genuinely disappears is given up on', () => {
  const st = createState();
  const T = defaultThresholds('squat');
  for (let i = 0; i < 5; i += 1) {
    step('squat', { lm: dim(body(), 'right', 0.6), w: body(), tMs: i * 100 }, st, T);
  }
  assert.equal(st.side, 'left');

  // Turned around: the left side is now genuinely gone, not merely lower-scoring.
  for (let i = 5; i < 30; i += 1) {
    const lm = dim(body(), 'left', 0.05);
    step('squat', { lm, w: lm, tMs: i * 100 }, st, T);
  }
  assert.equal(st.side, 'right', 'a sustained loss should re-pick');
});

check('a check abstains when the joints IT reads are poorly tracked', () => {
  const T = defaultThresholds('bench');
  // Wrists barely tracked, everything else fine. The wrist-stacking rule must stay quiet even
  // though the exercise-level gate passes on shoulder/elbow/hip.
  const bent = () => {
    const lm = body({ elbowAngle: 90, shoulderAngle: 88, wristAngle: 120 });
    for (const side of ['left', 'right']) {
      lm[IDX[side].wrist] = { ...lm[IDX[side].wrist], visibility: 0.45 };
      lm[IDX[side].index] = { ...lm[IDX[side].index], visibility: 0.45 };
    }
    return lm;
  };
  assert.ok(!run('bench', hold(6, bent)).faults.includes('wrist'), 'unreliable wrist, no wrist cue');

  // Same pose, wrists tracked properly — now it should speak up.
  const seen = () => body({ elbowAngle: 90, shoulderAngle: 88, wristAngle: 120 });
  assert.ok(run('bench', hold(6, seen)).faults.includes('wrist'));
});

// ── calibration ──────────────────────────────────────────────────────────────────────────

/** Fake a recording: `n` frames sweeping the primary angle between lo and hi and back. */
const sweep = (lo, hi, n = 120) => Array.from({ length: n }, (_, i) => {
  const t = (i % 40) / 40;
  const primary = t < 0.5 ? hi - (hi - lo) * (t * 2) : lo + (hi - lo) * ((t - 0.5) * 2);
  return { primary, torsoLean: 20, shoulder: 40, elbow: primary, knee: primary, hip: 150 };
});

check('calibration refuses to learn from too little', () => {
  assert.equal(calibrate('squat', sweep(90, 170, 10)), null, 'a handful of frames is not a recording');
  assert.equal(calibrate('squat', sweep(150, 165, 120)), null, 'a 15 degree twitch is not a rep');
});

check('calibration learns the rep endpoints in the right direction', () => {
  // Squat travels from a high angle (standing) down to a low one (bottom).
  const sq = calibrate('squat', sweep(85, 172));
  assert.ok(sq.repStart > sq.repEnd, 'squat starts high and finishes low');
  assert.ok(Math.abs(sq.repStart - 167) <= 6, `expected ~167, got ${sq.repStart}`);
  assert.ok(Math.abs(sq.repEnd - 90) <= 6, `expected ~90, got ${sq.repEnd}`);

  // Pushdown is the inverted arc: flexed at the top, extended at the bottom.
  const pd = calibrate('pushdown', sweep(62, 178));
  assert.ok(pd.repEnd > pd.repStart, 'pushdown starts low and finishes high');
});

check('calibration sets range-of-motion thresholds but never technique tolerances', () => {
  const patch = calibrate('bench', sweep(70, 170));
  assert.ok('lockout' in patch, 'lockout is anatomy — where your arm actually straightens');
  assert.ok(!('flare' in patch), 'elbow flare is technique and must not be learned from you');
  assert.ok(!('wristBend' in patch), 'nor wrist stacking');
  assert.ok(!('torsoLean' in patch), 'nor torso lean');

  const squat = calibrate('squat', sweep(85, 172));
  assert.ok(!('heelLift' in squat) && !('valgusRatio' in squat), 'squat faults stay at defaults too');
  assert.ok(!('depth' in squat), 'squat measures depth by hip-vs-knee, not an angle threshold');

  const skull = calibrate('skullcrusher', sweep(50, 168));
  assert.ok('depth' in skull, 'lifts that DO use an angle for depth get it calibrated');
  assert.ok(skull.depth > 50 && skull.depth < 70, `depth should sit just inside the bottom, got ${skull.depth}`);
});

check('calibrated endpoints actually drive rep counting', () => {
  // Someone with a shallow squat: their "bottom" is 120 degrees, well short of the 95 default.
  const shallowRep = [
    ...hold(3, () => body({ kneeAngle: 165 })),
    ...hold(6, () => body({ kneeAngle: 122 })),
    ...hold(6, () => body({ kneeAngle: 165 })),
  ];
  assert.equal(run('squat', shallowRep).st.reps, 0, 'default thresholds never see a rep');

  const patch = calibrate('squat', sweep(120, 168));
  assert.equal(run('squat', shallowRep, { thresholds: patch }).st.reps, 1, 'calibrated ones do');
});

check('every lift can tell you how to do it', async () => {
  const { TECHNIQUE, script, lines } = await import('./www/technique.js');
  for (const [id, ex] of Object.entries(EXERCISES)) {
    const t = TECHNIQUE[id];
    assert.ok(t, `${id} has no how-to brief`);
    assert.ok(t.setup && t.execute, `${id}'s brief is missing setup or execute`);
    assert.ok(t.mistakes.length, `${id} lists no mistakes to avoid`);
    assert.equal(lines(id).length, 3);
    // The spoken version leads with camera placement, since that has to happen first.
    assert.ok(script(id, ex.cameraHint).startsWith(ex.cameraHint), `${id} drops the camera hint`);
  }
  assert.equal(Object.keys(TECHNIQUE).length, Object.keys(EXERCISES).length, 'a brief for a lift that no longer exists');
});

check('every exercise threshold has a slider range defined in app.js', async () => {
  const src = await (await import('node:fs/promises')).readFile(new URL('./www/app.js', import.meta.url), 'utf8');
  for (const [id, ex] of Object.entries(EXERCISES)) {
    for (const key of Object.keys(ex.thresholds)) {
      assert.ok(new RegExp(`\\b${key}:\\s*\\[`).test(src), `${id}.${key} has no slider`);
    }
  }
});

console.log(ok.map((n) => `  ok  ${n}`).join('\n'));
console.log(`\n${ok.length} checks passed`);
