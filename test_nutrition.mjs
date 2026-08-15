// Self-check for the macro arithmetic and the food log.
// Run: node test_nutrition.mjs

import assert from 'node:assert/strict';

// nutrition.js reads the log through store.js, which is localStorage. Same shim the other
// storage-backed tests use.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

const store = await import('./www/store.js');
const n = await import('./www/nutrition.js');

const ok = [];
const check = (name, fn) => { mem.clear(); fn(); ok.push(name); };

const P = (over = {}) => ({ bodyweight: 80, goal: 'hypertrophy', daysPerWeek: 4, ...over });

check('protein scales with bodyweight and the goal, not with anything else', () => {
  assert.equal(n.targets(P({ bodyweight: 80 })).protein, 144, '80 kg at 1.8 g/kg');
  assert.equal(n.targets(P({ bodyweight: 60 })).protein, 108);
  assert.ok(n.targets(P({ goal: 'endurance' })).protein < n.targets(P({ goal: 'hypertrophy' })).protein);
  assert.equal(
    n.targets(P({ goal: 'strength' })).protein,
    n.targets(P({ goal: 'hypertrophy' })).protein,
    'lifting for strength and for size eat the same protein',
  );
});

check('the macros actually add up to the calorie target', () => {
  for (const profile of [P(), P({ bodyweight: 55, goal: 'endurance', daysPerWeek: 2 }), P({ bodyweight: 110, daysPerWeek: 6 })]) {
    const t = n.targets(profile);
    const fromMacros = t.protein * 4 + t.carbs * 4 + t.fat * 9;
    assert.ok(Math.abs(fromMacros - t.kcal) <= 4, `${fromMacros} vs ${t.kcal} — rounding only`);
  }
});

check('training more often earns more calories, and muscle earns a surplus', () => {
  assert.ok(n.targets(P({ daysPerWeek: 6 })).kcal > n.targets(P({ daysPerWeek: 2 })).kcal);
  assert.ok(n.targets(P({ goal: 'hypertrophy' })).kcal > n.targets(P({ goal: 'endurance' })).kcal);
});

check('a skinny endurance profile still gets a workable fat floor', () => {
  const t = n.targets(P({ bodyweight: 50, goal: 'endurance', daysPerWeek: 2 }));
  assert.equal(t.fat, 40, '0.8 g/kg');
  assert.ok(t.carbs > 0, 'and there are still carbs left over');
});

check('totals sum the log, and quantities multiply', () => {
  const day = [
    { at: '2026-08-13T08:00:00.000Z', foodId: 'egg', qty: 3 },
    { at: '2026-08-13T13:00:00.000Z', foodId: 'chickenBreast', qty: 1.5 },
  ];
  const t = n.totals(day);
  assert.equal(t.protein, Math.round(6.3 * 3 + 31 * 1.5));
  assert.equal(t.kcal, Math.round(72 * 3 + 165 * 1.5));
});

check('an unknown food contributes nothing rather than NaN', () => {
  const t = n.totals([{ at: 'x', foodId: 'unicorn', qty: 2 }, { at: 'y', foodId: 'egg', qty: 1 }]);
  assert.equal(t.protein, 6, 'the egg still counts');
  assert.ok(Number.isFinite(t.kcal));
});

check('only today counts toward today', () => {
  store.appendMeal({ at: new Date().toISOString(), foodId: 'whey', qty: 1 });
  store.appendMeal({ at: '2020-01-01T09:00:00.000Z', foodId: 'whey', qty: 1 });
  assert.equal(n.dayEntries().length, 1);
  assert.equal(n.totals(n.dayEntries()).protein, 24);
});

check('remaining goes negative when you go over, which is the point for calories', () => {
  const profile = P();
  const t = n.targets(profile);
  const over = [{ at: 'x', foodId: 'oliveOil', qty: Math.ceil(t.kcal / 119) + 5 }];
  assert.ok(n.remaining(profile, over).kcal < 0);
  assert.ok(n.remaining(profile, []).protein === t.protein, 'an empty day leaves the whole target');
});

