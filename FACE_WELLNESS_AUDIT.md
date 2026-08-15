# Face & Skin Wellness — Phase 0 Repository Audit

Written against the repository at `3f54866`, plus uncommitted work in the tree. Every claim below
was checked against the actual code, not assumed. No feature code has been written.

---

## 1. Executive assessment

**Buildable, and cheaper than expected — with one honest technical ceiling that shapes the whole
design.**

Three findings decide the shape of this feature:

**The face model is already half-shipped.** `www/vendor/tasks-vision.mjs` — the vendored MediaPipe
bundle — already exports `FaceLandmarker`, verified by importing it. The WASM runtime
(`www/vendor/wasm/`, 19 MB) is shared across all vision tasks and is already in the APK. The *only*
new asset is the model file: `face_landmarker.task`, **3,758,596 bytes (3.6 MB)**, confirmed live
at Google's CDN. No new npm dependency, no new WASM, no bundler change. APK goes from 24.2 MB to
roughly 27.8 MB.

**This app has never touched a pixel.** `grep` for `getImageData|createImageBitmap|toDataURL|
drawImage` across `www/*.js` returns **nothing**. Every existing feature — pose, boxing, form
faults — consumes landmark *coordinates* only. The camera frame is read by MediaPipe and discarded;
no JavaScript in this codebase has ever had access to image content. Face wellness would be the
first feature to read pixel data, and that is the single largest privacy change in the app's
history. It must be designed as such, not slipped in.

**Absolute colour measurement across days is not honest, and most of this category is built on
pretending otherwise.** Phone cameras run continuous auto-exposure and auto-white-balance. The same
cheek photographed in the same room ten minutes apart can differ more between shots than a real
skin change differs over a month. Any metric of the form "your redness value was 142 yesterday and
151 today" is measuring the camera's gain control, not the person.

The way out is the one thing that *is* robust: **ratios between regions within a single frame.**
Comparing the cheek to the forehead in the same photo cancels global exposure and white balance to
first order, because both regions went through the same gain. That constrains the feature to fewer
signals than a marketing page would want, and it is the difference between a wellness tool and a
random number generator.

**Recommendation: build it, with 3–4 within-frame ratio metrics, not the 8–10 absolute ones the
brief lists as candidates.** One trustworthy signal beats ten fake ones, as the brief itself says.

---

## 2. Current architecture

```
www/
  app.js          1700+ lines. All DOM wiring, sheet navigation, the single rAF frame loop,
                  camera lifecycle, HUD. Imports every other module.
  pose.js         Camera + MediaPipe. createLandmarker(model), startCamera(video, facingMode),
                  stopCamera(stream), cameraAlive(stream), drawSkeleton(ctx, lm, opts).
  filter.js       One Euro filter. Landmark smoothing applied before anything reads a joint.
  exercises.js    28 lifts, rep state machine, fault rules, cameraCheck(), calibration.  PURE
  boxing.js       Punch detection, bout clock.                                           PURE
  insights.js     Log analytics, fault patterns, confidence-aware evidence.              PURE
  planner.js      Splits, loads, plate maths.                                            PURE
  nutrition.js    Macro targets, food table, water.                                      PURE
  skin.js         (uncommitted) Self-reported skin log + lagged correlations.            PURE
  mood.js         Mind sheet wiring: talk / day / skin / trends panels.
  mood_insights.js, checks.js, t_inputs.js                                               PURE
  chat.js         Gemini. The ONLY networked module.
  store.js        localStorage, single key `gym-trainer/v1`.
  devcheck.js     Developer data-reconciliation screen.                                  PURE
  sw.js           Service worker. Explicit SHELL list, network-first for app files.
```

**Navigation** is a flat set of `<section class="sheet">` elements in one `index.html`, shown by
`show(sheet)` which hides all others and sets `running = false`. Sheets present:
`today, picker, setup, rest, settings, progress, eat, boxing, mind, profile, devcheck`.

**The frame loop** (`app.js`) is a single `requestAnimationFrame` chain guarded by two things: a
`running` boolean and a `loopGen` generation counter. The generation exists because `running` is
only observed on the *next* frame, which previously allowed two loops to drive one landmarker and
freeze the app. There is a `try/catch` around the body; a throw stops the loop and reports it
rather than dying silently. There is a `mode` variable (`framing | counting | live | calibrating`)
that switches behaviour within the one loop.

