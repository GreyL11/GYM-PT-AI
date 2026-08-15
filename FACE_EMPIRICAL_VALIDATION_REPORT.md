# Face Empirical Validation — Phase 3.5

Implements the architecture in [`FACE_AI_MODEL_RND.md`](FACE_AI_MODEL_RND.md) and
[`FACE_AI_MODEL_RND_V2.md`](FACE_AI_MODEL_RND_V2.md), with V2 taking precedence where they differ.

**Status: the measurement and validation system is built and tested with fixtures. No real capture
exists, so nothing has been empirically validated and no appearance signal is product-ready.** That
is the expected outcome of this phase, not a shortfall.

---

## 1. Architecture implemented

```
CAMERA (front)
  ↓
FaceLandmarker ─ 478-vertex fixed-topology mesh + 4x4 transformation matrix
  ↓
PER-FRAME GATE ─ framing + pose only. No pixel is read for a face that is not there.
  ↓ (20 consecutive accepted frames)
CAPTURE ─ drawImage → offscreen canvas → getImageData → one transient array
  ↓
CANONICAL REGISTRATION ─ piecewise-affine, one affine per mesh triangle,
                         from this person's own stored reference layout
  ↓
ANATOMICAL REGIONS ─ polygons built from the library's own contour rings
  ↓
MASK ALGEBRA ─ region ∧ face-oval ∧ ¬(eyes,brows,lips,irises) → erode
               → skin-segmentation veto → erode
  ↓
PIXEL QUALITY ─ sharpness, exposure, balance, lighting-vs-history
  ↓
STRUCTURED GATE ─ blocking failures stop the measurement;
                  comparability failures stop only the comparison
  ↓
FEATURES ─ log-density differences against the same-frame whole-face skin reference
  ↓
CAPTURE RECORD ─ scalars + counts + version fingerprint. No image, ever.
  ↓
VALIDATION ENGINE ─ per-signal state. Default UNVALIDATED. Only VALIDATED may ship.
```

The LLM appears nowhere in this diagram. It is not in the measurement path and receives nothing in
this phase.

## 2. Files changed

**New:**

| File | Lines | Purpose |
|---|---:|---|
| `topology.mjs` | 137 | Build script — regenerates topology from the vendored library |
| `www/face/topology.js` | 897 | **Generated.** 468 vertices, 8 contour rings, 854 derived faces |
| `www/face/registration.js` | 232 | Canonical reference, triangle location, piecewise-affine sampling |
| `www/face/mask.js` | 158 | Erosion, segmentation veto, pixel accounting |
| `www/face/features.js` | 268 | Log-density features and the register that declares them |
| `www/face/validation.js` | 258 | Protocols, gates, metrics, the state machine |
| `www/face/record.js` | 148 | Capture record, version fingerprint, consent, storage |
| `www/face/pipeline.js` | 196 | Orchestration, pure, pixels injected |
| `test_face_pipeline.mjs` | 30 checks | Geometry, registration, masks, pipeline, privacy boundary |
| `test_face_features.mjs` | 12 checks | Numerical, including the gain-invariance proof |
| `test_face_validation.mjs` | 17 checks | State machine and refusals |
| `eval_face.mjs` | 152 | Live harness. **Never in `npm test`** |

**Edited:**

| File | Change |
|---|---|
| `www/face/geometry.js` | Replaced three hand-copied index lists with generated topology; added `frame`, `project`, `unproject`, `hull`, `inPolygon`, `anatomy` |
| `www/face/quality.js` | Added `BLOCKING`, `COMPARABILITY`, `LABELS`, `gate()`. Existing functions untouched |
| `www/face/model.js` | Added `createSegmenter()`, `skinCategory()`; `releaseFace()` now closes the segmenter |
| `www/face/checkin.js` | Rewritten: real capture path, offscreen canvas boundary, validation panel |
| `www/index.html` | **Face sheet block only** — honest state card, validation panel |
| `www/sw.js` | Seven new modules added to `SHELL` |
| `vendor.mjs` | Added the segmentation model download |
| `package.json` | Three test files added to the chain; `topology` and `eval:face` scripts |
| `.claude/launch.json` | `autoPort: true` — port 8080 was held by another session |

