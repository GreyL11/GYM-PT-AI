# LLM Intelligence — Phase 0 Audit & R&D

Written against the working tree at `3f54866` plus uncommitted work. Every claim about this
repository was checked by reading the code or running it; three of them were checked by running a
probe script against the real modules, and are marked **verified by execution**. Provider claims are
sourced to official documentation fetched during this session, not to memory. No feature code was
written.

---

## 1. Executive recommendation

**This app does not need an AI coach added. It has one. It needs the evidence layer under it,
because the single best thing this app knows about you is the one thing the model is never told.**

The brief assumed a greenfield build. The repository says otherwise:

- `www/chat.js` — a working Gemini integration: streaming SSE, structured output, a system-prompt
  safety contract, hard-coded crisis fallback, provider isolation in one file.
- `www/digest.js` — an evidence brief with an explicit "absent is absent" rule, a companion `RULES`
  string that forbids invention, and its own test suite asserting that missing data produces missing
  keys rather than nulls.
- `www/insights.js` — `faultTimeline()` / `topPatterns()` / `setBreakdown()`: per-fault, per-rep,
  cross-set pattern detection with an honest confidence fraction and an explicit
  `'insufficient evidence'` floor.
- `app.js:1052` — an **"Ask why"** button that already seeds the chat with a question about a
  deterministic decision.

So Phases 1–3 of the brief are roughly 60% built, and were built with better discipline than most
teams manage. The gap is precise and it is not a plumbing gap:

> `insights.topPatterns()` can tell you *"Not reaching depth, recurring, confidence 1.0, in 6 of your
> last 6 sets, starting around rep 5."* `digest()` sends the model `setsAllTime`, `estimated1RM`, and
> a weekly volume dict. **The pattern layer — the app's only genuinely differentiated intelligence —
> is invisible to the LLM.** Ask the chat "why does my squat fall apart?" today and it answers from
> nothing.

**Recommendation: build a narrow tool-calling evidence layer over the existing pure modules, wire
the progression decision and the movement patterns into it, and add a deterministic claim validator.
Keep Gemini. Keep the key on the device. Do not build a backend.** Detail and justification below;
the per-capability BUILD NOW / LATER / DO NOT BUILD table is §10.

### Three defects found in the evidence path during the audit

These are in the code that feeds the model today. All three are **verified by execution**, not read
off the page.

**D1 — `weakestPoint` is always absent.** `digest.js:89` reads `l.fault?.label`.
`insights.summary()` returns that field as `topFault` (`insights.js:289`). `l.fault` is `undefined`,
so `weakestPoint` is always `null` and is then pruned away. Probe output for a lift with 36 recorded
depth faults:

```
summary().lifts[0].topFault = { id: "depth", label: "Not reaching depth", count: 36, share: 1 }
digest().training.lifts[0]  = { name, estimated1RM, changePct, stalled }   ← no weakestPoint
```

The most useful movement fact the app holds has never once reached the model.

**D2 — a fresh install tells the model it did zero sets of everything.** `digest.js:79` gates
`setsPerGroupThisWeek` on `Object.keys(s.volume).length`, which is the number of muscle groups and
therefore always truthy. `prune()` drops nulls, not zeros. Probe output, empty app:

```json
"training": { "setsPerGroupThisWeek": { "Chest": 0, "Back": 0, ..., "Legs": 0 },
              "daysTrainedLast30": 0, "productiveRange": "10-20 sets per group per week" }
```

This is exactly the failure `digest.js:14` names as rule 1 — and the same class as the
`verdict: "unknown"` / `nightsLogged: 0` leak already caught in the sleep block. A model handed a
table of zeros next to a "productive range" will write a paragraph about the training you did not
do. `test_digest.mjs:37` asserts no `null` appears; it does not assert no fabricated zero does.

**D3 — `insights.strength()` reads chronology by array position.** `insights.js:70` takes
`first = s[0]`, `last = s.at(-1)` from `sessions()`, which returns `[...byDay.values()]` — Map
insertion order, i.e. log order, not date order. A log array that is not chronologically sorted
inverts `changePct` and `days`. The probe surfaced it directly:

```
strength: { current: 74, best: 74, changePct: 0, days: -5, sessions: 6 }
                                                       ↑ negative
```

This is the identical defect just fixed in `nutrition.weightTrend()`, in a function whose output
`digest()` sends to the model as `estimated1RM` and `changePct`. `store.importAll()` restores
whatever ordering the backup file has, and validates shape only (`store.js:154`). Same fix: sort
defensively in `sessions()`.

None of these are blocking for the R&D decision, and none were fixed — this pass is audit only. All
three belong at the front of Phase 1: an evidence layer built on a source that inverts direction or
fabricates zeros is worse than no evidence layer.

---

## 2. Current repository reality

### A. Application architecture

| Aspect | Finding |
|---|---|
| Frontend framework | **None.** Hand-written ES modules, no bundler, no build step, no JSX, no npm runtime deps beyond MediaPipe. `www/` is served as-is. |
| Backend | **None. No server, no account, no API of any kind.** |
| Native shell | Capacitor 6 → Android WebView (`capacitor.config.json`, `androidScheme: "https"`). Unsigned debug APK built by `.github/workflows/android.yml` on push to `main`. |
| State management | Module-level `let` in `app.js` (`running`, `mode`, `loopGen`) plus direct reads from `store.js`. No framework, no observable, no reducer. |
| Storage | **One `localStorage` key**, `gym-trainer/v1` (`store.js:4`). `read()` spreads a `blank` template over the parse so missing keys default. Per-array write-time caps: `log` 500, `rounds` 500, `meals` 3000, `weights` 400, `chat` 200, `days` 420, `checks` uncapped. |
| Service boundaries | `PURE` modules (no DOM, no network) vs wiring modules. Pure: `exercises`, `insights`, `planner`, `nutrition`, `boxing`, `mood_insights`, `checks`, `t_inputs`, `skin`, `filter`, `devcheck`, `face/geometry`, `face/quality`. Wiring: `app.js` (2016 lines), `mood.js`, `face/checkin.js`. Networked: `chat.js` **only**. |
| Dependency pattern | Vendored, not bundled. `vendor.mjs` pulls MediaPipe WASM + models into gitignored `www/vendor/`. The comment at `chat.js:1` states the rule explicitly: no SDK, because vendoring one to make a single POST is not worth the megabytes. |
| Config / env | **No env handling at all.** No `.env`, no build-time substitution, no secrets in the repo. The one credential is the user's own Gemini key, typed into a field and stored at `store.settings.geminiKey`. |
| Tests | 13 plain `node test_*.mjs` files, no framework, sequential via `npm test`. Storage-backed modules use a `localStorage` shim installed before a dynamic `import()`. Currently 32 checks in the two suites I ran; ~190 across all 13. |

**Architectural consequence for this work:** there is no place to put a secret and no process to run
one. Any design requiring a server-held API key is not an addition to this app; it is a different
app, with an account system, an operator, a bill, and a dependency on connectivity that the gym
does not have. §5 treats that as the decision it is.

### B. Existing intelligence — what structured facts actually exist

Verified against the code, not the brief's vocabulary.

**Camera → facts.** `pose.js` creates the MediaPipe Pose Landmarker; `filter.js` applies a One Euro
filter to landmarks; `exercises.js` (1029 lines, pure) holds the rep state machine, per-exercise
joint-angle `rep: {start, end}` gates, and the fault rule table. **No JavaScript in this repository
has ever read a pixel** — `FACE_WELLNESS_AUDIT.md:22` records the grep for
`getImageData|createImageBitmap|toDataURL|drawImage` returning nothing, and it still does. Every
feature consumes landmark *coordinates*.

**The set record** — the atomic unit, written once per set by `coach.endSet()` (`coach.js:165`):

```js
{ at, exId, set, reps, target, load,
  faults: { depth: 2 },                       // flat lifetime counts, pre-existing
  repMs: [2010, 2150, ...],                   // per-rep duration
  faultEvents: [{ rep: 5, id: 'depth' }, ...],// exercises.js:1013 — the pattern primitive
  correctedFrom: 8 }                          // set once, only if a human amended the count
```

**Read layer over it** (all in `insights.js`, all pure):

