# Evidence Integrity Report

**One question: can we now trust that the LLM sees an honest representation of this application's
verified intelligence?**

**Answer: for what it is now shown, yes — and that is a smaller claim than it sounds, because what
it is shown is a fixed brief about three lifts, not an answer to whatever was asked.** The pipeline
that carries evidence to the model is now correct and tested. The pipeline is also still narrow, and
nothing yet checks what the model does with what it receives.

Written after Phase 1. Every claim below is backed by a test in `npm test` (14 suites, 217 counted
checks, exit 0) or by output quoted from a run.

---

## What changed, in one table

| | Before Phase 1 | After Phase 1 |
|---|---|---|
| A fresh install's brief | Claimed 0 sets across all six muscle groups, 0 days trained, beside a "productive range" to be judged against | 325 chars, containing **no number derived from a measurement** |
| The dominant fault per lift | Never sent. `digest.js` read a field name the producer does not emit | Sent as `weakestPoint`, plus `formPattern` with confidence and counts |
| Movement patterns (`topPatterns`) | Invisible to the model. The app's most differentiated intelligence | Sent for the top 3 lifts, with `confidence`, `inSets`/`ofSets`, `startsAroundRep` |
| A lift never watched for faults | Indistinguishable from a lift with clean form | `"formEvidence": "not watched"`, with a rule saying it is not reassurance |
| Strength trend on an unsorted log | Reported a 33% gain as −25%, over −29 days | Chronological regardless of stored order; unplaceable sets dropped |
| A past progression decision | Did not exist anywhere after the rest screen closed | Persisted with the numbers and threshold it was decided on |
| A decision that was never recorded | n/a | `"none recorded"` — never inferred from a load that changed |
| Key tier privacy | Undisclosed anywhere in the app or README | Stated at the point the key is pasted, attributed to Google's terms |

---

## What can now be trusted, and why

### 1. Absent is never rendered as zero

The rule is explicit, implemented at one boundary, and tested from both sides:

> **ABSENT** — no evidence exists. No number is emitted.
> **ZERO** — evidence exists and the measurement is zero. The zero is emitted.

Confidence in this comes from the tests asserting the *negative* case, which are the ones that catch
regressions: a fresh install's evidence packet is asserted to contain **no digit at all**
(`numbersIn(t)` is empty), and the digest is asserted not to match `/:0[,}]/`. Both fail on the
pre-fix code.

Zeros that survive, because they are real: `waterTodayMl: 0` when food was logged and nothing with
volume was drunk; `coverage.groupsThisWeek: 0` for an established lifter with an empty week;
`faultsPerRep: 0` in a decision basis for a genuinely clean exercise.

### 2. "Not watched" and "watched, clean" are different facts and read differently

This is the distinction most likely to produce a confidently wrong sentence about someone's
training, because the failure is silent — a lift with no fault tracking looks exactly like a lift
with no faults. Three states are now separated all the way to the model:

| State | Model sees |
|---|---|
| No set carries `faultEvents` | `"formEvidence": "not watched"` |
| Below `MIN_SETS_FOR_PATTERN` | `"formEvidence": "only 1 of 3 sets watched"` |
| Watched, nothing recurred | `"formEvidence": "watched 6 sets, nothing recurring"` |
| Watched, something recurred | `"formPattern": { confidence, inSets, ofSets, startsAroundRep }` |

A test asserts the unwatched case does not match `/stable|clean|good|fine/i` anywhere in its output,
and `RULES` states that these two are opposite findings.

### 3. Confidence is a fraction the app computed, not a word the model chose

`confidence` reaches the model as exactly `matchingSets / evidenceSets`, with both counts beside it
(`inSets: 2, ofSets: 6`). It is never rounded up, never relabelled `"high"`, and never invented for
domains whose sources compute no confidence. A test asserts `typeof confidence === 'number'` and
that a 2-of-6 pattern arrives as `0.33` with status `occasional`, not `recurring`.

### 4. Chronology comes from timestamps, not array position

Ascending, descending, shuffled, duplicate-timestamped and unparseable-timestamp inputs all have
defined, tested behaviour. The stored log is asserted unchanged after a read. Fixed in `sessions()`,
the shared upstream, so `strength()`, `stalledSessions()` and `shouldDeload()` are all covered by
the same guard.

### 5. A decision that was not recorded is not reconstructed

