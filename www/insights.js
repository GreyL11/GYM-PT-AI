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

/**
 * One entry per training day for a lift, oldest first.
 *
 * Sorted here rather than trusted, for the same reason nutrition.weightTrend() is: everything built
 * on this reads "first" and "last" by array position, and position is only chronology while every
 * writer appends in order. appendLog() does — but importAll() restores whatever ordering the backup
 * file happens to have and validates shape only. An out-of-order log does not make strength() a
 * little wrong, it makes changePct point the WRONG WAY — verified: a 33% gain read back as −25% —
 * and makes stalledSessions() count a stall at whichever load happens to sit last in the array.
 *
 * Three ordering cases, decided rather than left to chance:
 *   Unparseable `at`   dropped. A set that cannot be placed in time cannot join a trend, and
 *                      keeping it built an "Invalid Date" session whose date subtraction was NaN.
 *                      Not data loss: store.read().log still holds the record untouched.
 *   Equal `at`         left in insertion order. Array#sort is stable, and two sets written in the
 *                      same millisecond carry no truth about which came first.
 *   Already in order   unchanged, which is every log this app writes for itself.
 *
 * The array is copied before sorting, never sorted in place — reordering the caller's log as a
 * side effect of reading it would be its own bug.
 */
export function sessions(exId) {
  const byDay = new Map();
  const ordered = [...store.history(exId)]
    .filter((e) => Number.isFinite(new Date(e.at).getTime()))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  for (const e of ordered) {
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

// ── movement intelligence: rep-indexed fault patterns ────────────────────────────────────
//
// Reads `faultEvents` (see MOVEMENT_INTELLIGENCE_DESIGN.md), which only exists on sets logged
// after that field shipped. Every function here treats a missing/empty faultEvents as "no data
// yet" — never as "no faults happened." Backfilling that distinction for an old record is
// impossible, and guessing would be exactly the fabricated precision this layer exists to avoid.
//
// TERMINOLOGY (P0.6): one stored log entry is one SET. "Session"/"workout" would mean a whole
// training visit, possibly several exercises — nothing here, or anywhere in the log, groups by
// that. (`sessions()` above groups THIS exercise's sets by calendar day, which is a real, correct
// concept — but a different one, and it is never mixed into the functions below.) Everything past
// this point counts and speaks in SETS, because that is the only unit the data actually supports.

/** Below this many comparable sets, a "pattern" is a coincidence, not evidence. */
export const MIN_SETS_FOR_PATTERN = 3;

// Two different predicates, not one — collapsing them was a real bug caught while writing the
// tests for this file, not a hypothetical:
//
// `wasTracked` asks "does this set even carry the field" — true for every set logged after this
// shipped, INCLUDING a genuinely clean one (faultEvents: []). A clean tracked set is real evidence
// that the fault did NOT happen that set, and must count toward the confidence denominator.
//
// `hasUsableEvents` asks "did anything TRUTHFULLY fire" — used only where an empty set has nothing
// to report by definition (a within-set breakdown of a set with no faults is not a breakdown).
const wasTracked = (record) => Array.isArray(record?.faultEvents);

/**
 * How many reps this set actually, finally, had — after any manual rep correction. This is the
 * ceiling every fault event must respect to be usable evidence.
 *
 * `record.reps` is the truth once it exists, even if it is 0 (a corrected-to-zero set is a real,
 * meaningful fact, not a reason to fall back to the target). `record.target` — what the set was
 * AIMING for — is only a fallback for a malformed/legacy record where `reps` itself is missing,
 * never a way to raise the ceiling back up once a real `reps` value is present. Getting this
 * backwards was the P0.6 bug: `Math.max(reps, target, 1)` let the original target quietly restore
 * a rep count a human had just corrected away.
 */
const confirmedReps = (record) => (typeof record?.reps === 'number' ? record.reps : (record?.target ?? 0));

/**
 * `faultEvents` beyond `confirmedReps` are not deleted anywhere — see coach.amendReps() and
 * MOVEMENT_INTELLIGENCE_DESIGN.md's evidence-integrity addendum. They are real, camera-observed
 * facts about a rep count that was later corrected away, and staying available on the raw record
 * is exactly how a human (or devcheck.js) can tell "this was corrected" from "this is a bug."
 *
 * But they must never count as evidence for a rep that, per the final confirmed count, did not
 * happen. This is the one place that boundary is drawn — every pattern function reads through
 * here, never `record.faultEvents` directly, so the boundary cannot drift out of sync between them.
 *
 * A no-op for any record that was never corrected: step() never writes an event past the reps it
 * actually counted, so confirmedReps(record) is already >= every event's rep in that case.
 */
function usableEvents(record) {
  if (!wasTracked(record)) return null;
  const ceiling = confirmedReps(record);
  return record.faultEvents.filter((e) => e.rep <= ceiling);
}

const hasUsableEvents = (record) => wasTracked(record) && usableEvents(record).length > 0;

/**
 * How many of the last `lookback` sets of a lift carry fault-event data at all.
 *
 * This is the denominator every pattern confidence is a fraction of, and it is the only thing that
 * separates "this fault does not happen" from "nothing here was ever watched for it". Exported so
 * evidence.js can draw that line without re-deriving `wasTracked` and letting the two drift.
 */
export const trackedSets = (exId, lookback = 6) =>
  store.history(exId).filter(wasTracked).slice(-lookback).length;

/** Within ONE set: where did it first go wrong, and was the second half worse than the first? */
export function setBreakdown(record) {
  if (!hasUsableEvents(record)) return null;
  const events = usableEvents(record);
  const total = confirmedReps(record);
  if (!total) return null;
  const half = total / 2;
  const early = events.filter((e) => e.rep <= half).length;
  const late = events.filter((e) => e.rep > half).length;
  return { firstFaultRep: Math.min(...events.map((e) => e.rep)), totalFaults: events.length, early, late, worsening: late > early };
}

/**
 * Across the last `lookback` sets of this lift that carry faultEvents: does THIS fault recur, and
 * around which rep? Confidence is exactly (matching sets / observed sets) — never invented — and
 * this returns 'insufficient evidence' rather than a number when there isn't enough to say anything.
 */
export function faultTimeline(exId, faultId, lookback = 6) {
  // A clean tracked set belongs in `withData` — it is evidence the fault did not occur, and
  // excluding it (the bug this comment replaces) would silently drop every good set out of the
  // confidence denominator, inflating confidence for a fault that is actually rare.
  const withData = store.history(exId).filter(wasTracked).slice(-lookback);
  const label = FAULT_LABELS[faultId] ?? faultId;
  if (withData.length < MIN_SETS_FOR_PATTERN) {
    return {
      id: faultId, label, status: 'insufficient evidence',
      confidence: 0, evidenceSets: withData.length, matchingSets: 0, breakdownStartRep: null,
    };
  }
  const matches = withData
    .map((set) => usableEvents(set).filter((e) => e.id === faultId))
    .filter((hits) => hits.length > 0);
  const confidence = Math.round((matches.length / withData.length) * 100) / 100;
  const starts = matches.map((hits) => Math.min(...hits.map((e) => e.rep)));
  return {
    id: faultId,
    label,
    status: confidence >= 0.5 ? 'recurring' : matches.length ? 'occasional' : 'not observed',
    confidence,
    evidenceSets: withData.length,
    matchingSets: matches.length,
    breakdownStartRep: starts.length ? Math.round(starts.reduce((a, b) => a + b, 0) / starts.length) : null,
  };
}

/** Every fault id seen in the lift's recorded events, ranked by faultTimeline confidence. */
export function topPatterns(exId, lookback = 6) {
  const withData = store.history(exId).filter(hasUsableEvents).slice(-lookback);
  const ids = new Set(withData.flatMap((set) => usableEvents(set).map((e) => e.id)));
  return [...ids]
    .map((id) => faultTimeline(exId, id, lookback))
    .filter((p) => p.status !== 'insufficient evidence')
    .sort((a, b) => b.confidence - a.confidence);
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