| Function | Returns | Evidence gate |
|---|---|---|
| `sessions(exId)` | per-calendar-day `{date, at, load, sets, reps, faults, best}` | none |
| `strength(exId)` | `{current, best, changePct, days, sessions}` via adjusted Epley `e1rm` | `≥2` sessions |
| `stalledSessions(exId)` / `shouldDeload` | consecutive sessions at the same load; deload at `≥3` | — |
| `faultFingerprint(exId?)` | `[{id, label, count, share}]` ranked | — |
| `weeklyVolume()` + `VOLUME_TARGET {low:10, high:20}` | sets per muscle group, last 7 days | — |
| `lastTrained(group)` / `recoveryWarnings(session)` | hours since; `<48h` warnings | — |
| `fatigue(repMs)` | last-2-reps / first-2-reps duration ratio | `≥4` reps |
| **`setBreakdown(record)`** | `{firstFaultRep, totalFaults, early, late, worsening}` | needs `faultEvents` |
| **`faultTimeline(exId, faultId, lookback)`** | `{status, confidence, evidenceSets, matchingSets, breakdownStartRep}` | `MIN_SETS_FOR_PATTERN = 3`, else literal `status: 'insufficient evidence'` |
| **`topPatterns(exId, lookback)`** | the above per observed fault, ranked by confidence | same |

The three bold rows are the app's differentiator and are **not wired to any UI and not visible to
the LLM.** `MOVEMENT_INTELLIGENCE_ROADMAP.md:39` says this deliberately: no screen shipped in P0
because there was no accumulated data to show.

**The progression decision** — `coach.preview()` (`coach.js:215`):

```js
{ moved: true,  from: 60, to: 62.5, reason: 'all reps clean' }
{ moved: true,  deload: true, from: 60, to: 55, reason: 'stalled three sessions' }
{ moved: false, from: 60, to: 60, reason: 'reps missed' | 'form broke down' }
```

**Critical finding: this decision is never persisted.** It lives in the `exerciseSets` closure,
is previewed on the rest screen, is applied by `finishExercise()` to `store.setLoad`/`setReps`, and
is then gone. The *outcome* survives as a changed load; the *reasoning* does not. "Explain this
decision" cannot explain yesterday's decision, only this second's, unless the verdict is written
down. `TRAINING_DECISION_ENGINE.md:70` already specifies the intervention log that fixes this and
correctly marks it unbuilt.

**Explainability infrastructure that already exists:** `reason` strings on every verdict; confidence
as a plain fraction with a stated denominator; `FAULT_LABELS` mapping terse ids to human sentences;
`devcheck.js` (195 lines, pure) as a data-reconciliation screen.

### C. Face wellness — honest status

**Phase 2, guidance only. Nothing is measured and nothing is stored.** `face/checkin.js:8` states
the scope; the code confirms it — `frame()` computes `q.framing()` and `q.pose()` from landmark
geometry and a transformation matrix, paints an outline, and writes a steadiness percentage to the
DOM. There is no `store` import in the entire `www/face/` directory. There is no face key in
`store.js`'s `blank`. `face/model.js:28` deliberately disables blendshapes.

**There is no face wellness data. A `get_face_wellness_summary()` tool would be fiction.** Design an
extension point; do not build the tool. (Note also `FACE_WELLNESS_AUDIT.md:22`: reading pixels would
be the largest privacy change in the app's history, and is a decision to make on its own terms, not
as a side effect of an LLM feature.)

Self-reported skin is a different thing and **does** exist: `store.days()[key].skin =
{score 1-5, flags[], habits[]}` with `skin.js` computing lagged associations against dairy, high-GI
food, sleep, mood and training days, gated at `MIN_DAYS_PER_SIDE * 2 = 8` days.

### D. Hydration — honest status

Exists, minimally, inside `nutrition.js`:

- `waterTarget(profile)` — `35 ml/kg + 500 ml per session amortised over the week` (`nutrition.js:62`).
- `fluid(entries)` — sums `ml` across logged foods for a set of entries (`nutrition.js:218`).
  Alcohol deliberately carries no `ml`.

**What does not exist:** any hydration history function (`dailySeries()` carries `kcal`, `protein`,
`kg` — no `ml`), any reminder, any notification, any scheduling. `grep -i "notification|reminder|
schedule"` across the app returns one unrelated Gradle log line and two comments. There is no
`@capacitor/local-notifications` dependency.

So hydration evidence today = **today's total and today's target, and nothing else.** A
`get_hydration_history()` tool requires new derivation code (trivial — a `ml` column in
`dailySeries`) and should be scoped as such rather than assumed.

### E. Existing LLM infrastructure

| Capability | Status |
|---|---|
| Provider | Google Gemini, `gemini-2.5-flash`, `chat.js:11`. Isolated to one file by design. |
| SDK | None. Raw `fetch` to `generativelanguage.googleapis.com/v1beta`. |
| Streaming | Yes — `:streamGenerateContent?alt=sse`, with a correct partial-event SSE drainer (`drainSSE`, `chat.js:68`) that hands back the trailing fragment rather than parsing it. |
| Structured output | Yes — `readSkinNote()` uses `responseMimeType: 'application/json'` + `responseSchema` with an enum, then **re-validates the range in JS** because the schema guarantees shape, not sanity (`chat.js:236`). |
| Tool / function calling | **No.** Not used anywhere. |
| Prompt infrastructure | `SYSTEM` (`chat.js:28`) + `RULES` (`digest.js:136`) + two task-specific system strings. |
| Failure handling | `Blocked` error class, hard-coded local `BLOCKED_REPLY` with crisis numbers, `testKey()` returning the provider's own error text, `phrase()` returning `null` on any failure so the correct template stays on screen. |
| Key handling | `store.settings.geminiKey`, plain text, on-device. Sent as `x-goog-api-key` **header**, not the `?key=` query parameter — deliberately, so it stays out of logs and referrers (`chat.js:17`). |
| Caching | One: `store.settings.adviceCache` keyed on `JSON.stringify(facts)` (`app.js:1089`). |
| Rate limiting / abuse control | **None.** No request cap, no payload cap, no timeout, no retry policy. `talk()` accepts an `AbortSignal` that `mood.js` never passes. |

### F. Privacy — what the current model actually is

| Data | Leaves device? |
|---|---|
| Camera frames, pose landmarks, face landmarks | **Never.** No pixel is ever read; no landmark is ever serialised off-device. |
| Set log, loads, thresholds, fault events | Only as aggregates inside `digest()`. |
| Sleep / bed / wake, weight, eating, water | Yes, as aggregates in `digest()`, on **every chat message**, when `shareData` is on (default **true**, `mood.js:109`). |
| Free-text the user types into the check-in | Yes, plus up to 30 prior messages (`store.recentChat(30)`). |
| Mood scores, PHQ-9 / GAD-7 results | **No** — correctly absent from `digest()`. |
| API key | Stays in `localStorage`; sent only as an auth header to Google. |

**The finding that matters most in this document.** From Google's own API terms, fetched this
session:

> Unpaid tier: *"Google uses the content you submit to the Services and any generated responses to
> provide, improve, and develop Google products"*, and *"human reviewers may read, annotate, and
> process your API input and output"*.
>
> Paid tier: *"Google doesn't use your prompts…or responses to improve our products."*

Every user of this app pastes **their own** key. The overwhelmingly likely key is a free-tier key,
because that is exactly what makes a no-backend design work. So the current, shipping, default
behaviour is: **a person's sleep average, bodyweight trend, training frequency, eating summary and
end-of-day free-text — which in this app routinely includes how their day went — is submitted to a
tier whose terms permit human review and product training.**

Nothing about this is a bug. It is a documented consequence of a deliberate architecture. But
`README.md:74` describes the key only as "stored on the device in plain text, so set a spend limit
on it" — a cost warning, not a privacy one, and the privacy difference between a billing-enabled
key and a free one is larger than anything else in this report. **Surfacing that distinction at the
point where the key is pasted is the single highest-value change in this entire document, and it is
about six lines of UI.**

---

## 3. Available evidence

Only fields that exist in code. "Reliability" is about the measurement, not the storage.

