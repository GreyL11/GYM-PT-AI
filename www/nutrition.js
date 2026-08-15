// What to eat, and whether you actually did. Pure rules — no DOM, so test_nutrition.mjs runs it.
//
// ponytail: no food API, no downloaded database, no language model. Three reasons, in order of
// how much they matter:
//
//   1. This app has no network and no account, on purpose. A nutrition API would need a key
//      shipped inside the APK, and would stop working on gym wifi. Same objection to an LLM.
//   2. A lifter eats the same fifteen things. The table below plus your own saved foods covers a
//      normal week by day three, and every entry after that is one tap.
//   3. A confidently wrong number is worse than a rough number you can see. Every value here is
//      visible and editable; nothing is inferred behind your back.
//
// The targets are a STARTING POINT, exactly like startingLoad() in planner.js. The honest feedback
// loop for calories is the bathroom scale over three weeks, not a better formula.

import * as store from './store.js';

// ── targets ──────────────────────────────────────────────────────────────────────────────

/** Protein per kg of bodyweight. 1.6–2.2 is the useful range for gaining; more is just food. */
const PROTEIN_PER_KG = { strength: 1.8, hypertrophy: 1.8, endurance: 1.4 };

/** Rough daily calories per kg, by how often you train. Sedentary is ~28. */
const KCAL_PER_KG = { 2: 30, 3: 32, 4: 33, 5: 35, 6: 36 };

/** What the goal does to that: muscle needs a small surplus, endurance eats at maintenance. */
const GOAL_ADJUST = { strength: 1.05, hypertrophy: 1.10, endurance: 1.0 };

/** Fat floor in g/kg — below this you are just making your hormones worse to hit a macro. */
const FAT_PER_KG = 0.8;

/**
 * Fluid per kg of bodyweight, in ml. ~35 ml/kg is the usual everyday guideline, and training days
 * get a bump for what you sweat out — roughly half a litre a session, spread over the week.
 *
 * Like every other target here it is a starting point, and unlike the calorie one it has no
 * feedback loop: the honest signal for hydration is the colour of your urine, which no phone is
 * going to measure. Treat it as a nudge, not a verdict.
 */
const WATER_ML_PER_KG = 35;
const WATER_ML_PER_SESSION = 500;

const round5 = (n) => Math.round(n / 5) * 5;

/** Daily macro targets from the profile you already filled in for training.
 *
 *  `kcalTarget` on the profile, if set, replaces the formula — that is what accepting a suggestion
 *  from the scale writes. Protein and fat stay tied to bodyweight either way; only carbs move,
 *  because carbs are the macro you actually eat more or less of when the number changes. */
export function targets(profile) {
  const bw = profile.bodyweight;
  const kcal = profile.kcalTarget
    ?? round5(bw * (KCAL_PER_KG[profile.daysPerWeek] ?? 32) * (GOAL_ADJUST[profile.goal] ?? 1.05));
  const protein = Math.round(bw * (PROTEIN_PER_KG[profile.goal] ?? 1.8));
  const fat = Math.round(bw * FAT_PER_KG);
  // Carbs are whatever calories are left once protein and fat are paid for.
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { kcal, protein, carbs, fat };
}

/** Daily fluid target in ml, rounded to something you can picture in glasses. */
export function waterTarget(profile) {
  const perDay = profile.bodyweight * WATER_ML_PER_KG
    + (WATER_ML_PER_SESSION * (profile.daysPerWeek ?? 3)) / 7;
  return Math.round(perDay / 100) * 100;
}

// ── the food table ───────────────────────────────────────────────────────────────────────
//
// Macros are per ONE SERVING, not per 100 g, and the serving is the unit you actually think in.
// That kills all the unit arithmetic: logging something is the food times a quantity.
//
// Numbers are rounded standard values. They are good enough to hit a protein target and not good
// enough to argue about; if one is wrong for your brand, save your own version of it.

