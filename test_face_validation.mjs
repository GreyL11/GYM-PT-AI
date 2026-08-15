// The empirical validation engine: the state machine that decides whether a signal may ever become
// product intelligence. Run: node test_face_validation.mjs
//
// These tests are mostly about REFUSALS, because that is what this module is for. The dangerous
// failure is not an unstable signal — it is an unstable signal reported as VALIDATED, or a signal
// with no data reported as anything other than UNVALIDATED. Both would put a number in front of a
// person that nothing has earned.

import assert from 'node:assert/strict';

const v = await import('./www/face/validation.js');
const { FEATURES } = await import('./www/face/features.js');

const ok = [];
const check = (name, fn) => { fn(); ok.push(name); };

/** A capture record carrying one region with one feature value. */
const rec = (protocol, at, value, { accepted = true, available = true } = {}) => ({
  at,
  protocol,
  accepted,
  regions: {
    cheek: available
      ? { available: true, features: { dChromaRG: value, localContrast: Math.abs(value) } }
      : { available: false, reason: 'not_skin' },
  },
});

const day = (n) => `2026-08-${String(n).padStart(2, '0')}T09:00:00.000Z`;
const minute = (n) => `2026-08-01T09:${String(n).padStart(2, '0')}:00.000Z`;

/** Ten same-session captures with a MAD of 0.005. */
const setA = (jitter = 0.005) => Array.from({ length: 10 }, (_, i) => rec('A', minute(i), 1.000 + (i % 2) * 2 * jitter));
/** Seven across-session captures with a MAD of 0.02 — four times the noise above. */
const setB = () => [1.00, 1.02, 1.04, 0.98, 0.96, 1.01, 0.99].map((x, i) => rec('B', day(i + 2), x));
/** Six lighting-stress captures within a tight range. */
const setC = (range = 0.008) => Array.from({ length: 6 }, (_, i) => rec('C', day(i + 10), 1.000 + (range * i) / 5));

const evaluate = (records) => v.evaluateSignal(records, 'cheek', 'dChromaRG', FEATURES.dChromaRG);

// ── the states ───────────────────────────────────────────────────────────────────────────

check('no captures at all is UNVALIDATED, never stable', () => {
  const r = evaluate([]);
  assert.equal(r.state, v.STATES.UNVALIDATED);
  assert.equal(r.metrics.noiseMad, null, 'and no metric is invented to fill the gap');
  assert.equal(r.metrics.availability, null);
});

check('a handful of captures is COLLECTING_DATA and says what is missing', () => {
  const r = evaluate([...setA().slice(0, 4)]);
  assert.equal(r.state, v.STATES.COLLECTING_DATA);
  assert.match(r.reason, /A:4\/10/);
});

check('repeatable but never shown a different lamp is PROVISIONALLY_STABLE, not VALIDATED', () => {
  const r = evaluate([...setA(), ...setB()]);
  assert.equal(r.state, v.STATES.PROVISIONALLY_STABLE);
  assert.match(r.reason, /lighting stress is untested/);
  assert.ok(r.metrics.noiseRatio < v.GATES.noiseRatio);
});

check('all three protocols passing is VALIDATED', () => {
  const r = evaluate([...setA(), ...setB(), ...setC()]);
  assert.equal(r.state, v.STATES.VALIDATED);
  assert.ok(r.metrics.lightingRatio <= v.GATES.lightingRatio);
  assert.ok(r.metrics.availability >= v.GATES.availability);
});

check('noise as large as the day-to-day spread is UNSTABLE', () => {
  // Same-session jitter raised to match the across-session spread: the signal is its own error.
  const r = evaluate([...setA(0.05), ...setB(), ...setC()]);
  assert.equal(r.state, v.STATES.UNSTABLE);
  assert.match(r.reason, /mostly its own error/);
});

check('a signal lighting alone can move is UNSTABLE, even with captures the gate accepted', () => {
  const r = evaluate([...setA(), ...setB(), ...setC(0.9)]);
  assert.equal(r.state, v.STATES.UNSTABLE);
  assert.match(r.reason, /lighting alone moves it/);
  assert.ok(r.metrics.lightingRatio > v.GATES.lightingRatio);
});

check('a region that keeps coming back unavailable is INSUFFICIENT_DATA, not UNSTABLE', () => {
  // A finding about the REGION, not the feature. Conflating them would blame the wrong thing.
  const half = [
    ...Array.from({ length: 10 }, (_, i) => rec('A', minute(i), 1.0, { available: i < 3 })),
    ...setB(),
  ];
  const r = evaluate(half);
  assert.equal(r.state, v.STATES.INSUFFICIENT_DATA);
  assert.match(r.reason, /available in only/);
});

// ── what may and may not be counted ──────────────────────────────────────────────────────

