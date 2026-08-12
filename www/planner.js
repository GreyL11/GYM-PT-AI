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
};

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
  return round2(profile.bodyweight * ex.loadRatio * (EXPERIENCE[profile.trainingAge] ?? 1));
}

export function scheme(exId, profile = getProfile()) {
  const table = SCHEME[profile.goal] ?? SCHEME.hypertrophy;
  return { ...(EXERCISES[exId].compound ? table.compound : table.isolation) };
}

/** Heavy lower-body compounds jump 5 kg a session; everything else 2.5. */
export const increment = (exId) =>
  (EXERCISES[exId].compound && EXERCISES[exId].group === 'Legs' ? 5 : 2.5);

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
