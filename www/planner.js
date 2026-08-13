// What to train, and when. Pure rules — no model, no network.
//
// The profile asks only for things that change the output. Age, sex and height are deliberately
// NOT collected: nothing here would do anything with them, and a field that changes no decision is
// just a question you had to answer for nothing. Starting loads are a first guess either way —
// progression corrects them within two sessions.

import { EXERCISES } from './exercises.js';
import * as store from './store.js';

export const DEFAULT_PROFILE = {
  bodyweight: 75,          // kg — scales every starting load
  trainingAge: 'beginner', // beginner | intermediate | advanced
  goal: 'hypertrophy',     // strength | hypertrophy | endurance
  daysPerWeek: 3,
  equipment: ['barbell', 'dumbbell', 'cable', 'bodyweight'],
  injuries: [],
  bar: 20,                 // kg — men's Olympic. 15 for a women's bar, ~10 for an EZ curl bar
  plates: [25, 20, 15, 10, 5, 2.5, 1.25],  // what your gym actually stocks, kg
};

// ── what the bar can actually be loaded to ───────────────────────────────────────────────
//
// The app used to round every prescription to 2.5 kg, which quietly assumes your gym has 1.25 kg
// plates — they go on in pairs, so the smallest change you can make to a bar is TWICE the smallest
// plate you own. A gym whose smallest plate is 2.5 kg cannot make 62.5 kg at all, and telling
// someone to load it is an instruction that cannot be followed.
//
// Plates are assumed to be available in quantity. Running out of 20s and having to hang six 5s
// instead is a real gym problem, but tracking your gym's inventory is not something anyone is
// going to keep up to date.

// A profile saved before this existed has neither field, and a restored old backup is the same,
// so both fall back rather than producing NaN kilos at the rack.
const barOf = (p) => p.bar ?? DEFAULT_PROFILE.bar;
const platesOf = (p) => (p.plates?.length ? p.plates : DEFAULT_PROFILE.plates);

/** The smallest total change possible on a barbell: one plate per side, so twice the smallest. */
export const barbellStep = (profile = getProfile()) => 2 * Math.min(...platesOf(profile));

/** The nearest weight this gym's bar can actually be loaded to. */
export function achievableLoad(target, profile = getProfile()) {
  const bar = barOf(profile);
  if (target <= bar) return bar;
  const step = barbellStep(profile);
  return Math.round((target - bar) / step) * step + bar;
}

/**
 * What to hang on each end, biggest plates first — fewest discs to lift, and the standard sets are
 * canonical enough that greedy is also the fewest possible.
 *
 * @returns {{bar:number, perSide:Array<{kg:number,n:number}>, actual:number, exact:boolean}}
 *   `actual` is what you would really end up with, which differs from the target when the gym
 *   cannot make it. `exact` says whether it matched.
 */
export function loadout(total, profile = getProfile()) {
  const bar = barOf(profile);
  if (total < bar) return { bar, perSide: [], actual: bar, exact: total === bar, under: true };

  let left = (total - bar) / 2;
  const perSide = [];
  for (const kg of [...platesOf(profile)].sort((a, b) => b - a)) {
    const n = Math.floor((left + 1e-9) / kg);
    if (n > 0) { perSide.push({ kg, n }); left -= n * kg; }
  }
  return {
    bar,
    perSide,
    actual: Math.round((total - left * 2) * 100) / 100,
    exact: left < 1e-9,
    under: false,
  };
}

/** "Bar + 20 + 1.25 per side" — the line you read while loading. */
export function loadoutText(total, profile = getProfile()) {
  const l = loadout(total, profile);
  if (l.bar === undefined) return '';
  if (l.under) return `Less than the ${l.bar} kg bar`;
  if (!l.perSide.length) return 'Empty bar';
  const discs = l.perSide.flatMap(({ kg, n }) => Array(n).fill(kg)).join(' + ');
  return `Bar + ${discs} per side`;
}

