// Self-check for the day planner. Run: node test_planner.mjs
//
// planner.js reaches store.js, which is localStorage-backed, so we shim it BEFORE importing —
// hence the dynamic import. Keeping this separate leaves test_exercises.mjs dependency-free.

import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

const planner = await import('./www/planner.js');
const { EXERCISES } = await import('./www/exercises.js');

const P = (over = {}) => ({ ...planner.DEFAULT_PROFILE, ...over });
const ok = [];
const check = (name, fn) => { fn(); ok.push(name); };

// getDay(): 0 = Sunday. These are real Sundays/Mondays/etc in 2026.
const SUNDAY = new Date('2026-08-16T10:00:00');
const MONDAY = new Date('2026-08-17T10:00:00');
const TUESDAY = new Date('2026-08-18T10:00:00');
const WEDNESDAY = new Date('2026-08-19T10:00:00');

check('the weekday map matches the profile, and rest days are genuinely empty', () => {
  const week = planner.weekPlan(P({ daysPerWeek: 3 }));
  const trained = week.map(Boolean);
  assert.deepEqual(trained, [false, true, false, true, false, true, false], 'Mon/Wed/Fri');
  assert.equal(week.filter(Boolean).length, 3);

  const six = planner.weekPlan(P({ daysPerWeek: 6 })).filter(Boolean);
  assert.equal(six.length, 6);
});

check('today() and nextTrainingDay() agree about rest days', () => {
  const p = P({ daysPerWeek: 3 });
  assert.equal(planner.today(SUNDAY, p), null, 'Sunday is a rest day on a 3-day split');
  assert.ok(planner.today(MONDAY, p), 'Monday is not');

  const next = planner.nextTrainingDay(SUNDAY, p);
  assert.equal(next.day, 'Monday');
  assert.equal(next.inDays, 1);

  const afterTue = planner.nextTrainingDay(TUESDAY, p);
  assert.equal(afterTue.day, 'Wednesday');
});

check('a session never prescribes the same lift twice', () => {
  for (const days of [2, 3, 4, 5, 6]) {
    for (const s of planner.weekPlan(P({ daysPerWeek: days })).filter(Boolean)) {
      const ids = s.exercises.map((e) => e.exId);
      assert.equal(new Set(ids).size, ids.length, `${days}-day ${s.name} repeats a lift`);
    }
  }
});

check('equipment you do not own never appears', () => {
  const p = P({ equipment: ['bodyweight'] });
  const ids = planner.weekPlan(p).filter(Boolean).flatMap((s) => s.exercises.map((e) => e.exId));
  assert.ok(ids.length > 0, 'bodyweight-only should still produce something');
  for (const id of ids) assert.equal(EXERCISES[id].equipment, 'bodyweight', `${id} needs kit you lack`);
});

check('an injury removes every lift that aggravates it', () => {
  const p = P({ injuries: ['shoulder'] });
  const usable = planner.available(p);
  for (const id of ['bench', 'inclineBench', 'ohp', 'lateralRaise', 'dip']) {
    assert.ok(!usable.includes(id), `${id} should be excluded for a bad shoulder`);
  }
  assert.ok(usable.includes('squat'), 'legs are unaffected by a shoulder');

  const back = planner.available(P({ injuries: ['lowerBack'] }));
  for (const id of ['deadlift', 'rdl', 'row', 'squat']) assert.ok(!back.includes(id), id);
});

check('the goal drives the rep scheme, compounds and isolation separately', () => {
  assert.deepEqual(planner.scheme('squat', P({ goal: 'strength' })), { sets: 5, reps: 5 });
  assert.deepEqual(planner.scheme('squat', P({ goal: 'hypertrophy' })), { sets: 4, reps: 8 });
  assert.deepEqual(planner.scheme('curl', P({ goal: 'strength' })), { sets: 3, reps: 8 });
  assert.deepEqual(planner.scheme('curl', P({ goal: 'endurance' })), { sets: 3, reps: 20 });
});

check('starting loads scale with bodyweight and experience, rounded to the plate', () => {
  const light = planner.startingLoad('squat', P({ bodyweight: 60 }));
  const heavy = planner.startingLoad('squat', P({ bodyweight: 100 }));
  assert.ok(heavy > light, 'heavier lifter starts heavier');
  assert.equal(light % 2.5, 0, 'must land on a loadable weight');
  assert.equal(heavy % 2.5, 0);

  const novice = planner.startingLoad('bench', P({ bodyweight: 80, trainingAge: 'beginner' }));
  const veteran = planner.startingLoad('bench', P({ bodyweight: 80, trainingAge: 'advanced' }));
  assert.ok(veteran > novice, 'experience raises the first guess');

  // Bodyweight lifts have no external load to suggest.
  assert.equal(planner.startingLoad('pushup', P()), 0);
  assert.equal(planner.startingLoad('dip', P()), 0);
});

check('compounds lead the session, isolation follows', () => {
  const s = planner.buildSession(
    { name: 'Push', groups: ['Chest', 'Shoulders', 'Triceps'] },
    P({ goal: 'strength' }),
  );
  assert.ok(EXERCISES[s.exercises[0].exId].compound, 'first slot should be a compound');
  assert.equal(s.exercises[0].reps, 5, 'and it should get the heavy scheme');
});

check('rotation varies which lift fills a repeated group', () => {
  const session = { name: 'Pull', groups: ['Back', 'Back'] };
  const a = planner.buildSession(session, P(), 0).exercises.map((e) => e.exId);
  const b = planner.buildSession(session, P(), 1).exercises.map((e) => e.exId);
  assert.notDeepEqual(a, b, 'a different rotation should pick differently');
});

check('a saved profile survives a round trip and drives the plan', () => {
  assert.equal(planner.hasProfile(), false, 'nothing saved yet');
  planner.setProfile({ bodyweight: 92, daysPerWeek: 4, goal: 'strength' });
  assert.equal(planner.hasProfile(), true);

  const p = planner.getProfile();
  assert.equal(p.bodyweight, 92);
  assert.equal(p.trainingAge, 'beginner', 'unset fields keep their defaults');
  assert.equal(planner.weekPlan().filter(Boolean).length, 4);
  assert.equal(planner.today(TUESDAY).name, 'Lower A', '4-day split trains Tuesday');
  assert.equal(planner.today(WEDNESDAY), null, 'and rests Wednesday');
});

check('doneToday only counts sets logged today', () => {
  const store = mem.get('gym-trainer/v1');
  const data = JSON.parse(store);
  const session = { exercises: [{ exId: 'squat' }, { exId: 'bench' }] };
  data.log = [
    { at: new Date().toISOString(), exId: 'squat' },
    { at: '2020-01-01T10:00:00.000Z', exId: 'bench' },
  ];
  mem.set('gym-trainer/v1', JSON.stringify(data));

  const done = planner.doneToday(session);
  assert.ok(done.has('squat'), 'logged today');
  assert.ok(!done.has('bench'), 'logged in 2020, not today');
});

console.log(ok.map((n) => `  ok  ${n}`).join('\n'));
console.log(`\n${ok.length} checks passed`);
