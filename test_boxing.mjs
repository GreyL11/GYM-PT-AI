// Self-check for boxing: punch detection, classification, faults, and the round clock.
// Run: node test_boxing.mjs   (boxing.js is pure, so no shim is needed)

import assert from 'node:assert/strict';
import {
  createBoutState, boxStep, classify, leadHand, createBout, boutAt, roundStats,
  MODES, DEFAULT_BOUT, trackingWarning,
} from './www/boxing.js';
import { IDX } from './www/exercises.js';

const ok = [];
const check = (name, fn) => { fn(); ok.push(name); };

// A boxer, in world coordinates: metres, y grows downward, z grows away from the camera.
// Shoulders 0.38 m apart, so every threshold in the module is a multiple of that.
const GUARD = { left: { x: -0.10, y: -0.70, z: 0 }, right: { x: 0.10, y: -0.70, z: 0 } };

function boxer({ left = GUARD.left, right = GUARD.right, leftElbow, rightElbow, nose = { x: 0, y: -0.75, z: 0 }, vis = 1 } = {}) {
  const w = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: vis }));
  const put = (i, p) => { w[i] = { ...p }; };

  put(0, nose);
  put(IDX.left.shoulder, { x: -0.19, y: -0.55, z: 0 });
  put(IDX.right.shoulder, { x: 0.19, y: -0.55, z: 0 });
  put(IDX.left.hip, { x: -0.12, y: 0, z: 0 });
  put(IDX.right.hip, { x: 0.12, y: 0, z: 0 });
  put(IDX.left.wrist, left);
  put(IDX.right.wrist, right);
  // Elbow defaults to the midpoint, i.e. a bent arm, unless the caller places it.
  put(IDX.left.elbow, leftElbow ?? { x: (-0.19 + left.x) / 2, y: (-0.55 + left.y) / 2 - 0.08, z: (left.z ?? 0) / 2 });
  put(IDX.right.elbow, rightElbow ?? { x: (0.19 + right.x) / 2, y: (-0.55 + right.y) / 2 - 0.08, z: (right.z ?? 0) / 2 });
  return { lm, w };
}

/** A straight punch travels towards the camera: mostly z, arm in line with the shoulder. */
const straight = (side, reach = 0.62) => {
  const sx = side === 'left' ? -0.19 : 0.19;
  // Elbow slightly below the shoulder-to-wrist line: a normal straight, not a locked-out one.
  const wrist = { x: sx, y: -0.58, z: -reach };
  const elbow = { x: sx, y: -0.60, z: -reach / 2 };
  return side === 'left'
    ? boxer({ left: wrist, leftElbow: elbow })
    : boxer({ right: wrist, rightElbow: elbow });
};

/** A hook travels across, arm stays bent at about ninety degrees. */
const hook = (side) => {
  const sx = side === 'left' ? -0.19 : 0.19;
  const wrist = { x: side === 'left' ? 0.30 : -0.30, y: -0.60, z: -0.22 };
  const elbow = { x: sx + (side === 'left' ? 0.16 : -0.16), y: -0.60, z: -0.30 };
  return side === 'left'
    ? boxer({ left: wrist, leftElbow: elbow })
    : boxer({ right: wrist, rightElbow: elbow });
};

/** An uppercut comes from below and finishes above the shoulder, arm bent. */
const uppercut = (side) => {
  const sx = side === 'left' ? -0.19 : 0.19;
  const wrist = { x: sx * 0.5, y: -0.95, z: -0.30 };
  const elbow = { x: sx * 0.8, y: -0.55, z: -0.20 };
  return side === 'left'
    ? boxer({ left: wrist, leftElbow: elbow })
    : boxer({ right: wrist, rightElbow: elbow });
};

/** Run a sequence of poses through boxStep, collecting punches and faults. */
function run(frames, cfg = {}, st = createBoutState()) {
  const conf = { mode: 'shadow', stance: 'orthodox', ...cfg };
  const punches = [];
  const faults = [];
  let last;
  frames.forEach(({ pose, t }) => {
    last = boxStep({ lm: pose.lm, w: pose.w, tMs: t }, st, conf);
    if (last.punch) punches.push(last.punch);
    for (const f of last.faults) faults.push(f.id);
  });
  return { st, punches, faults, last };
}

