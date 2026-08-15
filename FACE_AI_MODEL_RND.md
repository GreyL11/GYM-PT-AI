# Face Intelligence — Model R&D and Architecture Decision

> **Model selection superseded by [`FACE_AI_MODEL_RND_V2.md`](FACE_AI_MODEL_RND_V2.md).** The APK-size
> constraint that drove several rejections here was lifted; V2 re-argues them on value. The Phase 0
> repository audit, the privacy architecture, the baseline/trend methodology, the routine schema
> finding and the multimodal decision below all still stand and are not repeated in V2.

Written against the working tree at `d81cc8e`. Every claim about this repository was checked by
reading the file named, not recalled. Every claim about an external model, price or policy was
fetched this session and is cited. **No feature code has been written and no package installed.**

This supersedes nothing in [`FACE_WELLNESS_AUDIT.md`](FACE_WELLNESS_AUDIT.md) — that document's
Phase 0 audit still stands and its conclusions were re-verified here. This one answers the question
that one did not: *which model does which job, and where does the boundary between measurement and
interpretation sit.*

---

## 0. The one-paragraph answer

Keep MediaPipe FaceLandmarker as the only vision model — it is already vendored, already correct
for the job, and nothing else on the market beats it inside a Capacitor WebView. Do the appearance
measurement in **plain JavaScript over Canvas pixel data**, restricted to within-frame ratios,
because absolute colour across days measures the camera's gain control, not the person. Do the
baseline and trend work in **deterministic, tested, offline arithmetic** — this is where the actual
intelligence of the feature lives. Use **Gemini, through the existing `chat.js` seam, structured,
evidence-only, validated by `validate.js`** to explain what the arithmetic found. **Do not send the
face image to a multimodal model as part of any check-in.** Recommended architecture: **Option D**,
built so that its measurement half is exactly Option A and the model layer can be deleted without
losing a single fact.

---

# PHASE 0 — Repository audit

## 0.1 Frontend architecture

No build step. No bundler. No framework. `www/index.html` is a single 74 KB document holding every
screen as a `<section class="sheet">`; ES modules are loaded directly by the browser; `www/app.js`
(2,083 lines) does all DOM wiring and navigation through one `show(sheet)` function that hides every
other sheet ([app.js:503](www/app.js:503)).

Shipping surface is a **Capacitor 6 Android APK** (`capacitor.config.json`, `webDir: "www"`), plus
the same directory served directly for development (`serve.mjs`). That means the runtime is the
**Android System WebView**, not a browser the user chose — a constraint that decides several
questions in Phase 1.

The codebase has an unusually strict and consistently applied convention: **modules that decide
things are pure and tested; modules that touch the DOM, the camera or the network decide nothing.**
It is stated in the header of nearly every file and it holds under inspection.

## 0.2 Current Face tab implementation

| File | Lines | What it actually does |
|---|---|---|
| [`www/face/model.js`](www/face/model.js) | 64 | `createFaceLandmarker()`, `startFaceCamera()`, `releaseFace()`. Only file touching MediaPipe or `getUserMedia` for the face. |
| [`www/face/geometry.js`](www/face/geometry.js) | 198 | Pure. Alignment, head pose (two independent methods), seven named regions, pixel-box conversion. |
| [`www/face/quality.js`](www/face/quality.js) | 304 | Pure. Framing, pose, sharpness, exposure, balance, lighting-vs-history, guidance, steadiness, verdict. |
| [`www/face/checkin.js`](www/face/checkin.js) | 148 | Sheet wiring. Camera lifecycle, rAF loop with a generation counter, overlay painting. |

**The critical finding: `quality.js` is substantially more built than `checkin.js` uses.**
`checkin.js:104` assembles a verdict from `framing` and `pose` only. `sharpness()`, `exposure()`,
`balance()` and `lightingMatch()` are written, exported, and tested — and never called, because all
four need pixel data and nothing in this app has ever read a pixel. The feature is not "unfinished
scaffold" in the sense of being thin; it is a finished front half waiting on the pixel path.

What the user sees — "capture confidence 72%" ([checkin.js:145](www/face/checkin.js:145)) — is
`assess()`'s weighted-minimum of two of six intended components, rendered as a debug string. It is
correct and it is meaningless to a person, which is the complaint that started this.

**Nothing is stored.** There is no `store` import anywhere under `www/face/`. There is no face key
in `store.js`'s `blank`. Verified.

## 0.3 Camera APIs and lifecycle

`navigator.mediaDevices.getUserMedia({video: {facingMode: 'user', width: {ideal: 1280}, height:
{ideal: 720}}})` ([model.js:43](www/face/model.js:43)). FaceLandmarker runs in `VIDEO` mode with
`delegate: 'GPU'` (WebGL through the MediaPipe WASM runtime), `numFaces: 1`, blendshapes **off**,
`outputFacialTransformationMatrixes` **on**.

Three lifecycle protections already exist and are correct:

1. **Generation counter** (`gen`, [checkin.js:29](www/face/checkin.js:29)) — prevents a stale rAF
   callback from resurrecting a second loop over one landmarker. Copied from the gym loop, where
   its absence once froze the app.
2. **Release on every exit path** — `show()` calls `face.close()` whenever the target sheet is not
   the face sheet ([app.js:506](www/app.js:506)), so no navigation route can leave the front camera
   lit.
3. **Model created on entry, `close()`d on exit** — two vision models resident at once is what
   pushes a mid-range phone into swapping ([model.js:52](www/face/model.js:52)).

`onBeforeOpen` exists so the caller can release the rear camera first; on most Android hardware both
cameras cannot be open simultaneously.

## 0.4 `quality.js` — what is already decided

`LIMITS` ([quality.js:26](www/face/quality.js:26)) is the whole threshold surface in one object, and
its own comment concedes the values are derived from what the maths implies, **not measured on real
captures**. That is the correct state for a pre-device feature and the single largest calibration
debt in the design.

The design decisions worth carrying forward unchanged:

- **Weighted minimum, not average** (`assess`) — four good components cannot outvote one fatal one.
- **`accepted` and `trustworthy` are separate** — a capture can be good enough to store and too weak
  to support a claim. The trend layer needs both.
- **`lightingMatch()` returns full marks until 4 samples exist** and reports `known: false` — it
  refuses to have an opinion rather than blocking the feature from starting.
- **One instruction at a time** (`guide`) — ordered by what blocks what.

## 0.5 `checkin.js` — the gap, precisely

```
frame() → landmarks + matrix → framing + pose → assess → steadiness → paint
```

`steady.ready` becomes true after 20 consecutive accepted frames and then **nothing happens**. There
is no capture event, no analysis, no persistence, no result screen. That is the whole defect.

## 0.6 Mind → Skin

Separate feature, working, and the correct merge target. [`www/skin.js`](www/skin.js) (242 lines,
pure, tested by `test_skin.mjs`) holds:

- 1–5 daily self-report + 6 descriptive flags + 4 routine habits
- `LAG_DAYS = 3` exposure window — skin answers late, so exposure is summed over the days *before*
  the day being scored
- Median-split association against dairy, high-GI food, sleep, mood and training days
- `MIN_DAYS_PER_SIDE = 4` on **each** side, `association()` returns `null` rather than a number when
  either side is thin
- `advice()` ranks a missed habit above any correlation, and suppresses any difference under 0.5 on
  a 5-point scale as noise
- `SEE_SOMEONE` — a referral line shown whenever skin is on screen

UI wiring is [`mood.js:222–300`](www/mood.js:222), display-only. The natural-language entry path
(`chat.readSkinNote`) already proves the structured-output pattern end to end.

**This module is the shape the face feature should copy, not compete with.**

## 0.7 Skincare / serum / face-wash data — the honest finding

**The brief assumes data that does not exist.** `grep -rni "serum|cleanser|toner|retinol|niacinamide"`
across `www/` returns **nothing**.

What actually exists is `day.skin.habits[]`, an array of ids drawn from a **fixed list of four**
([skin.js:48](www/skin.js:48)):

| id | label |
|---|---|
| `spf` | Sunscreen |
| `washPost` | Washed after training |
| `moisturise` | Moisturised |
| `nopick` | Left it alone |

There is **no product identity, no serum entity, no product start/stop date, and no timestamp finer
than the calendar day.** "Serum logged 12 of 20 days" is not a query this schema can answer today —
`washPost` is the closest thing to a face wash log and it means "washed after training", which is
not the same fact.

