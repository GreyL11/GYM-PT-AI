// Self-check for the skin layer. Run: node test_skin.mjs
//
// The point of these is not that the maths adds up — it is that the thing REFUSES to speak when
// the data cannot support what it would be saying. A confident sentence off six days of self-
// scored numbers is the failure mode worth testing for.

import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

const store = await import('./www/store.js');
const skin = await import('./www/skin.js');

const ok = [];
const check = (name, fn) => { mem.clear(); fn(); ok.push(name); };

/** n days ending today, each {score, dairy servings, mood, bed/wake, trained}. */
function seed(rows) {
  const days = {};
  const meals = [];
  const log = [];
  rows.forEach((r, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (rows.length - 1 - i));
    const key = store.dayKey(d);
    days[key] = {
      skin: { score: r.score, flags: [], habits: r.habits ?? [] },
      mood: r.mood ?? 3,
      bed: r.bed ?? '23:00',
      wake: r.wake ?? '07:00',
      plans: [],
    };
    for (let n = 0; n < (r.dairy ?? 0); n += 1) {
      meals.push({ at: new Date(d.getTime() + 3600e3).toISOString(), foodId: 'whey', qty: 1 });
    }
    if (r.trained) {
      log.push({ at: d.toISOString(), exId: 'bench', set: 1, reps: 5, target: 5, load: 60, faults: {}, repMs: [] });
    }
  });
  store.write({ days, meals, log });
  return { days, meals, log };
}

check('a handful of days says so instead of finding a pattern in them', () => {
  seed(Array.from({ length: 5 }, () => ({ score: 3, dairy: 2 })));
  assert.equal(skin.association('dairy'), null, 'five days cannot be split into two halves');
  const a = skin.advice();
  assert.match(a.text, /more days/);
  assert.equal(a.evidence, 'none yet');
});

check('a factor is only reported when both sides of the split are real', () => {
  // Nineteen days of heavy dairy and one without: there is no low-exposure side to compare to.
  const rows = Array.from({ length: 20 }, (_, i) => ({ score: 3, dairy: i === 0 ? 0 : 4 }));
  seed(rows);
  const a = skin.association('dairy');
  assert.ok(a === null || a.lowDays >= skin.MIN_DAYS_PER_SIDE, 'must not compare against one day');
});

check('a real split reports the difference, both sides, and never a cause', () => {
  // Alternating: heavy dairy days score badly, light ones score well. Exposure is read over the
  // three days BEFORE each score, so the blocks are long enough for the lag to land.
  const rows = [];
  for (let b = 0; b < 3; b += 1) {
    for (let i = 0; i < 8; i += 1) rows.push({ score: 2, dairy: 4 });
    for (let i = 0; i < 8; i += 1) rows.push({ score: 4, dairy: 0 });
  }
  seed(rows);
  const a = skin.association('dairy');
  assert.ok(a, 'this is enough data to say something');
  assert.ok(a.diff > 0, `skin should read better on low-dairy days, got ${a.diff}`);
  assert.ok(a.highDays >= skin.MIN_DAYS_PER_SIDE && a.lowDays >= skin.MIN_DAYS_PER_SIDE);
  assert.equal(typeof a.change, 'string');

  // The wording must offer a test, never a verdict.
  const said = skin.advice();
  assert.doesNotMatch(said.text, /caus|because of|due to/i, 'never claims causation');
  if (said.factor) assert.match(said.evidence, /not that one causes the other/);
});

check('an unticked habit outranks any correlation, because habits are known and patterns are hints', () => {
  const rows = [];
  for (let b = 0; b < 3; b += 1) {
    for (let i = 0; i < 8; i += 1) rows.push({ score: 2, dairy: 4, habits: [] });
    for (let i = 0; i < 8; i += 1) rows.push({ score: 4, dairy: 0, habits: [] });
  }
  seed(rows);
  const a = skin.advice();
  assert.equal(a.habit, 'spf', 'sunscreen is the best-evidenced move and it is not being done');
  assert.match(a.evidence, /logged on \d+ of your last \d+ days/);
});

check('with the habits done, it falls through to the pattern', () => {
  const all = skin.HABITS.map((h) => h.id);
  const rows = [];
  for (let b = 0; b < 3; b += 1) {
    for (let i = 0; i < 8; i += 1) rows.push({ score: 2, dairy: 4, habits: all });
    for (let i = 0; i < 8; i += 1) rows.push({ score: 4, dairy: 0, habits: all });
  }
  seed(rows);
  const a = skin.advice();
  assert.equal(a.habit, undefined, 'no habit left to nag about');
  assert.ok(a.factor, 'so it reports the pattern instead');
});

check('a flat log with everything done claims nothing at all', () => {
  const all = skin.HABITS.map((h) => h.id);
  seed(Array.from({ length: 16 }, () => ({ score: 4, dairy: 2, habits: all })));
  const a = skin.advice();
  assert.match(a.text, /Nothing in your log stands out/);
  assert.equal(a.factor, undefined);
});

check('sleep and mood read the right way round', () => {
  // Short sleep on the bad-skin days. "More exposure" must mean "worse" for every factor, or the
  // sign of the reported difference flips and the advice says the opposite of the truth.
  const rows = [];
  for (let b = 0; b < 3; b += 1) {
    for (let i = 0; i < 8; i += 1) rows.push({ score: 2, bed: '02:00', wake: '07:00', mood: 1 });
    for (let i = 0; i < 8; i += 1) rows.push({ score: 4, bed: '22:00', wake: '07:00', mood: 5 });
  }
  seed(rows);
  for (const f of ['sleep', 'stress']) {
    const a = skin.association(f);
    assert.ok(a, `${f} should be readable here`);
    assert.ok(a.diff > 0, `${f}: skin should read better on the better days, got ${a.diff}`);
  }
});

check('scored() only counts days that actually carry a score', () => {
  seed([{ score: 3 }, { score: 4 }]);
  const days = store.days();
  const keys = Object.keys(days);
  store.patchDay({ skin: null }, keys[0]);
  assert.equal(skin.scored().length, 1, 'a cleared day is not a zero');
});

check('the referral line is always available and never conditional', () => {
  assert.match(skin.SEE_SOMEONE, /dermatologist/);
  assert.ok(skin.SEE_SOMEONE.length > 40);
});

console.log(ok.map((n) => `  ok  ${n}`).join('\n'));
console.log(`\n${ok.length} checks passed`);
