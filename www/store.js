// ponytail: localStorage, not IndexedDB. A year of sessions for one lifter is a few hundred KB
// and every read is synchronous. Move to IndexedDB if you ever store video clips.

const KEY = 'gym-trainer/v1';

const blank = {
  loads: {}, thresholds: {}, log: [], profile: null, reps: {}, meals: [], foods: {}, weights: [],
  // Device settings, as opposed to training ones: which pose model this phone can afford to run.
  settings: {},
  // Health Coach outcome log — one row per offer/complete/skip/postpone of a candidate action. See
  // health.js. Same append-cap pattern as `verdicts`, and for the same reason: this is what makes
  // "you tend to complete hydration in the afternoon" an inspectable fact instead of a vibe.
  actions: [],
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
  // What progression decided, and the numbers it decided from. See appendVerdict below.
  verdicts: [],
};

/**
 * What progression decided at the end of an exercise, and the numbers it decided from.
 *
 * The outcome of a verdict has always survived — as a changed load in `loads`. The REASONING never
 * did: it lived in a closure in coach.js and was gone the moment you left the rest screen. So
 * "why did it hold me at 60 kg on Tuesday" had no answer, because nothing had written Tuesday down.
 *
 * What is stored is the deterministic result and its inputs, never prose. Anything explaining a
 * verdict later — a template, or the model — reads these numbers; it does not get to reconstruct
 * the decision, and a verdict that was never recorded stays unavailable rather than inferred.
 *
 * Additive and backward-compatible: every existing install simply has none, and read()'s spread
 * over `blank` gives them an empty array rather than undefined. Old sets keep no verdict forever —
 * that is honest, and backfilling one from a load change would be a decision nobody made.
 */
export function appendVerdict(entry) {
  const { verdicts } = read();
  write({ verdicts: [...verdicts, { at: new Date().toISOString(), ...entry }].slice(-200) });
  return entry;
}

export const verdicts = () => read().verdicts;

/** The most recent decision for a lift, or null when nothing was ever recorded for it. */
export const lastVerdict = (exId) =>
  [...read().verdicts].reverse().find((v) => v.exId === exId) ?? null;

export function appendRound(entry) {
  const { rounds } = read();
  write({ rounds: [...rounds, entry].slice(-500) });
}

/** One outcome event for a candidate action: {id, domain, event, at, ...}. */
export function appendAction(entry) {
  const { actions } = read();
  const row = { at: new Date().toISOString(), ...entry };
  write({ actions: [...actions, row].slice(-1000) });
  return row;
}

export const actions = () => read().actions;

/** Every event ever logged for one candidate-action id, oldest first. */
export const actionHistory = (id) => read().actions.filter((a) => a.id === id)
  .sort((a, b) => a.at.localeCompare(b.at));

/** The most recent event for an id, or null if it has never been offered. */
export const lastActionEvent = (id) => {
  const h = actionHistory(id);
  return h.length ? h.at(-1) : null;
};

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
    ['chat', Array], ['checks', Array], ['days', Object], ['verdicts', Array], ['actions', Array]]) {
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

// `skin` rides on the day row for the same reason mood and sleep do: it is an answer to "how did
// today go", read as one row by every screen that uses it. Shape: {score 1-5, flags[], habits[]}.
// `sleeps` is the current shape: one entry per block of sleep, with real timestamps, filed under
// the day it ENDED. `bed`/`wake` are the old one-pair-per-day shape and are kept because every day
// logged before this existed is stored that way — mood_insights.sleepBlocks() reads either.
const emptyDay = { mood: null, bed: '', wake: '', sleeps: [], plans: [], skin: null };

export const days = () => read().days;

export const day = (key = dayKey()) => ({ ...emptyDay, ...(read().days[key] ?? {}) });

export function patchDay(patch, key = dayKey()) {
  const next = { ...read().days, [key]: { ...day(key), ...patch } };
  // ~14 months. Long enough to see a seasonal pattern, short enough to stay small.
  const keys = Object.keys(next).sort().slice(-420);
  write({ days: Object.fromEntries(keys.map((k) => [k, next[k]])) });
}

/**
 * Record one block of sleep, filed under the day it ended.
 *
 * Filed by END rather than start because that is the question the rest of the app asks: "how did I
 * sleep for today" is about the sleep you just got up from, and a block running 23:00 Monday to
 * 07:00 Tuesday is Tuesday's night however you say it out loud. It also removes the ambiguity the
 * old bed/wake pair had, where a sleep landed on whichever day you happened to open the app.
 *
 * Kept sorted by start, and capped, so a day cannot grow without limit if something goes wrong.
 * Returns the day key it was filed under, which is not always today.
 */
export function addSleep(start, end) {
  const key = dayKey(new Date(end));
  const next = [...day(key).sleeps, { start, end }]
    .sort((a, b) => String(a.start).localeCompare(String(b.start)))
    .slice(-8);
  patchDay({ sleeps: next }, key);
  return key;
}

/** Remove a mis-logged block. Matched on its start, which is unique enough within one day. */
export function removeSleep(key, start) {
  patchDay({ sleeps: day(key).sleeps.filter((s) => s.start !== start) }, key);
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