check('a mis-tap can be removed again', () => {
  const at = new Date().toISOString();
  store.appendMeal({ at, foodId: 'beer', qty: 4 });
  assert.equal(n.dayEntries().length, 1);
  store.removeMeal(at);
  assert.equal(n.dayEntries().length, 0);
});

check('your own foods override the table and survive a round trip', () => {
  const id = n.foodId('My Protein Bar');
  assert.equal(id, 'my:my-protein-bar');
  store.saveFood(id, { name: 'My Protein Bar', serving: '1 bar', cat: 'Protein', kcal: 210, protein: 20, carbs: 22, fat: 6 });
  assert.equal(n.totals([{ at: 'x', foodId: id, qty: 2 }]).protein, 40);

  // Same name typed twice is the same food, corrected — not a second entry.
  store.saveFood(n.foodId('my protein bar'), { name: 'My Protein Bar', serving: '1 bar', cat: 'Protein', kcal: 210, protein: 25, carbs: 22, fat: 6 });
  assert.equal(Object.keys(store.customFoods()).length, 1);
  assert.equal(n.totals([{ at: 'x', foodId: id, qty: 1 }]).protein, 25);
});

check('frequent foods rank by how often you eat them', () => {
  const at = (i) => new Date(2026, 7, 13, 8, i).toISOString();
  ['egg', 'egg', 'egg', 'rice', 'rice', 'whey'].forEach((foodId, i) => store.appendMeal({ at: at(i), foodId, qty: 1 }));
  const top = n.frequent(3).map((f) => f.foodId);
  assert.deepEqual(top, ['egg', 'rice', 'whey']);

  store.appendMeal({ at: at(9), foodId: 'ghost', qty: 1 });
  assert.ok(!n.frequent(9).some((f) => f.foodId === 'ghost'), 'a deleted food drops out of the list');
});

check('the verdict is only opinionated about protein', () => {
  const profile = P({ bodyweight: 80 }); // 144 g target
  assert.match(n.verdict(profile, []), /Nothing logged/);
  assert.match(n.verdict(profile, [{ at: 'x', foodId: 'whey', qty: 1 }]), /120 g short/);
  assert.match(n.verdict(profile, [{ at: 'x', foodId: 'whey', qty: 6 }]), /Target hit/);
});

check('the meal a thing belongs to is read off the clock, not asked for', () => {
  const at = (h) => new Date(2026, 7, 13, h, 30).toISOString();
  assert.equal(n.mealSlot(at(7)), 'Breakfast');
  assert.equal(n.mealSlot(at(13)), 'Lunch');
  assert.equal(n.mealSlot(at(17)), 'Snack');
  assert.equal(n.mealSlot(at(20)), 'Dinner');

  const eaten = n.mealsEaten([{ at: at(8), foodId: 'egg', qty: 2 }, { at: at(21), foodId: 'rice', qty: 1 }]);
  assert.deepEqual([...eaten].sort(), ['Breakfast', 'Dinner']);
  assert.ok(n.MEALS.every((m) => typeof m === 'string'));
});

check('bodyweight keeps one point per day and reports the change across the window', () => {
  const day = (d, kg) => store.appendWeight(kg, new Date(Date.now() - d * 864e5).toISOString());
  day(20, 80);
  day(10, 81);
  day(0, 82);
  assert.equal(n.weightTrend().points.length, 3);
  assert.equal(n.weightTrend().now, 82);
  assert.equal(n.weightTrend().change, 2);

  // Weighing yourself twice in one day is not a second data point.
  day(0, 82.5);
  assert.equal(n.weightTrend().points.length, 3);
  assert.equal(n.weightTrend().now, 82.5);

  // A window shorter than the history only reads the recent part of it.
  assert.equal(n.weightTrend(14).points.length, 2);
  assert.equal(n.weightTrend(1).change, null, 'one point cannot describe a direction');
});