/** Guard → out → back, at 30fps-ish spacing. */
const throwPunch = (out, { startT = 0, outFrames = 4, holdFrames = 1, backFrames = 4, guard = boxer() } = {}) => {
  const seq = [];
  let t = startT;
  const push = (pose, n) => { for (let i = 0; i < n; i += 1) { seq.push({ pose, t }); t += 33; } };
  push(guard, 3);
  push(out, outFrames);
  push(out, holdFrames);
  push(guard, backFrames);
  return seq;
};

// ── basics ───────────────────────────────────────────────────────────────────────────────

check('the lead hand follows the stance', () => {
  assert.equal(leadHand('orthodox'), 'left');
  assert.equal(leadHand('southpaw'), 'right');
});

check('a punch is only counted once the hand comes home', () => {
  const st = createBoutState();
  // Out, and held out — nothing yet.
  const held = run([...Array(12)].map((_, i) => ({ pose: i < 3 ? boxer() : straight('left'), t: i * 33 })), {}, st);
  assert.equal(held.punches.length, 0, 'a hand still out there has not finished a punch');

  // Now bring it back.
  const home = run([...Array(4)].map((_, i) => ({ pose: boxer(), t: 400 + i * 33 })), {}, st);
  assert.equal(home.punches.length, 1, 'returning completes it');
});

check('a lead straight is a jab and a rear straight is a cross', () => {
  const jab = run(throwPunch(straight('left'))).punches[0];
  assert.equal(jab.kind, 'jab');
  assert.ok(jab.confidence > 0.6, `low confidence on a clean straight: ${jab.confidence}`);

  const cross = run(throwPunch(straight('right'))).punches[0];
  assert.equal(cross.kind, 'cross');

  // Southpaw flips which hand leads, and nothing else.
  const sp = run(throwPunch(straight('right')), { stance: 'southpaw' }).punches[0];
  assert.equal(sp.kind, 'jab');
});

check('a straight thrown at the lens is not mistaken for a hook', () => {
  // This is the whole reason the module measures in 3D: in x/y this punch hardly moves.
  const p = run(throwPunch(straight('left'))).punches[0];
  assert.equal(p.kind, 'jab', 'foreshortening must not turn a jab into a hook');
});

check('hooks and uppercuts are told apart by height, not by reach', () => {
  assert.equal(run(throwPunch(hook('left'))).punches[0].kind, 'hook');
  assert.equal(run(throwPunch(uppercut('right'))).punches[0].kind, 'uppercut');
});

check('classification confidence falls off at the boundary between shapes', () => {
  const clean = classify({ elbow: 172, rise: 0 }, 'left', 'orthodox');
  const marginal = classify({ elbow: 152, rise: 0 }, 'left', 'orthodox');
  assert.ok(clean.confidence > marginal.confidence, 'a half-straight arm is a guess and should say so');
  assert.ok(marginal.confidence <= 1 && marginal.confidence >= 0);
});

// ── faults ───────────────────────────────────────────────────────────────────────────────

check('a dropped guard is called', () => {
  const low = boxer({ right: { x: 0.16, y: -0.35, z: 0 } });   // right hand below the shoulder line
  const seq = [...Array(8)].map((_, i) => ({ pose: low, t: i * 33 }));
  assert.ok(run(seq).faults.includes('guardDown'));

  const up = [...Array(8)].map((_, i) => ({ pose: boxer(), t: i * 33 }));
  assert.ok(!run(up).faults.includes('guardDown'), 'hands at the chin are not a fault');
});

check('a hand that dawdles on the way back is called', () => {
  // Same punch, but the return takes well over half a second.
  const slow = [];
  let t = 0;
  const push = (pose, n) => { for (let i = 0; i < n; i += 1) { slow.push({ pose, t }); t += 100; } };
  push(boxer(), 3);
  push(straight('left'), 2);
  push(straight('left'), 8);   // hanging out there
  push(boxer(), 3);
  const r = run(slow);
  assert.equal(r.punches.length, 1);
  assert.ok(r.punches[0].returnMs > 500, `return was ${r.punches[0].returnMs}ms`);
  assert.ok(r.faults.includes('noReturn'));
});