Phase 7 below designs the minimum schema change. It is small, and it is a prerequisite, not a
detail.

## 0.8 Persistence

One `localStorage` key, `gym-trainer/v1` ([store.js:4](www/store.js:4)). `read()` spreads a `blank`
object over the parsed payload so a missing field defaults instead of throwing. Per-array caps
applied at write time: `log` 500, `rounds` 500, `meals` 3000, `weights` 400, `chat` 200, `verdicts`
200, `days` 420 keys.

`days[key]` is the row shape face check-ins would ride alongside:
`{mood, bed, wake, sleeps[], plans[], skin}`.

No IndexedDB anywhere (`grep indexedDB www/` → nothing). Backup is `JSON.stringify` of the whole
object, so anything added to the store is exported and restored automatically ([store.js:165](www/store.js:165)).

The file's own opening line is a `ponytail:` marker: *localStorage, not IndexedDB… move to IndexedDB
if you ever store video clips.* That is exactly the trigger the optional thumbnail feature would
pull.

## 0.9 AI provider integration

[`www/chat.js`](www/chat.js), 400 lines, and **the only file in the app that makes a network call**
other than the service worker. Verified: `grep -rln "fetch(" www/` returns `chat.js` and `sw.js`
only.

Raw `fetch` against `generativelanguage.googleapis.com/v1beta`. No SDK — deliberately, since there
is no bundler. Four entry points:

| Function | Shape | Validated? |
|---|---|---|
| `talk()` | SSE stream, conversational | No — it is a conversation |
| `phrase()` | one sentence from computed facts | No — returns `null` on any failure |
| `readSkinNote()` | `responseSchema` → `{score, flags}` | Yes — range clamped in JS after the schema |
| `explain()` | `responseSchema` → `{observed, meaning, suggestion}` | Yes — by `validate.js`, with one retry |

Model is `gemini-3.5-flash-lite`, overridable by `GEMINI_MODEL` env for `eval_coach.mjs`
([chat.js:35](www/chat.js:35)). Key lives in `store.settings.geminiKey`, sent as the
`x-goog-api-key` **header** rather than a query parameter, deliberately so it stays out of logs and
referrers.

## 0.10 Gemini implementation specifics worth reusing

- **Structured output works and is used twice.** `responseMimeType: 'application/json'` +
  `responseSchema` with enums. The comment at [chat.js:275](www/chat.js:275) makes the key point:
  the three fields of `explain()` are *how a claim gets classified without anything having to read
  English*.
- **`explain()` is deliberately not streamed** — streaming means the person has read it before
  anything could check it.
- **Failure is always local and always graceful.** `Blocked` error class, hard-coded local
  `BLOCKED_REPLY` carrying crisis numbers, `testKey()` returning the provider's own error text.

## 0.11 Evidence architecture

[`www/evidence.js`](www/evidence.js), 253 lines, pure, no network import, and the most important
file in this repository for the present question. It draws one line everywhere:

> **ABSENT** — no evidence exists, so no number is reported, because any number would be invented.
> **ZERO** — evidence exists and the measurement is zero. The zero is reported, because it is real.

Four statuses, of which every consumer must branch on the first field:
`ok | no_evidence | insufficient_evidence | unknown_exercise`, plus a `limitation` string meant to
be repeated verbatim rather than paraphrased.

[`www/digest.js`](www/digest.js) applies the same rule to the conversational path: `prune()` drops
every null so an unlogged fact is *absent* rather than `null`, because *a model handed `sleep: null`
will happily write a sentence about your sleep; a model handed nothing cannot*
([digest.js:16](www/digest.js:16)).

**Phase 6's requested state machine (`NO_BASELINE`, `BUILDING_BASELINE`, …) is this pattern. It
should be built as a fifth domain in `evidence.js`, not as a parallel invention.**

## 0.12 Claim validation

[`www/validate.js`](www/validate.js) + [`www/claims.js`](www/claims.js) + [`www/explain.js`](www/explain.js).

`provenance()` walks the evidence packet and indexes **every number in it with the path it came
from**, derived from the object rather than listed by hand. `checkClaim()` is then a lookup, not a
judgement — three deterministic rules (`exact`, `decimal`, `percent`), with a documented refusal to
let a non-integer round to zero decimals.

`explain.js` enforces the order that makes it mean something:

```
evidence → ask → validate → (one retry with feedback) → validate → render, or fall back
```

On failure it returns `status: 'unverified'` and **discards the answer entirely** — not trimmed, not
partially rendered — falling back to `plainly()`, the same explanation assembled by arithmetic.

The stated limits are equally important and are quoted here because a face feature would inherit
them: it checks that a number **exists** in the evidence, not that it was used for the right thing;
it sees digits, not words; and it says nothing about a sentence with no numbers in it
([validate.js:8](www/validate.js:8)).

## 0.13 Privacy architecture — the current, verified guarantee

`grep -rn "getImageData|createImageBitmap|toDataURL|toBlob|drawImage|OffscreenCanvas" www/` returns
**nothing**. Re-verified this session.

**No JavaScript in this application has ever had access to image content.** MediaPipe receives the
`<video>` element and returns coordinates. That is a stronger guarantee than most apps can make and
**any pixel-reading feature ends it.** It must be treated as the architectural decision it is.

What leaves the device today: the `digest()` aggregate on every chat message when `shareData` is on
(default **true**, [mood.js:109](www/mood.js:109)), plus what the user typed. Mood scores and
PHQ-9/GAD-7 results are correctly excluded.

The tier finding from `LLM_INTELLIGENCE_RND.md` §2F is load-bearing for Phase 9 and was re-verified
against Google's terms this session — see Phase 9.

## 0.14 Package and build constraints

```json
"dependencies": { "@capacitor/android": "^6.2.1", "@capacitor/core": "^6.2.1",
                  "@mediapipe/tasks-vision": "^0.10.14" }
```

Three runtime dependencies. One test command chaining 15 plain `node` files, no framework, no
runner, no mocking library. `vendor.mjs` rebuilds `www/vendor/` from `node_modules` plus downloads,
with a 3-try backoff, and is gitignored output.

Current vendored payload:

| Asset | Bytes | Shared |
|---|---|---|
| `vision_wasm_internal.wasm` | 9,423,986 | all vision tasks |
| `vision_wasm_nosimd_internal.wasm` | 9,294,247 | fallback |
| `tasks-vision.mjs` | 136,870 | all |
| `pose_landmarker_full.task` | 9,398,198 | gym |
| `pose_landmarker_lite.task` | 5,777,746 | gym |
| `face_landmarker.task` | 3,758,596 | face — **already downloaded** |

`sw.js` has an explicit `SHELL` array (network-first for app files, cache-first for `/vendor/`).
**Any new module must be added to it by hand** — a missed entry only bites on a cold offline start,
which is precisely the case the file exists for.

## 0.15 Target environment

- **Primary:** Android System WebView inside a Capacitor APK. Not a browser the user picks, and its
  version tracks the Play Store's WebView package rather than the app.
- **Secondary:** desktop Chrome via `npm run serve`, for development.
- Practical consequences: WebGL/WASM are safe; **WebGPU availability in the Android WebView is not
  something I could verify from an authoritative source this session** and must be treated as
  unavailable. `SharedArrayBuffer`-dependent threading is not guaranteed. No `<input capture>`
  workarounds needed — `getUserMedia` already works, proven by the gym flow.

---

# PHASE 1 — Model and library candidates

## A. Browser / on-device face landmark models

### A1. MediaPipe FaceLandmarker — **already vendored**

| | |
|---|---|
| Task | Face detection + 478-point 3D mesh + 4×4 facial transformation matrix |
| Provider | Google AI Edge, via `@mediapipe/tasks-vision` |
| Maintained | Yes — package actively published; the Web guide is current ([Face landmark detection guide for Web](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js)) |
| Asset | `face_landmarker.task`, **3,758,596 bytes**, HTTP 200 re-confirmed this session |
| Runtime | WASM + WebGL (`delegate: 'GPU'`), already in the APK |
| Browser / mobile | Broadest of any candidate; already proven in this app's gym flow on the same WebView |
| Package size delta | **Zero.** The class is already exported by the vendored bundle; the model is already downloaded |
| Licence | Apache 2.0, redistributable ([model card / guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker)) |
| Cost | Free |
| Offline | Yes, fully |
| Integration | **Already integrated and working** |
| Maintenance risk | Low–medium. Google has renamed and moved these docs more than once; the model file and API have been stable |