export const getProfile = () => ({ ...DEFAULT_PROFILE, ...(store.read().profile ?? {}) });
export const setProfile = (patch) => store.write({ profile: { ...getProfile(), ...patch } });
export const hasProfile = () => Boolean(store.read().profile);

// ── splits ───────────────────────────────────────────────────────────────────────────────
// Each session is a list of muscle groups in training order; a group may repeat to get two
// exercises from it. Compounds land first because that is when you are freshest.

const SPLITS = {
  2: [
    { name: 'Full body A', groups: ['Legs', 'Chest', 'Back', 'Triceps'] },
    { name: 'Full body B', groups: ['Legs', 'Back', 'Shoulders', 'Biceps'] },
  ],
  3: [
    { name: 'Full body A', groups: ['Legs', 'Chest', 'Back', 'Triceps'] },
    { name: 'Full body B', groups: ['Legs', 'Back', 'Shoulders', 'Biceps'] },
    { name: 'Full body C', groups: ['Legs', 'Chest', 'Back', 'Shoulders'] },
  ],
  4: [
    { name: 'Upper A', groups: ['Chest', 'Back', 'Shoulders', 'Triceps'] },
    { name: 'Lower A', groups: ['Legs', 'Legs', 'Legs'] },
    { name: 'Upper B', groups: ['Back', 'Chest', 'Biceps', 'Shoulders'] },
    { name: 'Lower B', groups: ['Legs', 'Legs', 'Legs'] },
  ],
  5: [
    { name: 'Push', groups: ['Chest', 'Shoulders', 'Triceps', 'Triceps'] },
    { name: 'Pull', groups: ['Back', 'Back', 'Biceps', 'Biceps'] },
    { name: 'Legs', groups: ['Legs', 'Legs', 'Legs'] },
    { name: 'Upper', groups: ['Chest', 'Back', 'Shoulders', 'Biceps'] },
    { name: 'Lower', groups: ['Legs', 'Legs', 'Legs'] },
  ],
  6: [
    { name: 'Push A', groups: ['Chest', 'Shoulders', 'Triceps'] },
    { name: 'Pull A', groups: ['Back', 'Back', 'Biceps'] },
    { name: 'Legs A', groups: ['Legs', 'Legs', 'Legs'] },
    { name: 'Push B', groups: ['Chest', 'Shoulders', 'Triceps'] },
    { name: 'Pull B', groups: ['Back', 'Back', 'Biceps'] },
    { name: 'Legs B', groups: ['Legs', 'Legs', 'Legs'] },
  ],
};

// Which weekdays you train, spread to leave recovery gaps. Index 0 = Sunday, matching getDay().
const TRAINING_DAYS = {
  2: [1, 4],
  3: [1, 3, 5],
  4: [1, 2, 4, 5],
  5: [1, 2, 3, 5, 6],
  6: [1, 2, 3, 4, 5, 6],
};

// ── loads and rep schemes ────────────────────────────────────────────────────────────────

const EXPERIENCE = { beginner: 1, intermediate: 1.35, advanced: 1.7 };

const SCHEME = {
  strength:    { compound: { sets: 5, reps: 5 },  isolation: { sets: 3, reps: 8 } },
  hypertrophy: { compound: { sets: 4, reps: 8 },  isolation: { sets: 3, reps: 12 } },
  endurance:   { compound: { sets: 3, reps: 15 }, isolation: { sets: 3, reps: 20 } },
};

const round2 = (kg) => Math.max(0, Math.round(kg / 2.5) * 2.5);

/** First-guess working weight. 0 means the lift is your own bodyweight. */
export function startingLoad(exId, profile = getProfile()) {
  const ex = EXERCISES[exId];
  if (!ex.loadRatio) return 0;
  const raw = round2(profile.bodyweight * ex.loadRatio * (EXPERIENCE[profile.trainingAge] ?? 1));
  // A barbell can only be what its plates allow. Dumbbells and stacks come in their own steps and
  // are not ours to model, so they keep the plain 2.5 rounding.
  return ex.equipment === 'barbell' ? achievableLoad(raw, profile) : raw;
}