check('the coach asks for data before it gives an opinion, and calls out impossible numbers', () => {
  const profile = P({ bodyweight: 80 });
  const day = (i, over) => ({ date: String(i), kcal: null, protein: null, kg: null, ...over });

  assert.match(n.coachLine(profile, [day(0), day(1)]), /log a few more days/);

  const fed = Array.from({ length: 10 }, (_, i) => day(i, { kcal: 2800, protein: 150 }));
  assert.match(n.coachLine(profile, fed), /Weigh yourself/);

  // Gaining on a huge deficit means the log is incomplete — that has to be said first, because
  // every other verdict is computed from the number that is wrong.
  const underLogged = fed.map((d, i) => ({ ...d, kcal: 900, kg: i === 0 ? 80 : i === 9 ? 82 : null }));
  assert.match(n.coachLine(profile, underLogged), /more than you are logging/);

  // Same weight gain, believable calories — now it is allowed to be pleased.
  const honest = fed.map((d, i) => ({ ...d, kg: i === 0 ? 80 : i === 9 ? 82 : null }));
  assert.match(n.coachLine(profile, honest), /working/);

  // Trying to gain but the scale is flat is the case worth flagging.
  const flat = fed.map((d, i) => ({ ...d, kg: i === 0 ? 80 : i === 9 ? 79.5 : null }));
  assert.match(n.coachLine(profile, flat), /To gain, eat more/);
});

check('the daily series marks unlogged days as gaps, never as zero', () => {
  const at = new Date(2026, 7, 13, 12);
  store.appendMeal({ at: new Date(at.getTime() - 864e5).toISOString(), foodId: 'whey', qty: 1 });
  store.appendWeight(80, new Date(at.getTime() - 2 * 864e5).toISOString());

  const s = n.dailySeries(4, at);
  assert.equal(s.length, 4);
  assert.equal(s.at(-1).kcal, null, 'today had nothing logged — a gap, not a zero');
  assert.equal(s.at(-2).kcal, 120, 'yesterday had the shake');
  assert.equal(s.at(-3).kg, 80);
  assert.equal(s.at(-3).kcal, null);
  assert.ok(s.every((d) => d.kcal === null || d.kcal > 0), 'a logged day is never silently zero');
});

check('the scale corrects the calorie target, but only when it has grounds to', () => {
  const profile = P({ bodyweight: 80, goal: 'hypertrophy' }); // 2,640 kcal, aiming +0.2 kg/wk
  const base = n.targets(profile).kcal;
  // 28 days: food logged throughout, weighed on the first and last day.
  const build = (kcal, from, to) => Array.from({ length: 28 }, (_, i) => ({
    date: String(i), kcal, protein: 150,
    kg: i === 0 ? from : i === 27 ? to : null,
  }));

  assert.equal(n.suggestion(profile, build(base, 80, 80).slice(0, 5)), null, 'five days is not evidence');
  assert.equal(n.suggestion(profile, build(base, 80, 80).map((d) => ({ ...d, kg: null }))), null, 'never weighed');

  // Flat for four weeks while trying to gain: the target was too low.
  const stuck = n.suggestion(profile, build(base, 80, 80));
  assert.ok(stuck.to > base, `expected a raise, got ${stuck?.to} vs ${base}`);
  assert.match(stuck.reason, /slower than/);

  // The suggestion is anchored to what was EATEN, not to the target that was ignored. Someone
  // eating 2,200 and holding steady has a maintenance of 2,200 — the answer is a bit over that,
  // nowhere near "the old target plus a bit".
  const underEating = n.suggestion(profile, build(2200, 80, 80));
  assert.ok(underEating.to > 2200 && underEating.to < 2600,
    `should sit just above the intake that produced the result, got ${underEating.to}`);

  // The new number is BELOW the old target yet still means "eat more than you have been". The
  // delta against intake is the one a human can act on, and it must not disagree with the advice.
  assert.ok(underEating.to < underEating.from, 'below the formula target');
  assert.ok(underEating.eatingDelta > 0, 'but still more food than is going in');
  assert.equal(underEating.eating, 2200);

  // Gaining far too fast: it comes down.
  const fast = n.suggestion(profile, build(base, 80, 83));
  assert.ok(fast.to < base, 'gaining 3 kg in a month is faster than intended');

  // Gaining at about the intended rate: nothing to say.
  assert.equal(n.suggestion(profile, build(base, 80, 80.8)), null, '0.2 kg/wk is the goal — leave it alone');

  // Under-logging is a logging problem, not a target problem, and must never raise the target.
  assert.equal(n.suggestion(profile, build(900, 80, 82)), null);

  // Never moves by more than 15% on a month of data.
  const wild = n.suggestion(profile, build(base, 80, 70));
  assert.ok(wild.to >= base * 0.85, `clamped, got ${wild.to} from ${base}`);
});

