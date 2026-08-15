# Face Protocol Collection — Phase 3.6

Builds the guided collection mode on top of the Phase 3.5 measurement pipeline
([`FACE_EMPIRICAL_VALIDATION_REPORT.md`](FACE_EMPIRICAL_VALIDATION_REPORT.md)), under the
architecture in [`FACE_AI_MODEL_RND_V2.md`](FACE_AI_MODEL_RND_V2.md).

**Status: collection tooling is implemented and fixture-tested. Zero real captures exist. Zero
protocols are complete. No signal is product-ready and no appearance intelligence is enabled.**

---

## 1. Repository audit

Verified against the working tree before any change; the Phase 3.5 report was accurate and nothing
had drifted.

| Checked | Finding |
|---|---|
| Capture pipeline | `pipeline.analyse()` unchanged; `record.build()` took a bare `protocol` string and nothing else |
| Persistence | One settings key, `faceLab`, holding `{consent, reference, captures}`; capped at 300 |
| Backup / export | `store.exportAll()` serialises the whole store, so `faceLab` already rode along |
| `eval_face.mjs` | Read `data.settings.faceLab.captures ?? data.captures`; counted protocols by a bare `>= minCaptures` |
| Validation state machine | 6 states, 4 gates, `series()` filtered on `protocol` and `accepted` only |
| Accepted vs rejected | Already both stored, `accepted: false` on rejects — no change needed |
| Face UI | One `face-lab` panel, toggled by a body button; protocol was a free-floating `<select>` that tagged nothing |
| Test conventions | Plain `node` files, `assert/strict`, one `console.log` summary per file, chained in `npm test` |
| Package scripts | `test`, `serve`, `vendor`, `topology`, `eval:face` |

**Two findings changed the implementation:**

1. **[README.md:124](README.md:124)** — *"a Capacitor WebView with no `DownloadListener` drops blob
   downloads silently, so **Copy** is there as the path that works everywhere."* The export and
   image buttons I first wrote used exactly that mechanism and **would have silently done nothing on
   the actual target device.** Both were rebuilt around the repo's existing File-plus-Copy pattern.
2. **The existing developer entry point convention** is a small labelled header button
   (`btn-devcheck`, `style="font-size:11px"`, `title="Developer: …"`) on the Progress sheet — not a
   settings flag. Phase 3.6 mirrors it rather than inventing a second configuration system.

## 2. Files changed

**New:**

| File | Purpose |
|---|---|
| `www/face/protocol.js` | The collection domain: specs, conditions, counting rules, progress, next step |
| `test_face_protocol.mjs` | 24 checks |
| `FACE_PROTOCOL_COLLECTION_REPORT.md` | This document |

**Edited:**

| File | Change |
|---|---|
| `www/face/record.js` | `session`, `repetition`, `condition` on the record; `notApplicable`, session lifecycle, `validationExport()` |
| `www/face/validation.js` | `oncePerDay()` applied to Protocol B's series; `geometryRatio` / `facialHairRatio` reported; `occlusionBehaviour()`; imports `dayKey` |
| `www/face/checkin.js` | Captures only inside a session; guided panel; File+Copy export; image preview |
| `www/index.html` | Face sheet only — header entry point, restructured validation panel |
| `www/sw.js` | `face/protocol.js` added to `SHELL` |
| `eval_face.mjs` | Protocol collection status, protocol readings, occlusion section, new export format |
| `package.json` | `test_face_protocol.mjs` added to the chain |

## 3. Unrelated files untouched

Present in the working tree throughout, **not mine, not reverted, not staged**:

- `www/index.html` — colour-palette rewrite in the `:root` block. Every edit here was surgical
  against the face-sheet markup.
- `www/app.js` — instrument-reading meta labels in `showToday()` / `showProgress()`. **Not touched
  at all this phase.**
- `.gitignore` (`graft/` entry) and `.ignore` — graft tooling.

## 4–9. The six protocols

All six live in `protocol.SPEC`, each carrying a purpose, an instruction, its condition list, and
its own counting rule.

### Protocol A — same-session repeatability
10 accepted captures, one condition (`baseline`), one sitting. **A rejected capture does not
increment the count** and is reported beside it (`accepted 8 · rejected 3 · 2 remaining`).

