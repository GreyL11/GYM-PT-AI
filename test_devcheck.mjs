// Self-check for the P0.5 data-validation module. Run: node test_devcheck.mjs
// Only tests what's NEW here — reconciliation and sanity checks. insights.js's own functions
// (setBreakdown/faultTimeline/topPatterns) already have their own suite; this does not re-test them.

import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

const devcheck = await import('./www/devcheck.js');

const NOW = new Date('2026-08-14T18:00:00Z');
const DAY = 86400000;
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString();
const seed = (records) => mem.set('gym-trainer/v1', JSON.stringify({ loads: {}, thresholds: {}, log: records, profile: null }));
const set = (exId, at, load, reps, faults = {}, faultEvents = []) =>
  ({ at, exId, load, reps, target: reps, faults, faultEvents });

const ok = [];
const check = (name, fn) => { mem.clear(); fn(); ok.push(name); };

check('trainedExercises lists only lifts that actually have history', () => {
  seed([set('squat', daysAgo(1), 80, 5), set('bench', daysAgo(1), 60, 5)]);
  assert.deepEqual(devcheck.trainedExercises(), ['bench', 'squat']);
});

check('a consistent set reconciles cleanly, with no false suspicion', () => {
  seed([set('squat', daysAgo(1), 80, 5, { valgus: 2 }, [{ rep: 4, id: 'valgus' }, { rep: 5, id: 'valgus' }])]);
  const r = devcheck.inspect('squat');
  const o = r.observed[0];
  assert.equal(o.reconciled, true);
  assert.deepEqual(o.mismatches, []);
  assert.deepEqual(o.suspiciousEvents, []);
  assert.deepEqual(o.unknownFaultIds, []);
  assert.equal(o.severities.valgus, 'safety', 'squat knee-cave is on the safety list');
});

check('a mismatch between faultEvents and the flat count is caught, not silently trusted', () => {
  // The flat count says 3, but only 2 events were actually recorded — exactly the kind of drift
  // that would happen if a future edit touched one side of the additive pair and not the other.
  seed([set('squat', daysAgo(1), 80, 5, { valgus: 3 }, [{ rep: 4, id: 'valgus' }, { rep: 5, id: 'valgus' }])]);
  const o = devcheck.inspect('squat').observed[0];
  assert.equal(o.reconciled, false);
  assert.deepEqual(o.mismatches, [{ id: 'valgus', fromEvents: 2, fromFlatCount: 3 }]);
});

check('a rep index outside what the set could have had is flagged as suspicious', () => {
  seed([set('squat', daysAgo(1), 80, 5, { valgus: 2 }, [{ rep: 4, id: 'valgus' }, { rep: 9, id: 'valgus' }])]);
  const o = devcheck.inspect('squat').observed[0];
  assert.equal(o.suspiciousEvents.length, 1);
  assert.equal(o.suspiciousEvents[0].rep, 9, 'a set of 5 cannot have a fault at rep 9');
});

// ── P0.6: the ceiling bug this cycle exists to fix ─────────────────────────────────────────
// The OLD suspiciousEvents ceiling was Math.max(reps, target, 1). target is never touched by
// amendReps(), so after a downward correction it silently won the max() and restored exactly the
// ceiling the correction had just lowered — a "corrected 5 down to 3, fault still recorded at rep
// 5" set was NOT flagged. This is the realistic case (target stays at what you were prescribed;
// only reps changes), unlike the previous check above where target happened to equal reps too.

check('a downward correction with an impossible event IS flagged, even though target is unchanged', () => {
  // Prescribed (target) 5 reps, camera originally counted 5, corrected down to 3. The rep-5 fault
  // is now impossible — this is exactly the scenario the old ceiling formula missed.
  const record = { ...set('squat', daysAgo(1), 80, 3, { valgus: 2 }, [{ rep: 2, id: 'valgus' }, { rep: 5, id: 'valgus' }]), target: 5, correctedFrom: 5 };
  seed([record]);
  const o = devcheck.inspect('squat').observed[0];
  assert.equal(o.corrected, true);
  assert.equal(o.correctedFrom, 5);
  assert.equal(o.suspiciousEvents.length, 1, 'target=5 must not rescue the rep-5 event now that reps=3');
  assert.equal(o.suspiciousEvents[0].rep, 5);
});