check('an accepted target replaces the formula and can be handed back', () => {
  const profile = P({ bodyweight: 80 });
  const formula = n.targets(profile).kcal;
  const chosen = n.targets({ ...profile, kcalTarget: 3000 });

  assert.equal(chosen.kcal, 3000);
  assert.notEqual(formula, 3000);
  assert.equal(chosen.protein, n.targets(profile).protein, 'protein is bodyweight, not calories');
  assert.equal(chosen.fat, n.targets(profile).fat, 'and so is the fat floor');
  assert.ok(chosen.carbs > n.targets(profile).carbs, 'the extra calories land in carbs');
  assert.equal(n.targets({ ...profile, kcalTarget: null }).kcal, formula, 'clearing it restores the formula');
});

check('editing a food you have eaten is a question, so the count has to be right', () => {
  const id = n.foodId('Protein bar');
  store.saveFood(id, { name: 'Protein bar', serving: '1', cat: 'Other', kcal: 200, protein: 20, carbs: 20, fat: 5 });
  assert.equal(n.usageCount(id), 0, 'saved but never eaten — nothing to warn about');

  store.appendMeal({ at: new Date().toISOString(), foodId: id, qty: 1 });
  store.appendMeal({ at: new Date().toISOString(), foodId: id, qty: 2 });
  store.appendMeal({ at: new Date().toISOString(), foodId: 'egg', qty: 1 });
  assert.equal(n.usageCount(id), 2, 'two entries, regardless of quantity');
  assert.equal(n.usageCount('egg'), 1);

  // Keeping it separate must not collide with the food already there, or with itself.
  const a = n.uniqueFoodId('Protein bar');
  assert.notEqual(a.id, id);
  store.saveFood(a.id, { name: a.name, serving: '1', cat: 'Other', kcal: 210, protein: 25, carbs: 20, fat: 5 });
  const b = n.uniqueFoodId('Protein bar');
  assert.notEqual(b.id, id);
  assert.notEqual(b.id, a.id);
  assert.equal(n.uniqueFoodId('Something else entirely').id, n.foodId('Something else entirely'));

  // And the old entries still resolve to the old numbers.
  assert.equal(n.totals([{ at: 'x', foodId: id, qty: 1 }]).protein, 20);
  assert.equal(n.totals([{ at: 'x', foodId: a.id, qty: 1 }]).protein, 25);
});

check('a backup round-trips, and a bad one is refused rather than half-applied', () => {
  store.appendMeal({ at: new Date().toISOString(), foodId: 'whey', qty: 2 });
  store.appendWeight(81);
  store.setLoad('squat', 92.5);
  const backup = store.exportAll();

  mem.clear();
  assert.equal(store.meals().length, 0, 'wiped');

  store.importAll(backup);
  assert.equal(store.meals().length, 1);
  assert.equal(store.getLoad('squat', 0), 92.5);
  assert.equal(store.weights().at(-1).kg, 81);

  // Anything that is not a backup must leave the data alone.
  for (const junk of ['', 'not json', '[]', '{"data":{"log":"nonsense"}}']) {
    assert.throws(() => store.importAll(junk), /backup|parse|damaged/i, `accepted: ${junk}`);
  }
  assert.equal(store.meals().length, 1, 'still there after every failed restore');
});