## 3. Unrelated changes left untouched

Present in the working tree when this phase started, **not mine, not touched, not staged**:

- `www/index.html` — a colour-palette rewrite in the `:root` block (`--sc-low`, `--on-surface`,
  `--neon` and neighbours). Every edit here was surgical against the face-sheet block; the palette
  is exactly as it was found.
- `.gitignore` — a `graft/` entry.
- `.ignore` — new file, graft tooling.

Nothing was reverted, absorbed or committed.

## 4. Models and versions

| Role | Model | Bytes | Source |
|---|---|---:|---|
| Landmarks | `face_landmarker/float16/1` | 3,758,596 | vendored, unchanged |
| Skin segmentation | `selfie_multiclass_256x256/float32/latest` | **16,371,837** | newly vendored |

`float32` is not a preference — `float16`, `int8` and a `512x512` build all return **404** from
Google's CDN. Verified this session. APK impact ≈ 27.8 MB → ≈ 44 MB, accepted under V2's priorities.

Every capture carries a version fingerprint, and `record.comparable()` refuses to pool records
across fingerprints:

```
pipeline    face-pipeline-1
topology    mesh-1:v468-e1322-f854
features    feat-1
landmarker  face_landmarker/float16/1
segmenter   selfie_multiclass_256x256/float32/latest   (null when it did not run)
sampling    density-120
mask        erode-2/5-cov-0.45-px-120
```

**The face-skin category index is asked for at runtime** via `ImageSegmenter.getLabels()`, never
assumed to be 3. If no `face-skin` label is found the capture proceeds **without** a veto and records
`segmenter: null`, so it can never later be mistaken for a vetoed one.

## 5. Registration methodology

`toReference(lm)` projects all 468 landmarks into the capture's own face frame — removing distance,
position and roll — then re-expresses them in a fixed canonical frame. The result is stored once,
from the first accepted capture, and is **per person**: every comparison this app makes is a person
against their own history, so no universal face is needed.

`planAll(reference)` then locates every canonical pixel of every region inside a mesh triangle and
caches the barycentric weights. Each capture applies those weights to its *current* landmarks — a
weighted sum of three points, with no division, so no degenerate triangle in a later capture can
produce a non-finite coordinate.

**Google's `canonical_face_model.obj` is deliberately not used.** Google's own tracker records it as
outdated and inconsistent with the current landmark set.

**Triangles are derived, and the limitation is reported, not hidden.**
`FACE_LANDMARKS_TESSELATION` exports **2,556 edges (1,322 unique)** and **no faces**. The 854
triangles are the 3-cycles of that edge graph. Euler characteristic V − E + F = 468 − 1322 + 854 =
**0**; FaceMesh is a disc with holes at the eyes and mouth, so a small non-positive value is
expected and completeness is not guaranteed. Canonical pixels landing in no triangle are **counted
as `unmapped`** and reported per region.

Sampling is **nearest-neighbour**, deliberately: interpolation would smooth the high-frequency
content the texture feature reads, making blur look like skin.

## 6. Region definitions

Built from the library's own contour rings, in `geometry.anatomy()`:

| Region | Bounded by |
|---|---|
| `forehead` | brow rings below, face-oval forehead arc above, pulled down by `hairline: 0.34` |
| `leftCheek` / `rightCheek` | eye lower lid above, inset oval laterally, lip corner medially |
| `leftUnderEye` / `rightUnderEye` | eye lower lid, band 0.06–0.30 eye-distances below |
| `nose` | between inner eye corners, above the lip line |
| `chin` | lip ring below to inset oval bottom. **Flagged `experimental`** |

**Excluded**, grown outward before subtraction: both eye rings (+0.18), both brow hulls (+0.22), the
lips hull (+0.15), plus the face-oval bound inset by 0.16.

The brow and lip rings are **not closed loops** — brows are two open polylines each, lips are nested
outer and inner rings — so `topology.js` flags them `hull: true` and the consumer takes the convex
hull. A hull over-approximates an exclusion, which is the safe direction.