**Storage** is one localStorage key, `gym-trainer/v1`. `read()` spreads a `blank` object over the
parsed payload, so a missing key defaults rather than throwing. Caps are enforced per-array at
write time: `log` 500, `rounds` 500, `meals` 3000, `weights` 400, `chat` 200, `days` 420 keys.

**Tests** are 11 plain `node` files, no framework, run in sequence by `npm test`. Storage-backed
modules use a `localStorage` shim installed before a dynamic `import()`. 160 checks currently pass.

---

## 3. Reusable infrastructure

| Component | Reuse | Notes |
|---|---|---|
| `pose.js: startCamera/stopCamera/cameraAlive` | **Direct** | Already takes `facingMode`; pass `'user'` |
| `FilesetResolver` + vendored WASM | **Direct** | Same fileset serves FaceLandmarker |
| `vendor.mjs` | **Extend** | Add one model download beside the pose models |
| `sw.js` SHELL list | **Extend** | Add new modules; `/vendor/` is already cache-first |
| `loopGen` generation pattern | **Copy** | Exactly the right fix for a second camera loop |
| `show(sheet)` navigation | **Direct** | Add one sheet; `show()` already stops the loop |
| `store.js` read/write/caps | **Extend** | Add one top-level key with its own cap |
| Backup export/import | **Automatic** | Serialises the whole object |
| Test harness pattern | **Direct** | localStorage shim + dynamic import |
| `insights.js` evidence discipline | **Pattern** | `MIN_SETS_FOR_PATTERN`, "insufficient evidence" |
| `skin.js` (uncommitted) | **Merge target** | Already owns self-reported skin + routine habits |

**`skin.js` matters here.** It already implements a daily self-reported skin score, routine habit
tracking, lagged correlation against diet/sleep/training, and refusal thresholds. Face wellness
should *feed* that module, not duplicate it — the camera adds an objective signal to a log that
already exists, and the routine tracker the brief asks for in Phase 6 is already written and tested.

---

## 4. New dependencies and assets

**None at the JS level.** Verified:

```
exports: DrawingUtils, FaceDetector, FaceLandmarker, FaceStylizer, FilesetResolver,
         GestureRecognizer, HandLandmarker, HolisticLandmarker, ImageClassifier,
         ImageEmbedder, ImageSegmenter, InteractiveSegmenter, MPImage, MPMask,
         ObjectDetector, PoseLandmarker, VisionTaskRunner
typeof FaceLandmarker === 'function'
```

| Asset | Size | Status |
|---|---|---|
| `face_landmarker.task` | 3.6 MB | **New.** HTTP 200 confirmed |
| `vision_wasm_internal.wasm` | 9.0 MB | Already vendored, shared |
| `tasks-vision.mjs` | 136 KB | Already vendored, already contains FaceLandmarker |

**APK impact: 24.2 MB → ~27.8 MB (+15%).** Acceptable for a sideloaded APK. Note the app already
ships *two* pose models (lite 5.6 MB + full 9.0 MB); if size ever becomes a problem, making the
`full` pose model an optional download would free more than the face model costs.

`face_landmarker.task` bundles detection, mesh (478 landmarks), and blendshapes. It also exposes
`facialTransformationMatrixes` — a 4×4 matrix giving **head pose directly**, which is exactly what
the yaw/pitch quality gate needs and avoids hand-rolling pose estimation from landmark geometry.

**Offline:** identical story to the pose models — vendored at build time by `npm run vendor`,
gitignored, cache-first in the service worker. No runtime network.

---

## 5. Recommended feature boundaries

Every candidate signal, assessed against the actual capture constraints.

### Reliable enough to build

**A. Region symmetry / within-frame ratios.**
Compare a region against another region *in the same frame* (cheek vs forehead, left cheek vs right
cheek, under-eye vs cheek). Because both regions passed through the same auto-exposure and
auto-white-balance, their *ratio* is far more stable across days than either absolute value.
Sensitive to lighting *direction* (side lighting brightens one cheek), which the quality gate can
detect and flag via left/right luminance imbalance.