check('the weight trend reads by date, not by array position', () => {
  // Found while seeding the chat's brief: an out-of-order array made the same data read as
  // -0.8 kg here and +0.8 kg in coachLine(). Position is not chronology, and getting this
  // backwards inverts every piece of advice built on the direction of travel.
  const day = (n) => new Date(Date.now() - n * 864e5).toISOString();
  const scrambled = [
    { at: day(0), kg: 80 },    // today, deliberately first
    { at: day(20), kg: 79.2 }, // three weeks ago, deliberately last
    { at: day(10), kg: 79.6 },
  ];
  const t = n.weightTrend(28, scrambled);
  assert.equal(t.now, 80, 'latest is the most recent date, not the last element');
  assert.equal(t.change, 0.8, 'and the direction follows from that');
});

check('water is counted from anything with a volume, but not from alcohol', () => {
  const day = [
    { at: 'a', foodId: 'water', qty: 4 },   // a litre
    { at: 'b', foodId: 'coffee', qty: 2 },  // 400 ml
    { at: 'c', foodId: 'milk', qty: 1 },    // 250 ml
    { at: 'd', foodId: 'chickenBreast', qty: 2 }, // no volume at all
  ];
  assert.equal(n.fluid(day), 1650);

  // Beer is a diuretic; counting it toward hydration would be worse than not counting it.
  assert.equal(n.fluid([{ at: 'x', foodId: 'beer', qty: 3 }]), 0);
  assert.equal(n.fluid([]), 0);

  // Water is fluid and nothing else — it must not move a single macro.
  const t = n.totals([{ at: 'x', foodId: 'water', qty: 8 }]);
  assert.deepEqual(t, { kcal: 0, protein: 0, carbs: 0, fat: 0 });
});

check('the water target scales with bodyweight and how often you train', () => {
  const light = n.waterTarget(P({ bodyweight: 60, daysPerWeek: 3 }));
  const heavy = n.waterTarget(P({ bodyweight: 100, daysPerWeek: 3 }));
  assert.ok(heavy > light, 'a bigger lifter needs more');
  assert.ok(n.waterTarget(P({ bodyweight: 80, daysPerWeek: 6 })) > n.waterTarget(P({ bodyweight: 80, daysPerWeek: 2 })),
    'and so does training more often');

  // Sane magnitudes: an 80 kg lifter lands somewhere around three litres, not thirty or three hundred.
  const t = n.waterTarget(P({ bodyweight: 80, daysPerWeek: 4 }));
  assert.ok(t >= 2500 && t <= 3600, `expected roughly 3 L, got ${t}`);
  assert.equal(t % 100, 0, 'rounded to something you can picture in glasses');
});

check('every food in the table is complete and lands in a real category', () => {
  for (const [id, f] of Object.entries(n.FOODS)) {
    assert.ok(f.name && f.serving, `${id} is missing its name or serving`);
    assert.ok(n.FOOD_CATS.includes(f.cat), `${id} has category "${f.cat}"`);
    for (const k of n.MACROS) assert.equal(typeof f[k], 'number', `${id}.${k} is not a number`);
    // Macros that do not roughly explain the calories mean a typo in one of the four. Ethanol is
    // the one energy source that is not a macro, so a drink has to declare it to balance.
    const fromMacros = f.protein * 4 + f.carbs * 4 + f.fat * 9 + (f.alcohol ?? 0) * 7;
    assert.ok(
      Math.abs(fromMacros - f.kcal) <= Math.max(25, f.kcal * 0.25),
      `${id}: macros say ${Math.round(fromMacros)} kcal, table says ${f.kcal}`,
    );
  }
  for (const cat of n.FOOD_CATS) {
    assert.ok(Object.values(n.FOODS).some((f) => f.cat === cat), `category ${cat} is empty`);
  }
});

console.log(ok.map((name) => `  ok  ${name}`).join('\n'));
console.log(`\n${ok.length} checks passed`);
