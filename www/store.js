// ponytail: localStorage, not IndexedDB. A year of sessions for one lifter is a few hundred KB
// and every read is synchronous. Move to IndexedDB if you ever store video clips.

const KEY = 'gym-trainer/v1';

const blank = {
  loads: {}, thresholds: {}, log: [], profile: null, reps: {}, meals: [], foods: {}, weights: [],
  // Device settings, as opposed to training ones: which pose model this phone can afford to run.
  settings: {},
  // Boxing rounds live apart from `log`. That array is set-shaped — reps, load, target — and a
  // round has none of those; forcing it in would mean every lifting analytic had to filter it out.
  rounds: [],
  // ── Mind ───────────────────────────────────────────────────────────────────────────────
  // One row per day keyed 'YYYY-MM-DD': mood, sleep, and that day's plans. Kept together because
  // they are all answers to "how did today go", and read as one row on every screen that uses
  // them. Deliberately NOT merged into `log` — that array is set-shaped, and a day is not a set.
  days: {},
  // PHQ-9 / GAD-7 results. Fortnightly, so this stays short for years.
  checks: [],
  // The check-in conversation. Separate from `log` for the same reason `rounds` is.
  chat: [],
};

export function appendRound(entry) {
  const { rounds } = read();
  write({ rounds: [...rounds, entry].slice(-500) });
}

export const getSetting = (key, fallback) => read().settings[key] ?? fallback;
export const setSetting = (key, value) => write({ settings: { ...read().settings, [key]: value } });

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
  for (const [key, shape] of [['log', Array], ['meals', Array], ['weights', Array], ['loads', Object],
    ['chat', Array], ['checks', Array], ['days', Object]]) {
    if (key in data && (shape === Array ? !Array.isArray(data[key]) : typeof data[key] !== 'object')) {
      throw new Error(`Backup is damaged: "${key}" is the wrong shape.`);
    }
  }
  localStorage.setItem(KEY, JSON.stringify({ ...blank, ...data }));
  return { ...blank, ...data };
}

// ── mind ─────────────────────────────────────────────────────────────────────────────────
// Mood, sleep, plans, the check-in conversation, and the fortnightly screeners.

/** Local date, not UTC — a check-in at 1am belongs to the day you think it does. */
export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const shiftKey = (n, from = new Date()) =>
  dayKey(new Date(from.getFullYear(), from.getMonth(), from.getDate() + n));

const emptyDay = { mood: null, bed: '', wake: '', plans: [] };

export const days = () => read().days;

export const day = (key = dayKey()) => ({ ...emptyDay, ...(read().days[key] ?? {}) });

export function patchDay(patch, key = dayKey()) {
  const next = { ...read().days, [key]: { ...day(key), ...patch } };
  // ~14 months. Long enough to see a seasonal pattern, short enough to stay small.
  const keys = Object.keys(next).sort().slice(-420);
  write({ days: Object.fromEntries(keys.map((k) => [k, next[k]])) });
}

export const chat = () => read().chat;

export function appendChat(role, content) {
  const entry = { role, content, at: new Date().toISOString() };
  write({ chat: [...read().chat, entry].slice(-200) });
  return entry;
}

/** The slice the model gets. `at` is ours, not the API's — strip it. */
export const recentChat = (n = 30) =>
  read().chat.slice(-n).map(({ role, content }) => ({ role, content }));

export const clearChat = () => write({ chat: [] });

export const checks = () => read().checks;

export function appendCheck(entry) {
  write({ checks: [...read().checks, { at: new Date().toISOString(), ...entry }] });
}

export const lastCheck = (kind) => [...read().checks].reverse().find((c) => c.kind === kind) ?? null;

export function appendWeight(kg, at = new Date().toISOString()) {
  const day = new Date(at).toDateString();
  const kept = read().weights.filter((w) => new Date(w.at).toDateString() !== day);
  write({ weights: [...kept, { at, kg }].sort((a, b) => a.at.localeCompare(b.at)).slice(-400) });
}
