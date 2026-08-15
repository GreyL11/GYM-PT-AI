# Claim Validation Report

Phase 2A. What is enforced, what is not, and what the enforcement is actually worth.

**Verdict: PARTIALLY VERIFIED.**

Numeric claims are deterministically enforced on the "Explain this decision" path, where nothing
reaches the screen until it has passed. They are checked but **not** enforced on the conversational
path, where streaming means the user has already read the text. Every non-numeric claim class is
unenforced everywhere. No live model evaluation has been run.

---

## 1. What claim classes are enforced?

**One: numeric claims, on one path.**

Every number the evidence packet contains is indexed as the packet is built (`validate.provenance`),
walking the object and recording each finite value against the path it came from. Checking a claim
is then a lookup, not a judgement — no scoring, no plausibility, no second model.

Approved transformations, all deterministic and all documented in `validate.js`:

| Rule | Example | Why bounded this way |
|---|---|---|
| `exact` | evidence `6` supports `"6"` | An integer count has one correct form |
| `decimal` | `0.38` supports `"0.38"` and `"0.4"` | Rounding at the precision the claim itself asserts — but **never to zero decimals**, or `0.38` could be quoted as `"0"` |
| `percent` | `0.38` → `"38%"`; `0.333…` → `"33%"` or `"33.3%"` | Half-up at the written precision. `"40%"` from `0.38` fails: two-significant-figure rounding is not a rule anyone declared |
| `to − from` | `60 → 62.5` supports `"2.5 kg more"` | The **only** arithmetic admitted. A validator that accepts any combination of any two evidence numbers accepts almost any number at all. Suppressed when the load did not move, so a hold cannot put a `0` in the index |

A ratio like `"2 of 6 sets"` needs no special rule — both counts are separately in the evidence, and
`confidence: 0.33` carries the division already.

**Recommendations are exempt, and the exemption is where the design earns its keep.** "Try 4 sets
next time" proposes a number; demanding it appear in the evidence would reject correct advice. On
the structured path this classification is **exact** — the model puts each sentence in a labelled
field (`observed` / `meaning` / `suggestion`) and the field decides, so no word list is consulted
and phrasing cannot smuggle an observation into the exempt class. On the prose path it falls back to
a cue-word heuristic, which is a heuristic.

## 2. What claim classes are NOT enforced?

| Class | Status | Why |
|---|---|---|
| **What a number refers to** | **Not enforced.** The single most important limit here | The validator checks that a number *exists* in the evidence, not that it was used for the right thing. Evidence holding `ofSets: 6` accepts `"6 kg"`, `"6 days"` and `"rep 6"`. Worse: a wrong denominator that collides with an unrelated field passes — `"2 of 9 sets"` validates because `9` is really there as `totalFaults`. **Both cases are asserted in `test_validate.mjs` under `KNOWN HOLE`**, so the limit is visible in the suite and not only in this document |
| Numbers written as words | Not enforced | Extraction reads digits. "two thirds of your sets" is an unchecked claim. Mitigated upstream — the explain prompt asks for digits — not by a word-number parser |
| Non-numeric factual claims | Not enforced | "Your depth tends to go late in the set" cannot be checked without understanding it, and anything that understands it is a second model marking the first one's homework |
| Causation | Not enforced | Instructed in `RULES` and the explain prompt; word-list probed in the eval harness; **not blocked** |
| Medical / diagnostic language | Not enforced | Same. Instructed and probed, not blocked |
| Overclaimed certainty | Not enforced | Confidence reaches the model as a fraction with both counts, and `RULES` says to speak to the fraction. Nothing enforces it |
| Entity claims (exercise, date) | Not enforced | Dates are sidestepped rather than checked: the explain packet carries no timestamp, so there are no date claims to police. Exercise names are unchecked |

A deliberate omission: there is **no lexical blocklist in the shipping path**. It was considered and
rejected. A regex that rejects "clean" would reject "every rep was clean" — a correct sentence about
a low fault rate — and a validator that fires on correct output gets disabled. Word lists live in the
eval harness, where a false positive costs a re-read rather than a broken feature.

## 3. What happens when an invalid numeric claim appears?

On the explain path:

```
ask → validate → [fail] → retry once, same packet + which numbers were wrong
                        → validate → [fail] → discard the answer entirely
                                             → show the deterministic explanation
```

- **Maximum two attempts, ever.** A paid call per attempt is the user's own money, and a model that
  failed twice on the same evidence will fail again. Asserted by a test that feeds ten bad answers
  and checks the model was called exactly twice.
- **The retry gets the same evidence packet**, byte-identical, asserted by `deepEqual`. Never fresh
  evidence, never a corrected value — supplying a "right" number would be inventing evidence to fix
  invented evidence. The feedback names the offending numbers and nothing else.
- **A failed answer is discarded whole.** Not trimmed, not shown with the bad clause removed. Option
  B from the brief (strip the invalid clause) was rejected: removing a clause from a paragraph that
  reasoned through it leaves a paragraph whose remaining sentences still lean on the deleted fact.
- **The fallback is not an apology.** `explain.plainly()` assembles the same explanation from the
  same verdict by arithmetic — "Staying at 60 kg. Every rep was there, but corrections ran at 0.38
  per rep and the limit for adding weight is 0.34." A test runs that output back through the
  validator, so the fallback is held to the same bar as the model. **That test caught a real bug**:
  the sentence splitter was breaking `0.38` at its decimal point, turning one true claim into two
  fabricated ones.