export function scheme(exId, profile = getProfile()) {
  const table = SCHEME[profile.goal] ?? SCHEME.hypertrophy;
  return { ...(EXERCISES[exId].compound ? table.compound : table.isolation) };
}

/** Heavy lower-body compounds jump 5 kg a session; everything else 2.5 — but never smaller than
 *  the bar can actually change by, or progression prescribes a weight nobody can load. */
export const increment = (exId, profile = getProfile()) => {
  const ex = EXERCISES[exId];
  const base = ex.compound && ex.group === 'Legs' ? 5 : 2.5;
  return ex.equipment === 'barbell' ? Math.max(base, barbellStep(profile)) : base;
};

/** Compounds need real rest; isolation does not. */
export const restSeconds = (exId) => (EXERCISES[exId].compound ? 180 : 75);

// ── session building ─────────────────────────────────────────────────────────────────────

/** Lifts you can actually do: the gear exists and nothing you're nursing rules them out. */
export function available(profile = getProfile()) {
  return Object.entries(EXERCISES)
    .filter(([, ex]) => profile.equipment.includes(ex.equipment))
    .filter(([, ex]) => !ex.avoidFor.some((i) => profile.injuries.includes(i)))
    .map(([id]) => id);
}

/**
 * Turn one split session into concrete lifts.
 * `rotation` shifts which candidate fills each slot so sessions of the same name in different
 * weeks are not always identical, without needing randomness (which would break resumability).
 */
export function buildSession(session, profile = getProfile(), rotation = 0) {
  const pool = available(profile);
  const chosen = [];

  session.groups.forEach((group, slot) => {
    const candidates = pool
      .filter((id) => EXERCISES[id].group === group && !chosen.includes(id))
      // Compounds first within a group, so the heavy work leads.
      .sort((a, b) => Number(EXERCISES[b].compound) - Number(EXERCISES[a].compound));
    if (!candidates.length) return; // group wiped out by equipment or injury — skip it
    chosen.push(candidates[(rotation + slot) % candidates.length]);
  });

  return {
    name: session.name,
    exercises: chosen.map((exId) => ({
      exId,
      name: EXERCISES[exId].name,
      ...scheme(exId, profile),
      load: store.getLoad(exId, startingLoad(exId, profile)),
    })),
  };
}

/** The whole week, indexed by getDay() — 0 = Sunday. null means a rest day. */
export function weekPlan(profile = getProfile()) {
  const split = SPLITS[profile.daysPerWeek] ?? SPLITS[3];
  const days = TRAINING_DAYS[profile.daysPerWeek] ?? TRAINING_DAYS[3];
  const week = Array(7).fill(null);
  days.forEach((weekday, i) => {
    week[weekday] = buildSession(split[i % split.length], profile, i);
  });
  return week;
}

/** Today's session, or null on a rest day. */
export function today(date = new Date(), profile = getProfile()) {
  return weekPlan(profile)[date.getDay()];
}

/** The next training day after today, for the "rest day" screen. */
export function nextTrainingDay(date = new Date(), profile = getProfile()) {
  const week = weekPlan(profile);
  const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  for (let i = 1; i <= 7; i += 1) {
    const d = (date.getDay() + i) % 7;
    if (week[d]) return { day: NAMES[d], session: week[d], inDays: i };
  }
  return null;
}

/** Which lifts from today's session are already logged today. */
export function doneToday(session, date = new Date()) {
  if (!session) return new Set();
  const day = date.toDateString();
  const logged = store.read().log.filter((e) => new Date(e.at).toDateString() === day);
  return new Set(logged.map((e) => e.exId));
}
