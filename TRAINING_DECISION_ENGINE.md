# Training Decision Engine (v2 design — not implemented this pass)

**Status: designed, not built.** It depends on `faultEvents` data existing across multiple
sessions, which the P0 in this cycle creates but cannot itself have accumulated yet — a decision
engine reading pattern data that doesn't exist yet would either fabricate confidence or add
branches nothing can currently exercise. It's correctly a P1, and this file specifies it so the P0
is built with the right shape underneath it.

## Today, verified (see audit §1)

`coach.js` `preview()` already returns a binary-ish outcome from `exerciseSets` (this exercise's
sets so far):

- `{ moved: true, from, to, reason: 'all reps clean' }` — every rep hit, faults-per-rep under
  `CLEAN_FAULTS_PER_REP` (a flat 0.34 constant)
- `{ moved: true, deload: true, ... }` — 3 sessions stalled at the same load
- `{ moved: false, reason: 'reps missed' | 'form broke down' }` — otherwise

This is a real decision, already evidence-gated (it never moves on one set alone — `exerciseSets`
spans the whole exercise's sets that session), already explainable (`reason` is returned, already
surfaced in the UI as spoken text), and already separates "decide" (`preview()`) from "commit"
(`finishExercise()`) so a miscounted rep can be corrected before anything is written. **This
architecture is correct and should be extended, not replaced.**

## The upgrade: same shape, richer inputs and vocabulary

```text
outcome = decide({
  repsHit,                        // existing input
  faultRatePerSet,                // existing input (CLEAN_FAULTS_PER_REP threshold)
  breakdownPattern,                // NEW — from insights.faultTimeline() per relevant fault id
  stalledSessions,                 // existing input (insights.shouldDeload)
})
```

### Outcome vocabulary

| Outcome | Fires when | Evidence required |
|---|---|---|
| `PROGRESS` | All reps hit, clean fault rate, no recurring breakdown pattern with confidence ≥ 0.5 | Same as today's `moved: true` |
| `MAINTAIN` | All reps hit, but a fault pattern is `'occasional'` (confidence 0.2–0.5) — not yet enough to act on, worth one more look | `faultTimeline` returned `evidenceSets ≥ MIN_SETS_FOR_PATTERN` |
| `REDUCE_VOLUME` | Reps completed but `setBreakdown` shows the SAME fault worsening within-set across ≥2 of the last 3 sets at this load — the movement holds early, not late | Requires per-set `faultEvents`, not just a lifetime count |
| `REDUCE_LOAD` | Fault pattern confidence ≥ 0.5 AND `breakdownStartRep` is early in the set (before roughly half the target reps) | Same pattern data, stricter position threshold |
| `DELOAD` | Existing 3-session stall rule (day-grouped, via `insights.sessions()` — a real, calendar-day concept, unrelated to the set-level pattern data below) — unchanged, it's already evidence-gated correctly | `insights.shouldDeload` |
| `RETEST` | A previous intervention (see below) has one, not yet enough, comparable SET recorded since it was applied | Requires the intervention-history log this file's second half describes |
| `INSUFFICIENT_CONFIDENCE` | Fewer than `MIN_SETS_FOR_PATTERN` comparable sets exist — explicitly returned instead of guessing | This is the DEFAULT for a new lift or a lift with no `faultEvents` history yet, and it must be a real, testable branch, not a silent fallthrough |

**Rule, not a preference:** `INSUFFICIENT_CONFIDENCE` must be the actual return value when evidence
is thin — not `PROGRESS` used as a default. A decision engine that quietly assumes "fine" when it
doesn't know is worse than one that says "not enough evidence," per the mission's own anti-
hallucination rule.

## Explanation format (Phase 7, folded in here rather than a separate file)

Every decision carries the same six fields, generated from stored evidence, never templated with
invented numbers:

```text
OBSERVATION   what setBreakdown/faultTimeline actually measured this set
EVIDENCE      "detected in {matchingSets} of your last {evidenceSets} comparable sets"
CONFIDENCE    the exact fraction, not a vague word — "0.67" is honest, "high" alone is not
DECISION      one of the outcomes above
REASON        which threshold in the table above was crossed
NEXT CHECK    what set/comparison would change this
```

This reuses the existing `reason` field's role in `coach.js` — it's the same mechanism, given more
to say.

## Intervention → outcome logging (Phase 5, folded in here)

When a decision changes something (`REDUCE_LOAD`, `REDUCE_VOLUME`, `DELOAD`), record it:

```js
{ at, exId, decision, from, to, evidenceAtDecision: { faultId, confidence, breakdownStartRep } }
```

stored the same way `log`/`rounds` already are — a new small array in `store.js`, same pattern as
`appendRound`. The **next** comparable set/session is compared against `evidenceAtDecision`, and the
result is reported as:

> "Improvement followed this adjustment" / "Not enough evidence yet" / "The pattern has not changed"

**Never:** "this adjustment caused the improvement." One person, one uncontrolled variable, no
control condition — causation is not a claim this system, or any single-user system, can honestly
make. This is a hard rule, not a style preference.

## Why this is P1, not P0

Every outcome above except the three that already exist today (`PROGRESS`/`DELOAD`/hold) depends on
`faultTimeline()` having enough evidence sessions to return a real confidence. That data starts
accumulating the moment `faultEvents` ships (this cycle's P0) and takes several real training
sessions to become non-trivial. Building the decision branches before that data exists would mean
testing them only against synthetic fixtures, which proves the code runs, not that the decisions are
right. Ship the instrumentation, let it accumulate, then build this against real accumulated
`faultEvents` — which is exactly the sequencing `MOVEMENT_INTELLIGENCE_ROADMAP.md` specifies.
