// Skin, read against everything this app already logs. Pure — no DOM, no network, no model.
//
// WHY THIS EXISTS AT ALL, given every phone already has a dozen skincare apps:
//
// Those apps know what you put ON your face and nothing else. This one already logs, by name, the
// two dietary things with the most real evidence behind skin flare-ups — dairy (whey especially,
// which is a lifter's daily habit) and high-glycaemic food — plus sleep, stress and which days you
// sweated. Nobody else has both halves. That, and only that, is the reason to build this.
//
// WHAT IT WILL NOT DO:
//
// It cannot see your face and it is not a doctor. So it never names a condition, never says
// whether something is normal or bad, never suggests a medicine or an active ingredient, and never
// claims one thing caused another. It reports what YOUR OWN log shows alongside what your skin
// did, says how thin the evidence is, and offers the one move an individual can actually make:
// change one thing for two weeks and look at the difference. Anything painful, spreading or
// lasting is a dermatologist's, and it says so rather than guessing.
//
// This is the same discipline as t_inputs.js refusing to estimate a hormone level from behaviour:
// the honest output of thin data is a small claim, not a confident one.

import { sleepSummary } from './mood_insights.js';
import * as store from './store.js';

/** Skin logged 1 (bad day) to 5 (good day). One number, because a person will answer one number
 *  every day and will not fill in a form. */
export const SCALE = [1, 2, 3, 4, 5];

/** Things worth noticing, in a person's words. Deliberately descriptive, never diagnostic —
 *  "sore spots" is an observation, "acne" is a diagnosis and not this app's to make. */
export const FLAGS = [
  { id: 'breakout', label: 'Breaking out' },
  { id: 'oily', label: 'Oily' },
  { id: 'dry', label: 'Dry or tight' },
  { id: 'red', label: 'Red or irritated' },
  { id: 'sore', label: 'Sore spots' },
  { id: 'puffy', label: 'Puffy / tired' },
];

/**
 * The routine. Fixed, short, and not personalised — because the evidence behind these does not
 * vary by person, and dressing a known checklist up as a daily insight would be the fake kind of
 * intelligence this file exists to avoid.
 *
 * Sunscreen is first because it is the single best-evidenced thing anyone can do for how skin
 * looks over years, and it is the one most often skipped by someone training indoors.
 */
export const HABITS = [
  { id: 'spf', label: 'Sunscreen', why: 'The best evidenced thing you can do for skin over years. Daylight counts, indoors or not.' },
  { id: 'washPost', label: 'Washed after training', why: 'Sweat sitting under a cap or a collar is the most avoidable irritation a lifter has.' },
  { id: 'moisturise', label: 'Moisturised', why: 'A barrier that holds water is calmer. Nothing clever required.' },
  { id: 'nopick', label: 'Left it alone', why: 'Picking is what turns a spot that would have gone into a mark that stays.' },
];

/** Anything below this many days on EITHER side of a comparison and there is nothing to say. */
export const MIN_DAYS_PER_SIDE = 4;

/** Skin answers slowly. Something eaten today shows up over the next few days, not this evening,
 *  so exposure is summed over the days BEFORE the day being scored. */
export const LAG_DAYS = 3;

// Food groups this reads. Only the two with real evidence behind them, kept narrow on purpose:
// a list that quietly grows to "everything you ate" would find a pattern in noise every week.
const DAIRY = new Set(['whey', 'milk', 'curd', 'greekYogurt', 'paneer', 'cottageCheese', 'chai']);
const HIGH_GI = new Set(['softDrink', 'rice', 'bread', 'potato', 'idli', 'dosa', 'banana']);