| Domain | Actual source | Available fields | Reliability | Freshness | LLM? | Risks |
|---|---|---|---|---|---|---|
| **Set log** | `store.read().log`, cap 500 | `at, exId, set, reps, target, load, faults{}, repMs[], faultEvents[], correctedFrom` | High for load/target (typed); medium for `reps` (camera-counted, human-correctable); `faultEvents` only on sets logged after that field shipped | Per set | **Never raw** — 500 records is a context dump | 500-set cap silently truncates history; `correctedFrom` distinguishes corrected from buggy |
| **Strength** | `insights.strength(exId)` | `current, best, changePct, days, sessions` | Medium — Epley is rough past ~12 reps, and only ever compared against itself | Per session | Yes, via tool | **D3: positional chronology** — `changePct`/`days` invert on an unsorted log |
| **Stall / deload** | `stalledSessions`, `shouldDeload`, `deloadTo` | integer count; boolean; target load | High — arithmetic over stored loads | Per session | Yes | "Stalled 6" on a 6-session fixture is correct but reads dramatic without the load context |
| **Weekly volume** | `weeklyVolume()`, `VOLUME_TARGET` | sets per group, last 7 days; `{low:10, high:20}` | High | Rolling 7d | Yes, **gated on non-zero** | **D2: all-zero dict is fabricated absence** |
| **Fault fingerprint** | `faultFingerprint(exId?)` | `[{id, label, count, share}]` | High as a count; lifetime, so it never decays | All-time | Yes | A fault fixed six months ago still ranks first |
| **Movement patterns** | `faultTimeline`, `topPatterns`, `setBreakdown` | `status, confidence, evidenceSets, matchingSets, breakdownStartRep, early/late/worsening` | **Highest-integrity data in the app.** Confidence is literally `matchingSets/evidenceSets`; refuses below 3 sets | Last N sets | **Yes — this is the point** | Not currently reaching the model at all; `breakdownStartRep` is ±1 rep at boundaries (`MOVEMENT_INTELLIGENCE_DESIGN.md:41`) |
| **Progression decision** | `coach.preview()` | `moved, deload, reps, from, to, reason` | High — pure function of stored sets | **Ephemeral** | Yes, once persisted | **Not stored.** Cannot explain any past decision |
| **Session plan** | `planner.today()`, `scheme`, `startingLoad`, `achievableLoad` | split, exercises, sets/reps, plate maths | High | Per day | Yes | Prescription, not observation — must be labelled as such |
| **Eating** | `nutrition.dailySeries(28)`, `targets`, `totals`, `suggestion`, `coachLine` | per-day `kcal/protein/kg` with `null` gaps; targets; `{from,to,delta,eating,observedRate,reason}` | Medium — self-reported, and `suggestion()` refuses when under-logging is detected | Daily | Yes | Under-logging is the dominant error and the model must not "correct" for it |
| **Bodyweight** | `store.weights()` cap 400, `nutrition.weightTrend(days)` | `{now, change, days, points[]}` | High (scale), noisy day-to-day | Per weigh-in | Yes | Recently fixed to sort defensively; `now` is all-time latest while `change` is windowed |
| **Hydration** | `nutrition.fluid(dayEntries())`, `waterTarget(profile)` | today's ml; target ml | Medium — only counts logged drinks with a known `ml` | **Today only** | Yes, narrowly | **No history exists.** Never a dehydration claim (`nutrition.js:37` already says the honest signal is urine colour) |
| **Sleep / training inputs** | `t_inputs.read()` | `sleep{verdict,nights,avg}, weight{verdict,points,kg}, training{verdict,days}, advice{text,plan}` | Medium — self-reported bed/wake; refuses below `MIN_NIGHTS = 10` | 28-day window | Yes | `verdict: 'unknown'` must never ship (already fixed in `digest.js:96`) |
| **Mood / plans** | `store.days()`, `mood_insights.js` | `mood 1-5, bed, wake, plans[{text,done}]` | Low-medium, self-reported | Daily | Aggregate only | Sensitive; comparisons already gated at 4 days per side |
| **PHQ-9 / GAD-7** | `store.checks()`, `checks.js` | `{kind, at, total, band, risk}` | High as a screener; **not a diagnosis** | Fortnightly | **No — keep out** | Highest-sensitivity data in the app. Correctly absent from `digest()` today. Do not add |
| **Skin (self-report)** | `store.days()[k].skin`, `skin.js` | `score, flags[], habits[]`; `associations()` `{diff, highDays, lowDays, ...}`; `advice()` | Low — n=1 self-scored correlation, and `skin.js` says so in its own output | Daily | Yes, with its own caveat string | Correlation→causation is the entire risk; `skin.js:228` already ships the disclaimer text — reuse it verbatim |
| **Face wellness** | — | **none** | — | — | **No — does not exist** | Any tool here fabricates |
| **Boxing** | `store.read().rounds` cap 500 | round records; feeds `trainedDays` | High | Per round | Aggregate only | Deliberately not set-shaped; don't mix into lifting analytics |
| **Chat** | `store.chat()` cap 200 | `{role, content, at}` | It is what was said, nothing more | Per message | Last 30, already | **Prompt-injection surface** — see §9 |

---

## 4. R&D — what should the LLM do?

Nine roles, judged independently. Latency is time-to-first-token on Flash-class models over mobile
data; cost is per invocation at Gemini 2.5 Flash rates (§7).

### 1. Explainer — "why did the app decide this?"

| | |
|---|---|
| **Value** | **Highest of the nine.** The deterministic engine already produces a `reason`, but a template answers one question and a person has five. "Form broke down" invites "which fault, on which rep, and is that new?" — and `faultTimeline()` knows, while no template will ever be written for every follow-up. |
| **Feasibility** | High. `preview()` returns the verdict; `topPatterns()` returns the evidence; both are pure. Requires persisting the verdict (§2B). |
| **Latency** | ~1–2s with tools. Off the critical path — the rest screen already shows the correct template. |
| **Cost** | ~$0.004/question. |
| **Hallucination risk** | **Low, and structurally so** — the answer space is bounded by a verdict object and a pattern list that were computed before the model was called. |
| **Safety risk** | Low. Training advice, not health advice. |
| **Data** | Persisted verdict + `topPatterns(exId)` + current load/reps. |
| **Recommendation** | **BUILD NOW.** This is the MVP. |

### 2. Personal data analyst — "ask your data"

| | |
|---|---|
| **Value** | High. This is the use `digest()` was built for and half-serves today. |
| **Feasibility** | High via tools; the pure modules already compute every answer. |
| **Latency** | 1–3s (2–3 tool round trips). |
| **Cost** | ~$0.004/question. |
| **Hallucination risk** | **Medium — the highest of the "build now" set.** Open-ended questions invite invented numbers. This is what the validator (§8) exists for. |
| **Safety risk** | Medium — "am I dehydrated / is my sleep unhealthy" arrives through this door. |
| **Data** | Most tools. |
| **Recommendation** | **BUILD NOW**, behind claim validation. |

### 3. Conversational coach (the existing Mind check-in)

| | |
|---|---|
| **Value** | Already shipped and, per `README.md:80`, deliberately positioned as *the interface, not the evidence*. |
| **Recommendation** | **KEEP AS IS.** Do not restructure it into a tool-calling agent. A companion that pauses to call `get_training_summary()` before responding to "today was rough" is a worse companion. Route tool use by intent, not by screen — §6. |

### 4. Workout planner

| | |
|---|---|
| **Value** | Low. `planner.js` already produces splits, schemes, starting loads and plate maths deterministically, and `coach.js` progresses them on evidence. |
| **Hallucination risk** | **High** — an LLM will happily prescribe a load, and a wrong load is the one output in this app that can injure someone. |
| **Recommendation** | **DO NOT BUILD.** The rule beats the model, exactly as `MOVEMENT_INTELLIGENCE_ROADMAP.md:75` argues. |

### 5. Weekly / monthly summariser

| | |
|---|---|
| **Value** | Medium. Pleasant; not a reason to keep the app. |
| **Feasibility** | High, but note there is **no workout/session entity** in this codebase (`insights.js:169` states this explicitly — nothing groups several exercises into one visit). A weekly summary can honestly speak in *sets, days and lifts*, not "workouts". |
| **Cost** | One cached call/week ≈ $0.004/user/month. |
| **Recommendation** | **BUILD LATER**, after the explainer proves the evidence layer. |

### 6. Cross-domain wellness summariser

| | |
|---|---|
| **Value** | Medium, and genuinely differentiated — `skin.js:5` makes the real argument that no skincare app holds both halves. |
| **Safety risk** | **Highest of the nine.** Correlation→causation across training/eating/sleep/skin is the failure mode, and `skin.js` and `TRAINING_DECISION_ENGINE.md:84` both already forbid it in prose. |
| **Recommendation** | **BUILD LATER**, and only with a hard validator rule that blocks causal verbs across domains. §8. |

### 7. Recommendation generator

| | |
|---|---|
| **Value** | Low — `t_inputs.advice()`, `nutrition.suggestion()`, `skin.advice()` and `coach.preview()` already each produce exactly one recommendation, deliberately one, from evidence with stated thresholds. |
| **Recommendation** | **DO NOT BUILD** as a generator. **The existing `phrase()` pattern is the right shape and should be kept**: the rule decides, the model only rewords, and it returns `null` on failure so the correct sentence survives (`chat.js:119`). |

### 8. Progression assistant (LLM in the progression loop)