**There is no `mirrored` flag in the anatomical layer**, and its absence is a genuine simplification:
landmark 263 is the subject's left eye wherever it lands in a flipped frame, so a polygon built from
it cannot acquire the left/right swap that a formula-placed box could.

## 7. Segmentation veto and erosion

> **Landmarks define geometry. Segmentation only vetoes.**

At 256×256 against 1280×720, one mask pixel covers ~5 source pixels across — far too coarse to draw
a cheek edge, and perfectly adequate to answer "is this hair". So it never draws an edge.

Two separate erosions, separately accounted:

| Erosion | Radius (canonical px) | Absorbs |
|---|---:|---|
| `geometryErode` | 2 | the region's own polygon boundary |
| `vetoErode` | 5 | the segmentation's 256×256 resolution (~2.4 canonical px per mask px) |

Both shrink and neither can grow. Per region, every pixel is accounted for:

```
candidates → unmapped → offImage → sampled → erosionRejected → segmentationRejected → afterVeto
coverage = afterVeto / candidates
```

Unavailable below `minCoverage 0.45` **or** `minPixels 120`, with the dominant loss named
(`unmapped_by_topology`, `outside_image`, `eroded_away`, `not_skin`, `insufficient_pixels`,
`region_too_small`).

## 8. Candidate features

All are **differences in log-density space against the same-frame whole-face skin reference**.

| Feature | Calculation | Confounds | Measured/inferred |
|---|---|---|---|
| `dDensityR/G/B` | median region density − median face-skin density, per channel | illuminant spectrum, local tone mapping | measured (of the photograph) |
| `dChromaRG`, `dChromaGB` | median(D_R − D_G) region − same for face | as above; **never called redness** | measured |
| `localContrast` | MAD of high-passed log-luminance, radius-3 local mean removed, whole-kernel-valid pixels only | **blur (hard-gated)**, sampling ratio, surviving non-skin pixels | measured |
| `specularFraction` | fraction of valid pixels ≥ 245 in all channels | light direction and hardness; a global exposure lift genuinely creates these | measured |

**Why differences.** A per-channel camera gain is a multiplication in linear light, hence an additive
constant across the whole frame in log-density space, hence it cancels *exactly* in any within-frame
difference. This is not argued in a comment — `test_face_features.mjs` applies six sets of random
per-channel gains and asserts every differenced feature moves by less than 2e-4, with a companion
test proving the absolute statistics *do* move so the invariance test cannot pass vacuously.

**What that does not cover, stated plainly:** a change of illuminant *spectrum* is not a gain, and a
phone's pipeline is not a pure sRGB encode — local tone mapping is spatially varying, so
"constant across the frame" is an approximation on real hardware. How good an approximation is
exactly what Protocol A and C measure.

## 9. Features rejected before implementation

| Rejected | Why |
|---|---|
| **Melanin / haemoglobin ICA projection** | V2 proposed it. The basis vectors are obtained per-dataset and per-camera by independent component analysis, and could not be verified from a source in hand this session. Shipping recalled constants would produce a confident number rather than an obviously broken one — exactly the failure this phase exists to prevent. A test asserts it is absent so that adding it later is a conscious act |
| Absolute colour / tone / ITA° | uncalibrated and gain-dependent |
| Erythema or "redness" index | same, plus it reads as a medical claim |
| Pore, wrinkle, blemish counts | below reliable resolution; blob detection cannot separate a spot from a shadow or a hair |
| Hydration | the camera cannot measure water content |
| Any composite 0–100 score | components have different reliabilities and no justifiable weighting |

## 10. Quality gate

`quality.gate(parts)` returns structured evidence, not a percentage:

```
{ accepted, comparable, checks: {name: {score, pass, reason, label}},
  failures: [], warnings: [], missing: [], instruction, overall }
```

- **Blocking** — `framing`, `pose`, `sharpness`, `exposure`. Any failure ⇒ not accepted.
- **Comparability** — `balance`, `lighting`. Failure ⇒ accepted but `comparable: false`.
- **`missing` is not a pass.** A capture where the pixel checks never ran cannot be accepted; a gate
  that treated absence as success would record unmeasured captures as validated ones.