### Protocol B — multi-day comparability
7 accepted captures, **one per calendar day**, and this is the phase's most consequential rule.

B supplies `spread`, the denominator the same-session `noise` is divided by. Seven B captures ten
minutes apart would make `spread` measure the same thing `noise` does, drive the ratio to 1, and
fail every signal for a reason that has nothing to do with any signal. So:

- `protocol.dayLimited()` counts the **first accepted capture of each day** and no more;
- `validation.oncePerDay()` applies the same rule to the **series that feeds the gate**, so the fix
  is in the measurement, not just the progress bar;
- extra same-day captures are still stored — they are real data — but advance nothing;
- when today is already recorded the UI **says "come back tomorrow"** and disables the button rather
  than offering one that silently does nothing.

Phase 3.5 specified `minCaptures: 7` but no spacing. The distinct-day requirement is **added here**
and derived from what `spread` has to mean.

### Protocol C — lighting stress
6 accepted, ≥4 of `baseline · brighter · dimmer · side-lit · warm · cool`. Labels only — the device
stack exposes no lux or colour-temperature API, and a label pretending to be a measurement would be
worse than none. Marked in the report as stress conditions, never as comparable baseline captures.

### Protocol D — geometry stress
6 accepted, ≥4 of `baseline · closer · farther · roll-left · roll-right · yaw-left · yaw-right ·
expression`. The instruction says explicitly that a rejection means the tester moved too far and
that this is the gate working.

### Protocol E — occlusion stress
4 **attempted** — the one protocol counting attempts rather than acceptances, because a rejection
*is* the result. Conditions: `baseline · glasses · hair-forehead · hair-cheek · hand`.

`validation.occlusionBehaviour()` scores it in its own vocabulary, since "does it hold still" is the
wrong question here:

| Verdict | Meaning |
|---|---|
| `refused_by_gate` | every attempt rejected outright — **correct** |
| `excluded_correctly` | accepted, and the obstructed region went unavailable — **correct** |
| `measured_through_occlusion` | accepted, and the obstructed region measured anyway — **the failure** |
| `no_baseline` / `no_data` | not enough to say |

`hand` deliberately maps to no region: a hand can land anywhere, so there is nothing to hold to
account.

### Protocol F — facial hair
6 accepted, ≥2 of `baseline · stubble · beard · freshly-shaved`. The only protocol marked
`optional`, and the only one whose "Not applicable to me" checkbox is shown.

**`NOT_APPLICABLE` is a first-class state** and a test asserts it never becomes `COMPLETE`,
`COLLECTING`, or `INSUFFICIENT_DATA`.

## 10. Metadata schema

Extends the existing record; it does not replace it.

```
{ at, protocol, session, repetition, condition,      ← new in 3.6
  accepted, meanFaceLuma,
  quality: { accepted, comparable, failures[], warnings[], checks{} },
  device, sampling, versions{}, regions{} }
```

- `session` is the session start timestamp (`"A-2026-08-15T18:22:04.113Z"`) — readable in an export,
  so "which sitting was this?" is answerable by looking.
- `repetition` is the repetition the tester was *asked* for, so a rejection does not consume one.
- All three are **omitted entirely when absent**, never null.
- **There is no `inclusion` field.** `protocol` and `accepted` already decide whether a capture
  counts; a third field restating them is a third field that can disagree with them.
- Pipeline and model versions continue to ride on every record via the existing `versions()`.

## 11. Accepted vs rejected

| | Accepted | Rejected |
|---|---|---|
| Stored | yes | yes |
| Advances the target | yes | **no** (except E, which counts attempts) |
| Enters stability statistics | yes | **never** — `validation.series()` filters on `accepted` |
| Shown in the dashboard | yes | yes, as a separate count |

A gate refusing most real attempts is itself a finding, and would be invisible if only successes
were kept.

## 12–13. Privacy and raw images

**Unchanged and enforced by test:** no file under `www/face/` may import `chat.js`, call `fetch`,
open a socket, or call `toDataURL`. Verified again this phase — the only occurrence of the string
"chat.js" under `www/face/` is a comment.

