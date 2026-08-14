// Developer-facing data validation for `faultEvents` (P0.5/P0.6). NOT a product feature — no
// polish, no charts, no LLM, no new intelligence. Exists to answer exactly one question after a
// real training session: is the data actually trustworthy enough to build P1 on top of.
//
// Reuses insights.js's read layer (setBreakdown/faultTimeline/topPatterns) rather than duplicating
// it. The only genuinely new logic here is RECONCILIATION — checking that the additive faultEvents
// field agrees with the flat faults count it rides alongside, and that its rep indices are sane.
// Nothing here changes detection thresholds, fault rules, or any stored data — it only reads.
//
// TERMINOLOGY (P0.6): one stored log entry is one SET, never called a "session" anywhere below —
// see insights.js's own terminology note. Nothing in this codebase groups sets into a whole
// training visit, so this tool never claims to either.

import { EXERCISES } from './exercises.js';
import * as insights from './insights.js';
import * as store from './store.js';

/** Which lifts actually have logged history — so a picker isn't 20 mostly-empty entries. */
export function trainedExercises() {
  const ids = new Set(store.read().log.map((e) => e.exId));
  return [...ids].filter((id) => EXERCISES[id]).sort();
}

/**
 * Does the flat `faults` count reconcile EXACTLY with `faultEvents`? These two fields are meant
 * to describe the same firings — `faults` is the count coach.js has relied on since before this
 * field existed, `faultEvents` is the additive rep-indexed version written in the same call.
 *
 * Deliberately compares the RAW arrays, never the correction-aware `confirmedReps` ceiling from
 * insights.js. `faults` and `faultEvents` are written together, at the same instant, before any
 * rep correction can exist — they must always agree with each other regardless of what a human
 * does to `reps` afterward. If a future edit ever touched one without the other, this is what
 * would notice; a rep correction must never be able to make that comparison look reconciled OR
 * unreconciled when it genuinely isn't either.
 */
function reconcile(record) {
  if (!Array.isArray(record.faultEvents)) return { tracked: false, matches: null, mismatches: [] };
  const counted = {};
  for (const e of record.faultEvents) counted[e.id] = (counted[e.id] ?? 0) + 1;
  const flat = record.faults ?? {};
  const ids = new Set([...Object.keys(counted), ...Object.keys(flat)]);
  const mismatches = [...ids]
    .filter((id) => (counted[id] ?? 0) !== (flat[id] ?? 0))
    .map((id) => ({ id, fromEvents: counted[id] ?? 0, fromFlatCount: flat[id] ?? 0 }));
  return { tracked: true, matches: mismatches.length === 0, mismatches };
}

/**
 * A rep index that could not have come from the FINAL, confirmed set: non-positive, non-integer,
 * or past `confirmedReps` — reps, falling back to target only if reps is genuinely absent, never
 * the other way round.
 *
 * P0.6 fix: this used to be `Math.max(reps, target, 1)`, which let the ORIGINAL target quietly
 * raise the ceiling back up after a downward correction — a set corrected from 5 reps to 3, with a
 * fault recorded at rep 5, was NOT flagged, because target (still 5, untouched by the correction)
 * won the max() and restored exactly the ceiling the correction had just lowered. Confirmed by
 * re-tracing the actual code, not assumed: `record.target` is never touched by amendReps().
 *
 * Deliberately still scans the RAW faultEvents, not insights.js's ceiling-filtered usable events —
 * catching what's beyond the ceiling is the entire point; filtering it out first would hide the
 * exact thing this function exists to show. Never returns fewer flags because a correction
 * happened — see `correctedFrom` on the observed entry for the explanation, not suppression.
 */
function suspiciousEvents(record) {
  if (!Array.isArray(record.faultEvents)) return [];
  const ceiling = typeof record.reps === 'number' ? record.reps : (record.target ?? 0);
  return record.faultEvents.filter((e) => !Number.isInteger(e.rep) || e.rep < 1 || e.rep > Math.max(ceiling, 1));
}

/** A fault id that isn't in this exercise's own rule table — a typo or a stale id from a removed rule. */
function unknownFaultIds(record) {
  if (!Array.isArray(record.faultEvents)) return [];
  const known = new Set((EXERCISES[record.exId]?.faults ?? []).map((f) => f.id));
  return [...new Set(record.faultEvents.map((e) => e.id))].filter((id) => !known.has(id));
}

const severityOf = (exId, faultId) => EXERCISES[exId]?.faults?.find((f) => f.id === faultId)?.severity ?? null;

/**
 * The full validation report for one lift.
 *
 * OBSERVED — the raw stored records, newest last, each with its own reconciliation/sanity check
 *            and, if it was ever rep-corrected, exactly what it was corrected FROM.
 * DERIVED  — insights.setBreakdown() per set with usable evidence, plus insights.topPatterns()
 *            across them. Every pattern also carries `sourceSets` (exact timestamps) so it can be
 *            checked by eye against the OBSERVED list above it.
 * INSUFFICIENT — fault ids that exist in the data but that faultTimeline refuses to score yet,
 *            with the reason (evidence count vs the floor), so "no answer yet" is never confused
 *            with "silently absent."
 */