const FACTORS = {
  dairy: {
    label: 'dairy and whey',
    change: 'Try two weeks with less of it — whey is the usual one for lifters.',
  },
  sugar: {
    label: 'high-sugar and refined carbs',
    change: 'Try two weeks with fewer sugary drinks and less white rice or bread.',
  },
  sleep: {
    label: 'short sleep',
    change: 'Try a fortnight of getting to bed earlier.',
  },
  stress: {
    label: 'low mood days',
    change: 'Worth mentioning to someone. Stress and skin travel together and neither is fixed by a cream.',
  },
  training: {
    label: 'training days',
    change: 'If you are not already, wash your face soon after a session rather than hours later.',
  },
};

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round1 = (n) => Math.round(n * 10) / 10;

/** Every day that has a skin score, oldest first, as {key, score, flags}. */
export function scored(days = store.days()) {
  return Object.entries(days)
    .filter(([, d]) => typeof d?.skin?.score === 'number')
    .map(([key, d]) => ({ key, score: d.skin.score, flags: d.skin.flags ?? [], habits: d.skin.habits ?? [] }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Mark one routine habit done (or not) for a day. The exact same store field the Mind → Skin
 * panel's chips read and write (`store.day().skin.habits`) — there is only this one place
 * adherence lives, so a habit checked off through a coach walkthrough and one checked off through
 * the Skin panel are the same fact, never two counters to drift apart.
 */
export function setHabitDone(habitId, done, key = store.dayKey()) {
  const cur = store.day(key).skin ?? { score: null, flags: [], habits: [] };
  const habits = done
    ? [...new Set([...(cur.habits ?? []), habitId])]
    : (cur.habits ?? []).filter((h) => h !== habitId);
  store.patchDay({ skin: { ...cur, habits } }, key);
  return habits;
}

/**
 * Of the last `n` days with a skin entry, how many had every routine habit logged.
 *
 * Adherence, not appearance — this counts whether the routine was followed, never whether skin
 * looked any different for it. Lets the coach say "7 of your last 10 recorded evening routines"
 * without ever implying the routine changed anything.
 */
export function routineAdherence(n = 10, days = store.days()) {
  const rows = scored(days).slice(-n);
  const complete = rows.filter((r) => HABITS.every((h) => r.habits.includes(h.id))).length;
  return { complete, of: rows.length };
}

/** Servings of a food group eaten on a given calendar day. */
function servingsOn(key, group, meals) {
  return meals
    .filter((m) => store.dayKey(new Date(m.at)) === key && group.has(m.foodId))
    .reduce((sum, m) => sum + m.qty, 0);
}

/** Exposure to a factor over the LAG_DAYS before `key`, since skin answers late. */
function exposureBefore(key, factor, { meals, days, log }) {
  const window = [];
  for (let i = 1; i <= LAG_DAYS; i += 1) {
    const d = new Date(`${key}T12:00:00`);
    d.setDate(d.getDate() - i);
    window.push(store.dayKey(d));
  }

  if (factor === 'dairy') return mean(window.map((k) => servingsOn(k, DAIRY, meals)));
  if (factor === 'sugar') return mean(window.map((k) => servingsOn(k, HIGH_GI, meals)));
  if (factor === 'training') {
    return mean(window.map((k) => (log.some((s) => store.dayKey(new Date(s.at)) === k) ? 1 : 0)));
  }
  if (factor === 'sleep') {
    // Inverted so "more exposure" means "worse" for every factor, which keeps the comparison
    // below reading the same way in all cases.
    const hrs = window.map((k) => hoursFor(days[k])).filter((h) => h != null);
    return hrs.length ? -mean(hrs) : null;
  }
  if (factor === 'stress') {
    const moods = window.map((k) => days[k]?.mood).filter((m) => typeof m === 'number');
    return moods.length ? -mean(moods) : null;
  }
  return null;
}

/**
 * Sleep length for a day, in hours. Null when nothing was logged.
 *
 * Was a private copy of the same clock arithmetic that lives in mood_insights.js — two
 * implementations of one calculation, which is a drift waiting to happen and did not survive
 * sleep becoming a list of blocks. Reads the main sleep, matching the Testosterone card and the
 * Trends chart, so all three mean the same thing by "slept 7h".
 */
const hoursFor = (d) => sleepSummary(d).main;

/**
 * Split the scored days by whether exposure to a factor was above or below your own median, and
 * report what skin averaged on each side.
 *
 * The median is YOURS, not a guideline — "more dairy than you usually have" is a comparison this
 * data can support; "more dairy than is good for you" is not. Returns null rather than a number
 * whenever either side is too thin to mean anything.
 */
export function association(factor, ctx = context()) {
  const rows = scored(ctx.days)
    .map((r) => ({ ...r, exposure: exposureBefore(r.key, factor, ctx) }))
    .filter((r) => r.exposure != null);
  if (rows.length < MIN_DAYS_PER_SIDE * 2) return null;

  const sorted = [...rows].map((r) => r.exposure).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const high = rows.filter((r) => r.exposure > median);
  const low = rows.filter((r) => r.exposure <= median);
  if (high.length < MIN_DAYS_PER_SIDE || low.length < MIN_DAYS_PER_SIDE) return null;

  const diff = round1(mean(low.map((r) => r.score)) - mean(high.map((r) => r.score)));
  return {
    factor,
    label: FACTORS[factor].label,
    change: FACTORS[factor].change,
    // Positive = skin scored better on the lower-exposure days.
    diff,
    highDays: high.length,
    lowDays: low.length,
    highScore: round1(mean(high.map((r) => r.score))),
    lowScore: round1(mean(low.map((r) => r.score))),
  };
}

/** Everything readable, worst-looking factor first. */
export function associations(ctx = context()) {
  return Object.keys(FACTORS)
    .map((f) => association(f, ctx))
    .filter(Boolean)
    .sort((a, b) => b.diff - a.diff);
}

/** The data the read functions need, gathered once. */
export function context() {
  return { days: store.days(), meals: store.meals(), log: store.read().log };
}

/**
 * One thing to do, and the honest reason for it.
 *
 * Ordered by what the evidence supports rather than what sounds impressive: an unticked habit
 * beats a correlation, because the habits are known to work and a correlation from three weeks of
 * one person's self-scored data is a hint. A difference under half a point on a five-point scale
 * is not reported at all — that is inside the noise of how you happened to feel that morning.
 */
export function advice(ctx = context()) {
  const rows = scored(ctx.days);
  if (rows.length < MIN_DAYS_PER_SIDE * 2) {
    return {
      text: `Log your skin for ${MIN_DAYS_PER_SIDE * 2 - rows.length} more days and this starts comparing it against your food, sleep and training.`,
      habit: 'spf',
      evidence: 'none yet',
    };
  }

  // A habit you are not doing beats any pattern, because these are known rather than inferred.
  const recent = rows.slice(-7);
  for (const h of HABITS) {
    const doneDays = recent.filter((r) => r.habits.includes(h.id)).length;
    if (doneDays <= recent.length / 3) {
      return {
        text: `${h.label}: ${h.why}`,
        habit: h.id,
        evidence: `logged on ${doneDays} of your last ${recent.length} days`,
      };
    }
  }

  const top = associations(ctx)[0];
  if (top && top.diff >= 0.5) {
    return {
      text: `Your skin scored ${top.diff} higher on the days after less ${top.label}. ${top.change}`,
      factor: top.factor,
      evidence: `${top.lowDays} days vs ${top.highDays} — your own log, not a study. It shows the two move together, not that one causes the other.`,
    };
  }

  return {
    text: 'Nothing in your log stands out against your skin right now. The habits are doing the work — keep them up.',
    habit: null,
    evidence: `${rows.length} days logged, no factor above half a point`,
  };
}

/** Said whenever skin is on screen. Not a disclaimer to bury — the app genuinely cannot see your
 *  face, and the things that most need a doctor are the ones it is least able to notice. */
export const SEE_SOMEONE =
  'Anything painful, spreading, or still there after a few weeks is worth a dermatologist rather than an app. This only reads what you logged.';
