// Self-check for the log analytics. Run: node test_insights.mjs
// Same localStorage shim + dynamic import as test_planner.mjs.

import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

const insights = await import('./www/insights.js');

const NOW = new Date('2026-08-12T18:00:00Z');
const DAY = 86400000;
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString();

/** Replace the whole log with the given set records. */
function seed(records) {
  mem.set('gym-trainer/v1', JSON.stringify({ loads: {}, thresholds: {}, log: records, profile: null }));
}
const set = (exId, at, load, reps, faults = {}, faultEvents = []) =>
  ({ at, exId, load, reps, target: reps, faults, faultEvents });

const ok = [];
const check = (name, fn) => { fn(); ok.push(name); };

check('Epley behaves at the edges', () => {
  assert.equal(insights.e1rm(100, 1), 100, 'a single is the 1RM');
  assert.ok(insights.e1rm(100, 5) > 100, 'more reps implies a bigger max');
  assert.equal(insights.e1rm(0, 10), 0, 'bodyweight lifts have no estimate');
  assert.equal(insights.e1rm(100, 0), 0, 'a set of zero is not a max');
});

check('sets collapse into one entry per training day', () => {
  seed([
    set('squat', daysAgo(10), 60, 5),
    set('squat', daysAgo(10), 60, 5),
    set('squat', daysAgo(10), 60, 4),
    set('squat', daysAgo(3), 65, 5),
  ]);
  const s = insights.sessions('squat');
  assert.equal(s.length, 2, 'two training days');
  assert.equal(s[0].sets, 3);
  assert.equal(s[0].reps, 14);
  assert.equal(s[1].load, 65);
});

check('strength trend reads the direction of travel', () => {
  seed([set('squat', daysAgo(28), 60, 5), set('squat', daysAgo(1), 80, 5)]);
  const st = insights.strength('squat');
  assert.equal(st.sessions, 2);
  assert.ok(st.changePct > 30, `expected a big gain, got ${st.changePct}%`);
  assert.equal(st.days, 27);

  seed([set('bench', daysAgo(20), 80, 5), set('bench', daysAgo(1), 70, 5)]);
  assert.ok(insights.strength('bench').changePct < 0, 'going backwards must read negative');

  seed([set('bench', daysAgo(1), 80, 5)]);
  assert.equal(insights.strength('bench'), null, 'one session is not a trend');
});

check('a flat load across three sessions is a stall, and triggers a deload', () => {
  seed([
    set('bench', daysAgo(14), 60, 5),
    set('bench', daysAgo(9), 70, 3),
    set('bench', daysAgo(6), 70, 3),
    set('bench', daysAgo(2), 70, 4),
  ]);
  assert.equal(insights.stalledSessions('bench'), 3);
  assert.equal(insights.shouldDeload('bench'), true);
  assert.equal(insights.deloadTo(70), 62.5, '10% off, rounded to a loadable plate');

  seed([set('bench', daysAgo(9), 60, 5), set('bench', daysAgo(2), 70, 5)]);
  assert.equal(insights.shouldDeload('bench'), false, 'progressing is not stalling');
});

check('the fault fingerprint ranks by share', () => {
  seed([
    set('bench', daysAgo(5), 60, 5, { flare: 6, lockout: 1 }),
    set('bench', daysAgo(2), 60, 5, { flare: 4, wrist: 1 }),
  ]);
  const fp = insights.faultFingerprint('bench');
  assert.equal(fp[0].id, 'flare');
  assert.equal(fp[0].count, 10);
  assert.ok(Math.abs(fp[0].share - 10 / 12) < 1e-9);
  assert.equal(fp[0].label, 'Elbows flaring', 'ids must be translated for humans');

  seed([set('squat', daysAgo(1), 60, 5)]);
  assert.deepEqual(insights.faultFingerprint('squat'), [], 'clean lifting has no fingerprint');
});

check('weekly volume counts sets per group inside 7 days only', () => {
  seed([
    set('bench', daysAgo(1), 60, 5),
    set('bench', daysAgo(2), 60, 5),
    set('squat', daysAgo(3), 80, 5),
    set('bench', daysAgo(30), 60, 5), // too old to count
  ]);
  const v = insights.weeklyVolume(NOW);
  assert.equal(v.Chest, 2);
  assert.equal(v.Legs, 1);
  assert.equal(v.Back, 0);
});

check('recovery warnings fire inside 48h and stay quiet after', () => {
  seed([set('bench', daysAgo(1), 60, 5)]);
  const session = { exercises: [{ exId: 'bench' }, { exId: 'squat' }] };
  const warn = insights.recoveryWarnings(session, NOW);
  assert.equal(warn.length, 1, 'only the recently-trained group');
  assert.equal(warn[0].group, 'Chest');
  assert.equal(warn[0].hoursAgo, 24);

  seed([set('bench', daysAgo(4), 60, 5)]);
  assert.deepEqual(insights.recoveryWarnings(session, NOW), [], '4 days is recovered');
});

