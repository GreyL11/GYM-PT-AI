// Self-check for the angle maths and the rep state machine — the only non-obvious logic here.
// Run: node test_exercises.mjs
//
// Landmarks are synthesised, not recorded. Each body() is geometrically consistent for the joint
// under test and roughly plausible everywhere else, which is all the pure functions can tell.

import assert from 'node:assert/strict';
import { EXERCISES, defaultThresholds, createState, step, angle, torsoLean, IDX } from './www/exercises.js';

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

/** Feed frames through step(), collecting every fault id emitted along the way. */
function run(exId, frames, opts = {}) {
  const st = createState();
  const T = { ...defaultThresholds(exId), ...(opts.thresholds ?? {}) };
  const seen = [];
  let last;
  frames.forEach((lm, i) => {
    // Same array for lm and w: the synthetic frame is already metric-ish and undistorted.
    last = step(exId, { lm, w: lm, tMs: i * 33, view: opts.view }, st, T);
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
