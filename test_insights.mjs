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
const set = (exId, at, load, reps, faults = {}) => ({ at, exId, load, reps, target: reps, faults });

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

console.log(ok.map((n) => `  ok  ${n}`).join('\n'));
console.log(`\n${ok.length} checks passed`);
