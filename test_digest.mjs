// Self-check for the chat's factual brief. Run: node test_digest.mjs
//
// The thing being tested is ABSENCE. A model handed `sleep: null` will write a confident sentence
// about sleep it was never told; a model handed nothing cannot. So most of what follows logs
// nothing and asserts the key is simply not there.

import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

const store = await import('./www/store.js');
const planner = await import('./www/planner.js');
const { digest, RULES } = await import('./www/digest.js');

const ok = [];
const check = (name, fn) => { mem.clear(); fn(); ok.push(name); };

const P = (over = {}) => ({ ...planner.DEFAULT_PROFILE, ...over });

/** A day `n` days ago. */
const back = (n) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
};

check('an empty app sends almost nothing, and never a null', () => {
  const d = digest(P());
  const json = JSON.stringify(d);
  assert.doesNotMatch(json, /null/, 'a null invites the model to talk about what it does not have');
  assert.equal(d.sleep, undefined, 'no sleep logged means no sleep key at all');
  assert.equal(d.weight, undefined);
  assert.equal(d.training?.setsAllTime, undefined);
  // The profile is always known, because it was answered on setup.
  assert.equal(d.goal, 'hypertrophy');
  assert.equal(d.bodyweightKg, 75);
});

check('logged training appears, with the range that makes the number mean something', () => {
  const log = [];
  for (let i = 0; i < 6; i += 1) {
    for (let set = 1; set <= 3; set += 1) {
      log.push({ at: back(i).toISOString(), exId: 'bench', set, reps: 8, target: 8,
        load: 60, faults: {}, repMs: [2000, 2100] });
    }
  }
  store.write({ log, profile: P() });
  const d = digest(P());
  assert.equal(d.training.setsAllTime, 18);
  assert.ok(d.training.setsPerGroupThisWeek, 'weekly volume by group is the useful cut');
  assert.match(d.training.productiveRange, /sets per group per week/,
    'a bare number invites the model to invent what good looks like');
});

check('eating only reports days that were actually logged', () => {
  const meals = [];
  const at = back(0);
  for (const [foodId, qty] of [['whey', 2], ['rice', 2], ['chickenBreast', 2]]) {
    meals.push({ at: at.toISOString(), foodId, qty });
  }
  store.write({ meals, profile: P() });
  const d = digest(P());
  assert.ok(d.eating.todayProteinG > 50, 'today is summed');
  assert.equal(d.eating.daysLoggedLast28, 1);
  assert.ok(d.eating.targetKcal > 0 && d.eating.targetProteinG > 0, 'targets always known');

  // Nothing drunk today, so no water figure is offered rather than a zero that reads as "none".
  mem.clear();
  store.write({ profile: P() });
  assert.equal(digest(P()).eating.todayProteinG, undefined);
});

check('weight appears only once there is a weigh-in, and carries the direction', () => {
  assert.equal(digest(P()).weight, undefined);
  store.appendWeight(80, back(20).toISOString());
  store.appendWeight(81.5, back(0).toISOString());
  const d = digest(P());
  assert.equal(d.weight.latestKg, 81.5);
  assert.ok(d.weight.changeKg28d > 0, 'the trend is the part worth answering from');
});

check("the app's own conclusions travel with the numbers", () => {
  const log = [];
  for (let i = 0; i < 4; i += 1) {
    log.push({ at: back(i).toISOString(), exId: 'squat', set: 1, reps: 5, target: 5,
      load: 80, faults: {}, repMs: [2000] });
  }
  store.write({ log, profile: P() });
  const d = digest(P());
  assert.ok(d.appsView?.nextMove, 'the model must agree with the rest of the app, not freelance');
});

check('the rules forbid inventing, and name what absence means', () => {
  assert.match(RULES, /Never estimate, extrapolate or invent/);
  assert.match(RULES, /was not logged/);
  assert.match(RULES, /Never diagnose/);
  assert.match(RULES, /hormone/);
  assert.match(RULES, /appsView/, 'the rules must explain every key the data can contain');
});