export const FOODS = {
  // Protein
  chickenBreast: { name: 'Chicken breast', serving: '100 g', cat: 'Protein', kcal: 165, protein: 31, carbs: 0, fat: 3.6 },
  chickenThigh:  { name: 'Chicken thigh', serving: '100 g', cat: 'Protein', kcal: 209, protein: 26, carbs: 0, fat: 11 },
  egg:           { name: 'Egg', serving: '1 large', cat: 'Protein', kcal: 72, protein: 6.3, carbs: 0.4, fat: 4.8 },
  eggWhite:      { name: 'Egg white', serving: '1', cat: 'Protein', kcal: 17, protein: 3.6, carbs: 0.2, fat: 0 },
  whey:          { name: 'Whey scoop', serving: '30 g', cat: 'Protein', kcal: 120, protein: 24, carbs: 3, fat: 1.5 },
  paneer:        { name: 'Paneer', serving: '100 g', cat: 'Protein', kcal: 296, protein: 18, carbs: 3.4, fat: 22 },
  tofu:          { name: 'Tofu, firm', serving: '100 g', cat: 'Protein', kcal: 144, protein: 17, carbs: 3, fat: 9 },
  soyaChunks:    { name: 'Soya chunks, dry', serving: '50 g', cat: 'Protein', kcal: 172, protein: 26, carbs: 16, fat: 0.5 },
  greekYogurt:   { name: 'Greek yogurt', serving: '100 g', cat: 'Protein', kcal: 59, protein: 10, carbs: 3.6, fat: 0.4 },
  curd:          { name: 'Curd / plain yogurt', serving: '100 g', cat: 'Protein', kcal: 61, protein: 3.5, carbs: 4.7, fat: 3.3 },
  milk:          { name: 'Milk, whole', serving: '250 ml', cat: 'Protein', kcal: 149, protein: 7.7, carbs: 12, fat: 8, ml: 250 },
  cottageCheese: { name: 'Cottage cheese', serving: '100 g', cat: 'Protein', kcal: 98, protein: 11, carbs: 3.4, fat: 4.3 },
  salmon:        { name: 'Salmon', serving: '100 g', cat: 'Protein', kcal: 208, protein: 20, carbs: 0, fat: 13 },
  tuna:          { name: 'Tuna, canned in water', serving: '100 g', cat: 'Protein', kcal: 116, protein: 26, carbs: 0, fat: 1 },
  beefMince:     { name: 'Beef mince, lean', serving: '100 g', cat: 'Protein', kcal: 250, protein: 26, carbs: 0, fat: 15 },
  prawns:        { name: 'Prawns', serving: '100 g', cat: 'Protein', kcal: 99, protein: 24, carbs: 0.2, fat: 0.3 },
  dal:           { name: 'Dal, cooked', serving: '1 cup', cat: 'Protein', kcal: 200, protein: 12, carbs: 33, fat: 3 },
  rajma:         { name: 'Rajma / kidney beans', serving: '1 cup', cat: 'Protein', kcal: 225, protein: 15, carbs: 40, fat: 1 },
  chickpeas:     { name: 'Chickpeas, cooked', serving: '1 cup', cat: 'Protein', kcal: 269, protein: 15, carbs: 45, fat: 4 },

  // Carbs
  rice:          { name: 'White rice, cooked', serving: '1 cup', cat: 'Carbs', kcal: 205, protein: 4.3, carbs: 45, fat: 0.4 },
  brownRice:     { name: 'Brown rice, cooked', serving: '1 cup', cat: 'Carbs', kcal: 218, protein: 5, carbs: 46, fat: 1.6 },
  roti:          { name: 'Roti / chapati', serving: '1', cat: 'Carbs', kcal: 104, protein: 3, carbs: 20, fat: 2 },
  bread:         { name: 'Bread', serving: '1 slice', cat: 'Carbs', kcal: 79, protein: 3, carbs: 14, fat: 1 },
  oats:          { name: 'Oats, dry', serving: '50 g', cat: 'Carbs', kcal: 190, protein: 6.6, carbs: 33, fat: 3.4 },
  potato:        { name: 'Potato, boiled', serving: '100 g', cat: 'Carbs', kcal: 87, protein: 2, carbs: 20, fat: 0.1 },
  sweetPotato:   { name: 'Sweet potato', serving: '100 g', cat: 'Carbs', kcal: 90, protein: 2, carbs: 21, fat: 0.2 },
  pasta:         { name: 'Pasta, cooked', serving: '1 cup', cat: 'Carbs', kcal: 220, protein: 8, carbs: 43, fat: 1.3 },
  idli:          { name: 'Idli', serving: '1', cat: 'Carbs', kcal: 58, protein: 2, carbs: 12, fat: 0.4 },
  dosa:          { name: 'Dosa, plain', serving: '1', cat: 'Carbs', kcal: 133, protein: 3, carbs: 22, fat: 4 },
  banana:        { name: 'Banana', serving: '1 medium', cat: 'Carbs', kcal: 105, protein: 1.3, carbs: 27, fat: 0.4 },
  apple:         { name: 'Apple', serving: '1 medium', cat: 'Carbs', kcal: 95, protein: 0.5, carbs: 25, fat: 0.3 },

  // Fats
  peanutButter:  { name: 'Peanut butter', serving: '1 tbsp', cat: 'Fats', kcal: 94, protein: 4, carbs: 3, fat: 8 },
  almonds:       { name: 'Almonds', serving: '30 g', cat: 'Fats', kcal: 173, protein: 6, carbs: 6, fat: 15 },
  oliveOil:      { name: 'Olive oil', serving: '1 tbsp', cat: 'Fats', kcal: 119, protein: 0, carbs: 0, fat: 13.5 },
  ghee:          { name: 'Ghee', serving: '1 tsp', cat: 'Fats', kcal: 45, protein: 0, carbs: 0, fat: 5 },
  avocado:       { name: 'Avocado', serving: 'half', cat: 'Fats', kcal: 160, protein: 2, carbs: 9, fat: 15 },

  // Veg
  mixedVeg:      { name: 'Mixed veg / sabzi', serving: '100 g', cat: 'Veg', kcal: 35, protein: 2, carbs: 7, fat: 0.3 },
  spinach:       { name: 'Spinach, cooked', serving: '100 g', cat: 'Veg', kcal: 23, protein: 2.9, carbs: 3.6, fat: 0.4 },
  broccoli:      { name: 'Broccoli', serving: '100 g', cat: 'Veg', kcal: 35, protein: 2.4, carbs: 7, fat: 0.4 },
  salad:         { name: 'Salad, undressed', serving: '1 bowl', cat: 'Veg', kcal: 25, protein: 1.5, carbs: 5, fat: 0.2 },

  // Other
  //
  // `ml` is fluid that counts toward the day's water. It is on the drinks rather than in a
  // separate list because a cup of tea hydrates you whether or not you thought of it as water,
  // and a tracker that only counts what you poured from the tap will always read low.
  //
  // Alcohol carries no `ml` on purpose: it is a diuretic, so counting a pint as three quarters of
  // a litre toward hydration would be actively wrong.
  water:         { name: 'Water', serving: '250 ml', cat: 'Other', kcal: 0, protein: 0, carbs: 0, fat: 0, ml: 250 },
  coffee:        { name: 'Black coffee / tea', serving: '1 cup', cat: 'Other', kcal: 2, protein: 0.3, carbs: 0, fat: 0, ml: 200 },
  chai:          { name: 'Chai with milk & sugar', serving: '1 cup', cat: 'Other', kcal: 105, protein: 2.5, carbs: 14, fat: 4, ml: 200 },
  softDrink:     { name: 'Soft drink', serving: '330 ml', cat: 'Other', kcal: 139, protein: 0, carbs: 35, fat: 0, ml: 330 },
  // `alcohol` is grams of ethanol, at 7 kcal/g. It is not a macro you track — it is here so the
  // calories add up, because otherwise a beer looks like it contains 50 of them.
  beer:          { name: 'Beer', serving: '330 ml', cat: 'Other', kcal: 143, protein: 1.6, carbs: 11, fat: 0, alcohol: 13 },
  wine:          { name: 'Wine', serving: '150 ml', cat: 'Other', kcal: 125, protein: 0.1, carbs: 4, fat: 0, alcohol: 15 },
  spirit:        { name: 'Spirit, neat', serving: '30 ml', cat: 'Other', kcal: 70, protein: 0, carbs: 0, fat: 0, alcohol: 10 },
};