**No image is written to app storage, so no export can contain one.** Verified live in the browser:
both the validation export and the full `store.exportAll()` backup contain no `data:image`, no
base64, and no `.png`.

**Raw image retention — the honest description of what actually happens:**

- Default off. A consent checkbox plus an explicit per-capture button press.
- The button **shows** the capture as an `<img>` rather than only downloading it, because
  [README.md:124](README.md:124) records that blob downloads are dropped silently in the Capacitor
  WebView. A download is still attempted for desktop; the note tells the tester to long-press the
  image if nothing arrives, which uses Android's own save mechanism.
- The image is therefore handed to the **device**, not stored by the app. The object URL is revoked
  when the sheet closes or the data is deleted.
- **Precise claim:** the *analysis* canvas is never attached to the document. The consent-gated
  preview is a separate element that exists only after an explicit press.
- Nothing is uploaded. Nothing is sent to Gemini.

**Deletion** removes captures, reference, protocol progress, consent, and revokes any preview —
`faceLab` only, leaving training, food, sleep and mood untouched.

## 14. Device testing workflow

The project ships as a **Capacitor 6 Android APK**; `android/` is a full Gradle project and CI has a
**Build APK** workflow publishing to GitHub releases.

```bash
npm ci && npm run vendor && npm test
npx cap sync android
cd android && ./gradlew assembleDebug
```