check('the brief stays small enough to be context rather than a report', () => {
  // Fill it with as much as a real user could plausibly have.
  const log = [];
  for (let i = 0; i < 30; i += 1) {
    for (const exId of ['bench', 'squat', 'deadlift', 'row', 'ohp', 'curl']) {
      log.push({ at: back(i).toISOString(), exId, set: 1, reps: 8, target: 8,
        load: 60, faults: { flare: 1 }, repMs: [2000, 2200] });
    }
  }
  const meals = [];
  const weights = [];
  const days = {};
  for (let i = 0; i < 28; i += 1) {
    meals.push({ at: back(i).toISOString(), foodId: 'whey', qty: 2 });
    weights.push({ at: back(i).toISOString(), kg: 80 + i * 0.05 });
    days[store.dayKey(back(i))] = { mood: 3, bed: '23:00', wake: '07:00', plans: [], skin: null };
  }
  store.write({ log, meals, weights, days, profile: P() });

  const size = JSON.stringify(digest(P())).length;
  assert.ok(size < 4000, `brief is ${size} chars — it should be context, not a data dump`);
  assert.ok(size > 200, 'but it should actually contain the facts');
});

check('a zero is absence too, and never ships as a number', () => {
  // prune() drops nulls, not zeros, so rule 1 can be broken by a 0 just as easily. weeklyVolume()
  // returns EVERY muscle group, zeroed, which made the old length check — counting muscle groups,
  // always truthy — hand a fresh install a table of zeros next to a productive range to judge it
  // against.
  const d = digest(P());
  assert.equal(d.training?.setsPerGroupThisWeek, undefined, 'no groups trained means no table');
  assert.equal(d.training?.productiveRange, undefined, 'and no yardstick with nothing to measure');
  assert.equal(d.training?.daysTrainedLast30, undefined);
  assert.doesNotMatch(JSON.stringify(d), /:0[,}]/, 'a bare zero invites the same paragraph a null does');

  // But a group you actually trained is a fact, and it arrives with only the groups you trained.
  const log = [];
  for (let i = 0; i < 3; i += 1) {
    log.push({ at: back(i).toISOString(), exId: 'squat', set: 1, reps: 5, target: 5,
      load: 80, faults: {}, repMs: [2000] });
  }
  store.write({ log, profile: P() });
  const after = digest(P()).training;
  assert.deepEqual(Object.keys(after.setsPerGroupThisWeek), ['Legs'], 'only what was trained');
  assert.ok(after.productiveRange, 'now the range means something');
});

check('the weakest point in a lift reaches the model', () => {
  // This read `l.fault?.label` against a summary() that returns `topFault` — always undefined,
  // always pruned. The one movement fact worth having never left the app.
  const log = [];
  for (let i = 0; i < 4; i += 1) {
    log.push({ at: back(i).toISOString(), exId: 'squat', set: 1, reps: 5, target: 5,
      load: 80, faults: { depth: 3 }, repMs: [2000], faultEvents: [{ rep: 4, id: 'depth' }] });
  }
  store.write({ log, profile: P() });
  assert.equal(digest(P()).training.lifts[0].weakestPoint, 'Not reaching depth');
});

check('lifts are capped, so one brief cannot become a training history', () => {
  const log = [];
  const ids = ['bench', 'squat', 'deadlift', 'row', 'ohp', 'curl', 'lunge', 'dip', 'pushup'];
  for (const exId of ids) {
    for (let i = 0; i < 3; i += 1) {
      log.push({ at: back(i).toISOString(), exId, set: 1, reps: 8, target: 8,
        load: 50, faults: {}, repMs: [2000] });
    }
  }
  store.write({ log, profile: P() });
  const d = digest(P());
  assert.ok((d.training.lifts?.length ?? 0) <= 6, 'six is plenty for a conversation');
});

console.log(ok.map((n) => `  ok  ${n}`).join('\n'));
console.log(`\n${ok.length} checks passed`);