| | |
|---|---|
| **Recommendation** | **DO NOT BUILD.** `chat.js:110` already states the reason better than I can: every threshold and refusal in the deterministic layer is arithmetic that is tested, instant, and works with no signal — handing it to a model trades away all four, and the refusals in particular. |

### 9. Real-time form coach

| | |
|---|---|
| **Value** | Superficially the flashiest; actually negative. |
| **Feasibility** | The frame loop runs at display rate and `coach.js` already throttles *speech* to 1.2s because being talked over mid-rep is worse than silence. A 500–2000 ms network round trip cannot participate in that loop. |
| **Safety risk** | High — a late cue is a wrong cue under load. And it would require sending camera-derived data continuously, breaking the app's core privacy property. |
| **Recommendation** | **DO NOT BUILD. Ever.** The brief forbids it and the architecture independently forbids it. |

### What explicitly should NOT use an LLM — and a disagreement to record

Rep counting, fault detection, thresholds, progression, deload, macro targets, water targets,
plate maths, PHQ-9 scoring, pattern confidence, and every threshold comparison. All are tested
arithmetic that works offline.

`MOVEMENT_INTELLIGENCE_ROADMAP.md:75` goes further and rejects **"an LLM explanation layer"**
outright, on the grounds that every explanation is a template over stored numbers and a template is
cheaper and more trustworthy. **That rejection is right about generation and wrong about
conversation, and the distinction is worth stating precisely:**

- Generating the *default* explanation — the sentence on the rest screen, the Stats coach line —
  should stay templated. It must work offline, must be instant, must be identical every time. Agreed,
  no change.
- Answering an *unanticipated follow-up* — "is that worse than last month?", "does it happen on
  bench too?", "why rep 5 and not rep 8?" — cannot be templated, because the question set is
  unbounded. The template owns the surface; the model owns the follow-up; the model reads the same
  numbers the template did.

That is an extension of the roadmap's position, not a reversal of it, and it holds only as long as
the model is denied any ability to compute or invent a number. Which is §8.

---

## 5. Provider and deployment research

### Requirements, derived from this repository rather than from a checklist

1. Must degrade to **fully working** with no key and no signal — the gym has neither.
2. No build step, no bundler, no SDK (`chat.js:1`).
3. Streaming (already relied on by the chat UI).
4. Function/tool calling with forced-mode and structured output.
5. No server to operate — see §2A.
6. The user brings their own key.

### Current pricing, from official sources fetched this session (Aug 2026)