The HUD shows the single blocking reason in words ("too dark in here", "turn to face the camera"),
or `Hold still`, or `Ready`. `overall` is retained on the record for triage and is shown to nobody —
collapsing "unusable" and "usable but not comparable" into one number is what made the old
"capture confidence 72%" useless.

## 11. Capture record schema

```
{ at, protocol, accepted, meanFaceLuma,
  quality: { accepted, comparable, failures[], warnings[], checks{} },
  device: { w, h, ratio },
  sampling: { ratio },              // source px per canonical px — a texture confound
  versions: { pipeline, topology, features, landmarker, segmenter, sampling, mask },
  regions: { name: { available, experimental, reason, coverage, counts{}, features? } } }
```

`features` is **absent** when a region was not measurable — never zeroed. Rejected captures are
stored too, carrying `accepted: false`: the gate's acceptance rate is itself a result, and a gate
rejecting 90% of real attempts would be invisible if only its successes were kept.

Stored under one settings key, `faceLab`, capped at 300 records (~1.5 KB each).

## 12. Privacy and consent

**Enforced by test, not by promise** (`test_face_pipeline.mjs`):

- No file under `www/face/` may import `chat.js`, call `fetch`, or open an `XMLHttpRequest`,
  `WebSocket` or `sendBeacon`. The whole directory is scanned, so a new module is covered the day it
  is added.
- No face module may call `toDataURL`. `toBlob` is permitted in exactly one file — `checkin.js` —
  and only inside the consent-gated download path.

The offscreen canvas is created with `document.createElement`, **never attached to the document**,
and cleared immediately after each capture. The `ImageData` is a local that goes out of scope.

**Retaining a capture** requires the consent checkbox *and* an explicit button press per capture. It
writes a PNG through the browser's own download path to the user's filesystem. It never enters app
storage — so there is nothing for a bug to leak and nothing for a backup to carry, and the user can
see and delete the files themselves.

**Deletion:** "Delete all face data" removes the `faceLab` key alone. Training, food, sleep and mood
are untouched.

**No image is sent anywhere. Gemini receives nothing in this phase.**

## 13. Validation metrics and predefined gates

Written before any capture existed, and unchanged since.

| Metric | Definition |
|---|---|
| `noise` | MAD across Protocol A — ten captures in a minute, appearance genuinely unchanged. This is measurement error |
| `spread` | MAD across Protocol B — comparable captures on different days. Error *plus* real variation |
| `noiseRatio` | noise ÷ spread |
| `lightingRatio` | (max − min across Protocol C) ÷ noise, over **accepted** captures only |
| `availability` | region available ÷ accepted captures |
| `falseChangeRate` | fraction of Protocol B captures beyond 2 robust MADs — every one is a false positive *if* the unchanged premise holds. Labelled a proxy, because the premise is an operator assertion |
| `coefficientOfVariation` | **refused** for features that cross zero; CV needs a ratio scale |

| Gate | Threshold | Rationale |
|---|---:|---|
| `noiseRatio` | ≤ **0.5** | Real day-to-day variation must be at least twice the noise before anyone is told. This is V2's "repeatability floor below 0.5 MAD" made non-circular by naming which MAD |
| `lightingRatio` | ≤ **2.0** | Lighting the gate *accepted* must not move the signal more than twice its own noise |
| `availability` | ≥ **0.8** | |
| `falseChangeRate` | ≤ **0.10** | |
| Protocol minimums | A 10, B 7, C 6, D 6, E 4, F 6 | |

**Nothing can reach `VALIDATED` without Protocol C.** A signal that is beautifully repeatable and has
never been shown a different lamp is untested against the confound that kills this feature category.

**On failure the signal is deleted or disabled. It is not tuned.** `validation.js` has no severity
levels and no partial credit.

## 14. Automated test results

```
npm test  →  exit 0
16 reporting files, 309 assertions
  face pipeline    30 checks
  face features    12 checks
  face validation  17 checks
```

No test requires an API key, network access, a camera, or a model file.

