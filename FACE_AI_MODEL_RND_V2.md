# Face Intelligence — Model R&D V2

**Supersedes the model-selection half of [`FACE_AI_MODEL_RND.md`](FACE_AI_MODEL_RND.md).** The Phase 0
repository audit in V1 still stands and is not repeated here. What changes is the constraint set: APK
and model size are no longer a primary optimisation target, and every rejection that rested on bytes
has been re-opened and re-argued on value.

Written against the working tree at `d81cc8e`. External facts fetched this session and cited. **No
production code changed, no package installed.**

---

## Headline: what actually changed, and what did not

Three decisions were re-opened. Two changed.

| Decision | V1 | V2 | Reason |
|---|---|---|---|
| Landmarks | MediaPipe FaceLandmarker | **Unchanged** | Nothing beats it on this surface even with size irrelevant — and it already emits a fixed-topology 478-vertex mesh, which is the thing a heavier model would have been bought for |
| Segmentation | Rejected (16.4 MB) | **ADOPTED** — `selfie_multiclass_256x256` | Removing the size argument leaves a real, nameable capability gap that landmarks cannot close: hair, background and clothing occlusion |
| Face parsing (SegFormer / BiSeNet) | Not evaluated | **REJECTED on merit** | Non-commercial dataset licence, redundant with landmark contours, needs a second inference runtime, and its one unique class is solvable with a boolean |

And one thing that is not a model at all turned out to be the **largest single accuracy and
repeatability gain available**, at zero bytes: **canonical UV registration** of every capture using
the mesh topology the app already receives. See §6.2.

The honest summary of the size-constraint removal: **it changed one decision, and the biggest
improvement in this document was never blocked by size in the first place.**

---

## 1. Why the previous size constraint was removed, and what that legitimately unlocks

V1 optimised against a stated APK budget: the app ships as a sideloaded Capacitor APK at ~27.8 MB,
and `selfie_multiclass` at 16,371,837 bytes was a 59% increase. That was a defensible reading of the
constraints as they stood, and it is the wrong reading of the constraints as they now stand.

The new priority order puts accuracy, repeatability, useful intelligence, change-vs-lighting
separation and region quality above size. Re-scored under those priorities, the segmentation
rejection does not survive — **not because 16 MB is now cheap, but because the capability it buys
sits at priorities 1, 2, 4 and 5.**

What removing the constraint does **not** license:

- It does not make a bigger model automatically better. Two candidates below are rejected at 89 MB
  and 340 MB **on grounds that have nothing to do with their size**.
- It does not remove *latency* or *memory* from the priority list — they are 9 and (implicitly) 7.
  A 16 MB model loaded at the wrong moment is a 2-second stall in front of a person holding their
  phone at arm's length. That is a design constraint, not a size constraint.
- It does not remove **licensing**, which turns out to be the decisive rejection criterion for the
  strongest face-parsing candidate.

---

## 2. The re-evaluated segmentation decision

### 2.1 The question, asked properly

> *Does accurate face/skin segmentation materially improve repeated personal appearance tracking,
> compared with landmarks only, Canvas region approximations, fixed geometric regions and simple
> image processing?*

Answered per sub-capability, against what the app already has. The baseline is not "nothing" — it is
[`geometry.js:146`](www/face/geometry.js:146), which already places seven boxes sized in eye-distance
units and rotated with head roll, and already refuses any box that crosses the frame edge.

| Capability | Landmarks + fixed boxes (today) | + `selfie_multiclass` | Material? |
|---|---|---|---|
| **Isolate skin from hair** | **Structurally impossible.** A box has no idea what is inside it. The forehead box sits 0.45 eye-distances above the eye midpoint and will contain fringe on some people, and on the *same* person on days their hair is down, wet, or under a cap | `face-skin` is a distinct class from `hair`; contaminated pixels are excluded | **YES — the strongest single argument.** Day-to-day hair variation is indistinguishable from a real appearance change, and it is *correlated with grooming*, which is exactly the behaviour the routine layer tries to reason about |
| **Isolate skin from background** | Partially handled — `toPixels().clipped` rejects out-of-frame boxes, and the pose gate limits yaw to 0.25 rad. But a cheek box on a narrow face at the yaw limit can still catch background | `background` is a distinct class | **Moderate.** Closes a real edge case the geometry gate only narrows |
| **Avoid facial-feature contamination** (eyes, brows, lips, nostrils) | **Already solved, exactly, for free.** The library exports `FACE_LANDMARKS_LEFT_EYE`, `_RIGHT_EYE`, `_LIPS`, `_FACE_OVAL`, `_TESSELATION`. Landmark contours are sub-pixel and per-frame | The 256×256 mask is *coarser* than the landmark contour | **NO — landmarks win.** This is the capability face parsing is usually bought for, and this app already has it |
| **Region-level measurement quality** | Boxes are a subsample. A cheek box at 0.38 eye-distances captures a fraction of the cheek | A full skin mask yields ~10–20× more valid pixels, and a robust **whole-face skin reference statistic** for within-frame normalisation | **YES, but bounded.** Sampling variance falls as 1/√N; illumination error does not fall at all. The win is real and is not the dominant error term |
| **Redness / colour appearance** | Limited by auto-white-balance, not by region definition | Same limit — segmentation does **not** touch AWB | **NO.** Anyone claiming segmentation improves colour accuracy is selling something. It improves *which pixels* you average, not *what the numbers mean* |
| **Texture / contrast** | Confounded by any non-skin pixel inside the box — a single hair strand raises local variance far more than a skin change does | Non-skin pixels removed before the variance is computed | **YES, and strongly.** Texture is the signal most destroyed by contamination, because variance is dominated by the highest-contrast content in the window |
| **Robustness across captures** | A fixed box is fixed; what falls inside it is not | Mask adapts per capture | **YES** — this is the same point as hair, generalised |
| **Baseline comparison** | Every contamination event injects a false deviation, and the k-of-n persistence rule cannot distinguish a three-day fringe from a three-day change | Contaminated pixels never enter the baseline | **YES** — contamination is *persistent*, which is precisely what defeats persistence-based noise rejection |