check('fatigue compares the end of a set against the start', () => {
  assert.equal(insights.fatigue([1000, 1000, 1000, 1000]), 1, 'even pace');
  assert.ok(insights.fatigue([1000, 1000, 1500, 2000]) > 1.4, 'slowing down');
  assert.equal(insights.fatigue([1000, 1000]), null, 'too few reps to tell');
  assert.equal(insights.fatigue(undefined), null);
});

check('summary survives an empty log and ranks lifts when there is one', () => {
  seed([]);
  const empty = insights.summary(NOW);
  assert.equal(empty.totalSets, 0);
  assert.deepEqual(empty.lifts, []);

  seed([
    set('squat', daysAgo(9), 60, 5), set('squat', daysAgo(2), 65, 5),
    set('curl', daysAgo(2), 20, 10, { swing: 3 }),
  ]);
  const s = insights.summary(NOW);
  assert.equal(s.totalSets, 3);
  assert.equal(s.lifts[0].exId, 'squat', 'the most-trained lift leads');
  assert.ok(s.lifts[0].strength.current > 60);
  assert.equal(s.lifts.find((l) => l.exId === 'curl').topFault.id, 'swing');
});

// ── movement intelligence: rep-indexed fault patterns ────────────────────────────────────

check('faultTimeline refuses to report anything below the evidence floor', () => {
  seed([
    set('squat', daysAgo(3), 80, 5, {}, [{ rep: 5, id: 'valgus' }]),
    set('squat', daysAgo(1), 80, 5, {}, [{ rep: 5, id: 'valgus' }]),
  ]);
  const t = insights.faultTimeline('squat', 'valgus');
  assert.equal(t.status, 'insufficient evidence');
  assert.equal(t.confidence, 0);
  assert.equal(t.evidenceSets, 2, 'the sets ARE seen, just not enough to speak from');
});

check('a clean tracked set counts as evidence the fault did not occur', () => {
  // This is the exact regression the fix caught: excluding clean-but-tracked sets from the
  // denominator would have reported 2/2 = 1.0 confidence instead of the honest 2/5 = 0.4.
  seed([
    // 8-rep sets: an event at rep 6 is only "usable" evidence if the set itself claims >= 6 reps —
    // this is the exact ceiling the P0.6 fix now enforces, so the fixture has to respect it too.
    set('squat', daysAgo(5), 80, 8, {}, [{ rep: 6, id: 'valgus' }]),
    set('squat', daysAgo(4), 80, 8, {}, []),
    set('squat', daysAgo(3), 80, 8, {}, []),
    set('squat', daysAgo(2), 82.5, 8, {}, [{ rep: 6, id: 'valgus' }]),
    set('squat', daysAgo(1), 82.5, 8, {}, []),
  ]);
  const t = insights.faultTimeline('squat', 'valgus');
  assert.equal(t.evidenceSets, 5, 'all five tracked sets count, clean or not');
  assert.equal(t.matchingSets, 2);
  assert.equal(t.confidence, 0.4);
  assert.equal(t.status, 'occasional');
  assert.equal(t.breakdownStartRep, 6);
});

check('a recurring fault crosses into "recurring" status, and a legacy set counts as neither hit nor miss', () => {
  seed([
    // Legacy shape: logged before faultEvents existed. No such key at all.
    { at: daysAgo(9), exId: 'squat', load: 80, reps: 8, target: 8, faults: { valgus: 1 } },
    set('squat', daysAgo(4), 80, 8, {}, [{ rep: 6, id: 'valgus' }]),
    set('squat', daysAgo(3), 80, 8, {}, [{ rep: 7, id: 'valgus' }]),
    set('squat', daysAgo(2), 80, 8, {}, [{ rep: 6, id: 'valgus' }]),
    set('squat', daysAgo(1), 82.5, 8, {}, []),
  ]);
  const t = insights.faultTimeline('squat', 'valgus');
  assert.equal(t.evidenceSets, 4, 'the legacy set is invisible here — not clean, not a miss, just unknown');
  assert.equal(t.matchingSets, 3);
  assert.equal(t.confidence, 0.75);
  assert.equal(t.status, 'recurring');
});

check('topPatterns ranks by confidence and drops anything below the evidence floor', () => {
  seed([
    set('bench', daysAgo(5), 60, 5, {}, [{ rep: 4, id: 'flare' }]),
    set('bench', daysAgo(4), 60, 5, {}, [{ rep: 4, id: 'flare' }, { rep: 5, id: 'wrist' }]),
    set('bench', daysAgo(3), 60, 5, {}, [{ rep: 5, id: 'flare' }]),
    set('bench', daysAgo(2), 60, 5, {}, []),
    set('bench', daysAgo(1), 62.5, 5, {}, [{ rep: 4, id: 'flare' }]),
  ]);
  const top = insights.topPatterns('bench');
  assert.equal(top[0].id, 'flare', 'flare fired in 4 of 5, wrist only 1 of 5 — flare must lead');
  assert.ok(top[0].confidence > top.at(-1).confidence);
  assert.ok(top.every((p) => p.status !== 'insufficient evidence'));
});

