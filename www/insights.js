// Reads the training log back. Everything here is arithmetic over sets you have already done —
// no model, no network, nothing that needs to be right about the future.
//
// The log is the only input: one record per set, written by coach.endSet().

import { EXERCISES, GROUPS } from './exercises.js';
import * as store from './store.js';

/** Fault ids are terse because they key the rule table; these are what a human should read. */
export const FAULT_LABELS = {
  depth: 'Not reaching depth',
  torso: 'Torso leaning',
  heel: 'Heels lifting',
  valgus: 'Knees caving in',
  flare: 'Elbows flaring',
  lockout: 'Not locking out',
  wrist: 'Wrists not stacked',
  eccentric: 'Dropping it too fast',
  asymmetry: 'Uneven left/right',
  elbowDrift: 'Elbows drifting',
  upperArm: 'Upper arms moving',
  plank: 'Body line sagging',
  kneeBend: 'Too much knee bend',
  barDrift: 'Bar drifting off the body',
  heave: 'Standing up / heaving',
  elbowPath: 'Elbows flaring on the row',
  arch: 'Arching the lower back',
  barPath: 'Bar path off vertical',
  tooHigh: 'Raising above shoulder height',
  elbowBend: 'Bending the elbow',
  swing: 'Swinging for momentum',
};

const DAY_MS = 86400000;
const round2 = (kg) => Math.max(0, Math.round(kg / 2.5) * 2.5);
const dayKey = (iso) => new Date(iso).toDateString();
const countFaults = (f) => Object.values(f ?? {}).reduce((a, b) => a + b, 0);

/**
 * Estimated one-rep max, adjusted Epley: load × (1 + (reps−1)/30).
 *
 * The textbook Epley is (1 + reps/30), which reports a 1-rep set as 3% MORE than the weight you
 * just lifted — it is only defined for multi-rep sets. The −1 makes a single exact. Brzycki is
 * the other common choice but has a singularity at 37 reps, and endurance work goes high enough
 * that a linear formula is the safer one. Rough past ~12 reps either way, which is fine: this is
 * only ever compared against itself.
 */
export const e1rm = (load, reps) => (load > 0 && reps > 0 ? load * (1 + (reps - 1) / 30) : 0);

/** One entry per training day for a lift, oldest first. */
export function sessions(exId) {
  const byDay = new Map();
  for (const e of store.history(exId)) {
    const key = dayKey(e.at);
    const s = byDay.get(key) ?? { date: key, at: e.at, load: e.load, sets: 0, reps: 0, faults: 0, best: 0 };
    s.sets += 1;
    s.reps += e.reps;
    s.faults += countFaults(e.faults);
    s.load = Math.max(s.load, e.load);
    s.best = Math.max(s.best, e1rm(e.load, e.reps));
    byDay.set(key, s);
  }
  return [...byDay.values()];
}

/** Estimated 1RM now vs when you started, for lifts that carry external load. */
export function strength(exId) {
  const s = sessions(exId).filter((x) => x.best > 0);
  if (s.length < 2) return null;
  const first = s[0], last = s.at(-1);
  const days = Math.round((new Date(last.at) - new Date(first.at)) / DAY_MS);
  return {
    current: Math.round(last.best),
    best: Math.round(Math.max(...s.map((x) => x.best))),
    changePct: first.best ? Math.round(((last.best - first.best) / first.best) * 100) : 0,
    days,
    sessions: s.length,
  };
}

/**
 * How many consecutive recent sessions sat at the same weight. Progression only raises the load
 * on a clean, all-reps session, so a flat load IS a stall — no separate counter needed.
 */
export function stalledSessions(exId) {
  const s = sessions(exId);
  if (!s.length) return 0;
  const load = s.at(-1).load;
  let n = 0;
  for (let i = s.length - 1; i >= 0 && s[i].load === load; i -= 1) n += 1;
  return n;
}

const STALL_LIMIT = 3;   // three sessions stuck is a stall, not a bad day
const DELOAD_FACTOR = 0.9;

export const shouldDeload = (exId) => stalledSessions(exId) >= STALL_LIMIT;
export const deloadTo = (load) => round2(load * DELOAD_FACTOR);

/** Which faults dominate — for one lift, or across everything when exId is null. */
export function faultFingerprint(exId = null) {
  const log = exId ? store.history(exId) : store.read().log;
  const totals = {};
  for (const e of log) {
    for (const [id, n] of Object.entries(e.faults ?? {})) totals[id] = (totals[id] ?? 0) + n;
  }
  const sum = Object.values(totals).reduce((a, b) => a + b, 0);
  if (!sum) return [];
  return Object.entries(totals)
    .map(([id, count]) => ({ id, label: FAULT_LABELS[id] ?? id, count, share: count / sum }))
    .sort((a, b) => b.count - a.count);
}

/** Hard sets per muscle group over the last 7 days. 10–20 is the usual productive range. */
export const VOLUME_TARGET = { low: 10, high: 20 };

export function weeklyVolume(now = new Date()) {
  const since = now - 7 * DAY_MS;
  const out = Object.fromEntries(GROUPS.map((g) => [g, 0]));
  for (const e of store.read().log) {
    if (new Date(e.at) < since) continue;
    const group = EXERCISES[e.exId]?.group;
    if (group) out[group] += 1;
  }
  return out;
}

/** When a muscle group was last worked. null if never. */
export function lastTrained(group, now = new Date()) {
  let latest = null;
  for (const e of store.read().log) {
    if (EXERCISES[e.exId]?.group !== group) continue;
    const at = new Date(e.at);
    if (!latest || at > latest) latest = at;
  }
  return latest && { at: latest, hoursAgo: Math.round((now - latest) / 3600000) };
}

const RECOVERY_HOURS = 48;

/** Groups in a planned session that have not had 48h since the last time you hit them. */
export function recoveryWarnings(session, now = new Date()) {
  if (!session) return [];
  const groups = [...new Set(session.exercises.map((e) => EXERCISES[e.exId].group))];
  return groups
    .map((g) => ({ group: g, ...(lastTrained(g, now) ?? {}) }))
    .filter((x) => x.hoursAgo !== undefined && x.hoursAgo < RECOVERY_HOURS);
}

/**
 * How much the reps slowed across a set. >1 means the last reps took longer than the first,
 * which is the honest signal that the set is done.
 */
export function fatigue(repMs) {
  if (!repMs || repMs.length < 4) return null;
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const start = mean(repMs.slice(0, 2));
  if (!start) return null;
  return mean(repMs.slice(-2)) / start;
}

/** Everything the Progress screen needs, in one pass. */
export function summary(now = new Date()) {
  const trained = [...new Set(store.read().log.map((e) => e.exId))].filter((id) => EXERCISES[id]);
  return {
    lifts: trained
      .map((exId) => ({
        exId,
        name: EXERCISES[exId].name,
        strength: strength(exId),
        stalled: stalledSessions(exId),
        deload: shouldDeload(exId),
        topFault: faultFingerprint(exId)[0] ?? null,
      }))
      .sort((a, b) => (b.strength?.sessions ?? 0) - (a.strength?.sessions ?? 0)),
    volume: weeklyVolume(now),
    faults: faultFingerprint().slice(0, 5),
    totalSets: store.read().log.length,
  };
}