The transformation matrix is the decisive feature: it gives a real rotation rather than an angle
inferred from where the nose sits, which is what makes the head-angle gate trustworthy
([geometry.js:111](www/face/geometry.js:111)).

### A2. TensorFlow.js `@tensorflow-models/face-landmarks-detection`

`1.0.6`, **last published roughly two years ago** ([npm](https://www.npmjs.com/package/@tensorflow-models/face-landmarks-detection)).
Its `mediapipe` runtime is a wrapper around *the same model this app already loads*; its `tfjs`
runtime would add `@tensorflow/tfjs-core` + a backend (~1–2 MB of JS) to reproduce what is already
in the APK, at lower fidelity. **Reject — strictly dominated.**

### A3. `face-api.js` / `human` / similar

`face-api.js` is unmaintained. `human` is maintained but is a 10+ MB kitchen sink bundling age,
gender, emotion and identity models — every one of which is an explicit non-goal
([FACE_WELLNESS_AUDIT.md §9](FACE_WELLNESS_AUDIT.md)). Shipping a library whose headline features
you must contractually refuse to use is a liability, not a dependency. **Reject.**

## B. MediaPipe segmentation — the one genuinely new candidate

Investigated because landmark-anchored boxes cannot know that a box contains hair, a beard, or a
spectacle frame, and occlusion is listed as a medium risk in the existing audit.

`ImageSegmenter` **is already exported by the vendored `tasks-vision.mjs`** — no new JS dependency.
Only the model file would be new. Sizes checked directly against Google's CDN this session:

| Model | Classes | Input | Bytes | Verdict |
|---|---|---|---|---|
| `selfie_multiclass_256x256` (float32) | background, hair, body-skin, **face-skin**, clothes, accessories | 256×256 | **16,371,837** | Right capability, wrong price |
| `selfie_multiclass_256x256` (float16) | — | — | **404 Not Found** | Does not exist |
| `hair_segmenter` (float32) | background, hair | 512×512 | **781,618** | Cheap; solves the forehead case only |
| `selfie_segmenter` (float16) | background, person | 256×256 | 249,537 | Useless here — no face/hair split |

Sources: [Image segmentation guide](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter),
[Multiclass model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf).

**16.4 MB takes the APK from ~27.8 MB to ~44 MB — a 59% increase for a confound that has not yet
been observed on a single real capture.** Rejected for v1 on that basis alone, not on capability.
Also noted: a live defect report of wrong category mapping under the GPU delegate on iOS Safari
([mediapipe#6142](https://github.com/google-ai-edge/mediapipe/issues/6142)) — irrelevant to an
Android WebView target, but a signal about how well-exercised this path is on the web.

`hair_segmenter` at 782 KB is the interesting middle. **Deferred, data-gated** — build it only if
field captures show forehead contamination the landmark box cannot avoid. Recorded as a
`ponytail:` upgrade path, not a plan.

## C. ONNX Runtime Web + WebGPU

WebGPU is now genuinely broadly shipped — Chrome/Edge 113+ desktop, **Chrome 121+ on Android**,
Firefox 141 on Windows, Safari 26, iOS 26 ([web.dev](https://web.dev/blog/webgpu-supported-major-browsers),
[ORT WebGPU docs](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)). ORT's own docs still
describe the WebGPU backend as **experimental**.

Three independent reasons to reject for this app:

1. **There is no model to run.** ORT-Web is a runtime, not a capability. No public, licensable,
   validated ONNX model measures "skin wellness" from an uncontrolled selfie. The candidates that
   exist are dermatology classifiers trained on clinical dermoscopy — which would be a diagnostic
   claim, the one thing this feature must never make.
2. **The shipping surface is a WebView**, and WebGPU availability there is unverified.
3. Adding a second inference runtime beside MediaPipe's WASM means two model loaders, two memory
   lifecycles and two failure modes on a phone already holding a pose model.

**Reject.** Revisit only if a specific, licensed, validated model appears.

## D. Classical image processing (Canvas 2D + typed arrays)

Not a library — the platform. `drawImage` into an offscreen canvas, `getImageData` on
landmark-anchored rects, arithmetic over `Uint8ClampedArray`.

| | |
|---|---|
| Size | **0 bytes** |
| Load time | 0 ms |
| Browser support | Universal, including the Capacitor WebView |
| Privacy | Best possible — pixels never leave a transient typed array |
| Offline | Total |
| Licence / cost | None / free |
| Accuracy | Exactly as good as the metric definition; fully inspectable and unit-testable |
| Integration | The `sharpness`/`exposure`/`balance` functions in `quality.js` are **already written to consume a luminance array** — this path is pre-fitted |
| Maintenance | Lowest of any candidate: it is the app's own code, with no upstream |

**This is the correct choice for the measurement layer**, and it is the rung of the ladder the rest
of this codebase already stands on.

## E. WebGPU acceleration for the pixel maths

Region boxes are a few hundred pixels on a side and analysis runs **once per accepted capture**, not
per preview frame. A JS loop over ~50k pixels is sub-millisecond. **Reject — no problem to solve.**

## F. Multimodal vision models (Gemini and peers)

Fully evaluated in Phase 9. Summary of the technical facts gathered:

- Images ≤384 px in both dimensions cost **258 tokens**; larger images are tiled at 258 tokens per
  768×768 tile ([Understand and count tokens](https://ai.google.dev/gemini-api/docs/tokens)).
- Current pricing, fetched this session ([Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)):

| Model | Input /1M | Output /1M |
|---|---|---|
| `gemini-3.5-flash-lite` *(in use today)* | $0.30 | $2.50 |
| `gemini-3.7-flash` / `3.6-flash` | $0.75 | $3.75 (rising after 2026-12-31) |
| `gemini-3.5-flash` | $1.50 | $9.00 |
| `gemini-2.5-flash-lite` | $0.10 | $0.40 |
| `gemini-2.0-flash` | — | **shut down 2026-06-01** |

An aligned 384×384 face crop therefore costs about **$0.00008 in input tokens.** Cost is *not* the
reason to refuse images, and saying otherwise would be dishonest. Repeatability and privacy are.

## G. Hybrid

Not a technology; the composition question. Phase 2.

---

# PHASE 2 — Architecture comparison

## Option A — fully local CV

```
camera → FaceLandmarker → alignment/regions → quality gate → deterministic pixel metrics
       → personal baseline → trend → screen (template sentences)
```

**Works today with zero network, zero key, zero cost, zero data egress.** Every number is
reproducible: same pixels in, same number out, forever. The full existing test harness applies with
no API key.

Weakness, stated plainly: the output is a table of ratios and state labels. `skin.js` already shows
this app can write good template sentences from computed facts — but the *nuanced Q&A* the brief
asks for is not reachable from arithmetic.

## Option B — local CV + strong multimodal model on the image

```
camera → local quality gate → standardized capture → aligned crop → multimodal model
       → interpretation → deterministic validation
```

The failure is not privacy first; it is **repeatability**. The model is being asked to *measure*.
Ask it about the same face twice and you get two similar-sounding sentences describing different
magnitudes, because generation is stochastic and the model has no memory of what it said last time.
A trend built on that is a trend in the sampler.

`validate.js` cannot rescue this either, and it is important to be exact about why: it verifies that
a **number appears in the evidence packet**. An image is not an evidence packet. Every claim derived
from pixels the model saw and the app did not is, by construction, unverifiable — the containment
layer would be waved straight through.

Second-order: the free-tier terms permit human review of submitted content (Phase 9).

## Option C — multimodal only

```
camera → image → model → "your skin looks…"
```

Honest evaluation, because the brief asks for one rather than a reflex:

Modern multimodal models are genuinely good at describing a face in one image. That is not the task.
The task is **detecting a change in one person across 30 captures under uncontrolled lighting** —
which requires that the measurement be stable to a smaller magnitude than the change, across
sessions, with no shared reference. This architecture has:

- no capture standardisation (nothing stops a comparison between a window shot and a bathroom shot);
- no numeric anchor (the "score" is generated text, so it drifts with phrasing);
- no refusal mechanism (asked about a face, a model answers about the face — it will not say
  "insufficient comparability");
- no offline path;
- every image on the network.

It is also the architecture that produces the most impressive-sounding demo, which is exactly why
the brief names it as the thing not to build. **Reject.**

## Option D — hybrid

```
LOCAL, DETERMINISTIC                         │ NETWORK, OPTIONAL
camera → FaceLandmarker → regions → quality  │
      → pixel metrics → baseline → trend     │
      → routine evidence → EVIDENCE PACKET ──┼──→ Gemini (structured, text only)
                                             │      → observed / interpretation / suggestion
                                             │    → validate.js → render, or fall back to template
```

Every fact is computed locally and survives the model being absent. The model receives **the same
JSON a human could read**, never pixels, and its output is checked against that JSON before it
reaches the screen — the arrangement `explain.js` already implements and proves.

The layer boundary is the product: **the LLM explains intelligence, it does not manufacture it.**

---

# PHASE 3 — Decision matrix

Weights: High = 3, Medium = 2. Scores 0–5, assigned against the criteria as this repository
constrains them, not in the abstract.

| Criterion | W | A: local CV | B: local+MM | C: MM only | D: hybrid |
|---|:-:|:-:|:-:|:-:|:-:|
| Useful personal intelligence | 3 | 3 | 4 | 2 | **5** |
| Repeatability over time | 3 | **5** | 2 | 1 | **5** |
| Privacy | 3 | **5** | 2 | 1 | 4 |
| Face check-in consistency | 3 | **5** | 3 | 1 | **5** |
| Works without backend | 3 | **5** | 3 | 1 | **5** |
| Cost | 2 | **5** | 3 | 3 | **5** |
| Mobile / browser compatibility | 3 | **5** | 4 | 4 | **5** |
| Performance | 2 | **5** | 3 | 3 | 4 |
| Model sophistication | 2 | 2 | 4 | 4 | 4 |
| Hallucination resistance | 3 | **5** | 2 | 1 | 4 |
| Maintenance burden | 2 | 4 | 2 | 3 | 3 |
| **Weighted total (max 145)** | | **131** | **84** | **59** | **131** |

**A and D tie, and the tie is the finding.**

D beats A on exactly two criteria — *useful personal intelligence* and *model sophistication* — and
pays for them in privacy, hallucination resistance and maintenance. Everything that makes either
option score well comes from the local half they share.

The correct reading is not "pick D because it ties and does more". It is:

> **All of the intelligence is in Option A. Option D is Option A plus a presentation layer.**
> Build D only in the shape where deleting the model layer costs zero facts.

That constraint is what turns the tie into a recommendation.

---

# PHASE 4 — The recommended intelligence stack

**Recommended: Option D, constrained.** Layer by layer, answering each required question.

### Layer 1 — Capture

- **Technology:** `getUserMedia({facingMode:'user'})` — [`face/model.js`](www/face/model.js), unchanged.
- **Why:** Already correct, already releases properly on every exit path.
- **In:** user opening the sheet. **Out:** a live `<video>`.
- **Measured or inferred:** neither — a device.
- **Validated by:** existing lifecycle tests; the `gen` counter; `show()` calling `face.close()`.
- **Stored:** no. **Leaves device:** no.
- **Fails:** permission denied, camera busy (rear camera still open), no front camera. All surface
  as a message in `#face-guide` today.
- **Uncertainty handed on:** absence of a stream stops the pipeline; no downstream layer runs.

### Layer 2 — Specialized vision model

- **Technology:** **MediaPipe FaceLandmarker**, `float16`, GPU delegate, blendshapes off.
- **Why best:** already vendored (0 bytes new), Apache 2.0, proven on this exact WebView, and the
  only candidate returning a true 4×4 head-pose matrix. Every alternative in Phase 1 is either the
  same model with a heavier runtime, an unmaintained package, or a runtime with no model.
- **In:** video frame. **Out:** 478 landmarks (normalised) + transformation matrix.
- **Measured or inferred:** *inferred* — a neural network estimate. It carries its own detection
  confidence, and landmark noise is the floor under every downstream number.
- **Validated by:** `geometry.js` computes head pose **two independent ways** (`poseFromMatrix` and
  `headPose`), which is a built-in cross-check that should be wired up as a disagreement flag.
- **Stored:** no — landmarks are transient. **Leaves device:** never.
- **Fails:** no face; multiple faces (capped at 1); extreme angle; heavy occlusion; very low light.
- **Uncertainty handed on:** `null` landmarks → `framing.score = 0` → capture refused.

### Layer 3 — Capture standardisation

- **Technology:** existing `geometry.js` — eye-corner distance as scale, roll-rotated region boxes
  sized in eye-distance units.
- **Why:** it is the precondition for comparing anything across days. A cheek patch defined as a
  fraction of interocular distance is the same piece of face at arm's length or a foot away
  ([geometry.js:130](www/face/geometry.js:130)).
- **In:** landmarks. **Out:** 7 normalised boxes + `alignment{scale, roll, eyeMid}`.
- **Measured:** yes — pure geometry, deterministic.
- **Validated by:** `test_face.mjs` synthetic faces; `toPixels().clipped` refuses any box crossing
  the frame edge.
- **Stored:** the scalars only, as capture metadata. **Leaves device:** no.
- **Fails:** mirroring errors (would silently swap left/right — the highest-consequence bug in the
  feature and already handled in one place); occlusion the geometry cannot see.
- **Uncertainty handed on:** `clipped: true` per region → that region is dropped, not measured.

### Layer 4 — Quality gate

- **Technology:** existing `quality.js`, **with the four unwired pixel checks connected**.
- **Why:** it is the module that says no, and a false trend caused by standing nearer a window is
  worse than no trend at all.
- **In:** landmarks + luminance arrays + the user's own lighting history.
- **Out:** `{overall, accepted, trustworthy, warnings[], per-component scores}`.
- **Measured:** yes, all six components.
- **Validated by:** `test_face.mjs`, which is written to test the **refusals** above all else.
- **Stored:** yes — the verdict rides with each check-in, because a trend layer must be able to
  down-weight a weak capture months later. **Leaves device:** only inside an evidence packet, as
  numbers.
- **Fails:** thresholds are **currently un-calibrated** (`LIMITS`' own comment). This is the top
  risk in the plan.
- **Uncertainty handed on:** `accepted` gates storage; `trustworthy` gates claim strength; the two
  are deliberately separate and both must travel.

### Layer 5 — Local signal extraction

- **Technology:** new `face/features.js` — pure JS over `getImageData`, no library.
- **Why:** Phase 1D. Free, universal, inspectable, unit-testable against synthetic buffers, and the
  existing quality functions already take exactly this input shape.
- **In:** one `ImageData` per accepted region, resampled to a fixed pixel size keyed to interocular
  distance. **Out:** ~8–12 scalars, **all of them within-frame ratios** (Phase 5).
- **Measured:** yes — but of the *image*, not of the skin. Every value is a property of a photograph.
- **Validated by:** synthetic buffers with known properties; a **scale-invariance test** (same
  synthetic face at two sizes must produce the same ratios); an **exposure-invariance test** (same
  buffer scaled by a global gain must produce the same ratios). Those two tests are the entire
  justification for the ratio-only rule and must exist before any UI.
- **Stored:** yes, ~12 scalars per check-in. **Leaves device:** only as numbers in an evidence packet.
- **Fails:** blur (gated), occlusion (invisible to it — see the hair/beard risk), makeup, a region
  that happens to contain a mole.
- **Uncertainty handed on:** each signal carries its own `available` flag and the region-level
  reason it is missing. A signal whose region was clipped is **absent**, never zero.

### Layer 6 — Personal baseline

- **Technology:** new `face/baseline.js` — quality-weighted rolling median + MAD. Pure.
- **Why:** median and MAD over a mean and SD because a single bad capture that slipped the gate must
  not move the centre, and because `skin.js` already establishes median-split comparison as this
  app's idiom.
- **In:** the stored check-in series. **Out:** per-signal `{state, center, mad, n, window}`.
- **Measured:** derived, deterministically.
- **Validated by:** unit tests including out-of-order input and single-sample input.
- **Stored:** recomputed on read, not cached — it is cheap and a stale cache is a silent lie.
- **Fails:** device change, seasonal lighting drift, too few samples. All handled by explicit states,
  never by a default value (Phase 6).
- **Uncertainty handed on:** the state token *is* the uncertainty. `n` and `window` travel with it.

### Layer 7 — Trend

- **Technology:** new `face/trends.js`. Pure. Robust z-score (`(x − median) / (1.4826 × MAD)`) plus a
  **k-of-n persistence rule**.
- **Why:** one capture outside the band is noise. Requiring 3 of the last 5 accepted captures on the
  same side is the cheapest defence against reporting a lamp as a change.
- **In:** baseline + recent accepted captures. **Out:**
  `{state, direction, magnitudeInMads, capturesUsed, windowDays}`.
- **Measured:** derived. **Never** expressed as a percentage of anything, because there is no
  denominator with meaning.
- **Validated by:** tests for exactly the adversarial cases in Phase 10.
- **Fails:** correlated drift (a user who changes rooms permanently). Mitigated by the lighting-match
  gate and by the rolling window re-centring.
- **Uncertainty handed on:** state token + counts, in the `evidence.js` shape.

### Layer 8 — Routine evidence

- **Technology:** new `face/routine.js` **or** an extension of `skin.js` — deterministic counting
  over `day.skin.habits[]` plus the new product schema (Phase 7).
- **Why:** it is counting. A model must never do this; it is the layer most likely to be asked a
  causal question and the one with the cleanest arithmetic answer.
- **In:** the `days` map. **Out:** consistency fractions, gaps, first/last-logged dates, overlap
  counts — with the `logged ≠ used` caveat attached to every one.
- **Measured:** yes — of the log, explicitly not of behaviour.
- **Stored:** already is. **Leaves device:** as counts.
- **Fails:** missing logs, retroactive logging, a product used but never recorded.
- **Uncertainty handed on:** explicit states — `NO_ROUTINE_DATA`, `INSUFFICIENT_OVERLAP`,
  `ROUTINE_CHANGED`.

### Layer 9 — Verified evidence packet

- **Technology:** a fifth domain in the existing [`evidence.js`](www/evidence.js).
- **Why:** the absent-vs-zero discipline already exists, is tested, and is the exact thing this
  feature needs. Reinventing it beside itself is how two definitions of "no data" ship.
- **In:** layers 4–8. **Out:** `{domain:'face', status, period, facts, coverage, limitation}`.
- **Validated by:** `validate.provenance()` indexes every number in it automatically — nothing new
  to write.
- **Leaves device:** **yes, this object, and only this object.**
- **Fails:** none — a packet with `status:'no_evidence'` is a valid, useful answer.

### Layer 10 — LLM explanation and Q&A

- **Technology:** **Gemini `gemini-3.5-flash-lite`, through `chat.js`, structured output, one
  retry, `validate.js` gate, template fallback.** No provider migration (Phase 8).
- **Why:** already integrated, already the cheapest tier that follows a schema reliably, already
  proven twice in this codebase. Changing provider for this feature would be hype.
- **In:** the Layer 9 packet as JSON, and nothing else — no chat history, no profile, **no pixels**.
- **Out:** `{observed[], meaning, suggestion}` — a classification-by-field, not by wording.
- **Measured or inferred:** **inferred, entirely.** Every number in it must already exist in the input.
- **Validated by:** `validate.checkAnswer()` against `provenance()`; unsupported → one retry with
  feedback → discard and fall back to the template.
- **Stored:** no. **Leaves device:** the packet does, per call, only when the user asks.
- **Fails:** no key, no signal, safety filter, unsupported numbers twice. Every one degrades to the
  arithmetic sentence, which is correct by construction.
- **Uncertainty handed on:** to the person, in the `limitation` string, verbatim.

**The constraint that makes this Option D and not Option B: layers 1–9 are the product. Layer 10 is
a rendering of layer 9. Delete layer 10 and the feature still tells the truth, just less warmly.**

---

# PHASE 5 — What can honestly be measured

The governing physical fact, and the reason most of this product category is fiction: **phone
cameras run continuous auto-exposure and auto-white-balance.** The same cheek photographed in the
same room ten minutes apart can differ more between shots than a real change differs over a month.
This is not speculation — the measurement literature says the same thing about smartphone
colourimetry generally: precision within one device is high, but *bias differs per phone relative to
reference colours, demonstrating the need for colour correction*, and calibration is essential when
comparing images taken under different lighting
([RGB colour correction and gamut limitations, PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC12528221/);
[reliability/validity of smartphone facial skin colour assessment, CCID](https://www.dovepress.com/bridging-accessibility-and-precision-evaluating-the-reliability-and-va-peer-reviewed-fulltext-article-CCID)).

Note what the favourable study actually supports: **excellent intra-device repeatability** under
controlled capture. That is precisely and only the claim this design makes — one person, one device,
one gated capture condition — and it is why every signal below is a **ratio between two regions of
the same frame**, which cancels global gain and illuminant to first order because both regions went
through the same pipeline.

## SUPPORTED — build these

| Signal | Definition | Why it survives |
|---|---|---|
| **Capture confidence** | `assess().overall` over all six components | Already built; a property of the photo, claimed as nothing else |
| **Alignment consistency** | SD of `alignment.scale` and pose angles across captures | Pure geometry, no pixels, no illuminant |
| **Lighting consistency** | `lightingMatch()` drift in the user's own SDs | Already written; explicitly a statement about *comparability*, not skin |
| **Left/right illumination balance** | `balance(leftLuma, rightLuma)` | Ratio within one frame |
| **Blur** | variance of the Laplacian, normalised | Already written; gates every texture signal |
| **Under-eye relative luminance** | underEye luma ÷ same-frame cheek luma | Ratio; the audit's assessment that this is reliable *as a ratio and not as an absolute* holds |
| **Cheek/forehead luminance ratio** | ratio, same frame | Same cancellation |
| **Left/right cheek luminance ratio** | ratio, same frame, **gated on `balance`** | Only meaningful when illumination is confirmed even |
| **Shine (relative)** | fraction of near-saturated pixels in a region ÷ same fraction on forehead | Specular highlights are genuinely visible and genuinely vary |
| **Surface variation (relative)** | local luminance SD within a region, after resampling to a fixed size keyed to eye distance, expressed as a ratio to a reference region | Scale-normalised and gain-normalised; **hard-gated on sharpness** |

Wording rule, non-negotiable: **"visible surface variation"**, never "texture", never "pores".

## PROMISING BUT EXPERIMENTAL — build behind a flag, do not surface

| Signal | Why it is not yet trusted |
|---|---|
| **Relative chromatic ratio** — e.g. `(R−G)/(R+G)` in a region minus the same quantity in a reference region, same frame | Cancels *exposure* but only partially cancels **auto-white-balance channel gains**, which are applied per-channel and can shift between shots. Plausible, unproven on this hardware. Must be validated against real captures before it is shown to anyone, and must never be called "redness" |
| **Left/right asymmetry as a change signal** | Robust to global lighting, confounded by lighting *direction*. Usable only when `balance` is well inside its limit. Needs field data to set that threshold |

## NOT RELIABLE ENOUGH — do not build

| Rejected | Why |
|---|---|
| Absolute redness / erythema index | AWB makes cross-day comparison meaningless; also the metric most likely to be read as a medical claim |
| Absolute colour, tone, or "skin tone" of any kind | Same physics, plus an explicit non-goal |
| Blemish or spot **counting** | Blob detection cannot separate a spot from a shadow, stubble, a mole or a hair at phone resolution under uncontrolled light. False counts drive false trends |
| Pore visibility | Below the reliable spatial resolution of a selfie at arm's length |
| Wrinkle / fine-line metrics | Dominated by expression and light direction; drifts into age estimation |
| Hydration | The camera cannot measure water content. Any such claim is fabricated |
| Any overall 0–100 "skin score" | The components have different reliabilities and no principled weighting. A single number would hide exactly the uncertainty this feature exists to communicate |
| Age, gender, identity, attractiveness, symmetry-as-beauty | Explicit non-goals |

## NOT IMPLEMENTED — the honest present state

**Every appearance signal above.** Today the feature measures framing and head pose, and stores
nothing. There is no baseline, no trend, no history, no routine linkage. Anything the UI currently
implies beyond "hold still" is implied by accident.

## Language rules, enforced in copy and in tests

Never: diagnose, name a condition, grade severity, say healthy/unhealthy, claim causation, or
compare the user to anyone else. Always: `SEE_SOMEONE` on screen ([skin.js:241](www/skin.js:241)),
and the words *"this is what the photograph showed, under these conditions"* rather than *"this is
what your skin is"*.

---

# PHASE 6 — Baseline methodology

**The user against their own history, never against anyone else.** No population norms exist in this
design and none should be added.

## Method

| Parameter | Value | Reasoning |
|---|---|---|
| Eligible captures | `quality.accepted` (`overall ≥ 0.6`) only | A rejected capture never enters the baseline |
| Minimum for a baseline | **7 accepted captures** | MAD is degenerate below ~5; `skin.js` already uses 8 total / 4 per side as its floor, so this sits in the same family rather than inventing a new number |
| Window | rolling **28 days** | Matches `nutrition.weightTrend(28)` and `dailySeries(28)`; long enough for a real change, short enough to re-centre on seasonal drift |
| Centre | **weighted median** | One bad capture that slipped the gate must not move it |
| Spread | **MAD × 1.4826** | Robust SD equivalent; the scale every deviation is expressed in |
| Recency weighting | exponential, **half-life 14 days** | Baseline drift is handled by weighting, not by cutting history off at a hard edge |
| Quality weighting | weight × `quality.overall` | `accepted` and `trustworthy` are already separate; this is where that separation earns its keep |
| Outliers | **never deleted** — down-weighted by quality, and flagged if \|z\| > 3 | Deleting an inconvenient sample is how a baseline becomes a wish |
| Comparability | each capture stores its `lightingMatch.drift`; captures beyond `lightingDriftMax` are excluded **from comparisons** but retained in the record | The distinction between "not stored" and "not comparable" must survive |
| Device change | store a coarse capture fingerprint (`videoWidth×videoHeight`, and the device pixel ratio) with each check-in; a change **starts a new baseline segment** | Different sensor, different bias — the colourimetry literature is unambiguous. No camera labels are stored; they are identifying and unnecessary |
| Missing history | an explicit state, never an assumption | Below |

## States — required, and this is the core of the whole feature

```
NO_BASELINE                 0 accepted captures. Nothing is known. No comparison is offered.
BUILDING_BASELINE           1..6 accepted. Reports the count and how many remain. No trend.
BASELINE_READY              >= 7 accepted within the window, on the current device segment.
INSUFFICIENT_COMPARABILITY  A baseline exists, but this capture's lighting/quality/device does not
                            match it. The capture is stored; the comparison is refused.
SIGNAL_UNAVAILABLE          Per-signal. Its region was clipped, occluded, or gated out.
```

Rules that must be enforced by test, not by intention:

- **`NO_BASELINE` never renders as "stable."** Missing history is not stability.
- **`BUILDING_BASELINE` never renders as "healthy," "good," or "normal."** Insufficient data is not
  a verdict.
- **`SIGNAL_UNAVAILABLE` never renders as zero** — this is `evidence.js`'s absent-vs-zero rule, and
  the exact bug already found once in `digest.js` where a fresh install shipped a table of zeros to
  the model ([digest.js:155](www/digest.js:155)).

## Trend methodology

- Sort by capture timestamp, **always** — never by array position. This exact bug was already found
  and fixed once in `insights.strength()` (`LLM_INTELLIGENCE_RND.md` §1A, Bug 3).
- Deviation is `(x − centre) / (1.4826 × MAD)`, reported **in MADs**, never as a percentage.
- **k-of-n persistence:** a change is only reported when **3 of the last 5** comparable captures sit
  on the same side beyond 2 MADs. One capture outside the band is noise and is reported as such.
- Trend states: `NO_BASELINE`, `BUILDING_BASELINE`, `INSUFFICIENT_COMPARABILITY`,
  `STABLE_WITHIN_BAND` (only ever from `BASELINE_READY`), `CHANGED_HIGHER`, `CHANGED_LOWER`.
- Every state carries `capturesUsed`, `windowDays` and the mean `quality.overall` of what it used.

---

# PHASE 7 — Routine intelligence

## The schema audit, restated because it decides the phase

**There is no serum log, no face-wash log, no product identity, and no product start date in this
application.** The only routine data is `day.skin.habits[]` over four fixed ids
([skin.js:48](www/skin.js:48)). The brief's example query — *"serum logged 12 of 20 days"* — cannot
be answered today at all.

## Minimum schema change

Reuse, do not rebuild. The existing `habits[]` array is already a per-day set of ids with a cap, a
backup path, and working chip UI:

1. **User-defined routine items** in `settings.routineItems: [{id, label, kind}]`, where `kind` is
   one of `cleanse | treat | moisturise | protect | other`. `skin.HABITS` stays as the built-in
   defaults and the two lists concatenate.
2. **Logged exactly as today** — the item's id lands in `day.skin.habits[]`. Zero new storage shape,
   zero migration, backup and restore work automatically.
3. **Start / change dates are derived, never entered** — first and last appearance of an id in the
   log. Cheaper than a product lifecycle model and more honest, provided the caveat below always
   travels with it.

That is the whole change. Anything more (brands, ingredients, concentrations, a product database) is
speculative and fails the first rung of the ladder.

## Deterministic facts this then supports

| Fact | Definition |
|---|---|
| `consistency` | days logged ÷ days elapsed, over a stated window |
| `gaps` | maximal runs of consecutive unlogged days |
| `firstLogged` / `lastLogged` | derived from the log |
| `overlapDays` | days with **both** an accepted face capture and a routine log |
| `changedOn` | a date where the routine id set changed materially |

## The causation rule, enforced structurally

**RECORDED TOGETHER ≠ CAUSED BY.**

Allowed: *"Your under-eye ratio moved 2.3 MADs above your baseline over a period in which
`niacinamide` was logged on 12 of 20 days."*

Not allowed: *"This serum improved your skin."* — and it is not allowed because this app has no
architecture capable of supporting it. There is no control period, no randomisation, no blinding,
one subject, and a self-selected exposure. `skin.js` already words this correctly
([skin.js:228](www/skin.js:228)): *"your own log, not a study. It shows the two move together, not
that one causes the other."*

## Missing-data semantics — the rule that is easiest to get wrong

**A missing log does not mean the product was not used.** It means it was not recorded. These are
different facts and the second one is the only one the app holds.

Required states, all of which must be representable:

```
NO_ROUTINE_DATA        nothing logged. No routine statement is made at all.
PARTIAL_LOGGING        logged on some days. Consistency reported WITH the "logged, not used" caveat.
INSUFFICIENT_OVERLAP   fewer than MIN_DAYS_PER_SIDE (4) accepted captures on each side of the split.
                       Reuses skin.js's existing floor rather than inventing a second one.
ROUTINE_CHANGED        the id set changed inside the comparison window — the comparison spans two
                       different routines and is reported as such, not silently averaged.
```

**The reuse win:** `skin.association()` already implements median-split comparison with per-side
minimums and a null return when either side is thin. Face signals are a second series to feed
through **the same tested function**, not a reason to write a second one.

---

# PHASE 8 — LLM strategy

## Provider decision: **keep Gemini. Do not migrate.**

Evaluated honestly against the requirements this repository actually imposes — no build step, no
SDK, no server, user's own key, must degrade to fully working offline:

| Option | Verdict |
|---|---|
| **Gemini direct, user's key (status quo)** | **Keep.** Structured output proven twice in this codebase; free tier exists, which is what makes a no-backend design viable at all; provider swap remains a one-file change |
| Anthropic direct from browser | Requires `anthropic-dangerous-direct-browser-access`, and has no free tier — every user would need a paid key. Better privacy, much steeper onboarding. Not worth it for this feature |
| OpenAI direct | Equivalent capability, no advantage here, and a migration cost for nothing |
| Backend proxy | Introduces the first server this app has ever had, an operator, a bill, an account system, and a *worse* privacy story in one respect — data would pass through the developer's infrastructure as well as Google's. **Reject** |
| On-device LLM | 1–4 GB quantised against a 27.8 MB APK. Not close |

**Model:** stay on `gemini-3.5-flash-lite` ($0.30 / $2.50 per 1M —
[pricing](https://ai.google.dev/gemini-api/docs/pricing)). It follows a response schema, its default
thinking level is minimal, and nobody's bill moves. Re-evaluate against `gemini-3.6-flash` only if
schema adherence measurably fails in the live eval.

**Note the API-generation trap already recorded** in `LLM_INTELLIGENCE_RND.md` §5: Google's newer
`/v1beta/interactions` shape coexists with the `:streamGenerateContent` + `contents` shape this app
uses. Both work; mixing them does not. This feature must stay on the shape `chat.js` already uses.

## Input contract

**Only the verified evidence packet, serialised as JSON.** Not the image. Not the chat history. Not
the training digest. Not the profile.

A narrow question deserves a narrow context — `explain.js:22` already argues this, and every extra
field is another number the answer could reach for.

## Output contract

Reuse `explain()`'s schema unchanged, because the fields *are* the classification mechanism:

```
observed:   ARRAY<STRING>  every number must appear in the packet. Digits, not words.
meaning:    STRING         explicitly the model's reading. Any number still from the packet.
suggestion: STRING         non-medical, exempt from numeric validation because it proposes
                           rather than reports.
```

Additional system rules this feature needs beyond the existing prompt:

- If a signal's status is not `ok`, **say so in `observed`.** Silence about an unmeasured signal
  reads as reassurance about it. This is the same failure the existing prompt already guards for
  form data: *"silence about their form reads as approval of it"* ([chat.js:296](www/chat.js:296)).
- Never name a skin condition, never grade severity, never say healthy/normal/good.
- A routine logged alongside a change is a co-occurrence. Say so in those words.
- These are measurements of a **photograph** taken under stated conditions, not of the person.

## Validation path

`explain.js`'s existing loop, unchanged: `packet → ask → validate → one retry with feedback →
validate → render, or discard and fall back to the arithmetic sentence.` `validate.provenance()`
indexes the new packet automatically — it walks the object rather than reading a hand-maintained
list, so a new field is checkable the day it is added.

**Known limits, inherited and worth restating:** the validator confirms a number *exists* in the
evidence, not that it was used for the right thing; it sees digits, not words; and it says nothing
about a sentence containing no numbers ([validate.js:8](www/validate.js:8)). The mitigation is the
same one already in place — classification by field, and a prompt that demands digits.

---

# PHASE 9 — Should we send the face image to a multimodal model?

## **OPTIONAL — and not in v1. Never in a check-in. Never on a free-tier key.**

### For routine tracking: **NO.** Categorically.

Four independent reasons, any one sufficient:

1. **Repeatability.** Generation is stochastic. The same face on two days yields two differently
   worded, differently calibrated descriptions. A trend built on that measures the sampler. This is
   the single reason and it does not have a workaround.
2. **The validator cannot reach it.** `validate.js` checks claims against numbers in the evidence
   packet. Claims derived from pixels the model saw and the app did not are unverifiable by
   construction — the containment layer waves them through.
3. **Privacy tier.** Re-verified against [Google's Gemini API terms](https://ai.google.dev/gemini-api/terms)
   this session:

   > **Unpaid:** *"Google uses the content you submit to the Services and any generated responses to
   > provide, improve, and develop Google products"*, and *"human reviewers may read, annotate, and
   > process your API input and output."* Google's own guidance: *"Do not submit sensitive,
   > confidential, or personal information to the Unpaid Services."*
   >
   > **Paid:** *"Google doesn't use your prompts…or responses to improve our products."* Logging is
   > limited-period, for abuse detection only.

   The overwhelmingly likely key in this app is a **free** key — that is exactly what makes the
   no-backend design work. Sending face photographs to a tier whose terms permit human review, by
   default, would be the worst privacy decision in this application's history.
4. **It ends the app's strongest guarantee.** No JavaScript here has ever had access to image
   content. Even the local pixel path weakens that; uploading would end it.

Cost, for completeness and honesty: an aligned 384×384 crop is **258 tokens ≈ $0.00008**
([token counting](https://ai.google.dev/gemini-api/docs/tokens)). **Cost is not the objection and I
will not pretend it is.**

### The one case where it is defensible

A person looking at a specific thing on their own face, who explicitly asks about it, once. Not
tracking — a question.

If it is ever built, every one of these conditions must hold:

| Condition | Requirement |
|---|---|
| Trigger | Explicit, user-initiated, per-instance. Never automatic, never part of a check-in |
| Default | **Off.** A setting the user must turn on, plus per-use confirmation |
| Key tier | **Blocked on a free-tier key**, with the terms quoted at the point of refusal. The app cannot detect tier directly; require an explicit "this key has billing enabled" acknowledgement and say plainly what it means |
| Persistence | The image is **never** written to storage — constructed, sent, released |
| Classification | The result lands in `interpretation`, never `observed`. It is **never** stored, never enters the baseline, never influences a trend |
| Framing | Displayed as *"a description of one photo, not a measurement"*, with `SEE_SOMEONE` alongside |
| Scope | One question, one answer. No history, no series, no comparison |

**Recommendation: do not build this in v1.** Ship layers 1–10 first. If users then ask for it,
it is a small, well-fenced addition. If they do not, the feature was never needed — which is the
likeliest outcome, and the reason to wait.

---

# PHASE 10 — Adversarial evaluation plan

Following this repository's existing convention exactly: **plain `node` files, `assert/strict`, no
framework, added to the `npm test` chain.** Live model work goes in a separate `eval_*.mjs` behind
an env var, as `eval_coach.mjs` already does.

## Unit tests — `test_face_features.mjs`, `test_face_baseline.mjs`, `test_face_evidence.mjs`

**No API key. No network. No camera.** Every one of these must pass offline.

| # | Case | Assertion |
|---:|---|---|
| 1 | Same synthetic capture twice | Byte-identical feature vector. Determinism is the floor |
| 2 | Same buffer × global gain (0.7, 1.4) | Every **ratio** signal within 1e-9. **This test is the justification for the ratio-only rule** — if it fails, the metric is deleted, not tuned |
| 2b | Same synthetic face at two scales | Scale-normalised signals unchanged |
| 2c | Left-lit synthetic face | `balance` fails; the L/R signal reports `SIGNAL_UNAVAILABLE`, not a value |
| 3 | Zero captures | State is `NO_BASELINE`. Assert the rendered string contains no form of "stable", "normal", "healthy", "good" |
| 4 | Two captures | `BUILDING_BASELINE`. No trend object emitted at all. Assert `trend === null`, not `trend.state === 'stable'` |
| 5 | No routine logs | Packet contains `NO_ROUTINE_DATA` and **no consistency number** |
| 6 | Routine logs present, appearance changed | Output contains a co-occurrence statement. Assert absence of causal verbs (`improved`, `caused`, `because of`, `thanks to`, `helped`, `worked`) |
| 7 | Camera never used | `status: 'no_evidence'` with a limitation sentence. Assert nothing resembling an appearance claim |
| 8 | Out-of-order history | Trend identical to the sorted-input trend. Guards the `insights.strength()` bug class |
| 9 | Bad capture (`overall < acceptMin`) | Not stored as baseline evidence; analysis blocked; a reason is given |
| 10 | Hallucination trap | Feed a packet, feed a canned answer containing a number **not** in it → `validate.checkAnswer().ok === false` |
| 11 | Causation trap | Canned answer asserting the serum caused the change → rejected or, at minimum, the assertion is provably confined to `meaning`, never `observed` |
| 12 | Absent vs zero | A signal with a clipped region must serialise as **absent**, not `0`. Assert the key is missing from the JSON |
| 13 | Device change | Captures across two fingerprints do not share a baseline segment |
| 14 | Quality weighting | A low-quality capture moves the centre strictly less than a high-quality one |

## Live model evaluation — `eval_face.mjs`

**Never in `npm test`.** Skips with a message when `GEMINI_API_KEY` is unset.

| # | Case | Measure |
|---:|---|---|
| L1 | Same packet × 10 runs | **Answer variance.** Report: how many runs pass `validate`, how many mention every non-`ok` signal, and the spread of numbers quoted. This is the number that decides whether one retry is enough |
| L2 | `NO_BASELINE` packet | Fails if any run implies stability |
| L3 | Packet with one `SIGNAL_UNAVAILABLE` | Fails if any run stays silent about it — silence reads as reassurance |
| L4 | Routine + change packet | Fails on any causal claim |
| L5 | Adversarial packet (deliberately sparse) | Fails if the model fills gaps with typical values |
| L6 | Model comparison | Same suite against `gemini-3.6-flash`, to justify or refuse a model change with data |

**Gate:** a signal ships only when its invariance tests pass on **real device captures**, not merely
on synthetic buffers. `LIMITS` is currently un-calibrated by its own admission, and the first real
capture session is a required, scheduled step — not something to discover in production.

---

# PHASE 11 — Impact, phases, risks

## Package, performance and cost

| Item | Impact |
|---|---|
| New npm dependencies | **Zero** |
| New model assets | **Zero.** `face_landmarker.task` (3.6 MB) is already downloaded by `vendor.mjs` |
| Rejected assets | `selfie_multiclass_256x256` **16.4 MB** (float16 does not exist — 404 verified). `hair_segmenter` 782 KB, deferred and data-gated |
| APK | ~27.8 MB, **unchanged** |
| New JS | ~5 modules, roughly 600–900 lines, all pure except the capture wiring. **Each must be added to `sw.js`'s `SHELL` by hand** |
| Per-capture CPU | One `drawImage` + ~7 `getImageData` calls on small rects + one pass over ~50k pixels. Sub-millisecond. **Runs once per accepted capture, never per preview frame** |
| Memory | One reused offscreen canvas, fixed size, cleared after each capture. Face landmarker still `close()`d on sheet exit |
| Storage | ~12 scalars + a quality verdict + a fingerprint ≈ **250 bytes per check-in**. Capped at 400 ≈ 100 KB. Comfortable in localStorage; no IndexedDB needed unless thumbnails are ever built |
| LLM cost | ~900 input + ~250 output tokens ≈ **$0.0009 per explanation**; ~$0.0018 with a retry. Ten explanations a month ≈ **$0.01**. Effectively free, on the user's own key |
| Offline | Everything except layer 10. The feature is fully usable with no key and no signal |

## Recommended implementation phases

| Phase | Deliverable | Gate |
|---:|---|---|
| **3** | `face/features.js` — pixel path + the SUPPORTED signals. Pure, tested against synthetic buffers | Invariance tests (#2, #2b) pass |
| **3.5** | **Calibration session on a real device.** Capture under varied light; set `LIMITS` from data | Thresholds justified by measurements, not by arithmetic |
| **4** | Capture event in `checkin.js` + `store.faceCheckins` + the offscreen-canvas privacy boundary | A test asserting `www/face/` does not import `chat.js` |
| **5** | `face/baseline.js` — states, weighting, device segments | Cases 3, 4, 13, 14 |
| **6** | `face/trends.js` — k-of-n persistence, MAD deviations | Cases 8, 9 |
| **7** | Routine schema (§7) + reuse of `skin.association()` for the face series | Cases 5, 6 |
| **8** | `evidence.faceEvidence()` — the fifth domain | Case 12 |
| **9** | Results UI: per-signal state table, "Why?" disclosure, no score anywhere | Copy review against Phase 5's language rules |
| **10** | LLM explanation through `explain.js` + `eval_face.mjs` | L1–L5 |
| **11** | Delete-face-data control, storage caps, memory review | — |

**Phases 3–8 carry all the risk and should carry all the tests.** Phase 7 is worth noting
separately: it needs no camera at all, and it may well deliver more user value per line than
anything above it.

## Risks and known limitations

| Risk | Severity | Mitigation |
|---|---|---|
| `LIMITS` is un-calibrated | **High** | Phase 3.5 is a gate, not a nicety. Everything downstream inherits these thresholds |
| Lighting variance produces false trends | **High** | Ratio-only signals; `lightingMatch` gate; `INSUFFICIENT_COMPARABILITY`; k-of-n persistence |
| Reading pixels ends the app's strongest privacy guarantee | **High** | Explicit boundary, offscreen canvas never in the DOM, scalars only, an import test, an independent delete control, and it is said plainly in the UI |
| Occlusion — hair, beard, glasses, makeup | Medium | Landmark boxes are deliberately small and well inside features; drop regions rather than measure hair; `hair_segmenter` (782 KB) as a data-gated upgrade |
| Users read wellness wording as medical | **High** | No score, no grade, observational language, `SEE_SOMEONE` always on screen |
| Model invents an appearance metric | Medium | Evidence-only input, structured fields, `validate.js`, discard-and-fall-back |
| Free-tier terms permit human review of submitted content | **High** | Never send images; disclose tier where the key is pasted |
| Front-camera mirroring flips left/right | Medium | Handled in one place (`regions({mirrored})`); a swapped cheek would look like a finding rather than a bug |
| Two vision models resident at once | Medium | Already handled — lazy create, `close()` on exit, rear camera released first |
| A new module missing from `sw.js` SHELL | Low | Only bites on a cold offline start, which is the case that file exists for. Check it every phase |
| Feature dilutes a training app | Medium | Separate sheet, entered deliberately, zero impact on the gym flow |

**The honest ceiling:** these are measurements of photographs, not of skin. They are valid for one
person, on one device, under gated capture conditions, compared only against themselves. That is a
real and useful thing. It is not dermatology and the product must never let anyone believe it is.

---

# Final recommendation

## MODEL STACK

- **Vision:** MediaPipe **FaceLandmarker** (`face_landmarker.task`, float16, 3.6 MB, Apache 2.0,
  already vendored, GPU delegate, blendshapes off, transformation matrix on). **No second vision
  model.** `selfie_multiclass` segmentation rejected at 16.4 MB; `hair_segmenter` (782 KB) deferred
  and data-gated.
- **Image processing:** **Plain JavaScript over Canvas 2D `getImageData`.** No library, no runtime,
  no WebGPU. Within-frame ratios only — every metric must pass a global-gain invariance test or be
  deleted.
- **Baseline / trend:** **Deterministic, pure, tested JS.** Quality-weighted rolling median + MAD,
  28-day window, 14-day half-life, ≥7 accepted captures, device-segmented, explicit states, k-of-n
  persistence before any change is reported. **This layer is the feature.**
- **LLM:** **Gemini `gemini-3.5-flash-lite`**, through the existing `chat.js` seam, structured
  output, evidence-packet input only, `validate.js` gate, one retry, arithmetic fallback. **No
  provider migration.**
- **Multimodal image analysis:** **OPTIONAL — off, and not in v1.** Never in a check-in, never on a
  free-tier key, never stored, never entering a baseline. Explicit user-initiated question only.
- **Storage:** existing `localStorage` under `gym-trainer/v1`, one new capped array (400 × ~250 B ≈
  100 KB). Scalars only. No images. No IndexedDB unless thumbnails are ever built.
- **Privacy:** pixels exist only in a transient offscreen canvas that is never attached to the DOM
  and is cleared after each capture; **no image is ever persisted or transmitted**; only the
  evidence packet leaves the device, only when the user asks for an explanation; an independent
  "delete all face data" control; enforced by a test asserting `www/face/` never imports `chat.js`.

## Is this genuinely better intelligence than the current feature?

**Yes — but not for the reason the word "AI" would suggest, and the honest version has three
qualifications.**

**Where it is unambiguously better.** Today the feature measures nothing, stores nothing, and shows
a debug string. Any of layers 5–9 is infinitely more than that, because the baseline is zero. More
importantly, the intelligence being added is not a bigger model — it is *arithmetic that knows when
to refuse*. `NO_BASELINE`, `INSUFFICIENT_COMPARABILITY` and `SIGNAL_UNAVAILABLE` are the genuinely
novel product content here, and no model of any size produces them, because a model asked about a
face answers about the face.

**Qualification one: the LLM adds no intelligence at all.** The decision matrix scored Options A and
D identically, and that is the most useful result in this document. Layer 10 makes the same facts
easier to read. It cannot make them more true, and every architecture that lets it try scores worse.

**Qualification two: the appearance signals are the weakest part, not the strongest.** Within-frame
ratios are physically defensible and the intra-device repeatability literature supports the narrow
claim being made — but no threshold in this design has yet met a real photograph. `LIMITS` says so
itself. Until the Phase 3.5 calibration session happens, the honest status of every appearance
signal is *plausible, untested*. If the invariance tests fail on real captures, the correct response
is to delete signals, not to tune them until they agree.

**Qualification three: the cheapest big win needs no camera.** Phase 7 — user-defined routine items
in the existing `habits[]` array, fed through `skin.association()`, which is already written and
tested — is a small schema change that makes the app answer a question users actually ask
("is this serum doing anything?") with the honest co-occurrence answer. That may well beat the
entire pixel path on value per line.

**The standard the brief set — use the best model for each job, but only claim intelligence where
the system has real evidence — is met by this design**, and it is met specifically because the
strongest model in the stack is the one allowed to decide the least.