| Model | Input /1M | Output /1M | Source |
|---|---|---|---|
| `gemini-2.5-flash` *(in use today)* | $0.30 | $2.50 | [ai.google.dev pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| `gemini-2.5-flash-lite` | $0.10 | $0.40 | same |
| `gemini-3.1-flash-lite` | $0.25 | $1.50 | same |
| `gemini-3.6-flash` / `3.7-flash` | $0.75 (→$1.50 after 2026-12-31) | $3.75 (→$7.50) | same |
| `gemini-3.5-flash` | $1.50 | $9.00 | same |
| Claude Haiku 4.5 | $1.00 | $5.00 (cache read $0.10) | [platform.claude.com pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| Claude Sonnet 5 | $2.00 | $10.00 (cache read $0.20) | same |
| `gpt-5-nano` | $0.05 | $0.40 | [developers.openai.com pricing](https://developers.openai.com/api/docs/pricing) |
| `gpt-5-mini` | $0.25 | $2.00 | same |

Google's page now lists `gemini-2.5-flash` under **previous generation** — still priced, still
served, not deprecated (unlike `gemini-2.0-flash`, which is marked deprecated). Google's function
calling docs have also moved to a newer `/v1beta/interactions` shape with `tools` / `tool_choice`
(`auto | any | none | validated`) and `allowed_tools`, while the app uses the older
`:streamGenerateContent` + `contents` shape. **Both work; mixing them does not.** Adding tool calling
means picking one API generation deliberately, and that is a real, nameable migration cost rather
than a footnote.

### Deployment options

**A. Keep direct-from-device, user's own key (status quo).**
✅ No server, no account, no operator, no bill, works offline for everything else, provider swap
stays a one-file change. ❌ Free-tier keys mean human review + product training (§2F). ❌ No way to
enforce rate limits centrally. ❌ Key sits in `localStorage` in plain text.

**B. Backend proxy (Cloudflare Worker / Vercel function) holding a shared key.**
✅ Real key secrecy, central rate limiting, paid-tier privacy by default, model routing, server-side
caching. ❌ **Introduces the first server this app has ever had**, and with it an account system (or
an open, abusable endpoint), an operator, a monthly bill that scales with users, a privacy story
that gets *worse* in one respect — data now passes through the developer's infrastructure as well
as Google's — and a new failure mode between the phone and the model.

**C. Anthropic direct-from-device.** Requires the `anthropic-dangerous-direct-browser-access`
header, which is named that way as a warning. No free tier, so every user must have a paid key —
which is *better* for privacy but a much steeper onboarding step than Google's free key. Haiku 4.5's
prompt caching ($0.10/MTok reads) is genuinely attractive for a fixed system+tools prefix.

**D. On-device model.** The APK is ~24 MB and `FACE_WELLNESS_AUDIT.md` treats a 3.6 MB model file as
a decision worth a paragraph. A useful tool-calling LLM is 1–4 GB quantised. Not close. **Reject.**

### Decision

**Stay on option A. Stay on Gemini. Keep `chat.js` as the single provider seam.**

The brief's security rule — *never expose secret production API keys in the frontend bundle* — is
**already satisfied, because there is no production key.** There is no shared credential to leak;
there is a user's own credential on the user's own device, and the correct mitigations for that
(header not query param, spend limit, never logged, one-tap forget) are already implemented at
`chat.js:17`, `mood.js:213` and `README.md:74`.

The real exposure is not key theft. It is **tier**. So:

1. **Do not build a backend.** It would trade the app's defining property for a threat model it does
   not have.
2. **Do disclose the tier difference where the key is pasted**, quoting Google's terms, with a link
   to enable billing. Highest privacy-per-line-of-code change available.
3. **Model choice:** keep `gemini-2.5-flash` for the conversational check-in — `thinkingBudget: 0` is
   supported there and time-to-first-token is the whole UX (`chat.js:265`). For the tool-calling
   evidence path, evaluate `gemini-3.1-flash-lite` (cheaper than today, newer) against
   `gemini-3.6-flash` when Phase 3 lands, and pin the API generation explicitly.
4. **Keep the abstraction at the level it already is** — `{role, content}` in, text out. Do not build
   a provider-factory interface for one provider; that is the abstraction this codebase would
   correctly reject.

---

## 6. Recommended architecture

```
        REAR CAMERA                       FRONT CAMERA (face — guidance only, Phase 2)
             │                                    │
             ▼                                    ▼
   pose.js → filter.js                    face/model.js → face/geometry.js
             │                                    │
             ▼                                    ▼
        exercises.js  ◄── landmarks only,   face/quality.js   ── nothing stored, nothing
        step() / faults     never pixels                          leaves this box
             │
             ▼
        coach.js  endSet() ──────────────────────────────┐
             │                                            │
             ▼                                            ▼
     ┌───────────────────────────────────────────────────────────────┐
     │  store.js  — localStorage 'gym-trainer/v1'   VERIFIED FACTS    │
     │  log[] · weights[] · meals[] · days{} · rounds[] · checks[]    │
     │  + NEW: verdicts[]  (persisted progression decisions)          │
     └───────────────────────────────────────────────────────────────┘
             │
             ▼
     ┌───────────────────────────────────────────────────────────────┐
     │  PURE READ LAYER (exists today, all tested, no network)       │
     │  insights · nutrition · t_inputs · skin · planner · checks    │
     └───────────────────────────────────────────────────────────────┘
             │
             ▼
     ┌───────────────────────────────────────────────────────────────┐
     │  NEW: evidence.js   — the tool bodies. Pure. No network.      │
     │  Narrow functions → {status, period, facts, coverage, conf}   │
     │  Every tool result kept in an EvidenceLedger for this turn    │
     └───────────────────────────────────────────────────────────────┘
             │                                        ▲
             ▼                                        │ tool results
     ┌───────────────────────────────────────────────────────────────┐
     │  chat.js — the ONLY networked file. Tool loop, max 3 hops.    │
     │  Gemini · streaming · user's own key · AbortSignal · timeout  │
     └───────────────────────────────────────────────────────────────┘
             │
             ▼
     ┌───────────────────────────────────────────────────────────────┐
     │  NEW: validate.js — deterministic. Numbers · entities ·        │
     │  certainty · medical · causation. Checked against the ledger. │
     └───────────────────────────────────────────────────────────────┘
             │
             ▼
        mood.js / app.js  — UI. Template answer already on screen;
                            model output only ever replaces it.
```

**Where each concern lives:**

- **Provider abstraction** — `chat.js`, unchanged in principle. One file knows the provider.
- **API keys** — `store.settings.geminiKey`, on device, header-only, user-owned, forgettable.
- **Frontend/backend boundary** — there isn't one, deliberately (§5).
- **Tool calling** — a bounded loop in `chat.js`: at most 3 tool hops, then the model must answer or
  say it cannot. Unbounded agent loops are a cost attack against the user's own card.
- **Evidence retrieval** — `evidence.js`, pure, testable with zero network, and useful to
  `devcheck.js` and the UI independently of the LLM. **This module is worth building even if the LLM
  work is cancelled**, which is the test of whether it is the right abstraction.
- **Context construction** — never `digest()`-style broadcast for the evidence path. Tools return
  only their own domain. `digest()` survives as the *conversational* context for the Mind check-in,
  where a small standing brief genuinely is the right shape.
- **Response validation** — `validate.js`, §8.
- **Streaming** — kept for the check-in. **Not used for the explainer**, which is short, structured
  and must be validated before display (§8 names this tension honestly).
- **Caching** — extend the existing `adviceCache` pattern: key on the evidence packet hash, so a
  cache entry invalidates automatically when the underlying facts change. Weekly summaries cache for
  a week; explanations cache per verdict id.
- **Observability** — no telemetry, and none should be added: there is no server to send it to and
  adding one to watch an LLM would be absurd. `devcheck.js` is the right home for a local
  "last request: tokens, tools called, validator verdict" panel.
- **Failure handling** — the existing discipline, extended: every LLM path returns `null`/throws
  into a state where the deterministic answer is still on screen. `Blocked` → `BLOCKED_REPLY`.
  Timeout → the template. No spinner ever resolves to nothing (`chat.js:117`).

### Tool design (against real functions, not the brief's names)

Eight tools, each mapping to code that exists today except where marked.

| Tool | Backed by | Returns |
|---|---|---|
| `get_training_overview()` | `insights.summary()`, `weeklyVolume`, `VOLUME_TARGET` | sets all-time, per-group volume **only if non-zero**, days trained, productive range |
| `get_exercise_history(exId, days?)` | `insights.sessions`, `strength`, `stalledSessions` | per-session load/reps/faults, e1RM trend, stall count, `coverage.sessionCount` |
| `get_movement_patterns(exId)` | `insights.topPatterns` + `FAULT_LABELS` | `[{label, status, confidence, matchingSets, evidenceSets, breakdownStartRep}]`, or `status: 'insufficient_evidence'` with the count still missing |
| `get_progression_status(exId)` | **NEW** `store.verdicts[]` + `shouldDeload` + current load/reps | last verdict `{decision, from, to, reason, at, evidenceAtDecision}` |
| `get_eating_summary(days)` | `nutrition.dailySeries`, `targets`, `suggestion`, `coachLine` | logged-day count, average when logged, target, suggestion if any — **gaps as gaps** |
| `get_bodyweight_trend(days)` | `nutrition.weightTrend` | `{now, change, points, coverage}` |
| `get_lifestyle_inputs()` | `t_inputs.read()` | sleep/weight/training verdicts + the app's own next move — **never `'unknown'`** |
| `get_skin_summary()` | `skin.scored`, `associations`, `advice` | associations with both day counts, plus `skin.SEE_SOMEONE` verbatim as a mandatory caveat field |
| *(extension point)* `get_face_wellness_summary()` | — | **`{status: 'not_implemented'}`** — declared so the model can say what it cannot know, never fabricated |

Every tool obeys the same contract:

- validates its own arguments (unknown `exId` → `status: 'unknown_exercise'`, not an empty result);
- distinguishes **missing data** (`status: 'no_data'`) from a **negative finding**
  (`status: 'ok'` with zero matches) — the distinction `insights.js:178` already draws between
  `wasTracked` and `hasUsableEvents`, lifted to the tool boundary;
- carries an explicit period and a `coverage` count so the model can say how thin the evidence is;
- carries `confidence` only where the source computes one, never invented at this layer;
- returns bounded output — no tool may return more than ~40 rows.

---

## 7. Cost model

Measured against the current prompt, at `gemini-2.5-flash` rates.

**Per chat message today:** `SYSTEM` ~800 tok + `RULES` ~250 + digest ~300 + 30-message history
~1200 = **~2,550 input**, ~180 output → `2550 × $0.30/M + 180 × $2.50/M` = **$0.0012**.

**Per tool-called question** (tool declarations ~500 tok; 3 round trips, each resending the prefix
plus accumulated tool results): ~10,200 input, ~320 output → **~$0.0039**.

| User | Volume/month | Est. cost/month |
|---|---|---|
| Light | 15 questions, 4 skin notes | **$0.06** |
| Active | 80 questions, weekly summary, 20 skin notes | **$0.32** |
| Heavy | 300 questions, daily check-in chat | **$1.20** |

At `gemini-3.1-flash-lite`: heavy ≈ **$0.85**. At Claude Haiku 4.5 without caching: ≈ **$3.50**;
with prompt caching on the fixed system+tools prefix (reads at $0.10/MTok): ≈ **$1.20**.

**Scaling concerns, in order of actual risk:**

1. **There is no cost risk to the developer at all** — every token is billed to the user's own key.
   This inverts the usual analysis and is the strongest argument for keeping architecture A.
2. **The real risk is a runaway loop on someone else's card.** Mitigations, none of which exist
   today: hard cap of 3 tool hops; per-request timeout; a daily request counter in
   `store.settings`; payload cap on tool results.
3. Chat history is the largest and fastest-growing input term (~47% today). `recentChat(30)` should
   drop to ~12 messages on the evidence path, where the standing brief matters more than the banter.
4. Cost is **not** the constraint on this feature. Trust is. Do not build model routing.

---

## 8. Claim validation

Not an "AI truth detector". A **containment layer** with five deterministic checks, all run against
the `EvidenceLedger` — the exact JSON every tool returned this turn, which we hold locally.

| # | Check | Rule | Action |
|---|---|---|---|
| A | **Numeric** | Every number in the response must appear in the ledger, or be derivable by a whitelisted operation (sum, difference, percentage) over two ledger numbers | Flag → regenerate once → on repeat, fall back to the template |
| B | **Entity** | Every exercise name, fault label and date mentioned must be in `EXERCISES` / `FAULT_LABELS` **and** present in a tool result this turn | Flag → regenerate once |
| C | **Certainty** | If the supporting evidence has `confidence < 0.5` or `evidenceSets < MIN_SETS_FOR_PATTERN`, ban high-certainty wording (`always`, `definitely`, `proves`, `clearly`) | Block, regenerate |
| D | **Causation** | Ban causal verbs (`caused`, `because of`, `led to`, `due to`) linking two different evidence domains | **Block outright.** Non-negotiable — `TRAINING_DECISION_ENGINE.md:84` and `skin.js:14` already state this rule |
| E | **Medical** | Ban diagnostic and status language: condition names, `dehydrated`, `deficiency`, `your testosterone is`, `normal/abnormal/healthy/unhealthy levels` | **Block outright**, substitute the existing local disclaimer |

**Why this is reliable enough, and where it is not.** A–B are exact string/number matching against
data we generated ourselves — no judgement, no second model, no probabilistic scoring. C–E are
lexical and will produce false positives on innocent phrasing; that is the correct direction to fail
in for a health-adjacent app, and D and E fail *closed* into text the app already ships and already
trusts. What this does **not** catch is a fluent, number-free, hedged falsehood ("your form has been
looking better lately") — which is precisely why the system prompt must require every observation to
cite a tool, and why the response schema below makes citation structural rather than optional.

**Response contract** (adapted to what the UI can render — the app has no component that would
display a four-section evidence tree):

```json
{
  "answer": "2–4 sentences, plain, the way the rest of the app speaks",
  "observations": [{ "statement": "...", "tool": "get_movement_patterns",
                     "field": "confidence", "value": 1.0 }],
  "inference":   { "statement": "...", "basedOn": ["observations[0]"], "confidence": "low|medium" },
  "unknown":     ["what would need logging to answer better"]
}
```

`observations[].tool` + `field` + `value` is what makes check A cheap: the validator looks the value
up rather than parsing prose for it. No chain-of-thought is requested or displayed.

**The honest tension: streaming versus validation.** You cannot validate text the user has already
read. Resolution, per surface:

- **Explainer / structured answers:** do not stream. They are 2–4 sentences; validate, then render.
  Total latency ~1.5s against a template that is already on screen — an acceptable trade.
- **Conversational check-in:** keep streaming, keep the current `digest()` brief, do not tool-call.
  Checks D and E run on the completed text; a block replaces the bubble with the local disclaimer.
  Rare, and preferable to a silent stream.

---

## 9. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Free-tier data usage** — training/sleep/weight/free-text submitted under terms permitting human review and product training (§2F) | **Highest** | Disclose at the key field, quoting Google's terms; link to enable billing; keep `shareData` toggle |
| Invented numbers | High | Validator A; tools return the numbers, the model never computes |
| Unsupported health claims | High | Validator E; reuse existing local disclaimer strings verbatim |
| False causation across domains | High | Validator D, blocking; system-prompt rule; both already exist in prose |
| **Prompt injection via stored user text** | Medium-High | `store.chat()` and day `plans[]` are free text the user authored. A conversational app is a weak target — but tool results must be clearly delimited and the system prompt must state that tool output is data, never instruction. Never let model output trigger a write |
| Context dumping | Medium | Tools cap output; the 500-set log is never serialised; history trimmed to ~12 on the evidence path |
| Cost attack / runaway loop | Medium | 3-hop cap, timeout, daily counter — **none of which exist today** |
| Stale data | Medium | Evidence packets carry timestamps; caches key on evidence hash, not on time |
| Latency / API failure | Low | Already handled correctly — the template is always on screen first; every LLM path returns `null` rather than an error state |
| **LLM failure breaking the app** | Low | Structurally impossible today: `chat.js` is the only networked module and nothing in the training, counting, logging or notification paths imports it. **Preserve this invariant** — `evidence.js` must not import `chat.js` |
| Key theft from `localStorage` | Low | Requires device compromise; it is the user's own key with their own spend limit |

---

## 10. Final decision

| Capability | Decision | Why |
|---|---|---|
| **Fix D1/D2/D3 in the evidence path** | **BUILD NOW** | Everything below is built on numbers that are currently wrong or fabricated |
| **Key-tier privacy disclosure** | **BUILD NOW** | Highest privacy value per line in this document; ~6 lines of UI |
| **`evidence.js` — narrow pure retrieval + coverage + confidence** | **BUILD NOW** | Useful with or without an LLM; the test of the abstraction |
| **Persist the progression verdict (`store.verdicts[]`)** | **BUILD NOW** | Without it, no past decision can ever be explained. Shape already specified in `TRAINING_DECISION_ENGINE.md:70` |
| **Tool-calling loop in `chat.js` (3-hop cap, timeout)** | **BUILD NOW** | The mechanism that connects the pattern layer to the question |
| **`validate.js` — the five checks** | **BUILD NOW** | Ships with the first tool-called answer, not after it |
| **"Explain this decision" on the rest screen** | **BUILD NOW** | The MVP. Bounded answer space, lowest hallucination risk, highest value |
| **"Ask your data" (extend the existing chat)** | **BUILD NOW**, behind the validator | The `Ask why` button at `app.js:1052` is already the entry point |
| **Movement patterns in the UI** (no LLM) | **BUILD NOW** | `topPatterns()` has been finished and untouched since P0. The templated version should ship before the conversational one |
| Weekly review | **BUILD LATER** | Cache-per-week, low marginal value over existing coach lines; speak in sets/days, not "workouts" |
| Post-workout briefing | **BUILD LATER** | **Blocked:** no session/workout entity exists (`insights.js:169`). Needs a data-model decision first |
| Hydration history tool | **BUILD LATER** | Needs a `ml` column in `dailySeries()` — small, but it is new derivation, not retrieval |
| Cross-domain wellness summary | **BUILD LATER** | Only after validator rule D is proven against adversarial fixtures |
| Face wellness tools | **BUILD LATER** | **No data exists.** Extension point only, returning `not_implemented` |
| Conversational check-in restructure | **DO NOT BUILD** | It is deliberately the interface, not the evidence. Leave it alone |
| Workout planner / progression by LLM | **DO NOT BUILD** | The rule is tested, instant, offline, and refuses — a model trades away all four |
| Recommendation *generation* | **DO NOT BUILD** | Keep the `phrase()` shape: rule decides, model rewords, `null` on failure |
| PHQ-9 / GAD-7 in LLM context | **DO NOT BUILD** | Most sensitive data in the app; correctly excluded today |
| Real-time form coaching | **DO NOT BUILD** | Latency incompatible with a per-frame loop; would break the camera privacy invariant |
| On-device LLM | **DO NOT BUILD** | 1–4 GB against a 24 MB APK |
| Backend proxy | **DO NOT BUILD** | Trades the app's defining property for a threat model it does not have (§5) |

### Suggested Phase 1 scope, in order

1. `sessions()` sorts by date (D3); `weakestPoint` reads `topFault` (D1); volume gated on non-zero
   (D2). Each with a test that fails on the current code.
2. `store.appendVerdict()` + `coach.finishExercise()` writes one. Cap 200, same shape as `appendRound`.
3. `evidence.js` with the eight tools, pure, plus `test_evidence.mjs` covering: missing data,
   unknown exercise, below-threshold confidence, and no-data-vs-negative-finding.
4. Key-tier disclosure in the Mind setup card.

Everything after that is Phase 2+ and should be re-scoped once 1–4 are real.

---

## Appendix — quality gate status at end of Phase 0

| Gate | Status |
|---|---|
| No raw camera frames sent to LLM | ✅ Structurally impossible — no pixel is ever read |
| No raw face images sent to LLM | ✅ Same, and no face data is stored at all |
| Deterministic engines remain source of truth | ✅ Preserved by design; §4 rejects every role that would change it |
| API keys secure | ⚠️ No shared key exists (good). **Tier disclosure missing** (§2F) |
| Tools retrieve minimal evidence | ⛔ Not built — `digest()` broadcasts one fixed brief |
| Missing data handled honestly | ⚠️ Mostly — **D2 fabricates zeros**, D1 silently drops a field |
| Confidence propagates into language | ⛔ `confidence` never reaches the model today |
| Unsupported claims detected | ⛔ No validation of any kind exists |
| Medical / hydration diagnosis prevented | ⚠️ Prompt-level only (`chat.js:42`), no enforcement |
| Correlation ≠ causation | ⚠️ Prose rules in `skin.js` / `TRAINING_DECISION_ENGINE.md`, no enforcement |
| LLM failure cannot break the app | ✅ `chat.js` is imported only by `mood.js` and `app.js`'s Stats rephrase, both fail-soft |
| Costs controlled | ⛔ No cap, no timeout, no counter |
| Existing tests pass | ✅ `npm test` — 13 suites |
| Privacy changes documented | ⚠️ This document is the first place the tier difference is written down |

---
---

# Phase 1 Implementation Results

Appended after implementation. Nothing above this line was edited — the Phase 0 findings stand as
written, including the ones implementation proved incomplete.

**Result: 14 suites, 217 counted checks, `npm test` exit 0.** 24 checks are new. Verified in the
running app at `localhost:8080` with no console errors.

## 1A — the three evidence defects

Each regression test was run against the pre-fix implementation first, by reverting the fix in
place. All three failed as predicted; the actual assertion output is quoted below.

### Bug 1 — `weakestPoint` never reached the model

**Root cause.** A contract mismatch, not a logic error. `insights.summary()` returns each lift's
dominant fault as `topFault` (`insights.js:289`); `digest.js` read `l.fault?.label`. `l.fault` is
`undefined`, so `weakestPoint` was `null` on every lift and `prune()` then removed the key.

**Failing test output, pre-fix:**

```
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual - expected
+ undefined
- 'Not reaching depth'
    at test_digest.mjs:164
```

**Where the fix belongs — decision B, the digest consumes the canonical contract.** `summary()`'s
output is already consumed correctly by the Progress screen at `app.js:1159-1160`, which reads
`lift.topFault.label` and `lift.topFault.share`. Renaming the producer would have broken the correct
consumer to accommodate the incorrect one. `digest.js` was the sole outlier, so `digest.js` moved.
No compatibility shim was added and none is needed — there is one producer and now two consumers
agreeing on one name.

**Fix.** `digest.js:104` — `l.fault?.label` becomes `l.topFault?.label`.

**Before/after, same fixture (four squat sets carrying `depth` faults):**

| | Before | After |
|---|---|---|
| `training.lifts[0].weakestPoint` | *(key absent)* | `"Not reaching depth"` |

The richer form of this evidence — status, confidence, evidence counts, timing — is deliberately
not squeezed into `weakestPoint`. It arrives as `formPattern`, built in 1C/1D, which is where the
confidence and its denominators live. `weakestPoint` stays what it always claimed to be: the
lifetime dominant fault.

### Bug 2 — a fresh install fabricated zero sets of everything

**Root cause.** Two independent mistakes compounding:

1. `insights.weeklyVolume()` returns **every** muscle group, zeroed, whether or not it was trained.
2. The gate was `Object.keys(s.volume ?? {}).length` — the number of muscle groups, a constant 6,
   and therefore always truthy.

`prune()` was working exactly as documented: it removes `null`/`undefined`/`''`/empty containers.
`0` is none of those, and correctly so — a measured zero is data. The bug was never in `prune()`.

**Failing test output, pre-fix:**

```
AssertionError [ERR_ASSERTION]: no groups trained means no table
+ actual - expected
+ { Back: 0, Biceps: 0, Chest: 0, Legs: 0, Shoulders: 0, ... }
```

**Fix, and the semantic it encodes.** `prune()` was left alone. The gate now filters to groups with
a non-zero count and reports the table only if any survive; `productiveRange` — a yardstick that
means nothing without a measurement beside it — is gated on the same condition; `daysTrainedLast30`
uses `|| null`, because a zero there is a fresh install and what it actually means is already said
properly by `t_inputs.advice()` in `appsView.nextMove`.

The rule now implemented and tested throughout:

> **ABSENT** — no evidence exists. No number is emitted, because any number states a measurement
> nobody took.
>
> **ZERO** — evidence exists and the measurement is zero. The zero is emitted, because it is real.

**Before/after, empty app:**

```
Before  "training": { "setsPerGroupThisWeek": { "Chest": 0, "Back": 0, "Shoulders": 0,
                      "Biceps": 0, "Triceps": 0, "Legs": 0 },
                      "productiveRange": "10-20 sets per group per week",
                      "daysTrainedLast30": 0, "todaysSession": "rest day" }

After   "training": { "todaysSession": "rest day" }
```

A full fresh-install brief is now 325 characters and contains **no number derived from a
measurement** — only the profile the user typed in themselves and the targets computed from it.

**Zeros that legitimately survive**, each covered by a test:

| Case | Emitted | Why |
|---|---|---|
| Trained a month ago, nothing this week | `setsAllTime: 2`, `setsPerGroupThisWeek: {}`, `coverage.groupsThisWeek: 0` | The all-time count is measured; the empty week is stated in words, not as six zeroed groups |
| Food logged today, nothing with volume drunk | `waterTodayMl: 0` | A real measurement — they logged, and drank nothing that counts |
| A clean exercise | `faultsPerRep: 0` in a decision basis | The sets were watched; the count is genuinely zero |

### Bug 3 — `insights.strength()` read chronology by array position

**Root cause.** `sessions()` built a `Map` keyed by day and returned `[...byDay.values()]` — Map
**insertion** order, which is log order, not date order. `strength()` then took `s[0]` as "first"
and `s.at(-1)` as "last". `store.appendLog()` does append chronologically, but `store.importAll()`
restores whatever order a backup file happens to hold and validates shape only (`store.js:154`).
Identical in kind to the `nutrition.weightTrend()` defect fixed immediately before this work began.

**Failing test output, pre-fix — a 33% gain read back as a 25% loss:**

```
AssertionError [ERR_ASSERTION]: latest is the most recent date, not the last element (got -25%)
    at test_insights.mjs:60
```

**Fix.** Not `reverse()` — nothing guarantees the input is uniformly descending, and a shuffled
array would defeat it. Chronology is established from the actual timestamp:

```js
const ordered = [...store.history(exId)]
  .filter((e) => Number.isFinite(new Date(e.at).getTime()))
  .sort((a, b) => String(a.at).localeCompare(String(b.at)));
```

Fixed in `sessions()` rather than in `strength()` where the symptom appeared, because it is the
shared upstream: `stalledSessions()` reads `s.at(-1).load` and would otherwise count a stall at
whichever load sat last in the array, and `shouldDeload()` reads that in turn. One guard, all
callers.

**Behaviours defined rather than left to chance**, each with a test:

| Input | Behaviour | Reason |
|---|---|---|
| Ascending | Unchanged | Every log this app writes for itself |
| Descending | Same result as ascending | Asserted by `deepEqual` against the ascending case |
| Shuffled | Same result as ascending | The case `reverse()` would not have fixed |
| Duplicate `at` | Insertion order preserved | `Array#sort` is stable; two sets in the same millisecond carry no truth about which came first |
| Unparseable / missing `at` | Dropped from the trend | A set that cannot be placed in time cannot join a trend. It previously created an `"Invalid Date"` session whose date subtraction was `NaN`. **Not data loss** — `store.read().log` keeps the record untouched |
| Fewer than 2 sessions | `strength()` returns `null` | Pre-existing and correct; now covered |

**The source array is never mutated.** `[...]` copies before sorting, and a test asserts the stored
log is unchanged after `sessions()` runs — reordering the caller's log as a side effect of reading
it would have been a second bug.

**Before/after, three sessions stored out of order (60 → 70 → 80 kg across 29 days):**

| | Before | After |
|---|---|---|
| `changePct` | `-25` | `+33` |
| `days` | `-29` | `+29` |
| `currentLoadKg` | `60` | `80` |

## 1B — the progression verdict is now written down

**Lifecycle, as found.** `coach.preview()` computed the decision inside the `exerciseSets` closure;
the rest screen displayed it; `finishExercise()` applied it to `store.setLoad`/`setReps` and spoke
it aloud. The **outcome** survived, as a changed load. The **reasoning** did not survive at all.
Nothing could answer "why did it hold me at 60 kg on Tuesday", because nothing had written Tuesday
down.

**What was added.** `store.appendVerdict()` / `verdicts()` / `lastVerdict(exId)`, following the
existing `appendRound()` pattern exactly — same array in `blank`, same write-time cap (200), same
one-line accessor style. `preview()` gained an additive `evidence` object carrying the values its
branches were already computed from; `finishExercise()` writes one record per committed exercise.

```js
{ at, exId, decision: 'progress' | 'hold' | 'deload', unit: 'kg' | 'reps', from, to,
  reason: 'form broke down',
  evidence: { sets, repsHit, totalReps, totalFaults, faultsPerRep, cleanLimit, stalledSessions } }
```

**Structured, never prose.** `reason` is the deterministic engine's own string — already spoken and
displayed today — and it is stored as one field among the numbers, not as the record's meaning.
Anything explaining a verdict later reads the numbers.

**Migration safety.** Purely additive. `read()` spreads over `blank`, so every existing install gets
`[]` rather than `undefined`; `importAll()` gained `['verdicts', Array]` in its shape check, guarded
by the existing `key in data` test so old backups still restore cleanly. **No verdict is ever
backfilled.** A load that changed before this shipped stays unexplained, and
`progressionEvidence()` says so — inferring "it went up, so it must have been clean" would
manufacture exactly the decision history this layer exists to keep honest.

**Why the write is in `finishExercise()` and not `preview()`.** `preview()` runs on every ± tap on
the rest screen; only `finishExercise()` is the moment the lifter actually committed. One record per
exercise, written where the decision is applied. A test asserts that previewing commits nothing.

## 1C — `evidence.js`

Pure. Imports `exercises.js`, `insights.js` and `store.js`, and nothing else — no chat, no digest,
no prompt, no DOM, no network. Delete the Gemini integration tomorrow and it still answers "what
does this app actually know about my squat" for a screen, a test, or `devcheck.js`. The dependency
direction is one-way: `digest.js` imports `evidence.js`, never the reverse.

**Four question-shaped reads**, named for what someone would actually ask:

| Function | Question |
|---|---|
| `trainingEvidence(now)` | How much work, spread how, how recently? |
| `liftEvidence(exId)` | Is this lift moving? |
| `movementEvidence(exId, lookback)` | Where does it break down, and how sure is that? |
| `progressionEvidence(exId)` | What did the app decide, and on what numbers? |
| `forLift(exId)` | All three of the above, composed at the edge so each can be absent independently |

**One shape, with `status` first and never optional:**

```js
{ domain, status, period?, facts?, coverage?, limitation? }
```

| `status` | Meaning |
|---|---|
| `ok` | Evidence exists. `facts` may legitimately be empty or zero — an empty `patterns` list under `ok` is a real finding |
| `no_evidence` | Nothing logged. No facts, no counts — a `sets: 0` here would state a measurement nobody took |
| `insufficient_evidence` | Logged, but below the source module's own floor. `coverage` still reports how much exists, because "3 more sets and this can answer" is both true and useful |
| `unknown_exercise` | Not a lift this app has. Deliberately not `no_evidence`, which would be a claim that the user has never trained it |

`limitation` is present whenever `status` is not `ok`, and is written to be repeated to a person
verbatim rather than paraphrased into a guess.

**Confidence is never manufactured.** It appears only where the source computes one, carried through
as the exact fraction `insights.faultTimeline()` produced — `matchingSets / evidenceSets` — with
both counts beside it. It is never rounded up, never converted to a word like "high", and never
invented for the domains (strength, training volume) whose sources produce no confidence at all.
The layer does not pretend all domains share confidence semantics.

**The three-way distinction that is the module's whole reason to exist**, for movement evidence:

| Situation | `status` | What may be said |
|---|---|---|
| No set carries `faultEvents` | `no_evidence` | Nothing about their form. Not "stable", not "clean" |
| Watched, below `MIN_SETS_FOR_PATTERN` | `insufficient_evidence` | How many sets short it is |
| Watched enough, nothing recurred | `ok`, `patterns: []` | "It held up" — the only one of the three that may be said this way |

One line was added to `insights.js` to support that: `trackedSets(exId, lookback)`, exporting the
denominator every confidence is a fraction of, so `evidence.js` draws the watched/unwatched line
with the same predicate rather than re-deriving `wasTracked` and letting the two drift apart.

## 1D — connecting the existing coach

**No new chat system, no backend, no tool-calling framework, no provider change.** `chat.js` was not
touched. The change is in `digest.js` — the brief the existing integration already sends — which now
carries the differentiated intelligence for the three most-trained lifts.

**Why three and not six.** The detail is the expensive part: a pattern with its confidence plus a
decision with its basis is roughly as many characters as everything else about that lift combined.
Lifts are already ranked by how much you train them, and past the third the honest state is usually
"not enough evidence" anyway. A question about the fourth lift is a question for retrieval, which is
Phase 2. `DETAILED_LIFTS = 3` is a named constant carrying that reasoning.

**What a detailed lift now carries** (real output — squat with a recurring depth fault):

```json
{ "name": "Back squat", "estimated1RM": 74, "changePct": 0, "stalled": 30,
  "weakestPoint": "Not reaching depth",
  "formPattern": { "signal": "Not reaching depth", "status": "recurring",
                   "confidence": 1, "inSets": 6, "ofSets": 6, "startsAroundRep": 5 },
  "lastDecision": { "decision": "hold", "reason": "form broke down",
                    "from": 60, "to": 60, "unit": "kg",
                    "basis": { "sets": 3, "repsHit": true, "faultsPerRep": 0.38,
                               "cleanLimit": 0.34, "stalledSessions": 3 } } }
```

All seven of the priority items are present: pattern, weakest point, evidence counts (`inSets` /
`ofSets`), timing (`startsAroundRep`), confidence, the deterministic verdict with its reason and the
numbers behind it, and explicit limitations.

**A gap found and closed during implementation.** The first version emitted nothing at all about
form for a lift that *was* watched with nothing recurring — `formPattern` was null and pruned away.
That is the same absent-vs-zero failure as Bug 2, one level up, and silence is the one thing a model
reliably fills in. Fixed with `formState()`, which always emits one of three compact tokens:

| Token | Means |
|---|---|
| `"not watched"` | No fault tracking on any set. Nothing is known |
| `"only 1 of 3 sets watched"` | Watched, below the floor |
| `"watched 6 sets, nothing recurring"` | Watched, and it held up |

Compact tokens rather than sentences, because these repeat once per lift while `RULES` — which
explains what each token means — is sent once. Putting the explanation in the part that does not
repeat is the cheaper half of the same information. `evidence.js` keeps the full sentences for
callers that show them to a person. Same reasoning for `"decisionEvidence": "none recorded"`.

**Context size, measured on a heavy fixture** (30 days, six lifts, one with a strong recurring
pattern, 28 days of food/weight/sleep, one recorded verdict):

| | Before | After | Δ |
|---|---|---|---|
| `RULES` | 910 ch / ~228 tok | 1,936 ch / ~484 tok | **+1,026 ch (+113%)** |
| `digest()` data | 1,318 ch / ~330 tok | 1,798 ch / ~450 tok | **+480 ch (+36%)** |
| **Total per message** | **2,228 ch / ~558 tok** | **3,734 ch / ~934 tok** | **+1,506 ch (+67%)** |
| Fresh-install data | 325 ch | 325 ch | unchanged |

At `gemini-2.5-flash` input pricing that is **+$0.0001 per message** — for the heavy user of §7,
about **+$0.03/month**. Cost is not the reason to think twice about this change. The reason to think
twice is that `RULES` more than doubled: four bullets now govern the four new fields, and by that
file's own standing rule, a fact added without a rule to govern it is a fact the model may do
anything with. Whether the model actually *obeys* those four bullets is untested — see the gaps.

**Existing chat behaviour is unchanged.** `chat.js`, `talk()`, the SSE handling, the streaming UI,
the `shareData` toggle, the 30-message history and the crisis fallback are all byte-identical. With
`shareData` off, nothing new is sent. `evidence.js` was added to `sw.js`'s `SHELL` list so a cold
offline start still resolves the new import.

## 1E — key tier disclosure

Rewritten in the Mind setup card (`index.html`), shortened into the share note (`mood.js`), and
matched in `README.md`. Verified rendering at mobile width with both links present and no console
errors.

It states, without hedging: there is no server in between; what is sent (typed text, plus the logged
summary while the toggle is on); what is never sent (camera frames, pose data, face images — "read
on this device and thrown away frame by frame; nothing in this app has ever kept an image", which is
literally true per `FACE_WELLNESS_AUDIT.md:22`); and that **which key you paste changes what Google
may do with it** — attributed to Google's terms rather than asserted as the app's own guarantee:
free-tier content used to improve their products with human review possible, billing-enabled key
not. Links go to the Gemini API terms and the AI Studio key page. No privacy guarantee is claimed
beyond what the cited tier supports, and nothing implies a proxy that does not exist.

## 1F — adversarial evidence tests

`test_evidence.mjs`, 15 checks, all eight scenarios, each written as the lie it is meant to prevent.

| # | Scenario | Result |
|---|---|---|
| 1 | Fresh install | ✅ `no_evidence` across all four domains; asserted the packet contains **no digit at all** |
| 2 | No pattern data | ✅ `no_evidence`; asserted the output does not match `/stable\|clean\|good\|fine/i`; strength still readable |
| 3 | One-off fault | ✅ `occasional`, confidence < 0.5, `1 of 6` — the five clean sets stay in the denominator |
| 4 | Strong recurring fault | ✅ label, `recurring`, confidence exactly `1`, `6 of 6`, `startsAroundRep: 5` |
| 5 | Shuffled storage order | ✅ a gain reads as a gain, elapsed days positive, period runs forwards |
| 6 | Verdict exists | ✅ decision, reason, and the threshold beside the number it was compared against |
| 7 | Verdict absent | ✅ `no_evidence`, despite a 60→80 load change sitting right there to be misread |
| 8 | Low confidence | ✅ `0.33` as a number, with `2 of 6` legible without the label |

Plus contract-level checks: every result names a domain and a valid status; every non-`ok` result
carries a limitation; an unknown exercise is refused rather than answered with an empty history; and
one lift composes into three independently-absent domains.

## Architecture decisions changed during implementation

1. **`weakestPoint` normalisation went to the consumer, not the producer** — the producer already
   had a correct consumer. Settled by grepping consumers, not by preference.
2. **`prune()` was not touched.** The Phase 0 report implied the zero-handling fix lived near it. It
   did not: `prune()`'s contract is about missing values and is correct as written. The bug was the
   gate above it.
3. **The chronology fix moved up to `sessions()`**, not `strength()` where the symptom appeared, so
   `stalledSessions()` and `shouldDeload()` are fixed by the same three lines.
4. **Invalid timestamps are dropped rather than sorted to one end** — an unplaceable set was
   silently producing `NaN` elapsed days, which the Phase 0 audit had not spotted.
5. **`formState()` was not in the plan.** Implementation exposed that a watched-and-clean lift
   emitted nothing at all, recreating Bug 2's failure mode at the digest boundary.
6. **Long limitation sentences were compacted to tokens at the digest boundary only**, because they
   repeat per lift while the rules explaining them are sent once. `evidence.js` keeps the full
   sentences for human-facing callers.
