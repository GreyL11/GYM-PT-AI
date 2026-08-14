# Movement Intelligence — Data Model Design

Built directly on the audit's §3/§4 findings. The single new primitive is **the rep number at which
a fault fires**, because it's the one thing that's computable today and simply isn't kept. Everything
else in this design is either reused as-is or a small, additive read-layer on top of it.

## What's reused, unchanged

- `exercises.js` `step()` rep state machine, EMA smoothing, per-check visibility gating — untouched.
- `store.js` `appendLog`/`history`/`exportAll`/`importAll` — untouched. The new field rides inside
  the existing log-entry object; no new storage key, no new store function.
- `insights.js` `sessions()`, `strength()`, `stalledSessions()`, `shouldDeload()`, `fatigue()` — all
  untouched and still the correct tool for what they already do (day-level 1RM trend, timing-based
  in-set fatigue). Movement Intelligence is a **new, separate set of functions reading the same
  log**, not a replacement.
- `coach.js` `preview()`/`finishExercise()` decide-then-commit split — untouched in this pass; it's
  the correct extension point for Phase 4 (see `TRAINING_DECISION_ENGINE.md`), not something to
  rebuild.

## The one schema change

**Additive only.** The existing log entry:

```js
{ at, exId, set, reps, target, load, faults: { id: count }, repMs: [ms, ...] }
```

gains one optional field:

```js
{ ...same as above, faultEvents: [{ rep, id }, ...] }
```

`faultEvents` is an ordered list, one entry per fault that fired during the set, each carrying which
rep was in progress at that moment. `faults` (the flat count dict) is **kept exactly as it is** —
every existing consumer (`faultFingerprint`, `preview`'s clean-rate check, the Progress screen)
keeps working unmodified, reading the field it always read.

**Where `rep` comes from:** inside `step()`, `st.reps` already holds the count of *completed* reps
at the moment a fault is confirmed. The rep in progress is `st.reps + 1`. This is an approximation
at the exact frame of a rep boundary (a fault confirmed in the last debounce-frame of rep N could in
principle belong to N or N+1) — that imprecision is named here rather than hidden, and it's the
right trade for the cost: zero extra camera-loop work, one small object pushed to an array that
already exists in the same scope.

## Migration & backward compatibility

- **No migration step.** Every record already in `store.js`'s `log` array simply lacks
  `faultEvents`. Every new Movement Intelligence function must treat a missing/empty
  `faultEvents` as **"no data yet," never as "no faults happened."** Concretely: a pattern function
  can only speak once enough *new* sets carrying the field exist; it must not backfill or guess for
  old sets.
- `store.importAll()`'s shape validation (`log` must be an `Array`) is unaffected — it doesn't
  inspect individual log-entry fields, so old backups still restore cleanly and simply won't have
  pattern data until new sets are logged.
- Nothing about `faults` (the flat dict) changes shape or meaning. Any external tooling or a future
  export consumer reading only that field is unaffected.

## Storage impact

A typical set is ~2-6 faults; each `faultEvents` entry is `{rep: <1-2 digit int>, id: <short string>}`
— tens of bytes. Against the existing 500-set cap in `appendLog`, this adds low single-digit KB at
full capacity. Not worth a size-mitigation strategy.

## Performance impact

One array push inside the existing fault-confirmation branch in `step()` (`exercises.js` ~L956),
which already runs at most once per fault per debounce window, not per frame. No new camera-loop
work, no new landmark reads, no new allocations beyond the one small object.

## Privacy

No new category of data — still joint-angle-derived fault ids and rep counts, still 100% local,
still covered by the existing export/import backup path. Nothing here creates a reason to reconsider
the offline-first architecture.

## New read-layer functions (in `insights.js`, alongside the existing ones)

```js
/** Within ONE set: where did it start going wrong, and did it get worse in the second half? */
export function setBreakdown(record) { /* uses record.faultEvents; null if none recorded */ }

/**
 * Across the last N sets of this lift that carry faultEvents: does this specific fault recur,
 * and around which rep? Refuses to report anything below MIN_SETS_FOR_PATTERN, and the
 * confidence is exactly (matching sets / observed sets) — not an invented score.
 */
export function faultTimeline(exId, faultId, lookback) { /* {confidence, evidenceSets, ...} */ }

/** Every fault with recorded events for this lift, ranked by faultTimeline confidence. */
export function topPatterns(exId, lookback) { /* [{...faultTimeline shape}, ...] sorted */ }
```

Exact behavior, evidence thresholds, and the language rules for presenting these (observation vs
pattern vs hypothesis vs recommendation) are specified in `TRAINING_DECISION_ENGINE.md` and
implemented as the P0 in `MOVEMENT_INTELLIGENCE_ROADMAP.md`.

## P0.6 addendum — evidence integrity and terminology (added after real-data validation)

Two decisions P0.5's validation exercise forced, before any more data collection:

**Rep correction never touches `faultEvents`.** `coach.amendReps()` can change `record.reps` after
the fact (the camera miscounted); it does not, and must not, trim, delete, or otherwise edit the
stored fault events. They are what the camera actually observed, and staying on the record —
unedited, forever — is what lets a human or `devcheck.js` tell "this was corrected" from "this
looks like a bug." The record instead gains one optional field, `correctedFrom`, set once (the
first time a given set is amended) to the original confirmed rep count. Every read function
(`setBreakdown`, `faultTimeline`, `topPatterns`) computes a `confirmedReps` ceiling from the
CURRENT `record.reps` and filters `faultEvents` against it at read time — never by mutating storage.
This is a no-op for any set that was never corrected, by construction: `step()` never writes an
event past the reps it actually counted, so the ceiling only ever discards something after a human
has genuinely shrunk the count.

**"Session" was being used for two different things in the same file, and one of them was wrong.**
`insights.sessions()` (pre-existing, unrelated to this cycle) genuinely groups a lift's sets by
calendar day — a real concept, correctly named. But `faultTimeline`/`topPatterns` read
`store.history(exId)` directly, one entry per SET, with no day-grouping at all — and were returning
fields named `evidenceSessions`/`matchingSessions`. Renamed to `evidenceSets`/`matchingSets`
(`MIN_SESSIONS_FOR_PATTERN` → `MIN_SETS_FOR_PATTERN`) rather than left to imply a grouping the data
does not have. No workout/training-session entity exists anywhere in this codebase — nothing
groups multiple exercises performed in one visit — so none of this layer's language claims one.