check('hyperextending the elbow is called, and a normal straight is not', () => {
  const sx = -0.19;
  const locked = boxer({
    left: { x: sx, y: -0.55, z: -0.66 },
    leftElbow: { x: sx, y: -0.55, z: -0.33 },   // perfectly in line: 180 degrees
  });
  assert.ok(run(throwPunch(locked)).faults.includes('overExtend'));
  assert.ok(!run(throwPunch(straight('left'))).faults.includes('overExtend'));
});

check('each mode only checks what its camera view can actually see', () => {
  assert.ok(MODES.shadow.faults.includes('noRotation'), 'shadowboxing shows the whole body');
  assert.ok(!MODES.bag.faults.includes('noRotation'), 'a heavy bag hides the shoulder line');
  assert.ok(!MODES.pads.faults.includes('chinUp'));

  // A fault the mode does not list must never fire, however bad the pose is.
  const chinHigh = boxer({ nose: { x: 0, y: -1.0, z: 0 } });
  const seq = [...Array(8)].map((_, i) => ({ pose: chinHigh, t: i * 33 }));
  assert.ok(run(seq, { mode: 'shadow' }).faults.includes('chinUp'));
  assert.ok(!run(seq, { mode: 'bag' }).faults.includes('chinUp'));
});

check('a hand hidden behind the bag is not judged', () => {
  const hidden = boxer();
  hidden.lm[IDX.left.wrist].visibility = 0.2;
  const r = run([...Array(8)].map((_, i) => ({ pose: hidden, t: i * 33 })), { mode: 'bag' });
  assert.equal(r.last.hands.left.seen, false, 'unmeasurable, so unreported');
  assert.ok(r.last.hands.right.seen);
});

check('no boxer, no coaching', () => {
  const gone = boxer({ vis: 0.1 });
  const r = run([...Array(6)].map((_, i) => ({ pose: gone, t: i * 33 })));
  assert.equal(r.last.visible, false);
  assert.equal(r.faults.length, 0);
});

// ── the round clock ──────────────────────────────────────────────────────────────────────

check('the bout clock walks through work, rest and the final bell', () => {
  const b = { ...createBout({ rounds: 3, workSec: 180, restSec: 60 }), startedAt: 0 };
  const at = (s) => boutAt(b, s * 1000);

  assert.deepEqual(at(0), { round: 1, phase: 'work', left: 180, done: false });
  assert.equal(at(179).phase, 'work');
  assert.equal(at(181).phase, 'rest');
  assert.equal(at(181).round, 1, 'the rest belongs to the round just finished');
  assert.equal(at(241).round, 2, 'and round two starts after it');
  assert.equal(at(241).phase, 'work');

  // 3 rounds = 3x180 work + 2x60 rest = 660s. No rest is served after the last round.
  assert.equal(at(659).done, false);
  assert.equal(at(660).done, true);
  assert.equal(at(700).phase, 'done');
});

check('an unstarted bout reads as ready, not as running', () => {
  const b = createBout({ workSec: 120 });
  assert.deepEqual(boutAt(b, 999999), { round: 1, phase: 'work', left: 120, done: false });
});

check('round stats report output, and how much of the breakdown to believe', () => {
  const p = (kind, confidence, returnMs) => ({ kind, confidence, returnMs });
  const s = roundStats([
    p('jab', 0.9, 200), p('jab', 0.9, 240), p('cross', 0.8, 300), p('hook', 0.3, 500),
  ], 60);
  assert.equal(s.count, 4);
  assert.equal(s.perMinute, 4, 'four punches in a one-minute round');
  assert.equal(s.byKind.jab, 2);
  assert.equal(s.certainty, 0.75, 'one of the four was a guess');
  assert.equal(s.medianReturnMs, 300);

  const empty = roundStats([], 180);
  assert.equal(empty.count, 0);
  assert.equal(empty.certainty, 0);
  assert.equal(empty.medianReturnMs, null);
});

check('pad work warns that the wrong person may be tracked', () => {
  assert.ok(trackingWarning('pads'));
  assert.equal(trackingWarning('shadow'), null);
  assert.equal(DEFAULT_BOUT.mode, 'shadow');
});

console.log(ok.map((n) => `  ok  ${n}`).join('\n'));
console.log(`\n${ok.length} checks passed`);