check('an uncorrected set is never marked corrected, and carries no correctedFrom', () => {
  seed([set('squat', daysAgo(1), 80, 5, { valgus: 1 }, [{ rep: 3, id: 'valgus' }])]);
  const o = devcheck.inspect('squat').observed[0];
  assert.equal(o.corrected, false);
  assert.equal(o.correctedFrom, null);
});

check('a legacy set with no faultEvents is still correctly NOT flagged as corrected', () => {
  seed([{ at: daysAgo(1), exId: 'squat', load: 80, reps: 5, target: 5, faults: { valgus: 1 } }]);
  const o = devcheck.inspect('squat').observed[0];
  assert.equal(o.tracked, false);
  assert.equal(o.corrected, false);
});

check('render() explains a flagged event as expected once correctedFrom is present, without hiding it', () => {
  const record = { ...set('squat', daysAgo(1), 80, 3, { valgus: 2 }, [{ rep: 2, id: 'valgus' }, { rep: 5, id: 'valgus' }]), target: 5, correctedFrom: 5 };
  seed([record]);
  const text = devcheck.render(devcheck.inspect('squat'));
  assert.match(text, /CORRECTED: originally 5 reps, confirmed at 3/);
  assert.match(text, /SUSPICIOUS rep indices:.*expected — this set was corrected/, 'still shown, just explained — never silently hidden');
});

check('a fault id not in the exercise\'s own rule table is flagged, not silently accepted', () => {
  seed([set('squat', daysAgo(1), 80, 5, { madeUpId: 1 }, [{ rep: 3, id: 'madeUpId' }])]);
  const o = devcheck.inspect('squat').observed[0];
  assert.deepEqual(o.unknownFaultIds, ['madeUpId']);
});

check('a legacy set (no faultEvents key at all) is reported as untracked, not as clean', () => {
  seed([{ at: daysAgo(1), exId: 'squat', load: 80, reps: 5, target: 5, faults: { valgus: 1 } }]);
  const r = devcheck.inspect('squat');
  assert.equal(r.legacySets, 1);
  assert.equal(r.trackedSets, 0);
  assert.equal(r.observed[0].tracked, false);
  assert.equal(r.observed[0].reconciled, null, 'nothing to reconcile against — this must not read as true');
});

check('insufficient-evidence fault ids are listed with why, distinct from ones that never occurred', () => {
  seed([
    set('squat', daysAgo(2), 80, 5, {}, [{ rep: 4, id: 'valgus' }]),
    set('squat', daysAgo(1), 80, 5, {}, []),
  ]);
  const r = devcheck.inspect('squat');
  assert.equal(r.patterns.length, 0, 'below the evidence floor, so nothing has cleared into patterns');
  assert.equal(r.insufficient.length, 1);
  assert.equal(r.insufficient[0].id, 'valgus');
  assert.equal(r.insufficient[0].evidenceSets, 2);
});

check('a cleared pattern carries the exact sets it came from, so it can be checked by eye', () => {
  seed([
    set('squat', daysAgo(4), 80, 5, {}, [{ rep: 4, id: 'valgus' }]),
    set('squat', daysAgo(3), 80, 5, {}, []),
    set('squat', daysAgo(2), 80, 5, {}, [{ rep: 5, id: 'valgus' }]),
    set('squat', daysAgo(1), 80, 5, {}, [{ rep: 4, id: 'valgus' }]),
  ]);
  const r = devcheck.inspect('squat');
  const p = r.patterns.find((x) => x.id === 'valgus');
  assert.ok(p, 'three of four sets should have cleared the floor');
  assert.equal(p.sourceSets.length, 3);
  assert.ok(p.sourceSets.every((at) => r.observed.some((o) => o.at === at)), 'every cited set must actually be in OBSERVED');
});

check('render() produces the three required sections in order, and never throws on an empty lift', () => {
  seed([set('squat', daysAgo(1), 80, 5, { valgus: 1 }, [{ rep: 3, id: 'valgus' }])]);
  const text = devcheck.render(devcheck.inspect('squat'));
  const observedAt = text.indexOf('OBSERVED DATA');
  const derivedAt = text.indexOf('DERIVED DATA');
  const insufficientAt = text.indexOf('INSUFFICIENT DATA');
  assert.ok(observedAt >= 0 && derivedAt > observedAt && insufficientAt > derivedAt);

  // A lift with zero history — must describe emptiness, not throw.
  const emptyText = devcheck.render(devcheck.inspect('bench'));
  assert.match(emptyText, /0 sets logged/);
});

console.log(ok.map((n) => `  ok  ${n}`).join('\n'));
console.log(`\n${ok.length} checks passed`);
