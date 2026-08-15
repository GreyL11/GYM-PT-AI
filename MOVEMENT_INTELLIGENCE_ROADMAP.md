# Movement Intelligence — Implementation Roadmap

## Competitive moat test (Phase 9, applied to what's actually being built)

For the P0 below — rep-indexed fault timeline with session-recency confidence:

1. Do competitors do this? No evidence found in this session's competitor research
   (`COMPETITIVE_OPPORTUNITY_ANALYSIS.md`) — every competitor pitch found was "form check" /
   "rep count," none described within-set or cross-session breakdown position.
2. Easy to copy? Structurally simple once you think of it — the moat isn't the algorithm, it's
   having the accumulated per-user history to run it against.
3. More valuable with continued use? Yes, directly — `MIN_SETS_FOR_PATTERN` means it produces
   nothing useful in week one and gets more specific every week after. This is compounding value,
   not a one-time feature.
4. Uses historical data? Yes, by construction — this whole design exists to use history that was
   previously being thrown away.
5. Affects a real training decision? Designed to (`TRAINING_DECISION_ENGINE.md`), not wired to the
   decision yet — that's the honest P1 boundary.
6. Improves retention? Plausibly — it's a reason to keep the same app rather than switch, because
   switching resets the pattern history to zero.
7. Supports B2B gym use? Yes, unaffected by whether the primary business model is consumer or
   B2B/kiosk — pattern data belongs to whichever local device/profile logged it.
8. Explainable? Yes by construction — confidence is a plain fraction with a stated evidence count,
   never a black-box score.

`MOAT_SCORE` reads high on differentiation, compounding value, and explainability; unproven on
retention and decision-impact until P1 ships and real sessions accumulate. Honest, not inflated.

## P0 — build now

| Item | Why P0 |
|---|---|
| Fix: propagate `severity` onto the fault object `step()` returns; branch the lifting haptic on it (mirroring the already-correct boxing code) | A real, verified bug in a capability this mission's own prompt claimed already worked. Zero new architecture, one existing pattern copied from boxing.js to the gym-lift path. |
| Add: `faultEvents: [{rep, id}]` to the set record, additive, backward-compatible | The single blocking gap identified in the audit — without it, nothing about within-set or cross-session breakdown position is possible, ever, regardless of how sophisticated the analysis layer is. |
| Add: `insights.setBreakdown(record)` — within-set early/late fault split, per set | Pure function over the new field, directly answers "did this specific set get worse toward the end," using real per-rep data instead of only rep-timing. |
| Add: `insights.faultTimeline(exId, faultId, lookback)` and `topPatterns(exId, lookback)` — cross-session recurrence with an honest confidence and an explicit `insufficient evidence` floor | The exact mechanism `TRAINING_DECISION_ENGINE.md` is designed around; ships now so it starts accumulating real data immediately instead of after another cycle of "let's design more first." |
| Tests for all of the above, including the below-threshold "insufficient evidence" path | Every other module in this codebase ships with tests; this one should not be the exception, and the anti-hallucination rule (don't report a pattern from too little data) is exactly the kind of thing that needs a red test to prove it actually refuses. |

**Deliberately excluded from P0's UI:** no new screen ships this pass. `topPatterns()` is exposed as
a tested function, not wired into the Progress screen yet. Building UI around data that has zero
real sessions to show (this is a fresh field — every existing set in storage lacks it) would only
produce empty-state screens to test. The right UI moment is once a handful of real sessions have
been logged with the new field — see P1.

## P1 — build after P0 has real accumulated data

- Wire `topPatterns()` into the Progress screen and the setup-screen "watch:" line (both already
  exist and already read `faultFingerprint()` for a similar purpose — this is the same UI slot,
  richer data).
- `TRAINING_DECISION_ENGINE.md`'s outcome vocabulary (`MAINTAIN`/`REDUCE_VOLUME`/`REDUCE_LOAD`/
  `RETEST`/`INSUFFICIENT_CONFIDENCE`), wired into `coach.js` `preview()` as additional branches
  ahead of the existing ones, preserving the existing `moved`/`deload` shape so nothing downstream
  breaks.
- Intervention → outcome logging (a new small array in `store.js`, same shape as `appendRound`).
- The UI language rules from Phase 7/8: observation → evidence → confidence → decision → reason →
  next check, rendered as the existing `line()`/`node()` card pattern already used on the Progress
  screen — no new UI framework, no new visual language.

## P2 — research / prototype only

- Worst-rep video/clip (Phase 6). Per that phase's own instructions to assess feasibility before
  building: MediaPipe already processes every frame live; a rolling in-memory buffer of the last
  ~2s of frames (not full video) keyed to the moment a fault fires is plausible on-device and
  privacy-preserving (never leaves the device, same as everything else). Full video recording is
  not justified yet — a representative frame or short buffered clip is the smallest thing that
  would answer "what happened," and should be prototyped only after P1's pattern data proves
  someone actually wants to see the evidence, not just read it.
- Symmetry as a rolled-up profile-level trend (the per-set `asymmetry` check already exists;
  aggregating it over time the same way `faultTimeline` does for other faults is a natural
  extension, not a new mechanism — worth doing once P0's pattern is proven useful for at least one
  real fault).

## REJECT

- **An LLM explanation layer.** Nothing in this design needs one — every explanation is a template
  over stored numbers, which is more trustworthy and strictly cheaper than an LLM would be for the
  same job, per the mission's own Phase 8 test ("if a simple rule is better than AI, recommend the
  rule").
- **A single blended "form score."** Explicitly rejected by the mission and independently the
  wrong call here — it would destroy exactly the per-rep, per-fault position information this whole
  cycle exists to preserve.
- **Any new fault-detection rules or exercises.** Out of scope for this cycle; the gap was never in
  detection, it was in what happens to a detection after it fires.
