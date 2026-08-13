// Self-check for landmark smoothing and glitch rejection. Run: node test_filter.mjs
// filter.js has no browser dependencies, so this imports it directly.

import assert from 'node:assert/strict';
import { createLandmarkFilter } from './www/filter.js';

const ok = [];
const check = (name, fn) => { fn(); ok.push(name); };

const FRAME = 1000 / 30;
/** One landmark, so the numbers stay readable. */
const at = (x, y = 0.5, vis = 1) => [{ x, y, z: 0, visibility: vis }];

/** Deterministic noise — a test that fails only sometimes is worse than no test. */
function noise(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return (s / 4294967296 - 0.5) * 2;
  };
}
const stdev = (a) => {
  const mean = a.reduce((x, y) => x + y, 0) / a.length;
  return Math.sqrt(a.reduce((s, v) => s + (v - mean) ** 2, 0) / a.length);
};

check('the first reading passes straight through', () => {
  const f = createLandmarkFilter('normalized');
  assert.equal(f.apply(at(0.42), 0)[0].x, 0.42, 'nothing to smooth against yet');
});

check('a held position gets much steadier', () => {
  const rnd = noise();
  const f = createLandmarkFilter('normalized');
  const raw = [];
  const out = [];
  for (let i = 0; i < 90; i += 1) {
    const x = 0.5 + rnd() * 0.02;          // standing still, tracker jitter only
    raw.push(x);
    out.push(f.apply(at(x), i * FRAME)[0].x);
  }
  // Ignore the settling frames; compare the steady state.
  const rawSd = stdev(raw.slice(30));
  const outSd = stdev(out.slice(30));
  assert.ok(outSd < rawSd * 0.5, `expected jitter at least halved, got ${outSd.toFixed(5)} vs ${rawSd.toFixed(5)}`);
});

check('a fast movement is still followed, not smeared', () => {
  const f = createLandmarkFilter('normalized');
  let last = 0;
  // A rep's worth of travel: 0 → 0.6 over half a second.
  for (let i = 0; i <= 15; i += 1) last = f.apply(at((i / 15) * 0.6), i * FRAME)[0].x;
  // Roughly two frames of lag at this speed. Note the earlier bug failed this at 0.043, not 0.4 —
  // the filter had frozen entirely, which is the failure this number is really guarding.
  assert.ok(last > 0.50, `lagging too far behind a real movement: ${last.toFixed(3)} of 0.6`);
});

check('a teleport is rejected, and the previous position held', () => {
  const f = createLandmarkFilter('normalized');
  for (let i = 0; i < 10; i += 1) f.apply(at(0.5), i * FRAME);
  const glitch = f.apply(at(0.98), 10 * FRAME)[0];   // whole-frame jump in 33ms
  assert.ok(Math.abs(glitch.x - 0.5) < 0.02, `glitch leaked through: ${glitch.x}`);
  assert.equal(f.rejected, 1);

  // A plausible movement of the same direction is NOT rejected.
  const f2 = createLandmarkFilter('normalized');
  for (let i = 0; i < 10; i += 1) f2.apply(at(0.5), i * FRAME);
  f2.apply(at(0.55), 10 * FRAME);
  assert.equal(f2.rejected, 0, 'ordinary movement must pass');
});

check('visibility survives a rejected frame, so the gate still sees the truth', () => {
  const f = createLandmarkFilter('normalized');
  for (let i = 0; i < 5; i += 1) f.apply(at(0.5, 0.5, 0.9), i * FRAME);
  const held = f.apply(at(0.99, 0.5, 0.1), 5 * FRAME)[0];
  assert.equal(held.visibility, 0.1, 'the tracker said it was unsure; that must not be overwritten');
});

check('world space allows metres, not frame fractions', () => {
  // 0.3 m in one frame is a fast but real hand. In normalized space the same number is a teleport.
  const world = createLandmarkFilter('world');
  for (let i = 0; i < 5; i += 1) world.apply(at(0), i * FRAME);
  world.apply(at(0.12), 5 * FRAME);
  assert.equal(world.rejected, 0, 'a real limb speed must not be rejected in metres');
});

check('reset forgets the previous set', () => {
  const f = createLandmarkFilter('normalized');
  for (let i = 0; i < 10; i += 1) f.apply(at(0.2), i * FRAME);
  f.reset();
  assert.equal(f.apply(at(0.8), 0)[0].x, 0.8, 'must not smooth against the last lift');
  assert.equal(f.rejected, 0);
});

check('a missing landmark array is passed through untouched', () => {
  const f = createLandmarkFilter('normalized');
  assert.equal(f.apply(undefined, 0), undefined);
});

check('a long stall does not produce one huge smoothing step', () => {
  const f = createLandmarkFilter('normalized');
  f.apply(at(0.5), 0);
  // Backgrounded for two seconds, then a modest move. dt is clamped, so this stays sane.
  const out = f.apply(at(0.56), 2000)[0].x;
  assert.ok(out > 0.5 && out <= 0.56, `unexpected jump to ${out}`);
});

console.log(ok.map((n) => `  ok  ${n}`).join('\n'));
console.log(`\n${ok.length} checks passed`);