**B. Texture / surface variation, scale-normalised.**
Local standard deviation of luminance within a region, computed after resampling the region to a
fixed pixel size keyed to interocular distance. Normalising by eye distance removes camera-distance
dependence. Requires a sharpness gate — blur destroys this metric, and blur varies with focus.
Report as *"visible surface variation"*, never as "texture" or "pores".

**C. Shine — near-saturated pixel fraction.**
Proportion of pixels in a region above a high luminance threshold, relative to the same fraction on
the forehead. Specular highlights are genuinely visible and genuinely vary. Strongly dependent on
light-source direction; only comparable when the lighting gate agrees.

**D. Under-eye relative luminance.**
Under-eye region luminance divided by same-frame cheek luminance. A ratio, so exposure-robust. The
brief lists this as "only if reliable" — it is, *as a ratio*, and is not as an absolute.

### Trackable only with heavy caveats

**E. Left/right asymmetry as a change signal.** Robust to global lighting but confounded by
lighting direction. Usable only when the quality gate confirms balanced illumination.

### Should NOT be built

| Rejected | Why |
|---|---|
| Absolute redness / erythema | Auto-white-balance makes cross-day comparison meaningless. Also the single most likely metric to be read as a medical claim. |
| Absolute colour / "tone" values | Same. Also invites skin-tone-relative judgements, which are explicitly out of scope. |
| Blemish/spot counting | Blob detection cannot separate a spot from a shadow, stubble, a mole, or a hair at phone resolution under uncontrolled light. False counts would drive false trends. |
| Pore visibility | Below the reliable spatial resolution of a phone selfie at arm's length. |
| Wrinkle/fine-line metrics | Dominated by expression and lighting direction, not by skin. Drifts into age estimation, which is a stated non-goal. |
| "Hydration" | The camera cannot measure water content. Any such claim is fabricated. |
| Any overall 0–100 score | Not defensible: the components have different reliabilities and no principled weighting. See §5.1. |

### 5.1 On an overall score

**Recommendation: do not build one.** The brief asks for this to be evaluated rather than assumed,
and the evaluation fails: combining a lighting-robust ratio with a blur-sensitive texture measure
into one number requires weights nobody can justify, and the resulting figure would hide exactly
the uncertainty this feature exists to communicate. Ship the per-signal status table the brief
sketches instead — `Surface consistency: Stable`, `Capture confidence: High`.

---

## 6. Privacy architecture

**Current guarantee, verified:** no image data is accessible to any JavaScript in this app today.
MediaPipe receives the `<video>` element directly and returns coordinates. Nothing is drawn to a
readable canvas, nothing is serialised, nothing is uploaded. `chat.js` is the only networked module
and it sends text the user typed.

**Face wellness changes this**, because pixels must be read to compute any of §5. Proposed
boundary, to be enforced by design and by test:

```
<video> frame (front camera)
   ↓  FaceLandmarker.detectForVideo()          → landmarks, head-pose matrix
   ↓  drawImage() into an OFFSCREEN canvas      → the only place pixels exist
   ↓  getImageData() on aligned region rects    → typed arrays, transient
   ↓  reduce to ~12 scalar numbers              → the ONLY thing that persists
   ↓  canvas cleared, ImageData dropped, frame never referenced again
```

Rules:

1. **No image is persisted, ever, by default.** Not to localStorage, not to IndexedDB, not to a
   file. The check-in record is scalars only.
2. **No image leaves the device.** No new network call. `chat.js` must never be handed face data —
   enforceable by a test that asserts the face module does not import it.
3. **The offscreen canvas is never attached to the DOM** and is cleared after each capture.
4. **Independent deletion.** A "Delete all face data" control that removes the `faceWellness` key
   alone, leaving training data intact.
5. **Front camera only while in the check-in sheet.** `stopCamera()` on leaving, verified by the
   existing `cameraAlive()` helper.
6. **The stored scalars are not biometric identifiers** — region ratios and variances cannot
   reconstruct a face or identify a person. This is worth stating in the UI.

Optional, opt-in, explicitly *not* default: saving a small aligned thumbnail per check-in so the
user can see their own history. Real product value, real risk. If built, it needs its own toggle,
its own storage cap, its own delete control, and IndexedDB rather than localStorage. **Do not build
in the first pass.**