check('captures the quality gate rejected never enter a stability number', () => {
  const poisoned = [
    ...setA(),
    ...Array.from({ length: 8 }, (_, i) => rec('A', minute(20 + i), 50, { accepted: false })),
    ...setB(),
    ...setC(),
  ];
  const clean = evaluate([...setA(), ...setB(), ...setC()]);
  const dirty = evaluate(poisoned);
  assert.equal(dirty.state, v.STATES.VALIDATED);
  assert.equal(dirty.metrics.noiseMad, clean.metrics.noiseMad, 'rejected captures changed nothing');
});

check('history out of order gives the same answer as history in order', () => {
  // insights.strength() once read chronology off array position. Every number here would be wrong
  // in a way nobody would notice.
  const inOrder = [...setA(), ...setB(), ...setC()];
  const shuffled = [...inOrder].reverse();
  const a = evaluate(inOrder);
  const b = evaluate(shuffled);
  assert.equal(a.state, b.state);
  assert.deepEqual(a.metrics, b.metrics);
});

check('series is chronological whatever order it was handed', () => {
  const s = v.series([rec('A', minute(9), 3), rec('A', minute(1), 1), rec('A', minute(5), 2)], 'A', 'cheek', 'dChromaRG');
  assert.deepEqual(s.map((p) => p.value), [1, 2, 3]);
});

// ── metrics that refuse ──────────────────────────────────────────────────────────────────

check('coefficient of variation is refused on a scale where it is meaningless', () => {
  // dChromaRG is a difference that crosses zero — its mean is not a scale, and CV would explode
  // near zero and read as a catastrophe.
  const r = evaluate([...setA(), ...setB(), ...setC()]);
  assert.equal(r.metrics.coefficientOfVariation, null);
  assert.equal(FEATURES.dChromaRG.ratioScale, false);

  // localContrast is a MAD: non-negative with a true zero, so CV is meaningful there.
  const lc = v.evaluateSignal([...setA(), ...setB(), ...setC()], 'cheek', 'localContrast', FEATURES.localContrast);
  assert.ok(typeof lc.metrics.coefficientOfVariation === 'number');
  assert.equal(v.coefficientOfVariation([1, 2, 3], false), null, 'refused when not a ratio scale');
  assert.equal(v.coefficientOfVariation([0, 0, 0], true), null, 'refused at a zero mean');
});

check('the false-change proxy handles the flat-then-jumps shape rather than skipping it', () => {
  assert.equal(v.falseChangeRate([1, 2]), null, 'too few samples');
  assert.equal(v.falseChangeRate([1, 1, 1, 1]), 0, 'genuinely constant is a real zero, not unknown');
  // MAD is exactly zero here. Dividing is impossible and the signal is the WORST kind — flat, then
  // a jump. Returning null would have let it through the gate untested.
  assert.ok(v.falseChangeRate([1, 1, 1, 1, 1, 1, 9]) > 0, 'an outlier among unchanged captures counts');
  assert.equal(v.falseChangeRate([1, 1, 1, 1, 1, 9]), 1 / 6);
});

check('a signal flagging changes among captures asserted unchanged is UNSTABLE', () => {
  const jumpy = [1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 4.00, 4.00]
    .map((x, i) => rec('B', day(i + 2), x));
  const r = evaluate([...setA(), ...jumpy, ...setC()]);
  assert.equal(r.state, v.STATES.UNSTABLE);
});

// ── the grid ─────────────────────────────────────────────────────────────────────────────

check('every feature in every region gets a verdict, and nothing is product-ready by default', () => {
  const all = v.evaluateAll([], ['forehead', 'leftCheek'], FEATURES);
  assert.equal(all.length, 2 * Object.keys(FEATURES).length);
  assert.ok(all.every((s) => s.state === v.STATES.UNVALIDATED));
  assert.equal(v.productReady(all).length, 0, 'nothing ships on an empty corpus');
});

check('only VALIDATED counts as product-ready', () => {
  const signals = Object.values(v.STATES).map((state) => ({ state }));
  const ready = v.productReady(signals);
  assert.equal(ready.length, 1);
  assert.equal(ready[0].state, v.STATES.VALIDATED);
});

check('the summary counts every state, including the zeros', () => {
  const s = v.summarise(v.evaluateAll([], ['cheek'], FEATURES));
  assert.equal(s.UNVALIDATED, Object.keys(FEATURES).length);
  assert.equal(s.VALIDATED, 0);
  assert.ok('PROVISIONALLY_STABLE' in s, 'a state with no members is still reported as zero');
});

check('the gates are the numbers the R&D document specified', () => {
  assert.equal(v.GATES.noiseRatio, 0.5);
  assert.equal(v.GATES.lightingRatio, 2.0);
  assert.equal(v.GATES.availability, 0.8);
  assert.equal(v.PROTOCOLS.A.minCaptures, 10);
});

console.log(`face validation: ${ok.length} checks passed`);