The tempting inference — the load went 60 → 80, so it must have progressed — is explicitly refused.
Loads move for reasons the log cannot recover: typed by hand, restored from a backup, decided before
verdicts were kept. A test seeds exactly that trap and asserts `no_evidence`.

### 6. Nothing from the camera has ever left, and now the app says so

Unchanged and structurally guaranteed: no JavaScript in this repository reads a pixel
(`FACE_WELLNESS_AUDIT.md:22`), so there is no image to send even by accident. Phase 1 added the
disclosure, not the property. The face check-in stores nothing at all.

---

## What still cannot be trusted

Ordered by how likely each is to produce a wrong answer to a real user.

### 1. Nothing checks what the model says — no claim validation exists

**This is the largest remaining gap and it is unmitigated.** `validate.js` from the Phase 0 plan was
not built; the Phase 1 scope deliberately excluded it. The model receives honest evidence and can
still state a number that is not in it, an exercise that was not retrieved, a certainty the
confidence does not support, or a causal link between two domains. The only defence today is the
`RULES` string, which is instruction, not enforcement.

**The evidence is now honest. The output is not yet verified.** Those are different claims and only
the first one is established.

### 2. The four new `RULES` bullets are untested against an actual model

`RULES` more than doubled (910 → 1,936 chars) to govern the new fields. Whether the model honours
"not watched means you know nothing about their form — do not reassure them" has not been measured
even once. There is no evaluation suite; `AI_COACH_EVALUATION.md` does not exist. A rule nobody has
tested is a hope.

### 3. It is still a broadcast brief, not retrieval

The model gets one fixed packet regardless of the question. Consequences:

- Detail covers the top 3 lifts. Ask about your fourth-most-trained lift and the model has its 1RM
  and nothing else — no pattern, no decision, and **no statement that the detail was omitted**. It
  cannot distinguish "no pattern exists" from "not included in this brief". *This is a live instance
  of the absent-vs-zero problem at the packet-assembly level, and it is not fixed.*
- One pattern per lift. A lift with two recurring faults reports only the higher-confidence one.
- The lookback is a fixed 6 sets. "Was this worse last month?" cannot be answered.

### 4. Most real users have no pattern data yet

`faultEvents` only exists on sets logged after that field shipped. For anyone with an older install,
`movementEvidence()` correctly returns `no_evidence` — honest, and also empty. The differentiated
intelligence this whole phase exists to expose will be absent for weeks of real use before it says
anything. Likewise `verdicts` starts empty for every existing install, by design.

### 5. Known precision limits, now carried but not eliminated

- `startsAroundRep` can be off by one at a rep boundary (`MOVEMENT_INTELLIGENCE_DESIGN.md:41`). The
  limitation string says so; the number still looks exact.
- `estimated1RM` is an Epley estimate, rough past ~12 reps. `liftEvidence()` always attaches the
  limitation, but `digest()` sends the number without it.
- Confidence over 6 sets is a fraction with a denominator of 6. `1.0` is honest arithmetic and is
  not the same thing as certainty.

### 6. Nothing about cost, abuse or injection changed

No request cap, no timeout, no daily counter, no payload limit — `talk()` still takes an
`AbortSignal` that `mood.js` never passes. Up to 30 prior chat messages, authored by the user, still
ride in every request. Unchanged from Phase 0, and all of it is still owed.

### 7. There is still no "explain this decision" button

The verdict is persisted and reaches the model, but the existing "Ask why" at `app.js:1052` is on
the Stats card and asks about `t_inputs` advice — not about progression. Nothing in the UI yet asks
the question this data was persisted to answer. The evidence is in place; the entry point is not.

---

## Verdict

**Trustworthy:** every number the model now receives about training, movement patterns and
progression decisions is either a real measurement or explicitly marked absent. The three defects
that could invert or fabricate those numbers are fixed, each with a regression test proven to fail
against the previous code. Absence is distinguishable from zero, unwatched from clean, and an
unrecorded decision from a decided one, at every layer from `insights.js` to the JSON on the wire.

**Not yet trustworthy:** what the model *does* with that evidence. No validator, no evaluation, no
enforcement — only instructions. And the brief is still fixed-shape, so for anything outside the top
three lifts the model's silence is ambiguous in a way the evidence layer itself no longer is.

The honest summary: **Phase 1 made the input truthful. It did not make the output verified.** The
next thing worth building is the smaller of the two remaining halves — a deterministic check that
every number in an answer appears in the evidence that produced it.