---

## 7. Proposed implementation phases

Adjusted from the brief where the repository suggests better ordering.

| Phase | Deliverable | Notes |
|---|---|---|
| **0** | This document | Complete |
| **1** | `face/quality.js` + `face/regions.js`, pure, tested | **Build the maths before the camera.** Both are pure functions over landmark arrays and synthetic pixel buffers, so they can be fully tested in node with zero UI. This inverts the brief's order deliberately: the quality gate is the feature's foundation, and it is testable without a camera at all. |
| **2** | `vendor.mjs` + face landmarker creation + check-in sheet with live guidance | Camera lifecycle, framing/pose/distance guidance, no analysis yet. Proves the loop and resource release. |
| **3** | `face/features.js` — the §5 metrics + `FACE_FEATURE_VALIDATION.md` | Pure; tested against synthetic image buffers with known properties. |
| **4** | `face/baseline.js` — quality-weighted rolling median + MAD bands | Pure. Reuses the evidence discipline from `insights.js`. |
| **5** | `face/trends.js` — stable / possible / repeated / uncertain | Pure. |
| **6** | Results, history and explainability UI | Progressive disclosure; "Why?" reveals sample counts and confidence. |
| **7** | Merge with `skin.js` routine + association intelligence | The routine tracker already exists and is tested. |
| **8** | Storage hardening, deletion controls, performance and memory review | |

Phases 1, 3, 4, 5 are pure logic and carry the bulk of the risk — they should carry the bulk of the
tests.

---

## 8. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Lighting variance produces false trends | **High** | Within-frame ratios; lighting-similarity gate against the user's own history; refuse to compare when it differs |
| Two landmarkers in memory at once | High | Create the face landmarker lazily, `close()` it on sheet exit; never hold both live |
| Canvas/ImageData memory churn on a mid-range phone | Medium | One reused offscreen canvas, fixed size, cleared per capture; analysis only at approved capture, never per preview frame |
| localStorage exhaustion | Medium | Scalars only (~200 bytes/check-in); cap at 400 check-ins ≈ 80 KB |
| Users read wellness wording as medical | **High** | Observational language enforced in copy; referral line always present; no scores, no grades |
| Feature dilutes a training app | Medium | Separate sheet, entered deliberately; zero impact on the gym flow |
| Front-camera mirroring flips left/right regions | Medium | Detect and normalise; a swapped cheek would silently corrupt asymmetry metrics |
| Beards, glasses, makeup, hair | Medium | Occlusion affects regions unequally; exclude regions with low landmark confidence rather than measuring hair |
| Regression in the gym flow | Medium | Full existing suite after every phase |

---

## 9. Explicit non-goals

Restating, because these are the failure modes this feature invites:

- No diagnosis of any condition — acne, eczema, psoriasis, rosacea, cancer, infection, allergy
- No severity grading of anything
- No "healthy/unhealthy" verdict
- No beauty, attractiveness or symmetry-as-beauty rating
- No age or gender inference
- No identity recognition or face matching
- No skin-tone classification of any kind
- No cloud upload, no LLM in the analysis path, no API key requirement
- No continuous or background capture
- No raw image or video persistence by default
- No overall 0–100 score
- No hydration claims
- No claim that any observed correlation is a cause

---

## Appendix A — pre-existing defect found during the audit

`test_skin.mjs` exists and passes (9 checks) but is **not referenced by the `npm test` script** —
`grep -c test_skin package.json` returns 0. My earlier edit to add it did not match the script's
actual text and I did not verify it. CI therefore does not run it. This is uncommitted work, so
nothing broken has shipped, but it must be fixed before the next commit.

## Appendix B — open questions for you

1. **Front-facing check-ins mean selfies.** Comfortable with the app asking for that daily-ish?
2. **The thumbnail question** (§6): seeing your own history is the most compelling part of a feature
   like this, and also the only part that stores an image. Default off, opt-in later — agreed?
3. **Where does it live?** A new bottom-tab, or a panel inside the existing Mind sheet next to the
   `skin.js` self-report it would feed?
4. **Beard/glasses:** if regions are frequently occluded, is a reduced signal set acceptable, or
   would you rather it declined to run?