check('setBreakdown reads one set, flags whether the second half was worse, and stays quiet without real data', () => {
  const degrading = set('squat', daysAgo(1), 80, 8, {}, [
    { rep: 6, id: 'valgus' }, { rep: 7, id: 'valgus' }, { rep: 8, id: 'valgus' },
  ]);
  const b = insights.setBreakdown(degrading);
  assert.equal(b.firstFaultRep, 6);
  assert.equal(b.totalFaults, 3);
  assert.equal(b.early, 0);
  assert.equal(b.late, 3);
  assert.equal(b.worsening, true);

  assert.equal(insights.setBreakdown(set('squat', daysAgo(1), 80, 5, {}, [])), null, 'a clean set has nothing to report');
  assert.equal(
    insights.setBreakdown({ at: daysAgo(1), exId: 'squat', reps: 5, target: 5, faults: {} }),
    null,
    'an untracked legacy set is unknown, not clean',
  );
});

// ── P0.6: evidence integrity across a rep correction ──────────────────────────────────────
// coach.amendReps() never touches faultEvents — see MOVEMENT_INTELLIGENCE_DESIGN.md's
// evidence-integrity addendum. A downward correction can leave an event referencing a rep beyond
// the corrected count; every insights.js function must ignore that event for ANALYSIS while never
// deleting it from the record. These seed `correctedFrom` directly, exactly as coach.js writes it.

check('setBreakdown ignores a fault event beyond the corrected rep count, without deleting it', () => {
  // Originally 5 reps, faults at 2 and 5. Corrected down to 3 — rep 5 no longer happened.
  const corrected = {
    ...set('squat', daysAgo(1), 80, 3, {}, [{ rep: 2, id: 'valgus' }, { rep: 5, id: 'valgus' }]),
    target: 5, correctedFrom: 5,
  };
  const b = insights.setBreakdown(corrected);
  assert.equal(b.totalFaults, 1, 'only the rep-2 event is usable evidence for a 3-rep set');
  assert.equal(b.firstFaultRep, 2);
  // Half of 3 reps is 1.5, so rep 2 is in the second half — correct, unrelated to the correction.
  assert.equal(b.early, 0);
  assert.equal(b.late, 1);
  // The record itself is untouched — the rep-5 event is still sitting right there.
  assert.equal(corrected.faultEvents.length, 2, 'nothing was deleted from the stored record');
});

check('an upward correction needs no special case — every original event is already in range', () => {
  // Camera undercounted at 3; corrected up to 5. Nothing here could ever become "impossible".
  const corrected = { ...set('squat', daysAgo(1), 80, 5, {}, [{ rep: 3, id: 'valgus' }]), target: 5, correctedFrom: 3 };
  const b = insights.setBreakdown(corrected);
  assert.equal(b.totalFaults, 1);
  assert.equal(b.firstFaultRep, 3);
});

check('a corrected set with nothing usable left reports null, not a phantom breakdown', () => {
  // Corrected down to 1 rep; the only recorded fault was at rep 5 — none of it survives.
  const corrected = { ...set('squat', daysAgo(1), 80, 1, {}, [{ rep: 5, id: 'valgus' }]), target: 5, correctedFrom: 5 };
  assert.equal(insights.setBreakdown(corrected), null);
});

check('faultTimeline and topPatterns only count a corrected set\'s usable events toward confidence', () => {
  seed([
    // Corrected from 5 down to 3: only the rep-2 event is usable; rep-5 must not count as a match.
    { ...set('squat', daysAgo(4), 80, 3, {}, [{ rep: 2, id: 'valgus' }, { rep: 5, id: 'valgus' }]), target: 5, correctedFrom: 5 },
    set('squat', daysAgo(3), 80, 5, {}, []),
    set('squat', daysAgo(2), 80, 5, {}, []),
  ]);
  // The fault DID occur (rep 2), so it should still count as a match — correction trims the
  // impossible part, it does not disqualify the whole set from being usable evidence.
  const t = insights.faultTimeline('squat', 'valgus');
  assert.equal(t.evidenceSets, 3);
  assert.equal(t.matchingSets, 1);

  const top = insights.topPatterns('squat');
  assert.equal(top.find((p) => p.id === 'valgus')?.matchingSets, 1);
});

check('confirmedReps trusts a real reps value of zero rather than falling back to target', () => {
  // Corrected all the way down to zero — a real, meaningful fact, not "no data".
  const corrected = { ...set('squat', daysAgo(1), 80, 0, {}, [{ rep: 4, id: 'valgus' }]), target: 5, correctedFrom: 5 };
  assert.equal(insights.setBreakdown(corrected), null, 'zero confirmed reps means zero usable evidence, target notwithstanding');
});

console.log(ok.map((n) => `  ok  ${n}`).join('\n'));
console.log(`\n${ok.length} checks passed`);
