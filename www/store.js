// ponytail: localStorage, not IndexedDB. A year of sessions for one lifter is a few hundred KB
// and every read is synchronous. Move to IndexedDB if you ever store video clips.

const KEY = 'gym-trainer/v1';

const blank = {
  loads: {}, thresholds: {}, log: [], profile: null, reps: {}, meals: [], foods: {}, weights: [],
};

export function read() {
  try {
    return { ...blank, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...blank };
  }
}

export function write(patch) {
  const next = { ...read(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function getLoad(exId, fallback) {
  return read().loads[exId] ?? fallback;
}

export function setLoad(exId, kg) {
  const { loads } = read();
  write({ loads: { ...loads, [exId]: kg } });
}

/** Bodyweight lifts have no weight to add, so progression raises this instead. */
export function getReps(exId, fallback) {
  return read().reps[exId] ?? fallback;
}

export function setReps(exId, n) {
  const { reps } = read();
  write({ reps: { ...reps, [exId]: n } });
}

/** Amend the most recent logged set — used when the camera miscounts a rep. */
export function amendLastSet(patch) {
  const { log } = read();
  if (!log.length) return null;
  const next = [...log];
  next[next.length - 1] = { ...next[next.length - 1], ...patch };
  write({ log: next });
  return next[next.length - 1];
}

/** Thresholds are per-exercise and per-body. Merged over the exercise defaults on load. */
export function getThresholds(exId, defaults) {
  return { ...defaults, ...(read().thresholds[exId] ?? {}) };
}

export function setThreshold(exId, key, value) {
  const { thresholds } = read();
  write({ thresholds: { ...thresholds, [exId]: { ...(thresholds[exId] ?? {}), [key]: value } } });
}

export function appendLog(entry) {
  const { log } = read();
  write({ log: [...log, entry].slice(-500) });
}

/** Every set logged for an exercise, oldest first. */
export function history(exId) {
  return read().log.filter((e) => e.exId === exId);
}

// ── food ─────────────────────────────────────────────────────────────────────────────────
// Kept in its own list rather than the set log: they are written at different times, read by
// different screens, and a year of meals is bigger than a year of sets.

export const meals = () => read().meals;

export function appendMeal(entry) {
  const { meals: m } = read();
  write({ meals: [...m, entry].slice(-3000) }); // ~18 months of eating
  return entry;
}

/** Undo a mis-tap. Matches on the timestamp, which is unique enough at millisecond resolution. */
export function removeMeal(at) {
  const { meals: m } = read();
  write({ meals: m.filter((e) => e.at !== at) });
}

/** Foods you saved yourself, so a food missing from the table only has to be typed once. */
export const customFoods = () => read().foods;

export function saveFood(id, food) {
  write({ foods: { ...read().foods, [id]: food } });
}

export function deleteFood(id) {
  const { [id]: gone, ...rest } = read().foods;
  write({ foods: rest });
}

// ── bodyweight over time ─────────────────────────────────────────────────────────────────
// The profile already holds today's bodyweight and always has — it scales every starting load.
// This is just the history of that one number, so the calorie target has something to be judged
// against. One point per day: weighing yourself twice does not mean you gained anything.

export const weights = () => read().weights;

// ── backup ───────────────────────────────────────────────────────────────────────────────
// Everything lives on exactly one phone with no account behind it, so losing the phone loses a
// year of training. It is one plain object, so a backup is just that object as text.

export const exportAll = () => JSON.stringify({ v: 1, at: new Date().toISOString(), data: read() }, null, 2);

/**
 * Replace everything from a backup.
 *
 * Validates before writing: a half-parsed restore that wipes the log is worse than a failed one.
 * Throws with something a human can read, because this is the one screen where a silent failure
 * costs you the data you were trying to protect.
 */
export function importAll(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That is not a backup — it did not parse as JSON.');
  }
  const data = parsed?.data ?? parsed;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('That is not a backup.');
  for (const [key, shape] of [['log', Array], ['meals', Array], ['weights', Array], ['loads', Object]]) {
    if (key in data && (shape === Array ? !Array.isArray(data[key]) : typeof data[key] !== 'object')) {
      throw new Error(`Backup is damaged: "${key}" is the wrong shape.`);
    }
  }
  localStorage.setItem(KEY, JSON.stringify({ ...blank, ...data }));
  return { ...blank, ...data };
}

export function appendWeight(kg, at = new Date().toISOString()) {
  const day = new Date(at).toDateString();
  const kept = read().weights.filter((w) => new Date(w.at).toDateString() !== day);
  write({ weights: [...kept, { at, kg }].sort((a, b) => a.at.localeCompare(b.at)).slice(-400) });
}