export const FOOD_CATS = ['Protein', 'Carbs', 'Veg', 'Fats', 'Other'];

/** The table plus anything you saved yourself. Yours win on an id clash, so you can correct a
 *  value you disagree with without editing the app. */
export const allFoods = () => ({ ...FOODS, ...store.customFoods() });

export const MACROS = ['kcal', 'protein', 'carbs', 'fat'];

/** Turn a name into a usable food id. Same name twice = the same custom food, updated. */
export const foodId = (name) => `my:${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

/**
 * How many logged meals point at a food.
 *
 * Meals store an id and a quantity, never the macros — so correcting a food's numbers corrects
 * every meal ever logged with it. That is right when you are fixing an estimate of a fixed thing
 * (you finally read the label), and wrong when the thing itself changed (new recipe). The app
 * cannot tell those apart, so it asks — and this is the number that makes the question concrete.
 */
export const usageCount = (id, meals = store.meals()) => meals.filter((m) => m.foodId === id).length;

/** A free id near `name`, for saving a changed recipe alongside the old one instead of over it. */
export function uniqueFoodId(name, foods = allFoods()) {
  const base = foodId(name);
  if (!foods[base]) return { id: base, name };
  for (let i = 2; i < 50; i += 1) {
    const id = `${base}-${i}`;
    if (!foods[id]) return { id, name: `${name} ${i}` };
  }
  return { id: `${base}-${Date.now()}`, name };
}

// ── the log ──────────────────────────────────────────────────────────────────────────────

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

/** Which meal an entry belongs to, read off the clock.
 *
 *  ponytail: derived, not asked. Making you pick "lunch" from a dropdown after you already picked
 *  the food is a second tap that tells the app what the timestamp already said. If you eat dinner
 *  at 2am the label is wrong and nothing downstream cares — it groups a list, it is not a macro. */
export const MEALS = ['Breakfast', 'Lunch', 'Snack', 'Dinner'];

export function mealSlot(at) {
  const h = new Date(at).getHours();
  if (h < 11) return 'Breakfast';
  if (h < 16) return 'Lunch';
  if (h < 19) return 'Snack';
  return 'Dinner';
}

/** Which meals have something in them today — drives the ticks on the dashboard. */
export function mealsEaten(entries) {
  return new Set(entries.map((e) => mealSlot(e.at)));
}

/** Everything eaten on a given day, oldest first. */
export function dayEntries(date = new Date()) {
  return store.meals().filter((m) => sameDay(m.at, date));
}

/** Add up the macros of some log entries. Unknown ids contribute nothing rather than NaN. */
export function totals(entries, foods = allFoods()) {
  const sum = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const e of entries) {
    const f = foods[e.foodId];
    if (!f) continue;
    for (const k of MACROS) sum[k] += (f[k] ?? 0) * e.qty;
  }
  for (const k of MACROS) sum[k] = Math.round(sum[k]);
  return sum;
}

/** Fluid drunk, in ml. Anything with an `ml` counts, so tea and milk are not invisible. */
export function fluid(entries, foods = allFoods()) {
  return Math.round(entries.reduce((sum, e) => sum + (foods[e.foodId]?.ml ?? 0) * e.qty, 0));
}

/** How much of each target is left. Negative means you went over, which matters for calories
 *  and does not matter at all for protein. */
export function remaining(profile, entries) {
  const t = targets(profile);
  const have = totals(entries);
  return Object.fromEntries(MACROS.map((k) => [k, t[k] - have[k]]));
}

/**
 * Your own food list, most-used first — the thing that makes day three one tap per meal.
 * Ties break toward what you ate most recently.
 */
export function frequent(limit = 8, meals = store.meals()) {
  const seen = new Map();
  meals.forEach((m, i) => {
    const prev = seen.get(m.foodId) ?? { foodId: m.foodId, n: 0, last: -1 };
    seen.set(m.foodId, { ...prev, n: prev.n + 1, last: i });
  });
  const foods = allFoods();
  return [...seen.values()]
    .filter((x) => foods[x.foodId])
    .sort((a, b) => b.n - a.n || b.last - a.last)
    .slice(0, limit);
}

/**
 * One row per day for the last `days`: what you ate, and what you weighed.
 *
 * Days you logged nothing come back as null rather than zero. A zero would draw a cliff on the
 * chart and read as "starved on Tuesday" when it means "did not open the app on Tuesday".
 */
export function dailySeries(days = 28, at = new Date()) {
  const meals = store.meals();
  const weights = store.weights();
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(at.getTime() - i * 864e5);
    const entries = meals.filter((m) => sameDay(m.at, d));
    const w = weights.filter((x) => sameDay(x.at, d)).at(-1);
    out.push({
      date: d.toDateString(),
      kcal: entries.length ? totals(entries).kcal : null,
      protein: entries.length ? totals(entries).protein : null,
      kg: w?.kg ?? null,
    });
  }
  return out;
}

/**
 * Bodyweight over the last `days`, and how much of it moved.
 *
 * This is the only honest check on the calorie target: the formula above is a guess, the scale is
 * a measurement. Deliberately does NOT auto-adjust the target — a week of water weight would send
 * it chasing noise, and you can read a number and change your own eating.
 */
export function weightTrend(days = 28, points = store.weights()) {
  const since = Date.now() - days * 864e5;
  // Sorted here rather than trusted. appendWeight() keeps the stored array in order, but this
  // reads "latest" and "earliest" purely by position — so an array that arrived any other way (a
  // restored backup, a hand-edited import, a future writer that forgets) would not produce a
  // slightly wrong number, it would report the direction BACKWARDS. Losing 800g reads as gaining
  // it, and every piece of advice built on top inverts with it.
  const ordered = [...points].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const window = ordered.filter((w) => new Date(w.at).getTime() >= since);
  const now = ordered.at(-1)?.kg ?? null;
  const change = window.length > 1 ? Math.round((window.at(-1).kg - window[0].kg) * 10) / 10 : null;
  return { now, change, days, points: window };
}

/**
 * One line about today, spoken in the same voice as the lifting cues.
 *
 * Protein is the only macro this is opinionated about, because it is the only one where "you were
 * short" reliably means something went wrong. Calories being off by 200 is noise.
 */
// ── correcting the target from the scale ─────────────────────────────────────────────────

/** Energy in a kg of bodyweight change. The standard figure; close enough over a month. */
const KCAL_PER_KG_MASS = 7700;

/** Weekly gain worth aiming for, as a fraction of bodyweight. 0.25%/wk is about as fast as you
 *  add size without mostly adding fat. Endurance holds steady. */
const GOAL_RATE = { strength: 0.0025, hypertrophy: 0.0025, endurance: 0 };

/** Below this the suggestion is inside the noise of a bathroom scale. */
const MIN_SUGGESTION = 100;

/**
 * What the scale says your calorie target should actually be.
 *
 * The formula in targets() is a population average applied to one person. This is the correction,
 * measured: if you are gaining slower than intended, the target was too low, by exactly the energy
 * the missing mass would have taken.
 *
 * Returns null whenever it should keep its mouth shut, which is most of the time:
 *   - fewer than 10 days between the first and last weigh-in, or under 7 days of food logged
 *   - the log is obviously incomplete, so the average it would correct is fiction
 *   - the correction is smaller than scale noise
 *
 * Deliberately a SUGGESTION, not an auto-adjustment. A week of water weight would otherwise walk
 * the target somewhere silly, and the lifter is the one who knows they were ill / on holiday /
 * carrying a fortnight of salt.
 */
export function suggestion(profile, series = dailySeries()) {
  const logged = series.filter((d) => d.kcal !== null);
  const weighed = series.filter((d) => d.kg !== null);
  if (logged.length < 7 || weighed.length < 2) return null;

  const spanDays = series.findLastIndex((d) => d.kg !== null) - series.findIndex((d) => d.kg !== null);
  if (spanDays < 10) return null;

  const t = targets(profile);
  const avg = Math.round(logged.reduce((a, d) => a + d.kcal, 0) / logged.length);
  // Under-logging by a third is a logging problem. Correcting the target for it would tell someone
  // eating 3000 and logging 1800 to eat more, which is the opposite of true.
  if (avg < t.kcal * 0.75) return null;

  const observedRate = ((weighed.at(-1).kg - weighed[0].kg) / spanDays) * 7;
  const goalRate = (GOAL_RATE[profile.goal] ?? 0) * profile.bodyweight;
  const delta = ((goalRate - observedRate) * KCAL_PER_KG_MASS) / 7;
  if (Math.abs(delta) < MIN_SUGGESTION) return null;

  // Anchored to what you ATE, not to the target you were given.
  //
  // The average intake is the number that produced the observed weight change, so it is the only
  // one that means anything: eating 2,200 and staying flat says maintenance is 2,200, whatever the
  // formula claimed. Adding the correction to an unmet target would suggest a number nobody has
  // any evidence about.
  const to = round5(avg + delta);

  // Clamped against the current target anyway — one month of scale data should nudge, not lurch.
  const bounded = Math.max(t.kcal * 0.75, Math.min(t.kcal * 1.25, to));
  if (round5(bounded) === t.kcal) return null;

  return {
    from: t.kcal,
    to: round5(bounded),
    delta: round5(bounded) - t.kcal,
    // What you have actually been eating. The delta that matters to a human is measured against
    // this, not against a target they were not hitting: a new number can be BELOW the old target
    // and still mean "eat more than you have been".
    eating: avg,
    eatingDelta: round5(bounded) - avg,
    observedRate: Math.round(observedRate * 100) / 100,
    reason: observedRate < goalRate
      ? `gaining ${observedRate <= 0 ? 'nothing' : `${observedRate.toFixed(2)} kg a week`}, slower than the ${goalRate.toFixed(2)} this is aiming for`
      : `gaining ${observedRate.toFixed(2)} kg a week, faster than the ${goalRate.toFixed(2)} this is aiming for`,
  };
}

/**
 * The coach line under the chart. Says the one thing worth saying, in priority order: fix the
 * missing data first, then the direction of travel, then protein.
 *
 * Nothing here is a health claim — it reads back what you logged against the goal you picked.
 */
export function coachLine(profile, series = dailySeries()) {
  const name = profile.name ? `${profile.name} — ` : '';
  const logged = series.filter((d) => d.kcal !== null);
  const weighed = series.filter((d) => d.kg !== null);

  if (logged.length < 3) {
    return `${name}log a few more days of food and this starts telling you something.`;
  }
  if (weighed.length < 2) {
    return `${name}${logged.length} days of food logged. Weigh yourself so it has something to check the calories against.`;
  }

  const drift = Math.round((weighed.at(-1).kg - weighed[0].kg) * 10) / 10;
  const avg = Math.round(logged.reduce((a, d) => a + d.kcal, 0) / logged.length);
  const t = targets(profile);
  const gaining = profile.goal !== 'endurance';

  // Gaining weight on a big deficit is not a result, it is missing food. Say that before anything
  // else, because every other reading below is computed off a number that is simply wrong.
  if (drift > 0.5 && avg < t.kcal * 0.8) {
    return `${name}up ${drift} kg, but only ${avg} kcal a day logged. You are eating more than you are logging — the advice is only as good as what goes in.`;
  }

  if (gaining && drift <= 0) {
    return `${name}averaging ${avg} kcal and ${drift === 0 ? 'flat' : `down ${Math.abs(drift)} kg`}. To gain, eat more than this — the target says ${t.kcal}.`;
  }
  if (!gaining && drift > 1) {
    return `${name}up ${drift} kg on ${avg} kcal a day. That is more than maintenance.`;
  }
  return `${name}averaging ${avg} kcal against a ${t.kcal} target, ${drift > 0 ? `up ${drift}` : `${drift}`} kg. That is working.`;
}

export function verdict(profile, entries = dayEntries()) {
  const t = targets(profile);
  const have = totals(entries);
  if (!entries.length) return `Nothing logged today. Target ${t.protein} g protein.`;
  const short = t.protein - have.protein;
  if (short > 0) return `${have.protein} g protein. ${short} g short — that is about ${Math.ceil(short / 24)} more scoop${short > 24 ? 's' : ''}.`;
  return `${have.protein} g protein. Target hit.`;
}