### 2.2 Verdict

**YES — adopt segmentation.** But the improvement is specific and should be described accurately
rather than generously:

> Segmentation improves **which pixels are measured**. It does not improve **what the measurement
> means**. It buys occlusion rejection, texture integrity and reference-statistic quality. It buys
> nothing at all against auto-white-balance, which remains the ceiling on colour work.

### 2.3 The design that neutralises its main weakness

`selfie_multiclass` is **256×256, float32, and that is the only variant that exists** — the
`float16`, `int8` and `512x512` URLs all return 404 (verified this session against Google's CDN).
Against a 1280×720 capture, one mask pixel covers roughly 5×2.8 source pixels, so mask *boundaries*
are coarse.

The fix is a division of labour that makes the coarseness irrelevant:

> **Landmarks define geometry. Segmentation only vetoes.**

The mask is **eroded inward** by ~2 mask pixels and used solely as an exclusion: a pixel is measured
only if the landmark geometry says it is in the region *and* the eroded mask says it is face-skin.
An eroded mask errs toward discarding good skin, which costs a little sample size, and never toward
admitting hair, which costs the trend's integrity. A boundary error that only ever removes pixels is
not an accuracy problem.

---

## 3. Strongest viable face detection / landmark candidates

Re-run with size irrelevant. The genuine question becomes: *would a dense 3D morphable model beat a
landmark model here?*

| Candidate | What it gives | Verdict |
|---|---|---|
| **MediaPipe FaceLandmarker** (3.6 MB, Apache 2.0, already vendored) | 478-point **fixed-topology** mesh, published tesselation, feature contour sets, 4×4 facial transformation matrix, GPU delegate, proven on this exact WebView | **SELECTED.** See below |
| InsightFace (SCRFD + 2d106det / 3d68) | Excellent detection, 106/68 points | **Reject.** Fewer points, no fixed dense topology, no maintained browser runtime, and licence terms on several released models restrict commercial use. Nothing gained |
| 3DDFA_V3 / DECA / EMOCA (3DMM fitting) | Dense 3D face with canonical UV correspondence | **Reject — because the app already has the output.** FaceLandmarker's 478 vertices *are* a fixed-topology mesh with a canonical parametrisation; adding a research-grade 3DMM fitter (PyTorch-origin, no web runtime, restrictive licences) to obtain correspondence the app is already handed is pure cost |
| TF.js `face-landmarks-detection` | Wraps the same MediaPipe model | **Reject** — strictly dominated, as in V1 |
| `human` / `face-api.js` | Bundled age/gender/emotion/identity | **Reject** — unmaintained or bundling explicit non-goals |

**The finding that matters:** with size removed, the strongest available upgrade to face geometry is
not a different model — it is **using more of the output of the model already loaded.** Today the app
reads **6 of 478 landmarks** (indices 263, 33, 1, 10, 152 and iris sets). The mesh topology, the
feature contours and the transformation matrix are all present and unused.

---

## 4. Strongest viable segmentation / face-parsing candidates

All sizes verified this session by direct request to the hosting CDN.

| Candidate | Classes | Bytes | Runtime | Licence | Verdict |
|---|---|---|---|---|---|
| **MediaPipe `selfie_multiclass_256x256`** | background, hair, body-skin, **face-skin**, clothes, accessories | **16,371,837** (float32 only — fp16/int8/512 all **404**) | `ImageSegmenter`, **already exported by the vendored bundle** (verified: `ImageSegmenter, ImageSegmenterResult` present in `www/vendor/tasks-vision.mjs`) | Apache 2.0 | **SELECTED** |
| `jonathandinu/face-parsing` (SegFormer-B5, CelebAMask-HQ, 19 classes) | skin, hair, **glasses**, eyes, brows, lips, nose, ears, neck, hat, cloth | **340,316,611** fp32 / **89,439,678** quantised | ONNX Runtime Web — **a second inference runtime** | **CelebAMask-HQ: non-commercial research and educational purposes only** | **REJECTED** — see below |
| BiSeNet face-parsing (`yakhyo/face-parsing`, `zllrunning/…`) | as above | ~50 MB class | ORT Web | Same CelebAMask-HQ restriction | **REJECTED**, same grounds |
| **EasyPortrait**-trained parsers | background, person, **face skin**, brows, eyes, lips, teeth — **no hair class, no glasses class** | model-dependent | ORT Web, no official web export | CC BY-SA 4.0 variant — **licence-clean** | **Held in reserve.** The clean-licence fallback if parsing ever becomes necessary; loses on the two classes that would justify parsing at all |
| MediaPipe `hair_segmenter` (512×512) | background, hair | **781,618** | Already-vendored `ImageSegmenter` | Apache 2.0 | **Optional complement.** Higher-resolution hair boundary than the 256×256 multiclass, at 0.8 MB. Data-gated: adopt if forehead contamination survives the multiclass mask |
| `selfie_segmenter` (person/background) | 2 | 249,537 | vendored | Apache 2.0 | **Reject** — no face/hair split, useless here |

### 4.1 Why face parsing is rejected, in priority order

**These are the reasons, and size is not among them.**

1. **Licence.** CelebAMask-HQ is *"available for non-commercial research purposes only"*, with an
   explicit agreement *"not to reproduce, duplicate, copy, sell, trade, resell or exploit for any
   commercial purposes, any portion of the images and any portion of derived data"*
   ([CelebAMask-HQ terms](https://github.com/switchablenorms/CelebAMask-HQ),
   [CelebA project page](https://mmlab.ie.cuhk.edu.hk/projects/CelebA.html)). Every strong
   off-the-shelf face parser is fine-tuned on it. For an app that may be distributed, a weights file
   whose training data forbids commercial exploitation of derived data is a legal question, not an
   engineering preference. That alone ends it.
2. **Redundancy with what the app already has.** Parsing's facial-feature classes — eyes, brows,
   lips, nose — are covered *more precisely* by landmark contours the library already exports. You
   would be adding 89–340 MB and a second runtime to obtain a coarser version of something free.
3. **Its one genuinely unique class is `glasses`,** and the honest engineering answer to spectacles
   is a per-user boolean: *"I wear glasses"* → permanently exclude the under-eye region, which is
   the only region a frame contaminates. One setting versus a second inference stack.
4. **A second runtime is a real maintenance and failure surface.** ORT Web's WebGPU backend is still
   documented as experimental ([ORT WebGPU](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)),
   and WebGPU availability inside the Android System WebView could not be confirmed from an
   authoritative source. Two model loaders, two memory lifecycles, two failure modes, on a phone
   that also holds a pose model.

Sources: [face-parsing model card](https://huggingface.co/jonathandinu/face-parsing),
[EasyPortrait](https://github.com/hukenovs/easyportrait) /
[paper](https://arxiv.org/abs/2304.13509),
[MediaPipe image segmentation guide](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter),
[Multiclass model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf).

### 4.2 Open empirical question

Whether `face-skin` in `selfie_multiclass` includes eyes and lips, or assigns them elsewhere, is not
stated unambiguously in the model card and **must be checked on real output before the mask algebra
is finalised**. It does not change the decision — landmark polygons exclude those regions either way
— but it changes whether that exclusion is belt-and-braces or load-bearing.

---

## 5. Appearance feature extraction — the biggest measurement upgrade, and it is not a model

The brief asks whether anything improves on *Canvas → RGB averages → contrast → brightness*. It does,
substantially, and the improvement is physics rather than machine learning.

### 5.1 Work in log space (optical density), not linear RGB

Tsumura et al.'s skin colour model — the basis of essentially all image-based melanin/haemoglobin
work — rests on three assumptions: colour variation in skin is driven by two pigments, their
quantities are spatially independent, and **linearity holds among the quantities and observed colour
signals in the optical density domain**, i.e. a multiplicative mixing model treated additively in log
colour space ([Tsumura et al., JOSA A 16(9) 2169](https://opg.optica.org/josaa/abstract.cfm?uri=josaa-16-9-2169);
[PubMed](https://pubmed.ncbi.nlm.nih.gov/10474894/)).

The consequence that matters here is a camera property, not a skin property:

> **A per-channel white-balance gain is a multiplication in linear RGB, which is an additive constant
> in log space. A constant added to every pixel of a frame cancels exactly in any difference between
> two regions of that frame.**

This is strictly stronger than V1's argument. V1 said ratios "cancel gain to first order". In log
space, *within-frame differences are invariant to per-channel gains exactly*, for any gain the camera
applies uniformly across the frame. Global exposure change is likewise a shift along the achromatic
direction `[1,1,1]` and is removed by the same subtraction.

What it does **not** survive: a change of *illuminant spectrum* (daylight vs tungsten changes the
relative reflectance response, not just a gain), local tone mapping, and any non-linear pipeline
stage. Those remain confounds and remain the job of the lighting-consistency gate.

### 5.2 The feature set this enables

1. **Linearise** the sRGB region samples (undo the transfer function) → optical density
   `D = −log(linear)`.
2. **Project** onto a two-dimensional pigment plane using fixed melanin and haemoglobin direction
   vectors from the literature, with the shading direction `[1,1,1]` projected out. Yields two
   per-pixel quantities: a melanin-like and a haemoglobin-like density.
3. **Reference** every regional statistic against the robust median of the *whole face-skin mask in
   the same frame* — which is exactly the statistic segmentation makes trustworthy.
4. **Separate specular from diffuse** before step 2 (dichromatic reflection model): specular
   highlights are near-neutral and near-saturated, they carry no pigment information, and they
   corrupt both colour and texture. Removing them turns shine from a *contaminant* into its own
   clean signal — the fraction and spatial spread of specular pixels within the mask.

**Naming discipline, non-negotiable.** These are *melanin-like* and *haemoglobin-like* **appearance
components of a photograph**. They are not concentrations, not medical measurements, and the
haemoglobin component must never be surfaced as "redness", "inflammation" or "irritation". The
literature itself lists diagnosis among the applications; this app explicitly declines that use.

### 5.3 Models considered and rejected for feature extraction

| Candidate | Verdict |
|---|---|
| Dermatology classifiers (ISIC-trained lesion models, etc.) | **Reject.** Intended use is diagnostic triage on dermoscopy images; deploying one on an uncontrolled selfie inside a wellness app misuses the model and manufactures a medical claim. Explicitly out of scope per the brief |
| Learned skin-quality / "beauty score" regressors | **Reject.** No published, licensable, validated model; trained against subjective labels; produces exactly the fake precision the brief forbids |
| Learned colour-constancy networks | **Held in reserve.** Would attack the actual ceiling (illuminant, not gain). No suitable maintained browser-deployable model found this session. Revisit if a licence-clean one appears |
| Multispectral / NMF pigment quantification | **Reject.** Requires multispectral capture hardware the phone does not have |

---

## 6. Architecture comparison

### 6.1 The proposed strong architecture, evaluated layer by layer

The brief's diagram is close to right. Two amendments, one addition.

```
CAMERA
  ↓
FACE LANDMARKER  (478-pt fixed-topology mesh + 4x4 transform)     ← unchanged
  ↓
CAPTURE STANDARDISATION                                            ← AMENDED: was a quality gate;
  ├─ quality gate (framing, pose, blur, exposure, balance, drift)     now ALSO a UV registration
  └─ CANONICAL UV REGISTRATION  (piecewise-affine over tesselation)   ← THE ADDITION
  ↓
SEMANTIC MASK ALGEBRA                                              ← AMENDED: segmentation vetoes,
  faceSkin(segmenter, eroded) ∩ faceOval(landmarks)                   landmarks define
  − eyes − brows − lips − nostrils (landmark polygons)
  − specular (dichromatic separation)
  ↓
PER-REGION FEATURES IN CANONICAL SPACE  (forehead, cheeks, under-eye, chin, nose)
  log-density → melanin-like / haemoglobin-like → within-frame referenced
  ↓
NORMALISATION AGAINST CAPTURE CONDITIONS   (quality weight, lighting drift, device segment)
  ↓
PERSONAL BASELINE   (quality-weighted rolling median + MAD, device-segmented)
  ↓
ROBUST CHANGE DETECTION  (deviation in MADs)
  ↓
MULTI-CHECK-IN PERSISTENCE  (k-of-n)
  ↓
VERIFIED EVIDENCE ENGINE  (evidence.js, fifth domain)
  ↓
┌───────────────────────────────┴───────────────────────────────┐
DETERMINISTIC UI — the primary result        STRONG LLM — explanation / Q&A
(always correct, offline, no key)            (text-only by default; image only on request)
```

**Why the ordering changed:** the brief places segmentation before region derivation, which implies
masks *define* regions. At 256×256 they cannot. Regions are defined by mesh geometry in canonical
space; the mask subtracts from them. That inversion is what lets a coarse model contribute
high-quality regions.

### 6.2 The addition — canonical UV registration, and why it is the largest single win

Today, "the same piece of cheek" means *an axis-aligned square, sized in eye-distance units, rotated
by roll, placed relative to the eye midpoint*. That is a good approximation and it has three failure
modes that all look like appearance change:

- **residual yaw and pitch** inside the accepted gate (±0.25 rad yaw is a *lot* of cheek sliding
  under a box);
- **expression** — a smile moves the cheek surface under a fixed box;
- **perspective** — at arm's length, a phone lens is not orthographic, so the projection of a 3D
  cheek into 2D changes with distance even after scale normalisation.

FaceLandmarker returns a **fixed-topology mesh**: vertex *i* is the same anatomical point in every
capture, and the tesselation is published by the library. Warping each capture into a fixed canonical
layout — piecewise-affine, one affine per triangle — makes region definition a **fixed mask in
canonical space**, identical across every check-in, independent of distance, roll, residual pose and
(largely) expression.

That directly serves priorities 1, 2, 4 and 5, and it costs **zero model bytes**. It also composes
with everything else: the segmentation mask, the specular mask and the region masks all live in the
same canonical frame, so mask algebra is a per-pixel `AND` rather than a coordinate problem.

**Caveat, verified:** Google's `canonical_face_model.obj` is documented as outdated and inconsistent
with the current landmark set ([mediapipe#5760](https://github.com/google-ai-edge/mediapipe/issues/5760),
[#4574](https://github.com/google/mediapipe/issues/4574)). The design must therefore **not** depend on
that file. Define the canonical frame internally — a fixed 2D reference configuration derived once
from the app's own mean landmark layout — and use the library's exported `FACE_LANDMARKS_TESSELATION`
for triangles. This removes an upstream dependency that is already known to be stale.

### 6.3 Comparison against simpler architectures — where complexity earns its keep

| Architecture | Regions | Occlusion | Colour model | Marginal value over the row above |
|---|---|---|---|---|
| **S0** — today | none (nothing measured) | — | — | baseline: zero |
| **S1** — V1 plan: landmark boxes + linear-RGB within-frame ratios | axis-aligned boxes | none | ratios | Everything, versus nothing. This is already a working feature |
| **S2** — S1 + canonical UV registration | fixed masks in canonical space | none | ratios | **Large.** Removes pose, distance, expression and perspective from region identity. **Zero bytes.** The best value-per-cost item in this document |
| **S3** — S2 + `selfie_multiclass` veto | as S2 | **hair, background, clothes** | ratios | **Large for texture, moderate for colour.** Removes the contamination class that persistence-based noise rejection cannot filter. 16.4 MB |
| **S4** — S3 + log-density pigment separation + specular removal | as S3 | as S3 | **exact invariance to per-channel gain; shine as its own clean signal** | **Large for colour, moderate for texture.** Zero bytes — it is arithmetic |
| **S5** — S4 + face parsing (SegFormer-B5) | as S4 | + glasses, hat, earrings | as S4 | **Small.** One class the boolean already handles, at +89–340 MB, a second runtime, and a non-commercial licence. **Rejected** |
| **S6** — S5 + multimodal model on every check-in | — | — | — | **Negative.** Adds output variance to a measurement pipeline whose entire purpose is repeatability. **Rejected** |

**Recommended: S4.** The two large wins that are *not* models (S2, S4) and the one model that closes
a capability landmarks structurally cannot (S3).

---

## 7. Benchmark design — and its blocked status

### 7.1 Status: **EMPIRICAL VALIDATION IS BLOCKED. No results are reported.**

Verified this session: the repository contains **no face captures of any kind**. The only images are
Android launcher and splash assets under `android/app/src/main/res/`. `test_face.mjs` builds
*synthetic* landmark arrays and constant-value luminance buffers — sufficient for invariance and
refusal tests, and useless for comparing region strategies on real skin.

**No benchmark numbers appear in this document, and none should be fabricated.** Every model choice
below is argued from mechanism, licence, published capability and measured file facts. The
comparative claims in §2 and §6 are *predictions*, and the benchmark exists to falsify them.

### 7.2 The benchmark to run once captures exist

**Corpus** (one consenting subject — this is a personal-baseline feature, so a personal corpus is the
right corpus):

| Set | Contents | Tests |
|---|---|---|
| **R** — repeatability | 10 captures in 60 seconds, same room, same light, subject re-frames between each | False-change floor |
| **L** — lighting | Same subject, same day, 5 conditions: window daylight, ceiling LED, warm lamp, side-lit, mixed | Lighting sensitivity |
| **P** — pose | Same conditions, yaw/pitch/roll sampled across the accepted range | Region stability vs pose |
| **H** — hair/occlusion | Hair down / hair up / cap / wet; and with and without glasses | Mask contamination |
| **C** — controlled change | A known, reversible, non-medical marker applied to one cheek region (e.g. a small amount of tinted moisturiser), photographed before / applied / removed | Sensitivity — can it detect a change it *should* detect? |
| **T** — longitudinal | 30 daily captures, unscripted | End-to-end false-positive rate |

**Arms:** (1) landmark boxes, linear RGB — the V1 design; (2) + canonical UV registration; (3) +
segmentation veto; (4) + log-density pigment separation and specular removal.

**Metrics:**

| Metric | Definition | Target |
|---|---|---|
| Region stability | Jaccard overlap of the region's source-pixel set across set **P**, per arm | Arm 2 ≫ Arm 1 |
| Mask contamination | Fraction of measured pixels that are not skin, hand-labelled on a 20-image subsample of **H** | Arm 3 ≈ 0; Arm 1 materially worse on forehead |
| Repeatability floor | SD of each signal across set **R**, in that signal's own MAD units | **< 0.5 MAD.** A signal above this cannot support a 2-MAD change threshold and is deleted |
| Lighting sensitivity | Signal range across set **L** ÷ repeatability SD | **< 2.0.** Above this, lighting dominates and the signal is deleted |
| False change rate | Fraction of set **T** days flagged `CHANGED` with no reported change | **< 5%** |
| Detection | Fraction of set **C** applications correctly flagged, and correctly *unflagged* on removal | Reported honestly; a signal that cannot detect a deliberate change is decorative |

**The gate:** a signal ships only if repeatability floor **< 0.5 MAD** and lighting sensitivity
**< 2.0** on real captures. **A signal that fails is deleted, not tuned.** Tuning a threshold until a
signal passes is how a measurement becomes a horoscope.

**This also calibrates `LIMITS`**, which its own comment concedes was set from what the maths implies
rather than from measurement ([quality.js:19](www/face/quality.js:19)).

---

## 8. Multimodal model decision, evaluated as four separate problems

The brief is right that these are not one problem. They have different answers.

### A. Automated analysis of every check-in — **NO**

Disqualifying, independent of model quality:

- **Repeatability.** Generation is stochastic. The same face on two days yields two differently
  calibrated descriptions, and a trend built on that measures the sampler. This is priority 2, and it
  is not fixable by a better model.
- **Unverifiable by construction.** `validate.js` checks claims against numbers in the evidence
  packet. Claims derived from pixels the model saw and the app did not have nothing to check against.
- **Version drift.** Providers replace model versions. A baseline built across a silent version
  change has a discontinuity nobody logged — fatal for a feature whose only job is comparing today
  with months ago.
- **Privacy.** Face images to a tier whose terms permit human review (§10).

### B. Personal change detection — **NO**, and more emphatically

Change detection requires that measurement error be *smaller than the change*, and *stable over
months*. A generative model offers neither guarantee, and cannot be made to. This is the single
strongest technical argument in the whole document and it is unaffected by model capability.

### C. User-initiated question about their own face — **OPTIONAL, off by default, consent-gated**

This is the one case with genuine incremental value. A person looking at something specific, asking
once, wants a description of *this photograph* — not a tracked metric. A frontier multimodal model
is genuinely good at that, and the failure modes above (repeatability, version drift, baseline
contamination) do not apply because **the answer is never stored and never enters the baseline.**

### D. Natural-language explanation of verified evidence — **YES, and no image is needed**

The evidence packet is text. Sending an image alongside it adds nothing to the explanation and
imports every risk from A. **Text-only.** This is the V1 design and it is unchanged.

### 8.1 Model recommendation for C and D

Benchmarks among frontier multimodal models are saturated on general image understanding, and the
comparison sources available this session are secondary and inconsistent about version numbers. That
makes benchmark-chasing the wrong basis for this decision. The decisive factors are architectural:

- The user already has **one** key, for **Gemini**. A second provider means a second key, a second
  onboarding step, and a second failure mode, for an optional feature.
- `chat.js` is the single provider seam and swapping providers is a one-file change if that ever
  changes.

**Recommendation: Gemini `gemini-3.7-flash` (or `3.6-flash`) for the optional vision path** — the
vision-capable tier above the `3.5-flash-lite` used for text, at $0.75 / $3.75 per 1M through
2026-12-31 ([Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)). An aligned 384×384
crop is 258 tokens ([token counting](https://ai.google.dev/gemini-api/docs/tokens)) — about
**$0.0002** per question. **Text explanation stays on `gemini-3.5-flash-lite`.**

Cost is not a constraint on either path and I will not pretend otherwise. Repeatability and privacy
are.

---

## 9. Signal register

Every signal, with all six required attributes. **No composite score exists anywhere in this design.**

| # | Signal | How calculated | Model contribution | Confounds | Measured / inferred | Min evidence | Compared over time |
|---:|---|---|---|---|---|---|---|
| 1 | Capture confidence | Weighted minimum over 6 quality components (`assess`) | Landmarker (geometry); none for pixels | Un-calibrated thresholds until benchmark | **Measured** (of the photo) | 1 capture | Not a trend — a gate |
| 2 | Region stability | Jaccard of canonical-space source pixels vs the person's own median capture | Landmarker mesh + UV registration | Landmark jitter, expression | **Measured** | 2 captures | Reported as a capture-quality diagnostic |
| 3 | Lighting comparability | `lightingMatch` drift in the person's own SDs | none | Genuine permanent room change reads as drift | **Measured** | 4 prior captures | Gates all comparisons |
| 4 | Skin-mask coverage | valid measured pixels ÷ region area in canonical space | **Segmenter** + landmark polygons | Mask coarseness; erosion is deliberately conservative | **Measured** | 1 capture | Per-region availability flag |
| 5 | Shine (specular fraction) | Fraction of masked pixels classified specular by dichromatic separation, per region | Segmenter (mask); arithmetic | Light-source direction and hardness | **Measured** | 1 capture; baseline 7 | MAD deviation |
| 6 | Surface variation | Local SD of diffuse log-luminance in canonical space, specular and non-skin pixels excluded | Segmenter (mask); arithmetic | **Blur (hard gate)**, focus distance, residual hair | **Measured** | 1 capture; baseline 7 | MAD deviation |
| 7 | Melanin-like component | Log-density projection on the melanin direction, referenced to the whole-face-skin median in the same frame | Segmenter (reference statistic); arithmetic | **Illuminant spectrum change**, local tone mapping, makeup | **Inferred** — a projection under a model of skin optics | 1 capture; baseline 7 | MAD deviation |
| 8 | Haemoglobin-like component | Same, on the haemoglobin direction. **Never surfaced as "redness"** | Segmenter; arithmetic | As #7, plus transient flush from heat, exercise, alcohol | **Inferred** | 1 capture; baseline 7 | MAD deviation |
| 9 | Under-eye relative luminance | Under-eye diffuse density minus same-frame cheek density | Segmenter; arithmetic | Spectacle shadow (→ per-user glasses exclusion), downward lighting | **Measured** (a contrast) | baseline 7 | MAD deviation |
| 10 | Left/right asymmetry | Same-region contrast across the midline, **gated on illumination balance** | Segmenter; arithmetic | Lighting direction — the dominant confound | **Measured** | baseline 7 | MAD deviation, gated |
| 11 | Routine consistency | Days logged ÷ days elapsed | none | **A missing log is not a missing use** | **Measured** (of the log) | 7 days | Fraction with window |
| 12 | Co-occurrence | `skin.association()` median split over a face signal | none | Confounding by season, diet, sleep — **never causal** | **Measured association** | 4 days per side | Its own comparison |

**Not built, and not to be built:** any 0–100 score, absolute colour or tone, pore or wrinkle
metrics, blemish counts, hydration, age, identity, or any statement about a condition, severity or
health.

**Reporting shape** — exactly as the brief specifies, never a score:

> Compared with your baseline of 14 captures:
> · cheek melanin-like component: **1.8 MAD below** your range, 3 of the last 5 captures
> · under-eye contrast: **within** your recent range
> · surface variation: **unavailable** — the last three captures were too soft to measure
> · capture conditions: **comparable** (lighting drift 0.6 SD)

---

## 10. Privacy and consent architecture

### 10.1 What changes, and what does not

**Unchanged, and non-negotiable:**

- No image is persisted, ever, by default — not to `localStorage`, not to IndexedDB, not to a file.
- No image is transmitted on any automatic path.
- Pixels exist only in a transient offscreen canvas, never attached to the DOM, cleared after each
  capture.
- Stored per check-in: ~12 scalars, a quality verdict, a device fingerprint. Region statistics and
  variances cannot reconstruct a face.
- Enforced by a test asserting nothing under `www/face/` imports `chat.js`.
- An independent "delete all face data" control that removes only the face key.

**What the V2 stack adds to the local surface:** a second on-device model and a UV-warped canonical
face image in memory during analysis. Both are transient, both are local, neither changes what leaves
the device. The segmentation mask is discarded with the frame.

### 10.2 Consent flow for the optional image path (case C only)

Every one of these must hold, and each is a hard requirement:

| Requirement | Detail |
|---|---|
| Trigger | Explicit, per-instance, user-initiated ("Ask about this photo"). Never automatic, never part of a check-in |
| Default | **Off.** A setting the user turns on, plus a per-use confirmation showing exactly what will be sent |
| Tier gate | **Blocked on a free-tier key.** Google's terms: unpaid — *"Google uses the content you submit… to provide, improve, and develop Google products"*, *"human reviewers may read, annotate, and process your API input and output"*, and *"Do not submit sensitive, confidential, or personal information to the Unpaid Services"*; paid — *"Google doesn't use your prompts…or responses to improve our products"* ([Gemini API terms](https://ai.google.dev/gemini-api/terms)). The app cannot detect tier, so require an explicit billing-enabled acknowledgement and state plainly what it means |
| Payload | The aligned, cropped face region **only** — never the full frame with its background — plus the current evidence packet, so the model reasons about the photo *in the context of verified history* rather than freelancing |
| Persistence | **Never.** Constructed, sent, released. Not stored before, during or after |
| Classification | Result lands in `interpretation`. **Never** `observed`, never stored, never entering a baseline, never influencing a trend |
| Hallucination handling | Any number in the answer is checked against the evidence packet by `validate.checkAnswer()`. Unsupported → one retry with feedback → **discard** and show the deterministic result. Claims about the *image* that carry no number cannot be validated and are therefore rendered under an explicit "this is a description of one photo, not a measurement" heading |
| Medical boundary | System prompt forbids naming any condition, grading severity, or saying healthy/normal. `SEE_SOMEONE` shown alongside every response ([skin.js:241](www/skin.js:241)) |
| Scope | One question, one answer. No history, no series, no comparison |

**Recommendation: do not build the image path in v1.** Ship S4 and the text explanation first. If
people then ask for it, it is a small, well-fenced addition to a system whose deterministic half is
already trustworthy.

---

## 11. Known limitations

1. **Auto-white-balance remains the ceiling on colour.** Log-space differencing removes per-channel
   *gain* exactly; it does not remove a change of illuminant *spectrum*. The lighting gate, not the
   maths, is what protects colour signals — and the lighting gate is un-calibrated.
2. **`LIMITS` has never met a real photograph.** Everything downstream inherits these thresholds.
3. **Empirical validation is blocked** (§7.1). Every comparative claim here is a prediction.
4. **Facial hair is probably not solved.** `selfie_multiclass`'s `hair` class covers scalp hair;
   whether it reliably covers beard growth is unverified, and in the widely-used face-parsing datasets
   beard is typically labelled *skin*. A subject who shaves on a cadence may inject a periodic texture
   signal that no available mask removes. **This may force the chin and jaw regions to be dropped
   entirely for some users** — an honest outcome, decided by the benchmark.
5. **256×256 mask resolution** forces the erode-and-veto design. It works, at the cost of discarding
   good skin near boundaries.
6. **Latency and memory rise.** Two vision models resident while the sheet is open (3.6 MB + 16.4 MB
   plus shared WASM). The segmenter must be loaded **on sheet open, not at capture**, or it becomes a
   ~1–2 s stall at the worst moment. Must be measured on a mid-range device; the pose model is already
   released before the face sheet opens.
7. **Melanin/haemoglobin projections are inferred**, under a two-pigment model with fixed direction
   vectors that were not calibrated for this camera or this person.
8. **Makeup, moisturiser and sunscreen** change surface optics directly. Applying sunscreen is a
   logged routine habit *and* a measurable appearance change, which is a confound sitting exactly
   where the routine layer draws its associations.
9. **A missing routine log never means non-use** — structurally enforced in the state machine, but it
   permanently caps how strong any routine claim can be.
10. **These are measurements of photographs, not of skin**, valid for one person, one device, gated
    capture conditions, compared only against themselves.

---

## 12. Implementation phases

| Phase | Deliverable | Gate |
|---:|---|---|
| **3** | `face/canonical.js` — UV registration: canonical layout, tesselation triangles, piecewise-affine warp. Pure, tested on synthetic meshes | Region stability invariant to synthetic pose/scale change |
| **3.5** | **Capture the benchmark corpus (§7.2).** Blocking for everything below | Sets R, L, P, H, C exist |
| **4** | `face/features.js` — linearise, log-density, pigment projection, specular separation, per-region statistics. Pure | Gain-invariance test exact to 1e-9; arms 1–2 benchmarked |
| **5** | `vendor.mjs` + `face/segment.js` — `selfie_multiclass`, eroded veto, mask algebra | Arm 3 benchmarked: contamination ≈ 0 on set H |
| **5.5** | **Signal cull.** Delete every signal failing the §7.2 gate. Calibrate `LIMITS` from sets R and L | Surviving signal list is fixed and justified by measurement |
| **6** | Capture event + `store.faceCheckins` + privacy boundary | Import test: `www/face/` never imports `chat.js` |
| **7** | `face/baseline.js` — quality-weighted median/MAD, device segments, explicit states | Adversarial cases (V1 Phase 10) |
| **8** | `face/trends.js` — MAD deviation, k-of-n persistence | False-change rate < 5% on set T |
| **9** | Routine schema (V1 §7) + `skin.association()` reuse for face signals | Co-occurrence never renders causally |
| **10** | `evidence.faceEvidence()` — fifth domain in `evidence.js` | Absent-vs-zero test |
| **11** | Deterministic results UI. No score anywhere | Copy review against §9 language rules |
| **12** | LLM explanation via `explain.js` + `eval_face.mjs` | Live eval L1–L5 |
| **13** | *(Optional, deferred)* image Q&A path with the §10.2 consent flow | Only if asked for |

Phases 3–8 carry the risk and the tests. **Phase 3.5 is blocking and cannot be worked around** — it
is the difference between a measurement system and a plausible-looking one.

---

# FINAL STACK

**Face detection/landmarks:**
MediaPipe **FaceLandmarker** (`face_landmarker.task`, float16, 3,758,596 B, Apache 2.0, already
vendored) — GPU delegate, `numFaces: 1`, blendshapes off, `outputFacialTransformationMatrixes` on.
Used far more fully than today: the 478-vertex fixed topology, the exported tesselation and feature
contour sets, and the transformation matrix — not the 6 landmarks currently read.

**Face parsing/segmentation:**
MediaPipe **`selfie_multiclass_256x256`** via the already-exported `ImageSegmenter`
(16,371,837 B, float32 — the only variant published; Apache 2.0). Role: **eroded exclusion veto
only** — `face-skin` ∧ landmark region ∧ ¬feature-polygons ∧ ¬specular. Never used to define region
boundaries.
*Rejected:* SegFormer-B5 / BiSeNet face parsing — non-commercial CelebAMask-HQ licence, redundant with
landmark contours, second inference runtime, one unique class (glasses) solved by a per-user boolean.
*Reserved:* `hair_segmenter` (781,618 B) if forehead contamination survives the multiclass mask;
EasyPortrait-trained parsers as the licence-clean fallback if parsing ever becomes necessary.

**Visual feature extraction:**
**Canonical UV registration** (piecewise-affine over the mesh tesselation, internally-defined
canonical layout — *not* Google's outdated `canonical_face_model.obj`), then **log-space optical
density with melanin-like / haemoglobin-like projection and dichromatic specular separation**,
referenced to the whole-face-skin median in the same frame. Plain JavaScript over Canvas
`getImageData`. **No model, no library, no WebGPU.**

**Personal baseline:**
Quality-weighted **rolling median + MAD×1.4826**. 28-day window, 14-day recency half-life, ≥7
accepted captures, device-segmented, outliers down-weighted and never deleted. Explicit states:
`NO_BASELINE`, `BUILDING_BASELINE`, `BASELINE_READY`, `INSUFFICIENT_COMPARABILITY`,
`SIGNAL_UNAVAILABLE`.

**Trend detection:**
Robust deviation `(x − median) / (1.4826 × MAD)`, reported **in MADs, never as a percentage**, with a
**k-of-n persistence rule** (3 of the last 5 comparable captures beyond 2 MADs). Always sorted by
capture timestamp. States: `STABLE_WITHIN_BAND` (only from `BASELINE_READY`), `CHANGED_HIGHER`,
`CHANGED_LOWER`, plus the baseline states above.

**LLM:**
**Gemini `gemini-3.5-flash-lite`** ($0.30 / $2.50 per 1M) through the existing `chat.js` seam.
Structured output (`observed` / `meaning` / `suggestion`), **evidence packet only — no pixels, no
chat history, no profile**, gated by `validate.js`, one retry, deterministic template fallback. No
provider migration.

**Optional multimodal vision:**
**Gemini `gemini-3.7-flash`** ($0.75 / $3.75 per 1M) — **OPTIONAL, default OFF, not in v1.**
User-initiated single questions only. Never on a check-in, never on a free-tier key, image never
persisted, answer never stored and never entering a baseline. **NONE on every automatic path.**

**Why this stack is better:**

It is better in four specific, mechanical ways, and it is worth being precise about which layer earns
which improvement — because two of the four cost nothing, and the one expensive model earns exactly
one of them.

1. **Region identity becomes anatomical instead of geometric.** Today "cheek" is an axis-aligned box
   placed relative to the eye midpoint; residual yaw inside the accepted gate, a smile, or a change in
   arm's-length distance all slide different skin under that box, and every one of those reads as
   appearance change. Canonical UV registration over the fixed 478-vertex topology makes "cheek" the
   same set of mesh triangles in every capture, forever. **This is the largest accuracy and
   repeatability gain in the document and it costs zero model bytes** — it was never blocked by the
   size constraint that was just lifted.

2. **Contamination is removed rather than averaged in.** A box cannot know what is inside it. Fringe
   on the forehead, background at the jaw, a hair across a cheek — each injects a deviation that is
   *persistent* for as long as the hairstyle is, which is precisely the failure mode a k-of-n
   persistence rule cannot filter out, because it looks exactly like a real multi-day change.
   `selfie_multiclass` is the only component here that closes a gap landmarks are structurally
   incapable of closing, and that is the entire justification for its 16.4 MB. Its effect is largest
   on texture, where a single high-contrast non-skin pixel dominates a local variance.

3. **Colour comparison gains an exact invariance instead of an approximate one.** V1 argued that
   within-frame ratios cancel camera gain "to first order". In log-density space the statement is
   stronger and provable: a per-channel white-balance gain is an additive constant across the frame,
   so it cancels *exactly* in any within-frame difference, and global exposure change is a shift along
   the achromatic axis removed by the same subtraction. Projecting onto melanin-like and
   haemoglobin-like directions then separates the two things that actually vary in skin appearance
   from the shading that varies with everything else. This is arithmetic — again, zero bytes — and it
   attacks the dominant error term that no segmentation model touches.

4. **The refusals get sharper, which is the actual product.** Better masks and better invariance are
   only worth having because they make the *negative* answers trustworthy: `INSUFFICIENT_COMPARABILITY`
   when the light does not match, `SIGNAL_UNAVAILABLE` when a region was occluded, `BUILDING_BASELINE`
   when there is not yet enough history, and a change reported only when it survives k-of-n
   persistence in MAD units. No model of any size produces those, because a model asked about a face
   answers about the face.

And what it deliberately does not do: it does not put a generative model anywhere in the measurement
path. Every layer that produces a number is deterministic, offline, and testable without a key. The
LLM explains that output and can be deleted without the loss of a single fact — which is the same
conclusion V1 reached, and the removal of the size constraint did nothing to weaken it.

**The one caveat that governs all four claims: they are predictions.** No arm of §7 has been run,
because no face captures exist in this repository. Phase 3.5 is the gate, and any signal that fails
its repeatability or lighting thresholds on real captures is deleted, not tuned.