**One real bug was found by these tests and fixed:** `falseChangeRate` returned `null` when the MAD
was exactly zero, on the grounds that there was no spread to divide by. That is the *flat-then-jumps*
shape — the single worst-behaved thing a signal can do — and it was sailing past the gate untested.
The gate ordering was also wrong: the noise-ratio check ran first and classified that shape as
`INSUFFICIENT_DATA` rather than `UNSTABLE`. Both fixed, both now tested.

## 15. Live evaluation status

**NOT RUN. No real captures exist.**

`node eval_face.mjs` with no argument prints `INSUFFICIENT DATA` and exits 0. The harness was
smoke-tested against a synthetic file to prove it runs and refuses — it correctly reported
`PROVISIONALLY_STABLE` for signals with data and `INSUFFICIENT_DATA` for constant ones, and
`VERDICT: no signal has satisfied the validation gates`. **That was a plumbing check on fabricated
input and is not a result.**

**Real data count: 0 captures. 0 of 6 protocols complete.**

## 16. Signal status

Every signal, in every region, is:

### **UNVALIDATED — 7 features × 7 regions = 49 signals**

`dDensityR`, `dDensityG`, `dDensityB`, `dChromaRG`, `dChromaGB`, `localContrast`,
`specularFraction` × `forehead`, `leftCheek`, `rightCheek`, `leftUnderEye`, `rightUnderEye`, `nose`,
`chin`.

**VALIDATED: none. PROVISIONALLY_STABLE: none. UNSTABLE: none. INSUFFICIENT_DATA: none.**

No appearance intelligence is enabled anywhere in the product, and the code path to enable it does
not exist yet.

### Findings not yet obtainable

| Question | Status |
|---|---|
| **Facial hair / shaving** (Protocol F) | **No data.** V2 predicted this may be unsolvable: `hair` covers scalp hair, and beard is typically labelled *skin* in face-parsing datasets, so a shaving cadence may inject a periodic texture signal no available mask removes. If `chin` proves unstable the correct outcome is REGION NOT RELIABLE, not a workaround |
| **Glasses / occlusion** (Protocol E) | **No data.** Mechanism implemented — the veto plus grown eye exclusions — untested against a real frame |
| **Lighting** (Protocol C) | **No data.** The gain-invariance proof holds numerically; whether it survives a real camera's tone mapping is precisely what is unmeasured |

## 17. Known limitations

1. **The pipeline has never processed a real camera frame.** The browser pane blocks camera access,
   so verification stopped at "modules load, sheet renders, panel works, validation refuses".
2. **`quality.LIMITS` is still uncalibrated**, by its own comment. Every threshold downstream
   inherits it.
3. **Derived triangulation may be incomplete** (Euler 0). Unmapped pixels are counted, not filled.
4. **256×256 mask resolution** forces erode-and-veto; good skin is discarded near boundaries.
5. **Local tone mapping is spatially varying**, so the gain-invariance proof is an approximation on
   real hardware.
6. **`localContrast` and `specularFraction` are not differenced** and are expected to be the first
   to fail. That prediction is recorded here so that failing is not later reframed as surprising.
7. **Latency and memory rose**: two vision models resident while the sheet is open. The segmenter
   loads asynchronously *after* the preview starts and its failure is non-fatal, but the real cost on
   a mid-range phone is unmeasured.
8. **`faceLab` lives in `store.settings`**, so every capture rewrites the whole settings blob. Fine
   for a few hundred validation records; it would need IndexedDB to go further.
9. **The false-change rate is a proxy** resting on an operator assertion this code cannot verify.

## 18. What must happen before any product intelligence is enabled

1. **Collect the corpus on a real device** — Protocols A (10), B (7), C (6), D (6), E (4), F (6).
2. **Run `npm run eval:face -- <backup.json>`** against an exported backup.
3. **Calibrate `quality.LIMITS`** from the real acceptance rate on sets A and L, before reading any
   stability number as final.
4. **Cull.** Delete every signal that fails its gate. Do not adjust the gate.
5. Only then build the baseline and trend layers (V1 Phases 5–8) — **over the surviving signals
   only**.
6. Only then let the LLM explain the result, text-only, through `explain.js` and `validate.js`.

**No step may be skipped, and step 4 is the one that will be tempting to skip.**