export function inspect(exId, lookback = 10) {
  const all = store.history(exId);
  const recent = all.slice(-lookback);
  const trackedAll = all.filter((r) => Array.isArray(r.faultEvents));

  const observed = recent.map((record, i) => {
    const rec = reconcile(record);
    const ids = Array.isArray(record.faultEvents) ? [...new Set(record.faultEvents.map((e) => e.id))] : [];
    return {
      index: all.length - recent.length + i + 1, // position in the FULL history, not just this slice
      at: record.at,
      reps: record.reps,
      target: record.target,
      load: record.load,
      tracked: rec.tracked,
      corrected: record.correctedFrom !== undefined,
      correctedFrom: record.correctedFrom ?? null,
      faultEvents: record.faultEvents ?? null,
      flatFaults: record.faults ?? {},
      reconciled: rec.matches,
      mismatches: rec.mismatches,
      suspiciousEvents: suspiciousEvents(record),
      unknownFaultIds: unknownFaultIds(record),
      severities: Object.fromEntries(ids.map((id) => [id, severityOf(exId, id)])),
    };
  });

  const derived = recent
    .map((record) => ({ at: record.at, breakdown: insights.setBreakdown(record) }))
    .filter((d) => d.breakdown); // setBreakdown is already usable-evidence-aware; trust it, don't re-filter on raw faultEvents

  const patterns = insights.topPatterns(exId, lookback).map((p) => ({
    ...p,
    sourceSets: recent.filter((r) => r.faultEvents?.some((e) => e.id === p.id)).map((r) => r.at),
  }));

  // topPatterns only returns what already cleared the floor. This recomputes faultTimeline for
  // every OTHER id seen in the data so a developer can see what's being held back, and why —
  // "there is no pattern for X" and "X hasn't cleared the evidence floor yet" must not look the same.
  const allIds = new Set(trackedAll.flatMap((r) => r.faultEvents.map((e) => e.id)));
  const insufficient = [...allIds]
    .map((id) => insights.faultTimeline(exId, id, lookback))
    .filter((p) => p.status === 'insufficient evidence');

  return {
    exId,
    totalSets: all.length,
    trackedSets: trackedAll.length,
    legacySets: all.length - trackedAll.length,
    observed,
    derived,
    patterns,
    insufficient,
  };
}

/** Same report, as plain lines — for a console or a `<pre>`, not a component tree. */
export function render(report) {
  const lines = [];
  const push = (s = '') => lines.push(s);

  push(`${report.exId} — ${report.totalSets} sets logged, ${report.trackedSets} tracked, ${report.legacySets} legacy (pre-faultEvents)`);
  push();
  push('OBSERVED DATA (raw stored records, newest last)');
  push('─'.repeat(60));
  for (const o of report.observed) {
    push(`#${o.index}  ${o.at}  ${o.reps}/${o.target} reps @ ${o.load || 'bodyweight'}`);
    if (o.corrected) push(`    CORRECTED: originally ${o.correctedFrom} reps, confirmed at ${o.reps}`);
    if (!o.tracked) { push('    (legacy — no faultEvents recorded)'); continue; }
    push(`    faultEvents: ${JSON.stringify(o.faultEvents)}`);
    push(`    flat faults: ${JSON.stringify(o.flatFaults)}`);
    push(`    reconciled: ${o.reconciled ? 'yes' : 'NO — ' + JSON.stringify(o.mismatches)}`);
    if (o.suspiciousEvents.length) {
      push(`    SUSPICIOUS rep indices: ${JSON.stringify(o.suspiciousEvents)}` +
        (o.corrected ? ' (expected — this set was corrected, see above)' : ' — UNEXPLAINED, look into this'));
    }
    if (o.unknownFaultIds.length) push(`    UNKNOWN fault ids: ${JSON.stringify(o.unknownFaultIds)}`);
    if (Object.keys(o.severities).length) push(`    severity: ${JSON.stringify(o.severities)}`);
  }

  push();
  push('DERIVED DATA (insights.js, unmodified)');
  push('─'.repeat(60));
  push('Within-set breakdown:');
  for (const d of report.derived) {
    push(`  ${d.at}: first fault rep ${d.breakdown.firstFaultRep}, early ${d.breakdown.early} / late ${d.breakdown.late}` +
      `${d.breakdown.worsening ? ' — WORSENING' : ''}`);
  }
  if (!report.derived.length) push('  (no set with usable fault evidence yet)');
  push('Cross-set patterns:');
  for (const p of report.patterns) {
    push(`  ${p.label} (${p.id}): ${p.status}, confidence ${p.confidence} (${p.matchingSets}/${p.evidenceSets} sets), ` +
      `breakdown starts ~rep ${p.breakdownStartRep}`);
    push(`    seen in: ${p.sourceSets.join(', ')}`);
  }
  if (!report.patterns.length) push('  (none have cleared the evidence floor yet)');

  push();
  push('INSUFFICIENT DATA (seen, but not enough evidence to score)');
  push('─'.repeat(60));
  for (const p of report.insufficient) push(`  ${p.label} (${p.id}): ${p.evidenceSets} tracked set(s), needs ${insights.MIN_SETS_FOR_PATTERN}`);
  if (!report.insufficient.length) push('  (none — every observed fault id already has a scored pattern, or none exist)');

  return lines.join('\n');
}