- With no API key at all, the deterministic explanation *is* the feature, instantly and offline.

## 4. Can the user see invalid content before validation?

**On the explain path: no.** `chat.explain()` is not streamed. It is one `generateContent` call
returning a complete object, validated before a single character is written to the DOM. This is the
only place in the app where "unsupported numbers are blocked" is a true sentence.

**On the conversational path: yes, and nothing can currently change that.** `mood.js:119` assigns
`reply.textContent = full` on every chunk. The text is on screen as it arrives. Validation there
could only ever be a correction after the fact.

That asymmetry is the honest architectural answer, not an oversight:

| Path | Streaming | Enforcement | Why |
|---|---|---|---|
| Explain this decision | No | **Real.** Blocked before render | Bounded question, bounded evidence, 2–4 sentences. Waiting ~1.5s costs nothing because the deterministic explanation is already correct |
| Mind check-in | Yes | **None shipped** | It is a companion, not an analyst. Removing streaming would wreck the thing it is good at, to police a surface with low numeric density |

Option C from the brief (structured output) was available and was taken — `readSkinNote()` had
already proved the API honours a response schema. It does double duty: it makes the answer bufferable
*and* it makes claim classification exact instead of heuristic.

## 5. Is streaming truly protected, or only final answers?

**Only final answers, on one path.** Streaming is not protected and is not claimed to be.

`validate.checkProse()` exists and is tested and could be wired to the chat to append a visible
correction after a bad reply. It has **not** been wired, because a notice under text the user has
already read is a disclosure, not a protection, and shipping it would invite exactly the
over-reading this report is meant to prevent. Wiring it is a real option for Phase 2B; it should be
described as "flagged after the fact" if it ships.

## 6. How many live evaluation scenarios were actually run?

**Two attempts. Seven scenarios, one run each.** Full detail in `AI_COACH_EVALUATION.md`.

The first attempt measured nothing about the model: `gemini-2.5-flash` had been withdrawn from new
API keys, so every scenario failed on the call. That attempt still earned its cost by exposing a
**shipping bug** — the Mind check-in was dead for any newly-created key. Model migrated to
`gemini-3.5-flash-lite`.

The second attempt produced real model output for all six explain scenarios. Scenario G returned no
text at all and remains inconclusive.

## 7. How many passed?

**Reported 3/7. On review: 4 genuine passes, 1 genuine failure, 2 harness false positives, 1
inconclusive.**

| | |
|---|---|
| Genuine pass | A, C, E — and D and F once the harness was corrected |
| **Genuine failure** | **B** |
| Harness false positive | D, F — failed on *"which is why the weight was held"*, which is correct: the threshold **is** why. Causation is now checked only on G, where it means one logged domain causing another |
| Inconclusive | G — the model returned nothing |

**Zero numeric hallucinations across every explain scenario.** Every figure traced to its source
field. The enforced claim class held — with the honest caveat that the model mostly restated the
packet, which is the easiest possible way to pass a provenance check.

## 8. What did the model still do wrong?

**It omitted the thing that mattered most, and every check in this document passed it.**

Scenario B handed the model `formEvidence: "No set of Back squat has been recorded with per-rep
fault tracking, so nothing is known about where it breaks down."` It returned a fluent, numerically
perfect answer that **never mentioned it** — no reassuring adjective for the word list to catch, no
false number for the validator to catch. Just silence about form, in an app whose camera watches
form, where silence reads as approval.

This is the failure predicted in §9 below as undetectable, observed on the first run that reached a
live model. The prompt has been strengthened; **that fix is untested until the next run**, and a
prompt instruction is not enforcement.

Two lesser findings: `observed` came back as a pipe-separated dump of raw field values rather than
an explanation, contradicting the standing rule against listing numbers back (also addressed in the
prompt); and scenario G produced no text, cause unknown.

## 9. What remains impossible to deterministically validate?

- **Anything requiring the sentence to be understood.** Binding a number to its referent, judging a
  qualitative statement, detecting implied causation across two clauses. Each needs a language model,
  and using one to check another produces two correlated opinions and no ground truth.
- **Omission.** A model that reports the pattern and silently drops "only 6 sets were watched" has
  stated nothing false. Nothing here can require completeness.
- **Tone-carried certainty.** "Your depth is going" and "your depth went in 2 of 6 sets" can carry
  identical numbers and very different confidence.
- **Advice quality.** Numbers in a suggestion are exempt by design. "Try 8 sets" passes validation
  and could still be poor advice; the validator is not a coach.

---

## Verdict

**PARTIALLY VERIFIED.**

Enforced, with tests: numeric claims on the explain path, where an unsupported number cannot reach
the user, the retry is bounded at one, and the fallback is arithmetic that passes its own validator.

Not enforced anywhere: what numbers mean, non-numeric claims, causation, medical language,
certainty — and every claim class on the streaming conversational path.

Measured once, on one run: the enforced class held completely (zero unsupported numbers), and the
unenforced class failed exactly where predicted.

The highest-risk gap is no longer a prediction. **On its first live run, the model answered a
question about an unwatched lift without ever mentioning that it was unwatched** — no false number,
no reassuring word, nothing for any check here to catch. The prompt now says to state it; a prompt
instruction is not enforcement, and one run is not a measurement. Until scenario B passes across
several runs, treat "the model will disclose what it does not know" as unverified.