The APK lands at `android/app/build/outputs/apk/debug/app-debug.apk`. Or take the CI build from
[releases/latest](https://github.com/GreyL11/GYM-PT-AI/releases/latest).

Why the APK and not a browser: a Capacitor WebView is a secure context, so the front camera is an
ordinary Android permission (README, "Run it in a browser instead").

**This workflow was NOT executed. No APK was built and no device was used in this phase.**

## 15. Export format

```json
{ "kind": "face-validation-export", "v": 1, "at": "...",
  "notApplicable": { "F": true },
  "captures": [ ... ] }
```

Deliberately **excludes the canonical reference layout** — 468 coordinates describing the shape of a
specific face, useless to the evaluation, and not something to put in a file meant to be moved
around.

`eval_face.mjs` accepts three shapes, in order: this export, a full app backup
(`data.settings.faceLab`), and a bare capture array. **The Phase 3.5 backup path still works** — a
corpus collected before this phase must not become unreadable because a nicer format arrived.

## 16. Evaluation integration

`eval_face.mjs` now prints, in this order:

1. **PROTOCOL COLLECTION STATUS** — *"photographs taken — NOT a validation result"*, per protocol,
   with rejections, missing conditions, and calendar-day spread for B.
2. **PROTOCOL READINGS** — `EVIDENCE COMPLETE` / `INSUFFICIENT DATA` / `NOT_APPLICABLE`, followed by
   an explicit note that supplying evidence is not passing validation.
3. **REGION AVAILABILITY**.
4. **SIGNAL VALIDATION** — the unchanged Phase 3.5 states and gates.
5. **OCCLUSION BEHAVIOUR** — protocol E in its own vocabulary.

New columns `geom/noise` and `hair/noise` are **reported and not gated**, with the reason printed in
the output: the Phase 3.5 gates were fixed before any capture existed, and adding a gate now —
knowing what the corpus will contain — would be moving the goalposts.

## 17–18. Automated tests

```
npm test  →  exit 0
17 reporting files, 333 assertions   (was 309; +24 from test_face_protocol.mjs)
```

Covering: protocol creation and metadata persistence; accepted counting; **rejected does not
increment**; rejected excluded from stability but present in statistics; completion logic; condition
coverage; `NOT_APPLICABLE` handling; session separation; out-of-order timestamps; export
preservation; backward compatibility with 3.5 captures; no raw image in any export; and the
vocabulary-collision guard asserting collection and signal states share no word.

No test needs an API key, network, camera, Gemini, or live segmentation inference.

**The most important test in the file:**

> `COMPLETING EVERY PROTOCOL VALIDATES NOTHING` — builds a corpus that turns every protocol
> `COMPLETE` using pure-noise feature values, and asserts not one signal reaches `VALIDATED`.
> A companion test asserts 200 identical fixtures also validate nothing, because "we have a lot of
> data now" is the argument that would otherwise erode this.

## 19. Real device test status

**NOT TESTED ON DEVICE.** No APK was built; no phone was used. The browser pane blocks camera
access, so the capture path has still never processed a real camera frame.

What *was* verified in a real browser: modules load with no console errors, the panel renders, the
dashboard reports `NOT_STARTED` for all six, protocol switching rebuilds the condition list,
`NOT_APPLICABLE` sets and displays, sessions start/persist/clear, the export produces the expected
shape with no image data, the Copy fallback engages when the clipboard is unavailable, and the image
button refuses without consent.

## 20. Real capture status

**0 real captures. 0 of 6 protocols complete. 0 signals product-ready.**

The `VALIDATED` rows visible in the harness smoke test came from fixture data constructed to pass —
included to prove the gates *can* pass rather than being rigged to always fail. **That is not a
result.**

## 21. Known limitations

1. **Never run on a device.** Camera, permissions, segmenter timing on real hardware, and the
   long-press image save are all unexercised.
2. **The whole quality gate is still uncalibrated** (`quality.LIMITS`), so acceptance rates on real
   captures are unknown. Protocol A doubles as the calibration run.
3. **Protocol B takes at least 7 days**, by construction.
4. **Condition labels are what the tester was asked for, not what the room did.** Nothing verifies
   the lamp actually changed.
5. **`assumedUnchanged` is an assertion**, not a fact — the false-change proxy rests on it.
6. **Auto-capture on steadiness**, not a shutter button: better science (no hand movement at the
   moment of capture) but it means a session records whatever is in front of the camera. Ending the
   session is the stop control.
7. **No manual per-capture exclusion**, deliberately — it would be a cherry-picking tool.
8. **`faceLab` lives in `store.settings`**, so every capture rewrites the settings blob.
9. **Geometry and facial-hair ratios are reported but ungated**, so D and F cannot yet fail anything.

## 22. How to collect the corpus

**Build and install:**

```bash
npm ci && npm run vendor && npm test && npx cap sync android
```

Then `cd android && ./gradlew assembleDebug`, or take the CI APK from releases. Install, open the
app, grant the camera permission once.

**Then, per protocol:** open **Face** → tap **Validate** (top right) → pick the protocol → read the
purpose → set the condition → **Start capture session** → hold still; captures happen automatically
and the panel reports each one → **End session**.

| | Do this | Time |
|---|---|---|
| **A** | One sitting. Ten accepted captures, stepping away and re-framing between each. Do it in your normal light — this is also the calibration run. | ~15 min |
| **B** | One capture a day for **7 days**, same place, same light, same time of day. Only the first of each day counts. | 7 days |
| **C** | One sitting, six captures, changing the light each time: baseline, brighter, dimmer, side-lit, warm, cool. Set the condition **before** each capture. | ~20 min |
| **D** | One sitting, six captures: baseline, closer, farther, roll left, roll right, one expression change. Small movements — a rejection means you moved too far. | ~15 min |
| **E** | Four attempts: baseline, glasses, hair over the forehead, hair over a cheek. **Expect rejections. They are the result.** | ~10 min |
| **F** | Only if you shave. Captures across a shaving cycle, days apart. Otherwise tick **Not applicable to me**. | days, or skip |

**Then export and evaluate:**

Validation panel → **Data** → **Copy** (or **Export file** on desktop) → paste into
`corpus.json` on the machine with the repo:

```bash
npm run eval:face -- corpus.json
```

**Then act on the result — this is the step that matters:**

1. Read **PROTOCOL COLLECTION STATUS** first. If a protocol is incomplete, collect more; do not read
   the signal section as final.
2. Read **SIGNAL VALIDATION**. **Delete every signal that fails its gate. Do not adjust the gate.**
3. Calibrate `quality.LIMITS` from the real acceptance rate before treating any stability number as
   final.
4. Only then does Phase 4 — baseline and trend, over the surviving signals only — become legitimate.

If nothing survives, that is a real and useful answer, and it is more valuable than a feature built
on signals that could not hold still.
