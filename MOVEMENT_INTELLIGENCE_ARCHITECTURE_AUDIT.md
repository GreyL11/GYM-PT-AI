# Movement Intelligence — Architecture Audit

Every claim below was checked against the actual file and line, not assumed from the prompt or
from prior conversation summaries. One of the prompt's own claimed-existing capabilities turned out
to be **half-wired** — see §2. One of my own earlier R&D docs turned out to be **wrong** — `store.js`
already has export/import backup (§4), which the prior `PRODUCT_R_AND_D_BASELINE.md` said didn't
exist. Corrected here, not silently dropped.

## 1. Capability table

| Capability | Code location | Input | Processing | Output | Stored? | Reusable? | Gaps |
|---|---|---|---|---|---|---|---|
| Camera pipeline | `pose.js` (createLandmarker, startCamera) | Video frame | MediaPipe Pose Landmarker, GPU delegate | 33 landmarks (normalized + world) | No | Yes | None found this pass |
| Smoothing/filtering | `filter.js` createLandmarkFilter | Raw landmark arrays | One-Euro filter per landmark axis, teleport rejection, dt-clamped | Filtered landmark arrays | No | Yes | None — already tested (9 checks) against a real freeze bug |
| Rep detection | `exercises.js` step() L838-913 | Filtered landmarks, thresholds | Two-state machine (start/end) on the lift's primary joint angle, EMA-smoothed, MIN_REP_MS floor | `reps`, `repCompleted`, `repMs[]` | repMs stored per set | Yes | None |
| Fault detection | `exercises.js` step() L915-959 | Same + per-fault rule closures | Per-check visibility gating via Proxy-tracked joint reads, HOLD_FRAMES debounce | `faults: [{id, cue}]` per frame | Aggregated to `faultCounts: {id: count}` per set | Yes | **`severity` is computed (L646) but never copied onto the returned fault object (L957) — see §2** |
| Safety vs efficiency split | `exercises.js` L607-646 (`SAFETY` table, `isSafetyFault`) | Static per-exercise, per-fault-id table | Stamps `f.severity` on every rule object at module load | `'safety'` \| `'efficiency'` on the rule, NOT on the fired-fault event | On the rule definition only | Partially | **Confirmed dead for lifting** — see §2 |
| Personal calibration | `exercises.js` calibrate() | 15s of recorded frames (percentiles) | 5th/95th percentile of observed range, ±5° margin | Threshold patch (repStart/repEnd/lockout/depth) | Yes, per-exercise thresholds | Yes | Deliberately does NOT calibrate technique tolerances — correct by design, not a gap |
| Progression | `coach.js` preview()/finishExercise() | `exerciseSets` (this exercise's sets so far) | All-reps-clean → +increment or +1 rep (bodyweight); 3-session stall → -10% deload; else hold | `{moved, reps?, deload?, from, to, reason}` | Applied to `store.loads`/`store.reps` only on `finishExercise()`, not on preview | Yes | Binary outcome vocabulary (move/hold/deload) — no MAINTAIN vs REDUCE_VOLUME vs RETEST distinction (Phase 4 target) |
| Deload | `insights.js` shouldDeload/deloadTo + coach.js preview() | `sessions(exId)` grouped by day | 3 consecutive sessions at the same load → deload 10%, rounded to loadable plates | boolean + new load | N/A (derived) | Yes | Threshold (3 sessions, 10%) is a fixed constant, not evidence-scaled |
| Training plans | `planner.js` | Profile (days/week, equipment, injuries) | Static split templates (full-body/upper-lower/PPL) | Today's session | No (regenerated) | Yes | Not movement-intelligence-aware — doesn't yet know a lift is breaking down |
| Progress analytics | `insights.js` summary()/strength()/faultFingerprint() | Full log | Epley 1RM trend, whole-history fault totals, weekly volume | Progress screen data | N/A (derived) | Yes | **faultFingerprint() has no rep-position or session-recency weighting — see §3** |
| Fault history / fingerprints | `insights.js` faultFingerprint() | `store.read().log` (all time, or filtered by exId) | Flat sum of `faults` dicts across ALL sessions ever | `[{id, label, count, share}]` | N/A | Yes | Cannot say "in 4 of your last 5 sessions" — it has no session boundary in the output, only a lifetime total |
| Backup/export | `store.js` exportAll()/importAll() | Full store object | JSON stringify/parse with shape validation | Downloadable JSON / restored store | Yes | Yes | **This already exists — corrects the earlier R&D baseline doc, which claimed it didn't** |
| Tests | `test_*.mjs` × 8 files | Synthetic frames/records | Pure-function assertions | Pass/fail | N/A | N/A | 118 checks confirmed by `npm test`, all pure-logic, none touch the DOM |

## 2. The one real bug this audit found

**Claim in the prompt:** "Safety vs efficiency fault handling" already exists.
**Reality:** It exists at the rule-definition layer and is dead everywhere downstream, for lifting.

- `exercises.js:646` stamps `f.severity = isSafetyFault(id, f.id) ? 'safety' : 'efficiency'` on every
  rule object when the module loads.
- `exercises.js:957`, where a fault actually fires, does `faults.push({ id: f.id, cue: f.cue })` —
  **`severity` is not copied over.**
- `coach.js:onFrame()` (L133-147) receives that faultless-severity object and returns only a cue
  string.
- `app.js:1344`, the live lifting loop, buzzes `[70, 60, 70]` for **every** gym-lift fault, with no
  branch on severity at all — because there's nothing to branch on by the time it gets there.
- Contrast: `boxing.js:190` gets this right — `faults.push({ id, cue, severity: ... })` — and
  `app.js:424` correctly buzzes harder (`[90, 60, 90]`) for a boxing safety fault vs a soft `[70]`
  for a technique one.

**So: a squat knee-valgus fault (safety) and a bench wrist-stacking fault (efficiency) currently
produce the identical buzz for lifting**, even though the code to tell them apart has existed since
the safety/efficiency split was built. This is a one-line-class fix (propagate severity through the
same object at L957, add the same branch app.js already has for boxing), and it's the first thing
in the P0 scope below — not because it's exciting, but because it's a real defect in a capability
this whole exercise was told already works.

## 3. What's actually available at each level of the hierarchy the prompt proposed

| Level | What genuinely exists today | What's discarded/missing |
|---|---|---|
| Frame | Filtered landmarks, joint angles, per-check confidence (via the Proxy visibility tracking) | **The rep number in progress at the moment a fault fires.** `st.reps` is available in scope at L956-957 (incremented earlier in the same call, L905) but never attached to the fault event. This is the single most important gap for everything Phase 3 wants. |
| Rep | Duration (`repMs[]`), completion (`repCompleted`) | Which faults (if any) fired during that specific rep — not tracked. Only the set-level total exists. |
| Set | `{reps, target, load, faults: {id:count}, repMs[]}` — a real, tested, stored record | Fault *position within the set* — see above. Also no per-set confidence/quality summary; the record is raw counts only |
| Exercise history | `sessions(exId)` groups sets by calendar day; `strength()`, `stalledSessions()`, `faultFingerprint(exId)` all read it | No concept of "comparable session" (same load ± tolerance) vs just "any session on this lift" — a deload after a deliberately light technique-practice day would currently count toward the same stall counter as a real attempt at the working weight |
| Movement profile (cross-exercise) | `faultFingerprint(null)` aggregates across everything; `weeklyVolume()` by muscle group | No symmetry tracking (left/right asymmetry exists as a per-set bench-press check already — `asymmetry` fault — but it's not rolled up anywhere as a profile-level trend) |

## 4. Answers to the four required questions

### A. What is already enough to build movement intelligence?
The set-level record (`faults`, `repMs`, `load`, `target`, `reps`) plus `sessions()`/`strength()`/
`faultFingerprint()` in `insights.js` are a genuinely solid foundation. The preview()/commit split
in `coach.js` (decide now, apply only when the lifter leaves the rest screen) is exactly the right
shape for a richer decision engine to extend — it should NOT be rebuilt, only given more inputs.

### B. What data is currently discarded but should be retained?
**The rep index at which each fault fires.** It's computable for free (the value is already in
scope in `step()`) and simply isn't written anywhere. This single addition is what turns "your
elbows flared 6 times this set" into "your elbows started flaring from rep 7 onward" — the entire
difference this mission is asking for.

### C. What can be safely derived from existing landmarks without new instrumentation?
Nothing further, honestly — the landmark stream, joint angles, and per-check confidence are already
exploited about as far as they safely go for the lifts in this catalogue. The gap isn't in the
camera layer, it's in what happens to the fault event *after* it's detected and *before* it's
thrown away as a bare count.

### D. What's impossible or unreliable with the current single-camera setup?
- **True causal attribution** ("this adjustment caused the improvement") — a single-camera, N=1,
  uncontrolled system can observe correlation across sessions at best. The mission text itself
  says not to claim causation without genuine experimental evidence, and there is no experimental
  design here (no control condition) — so the intervention/outcome loop (Phase 5) must always speak
  in "the pattern improved after X" language, never "X caused Y." This is achievable honestly; a
  causal claim is not.
- **Symmetry as a diagnosis** — the existing `asymmetry` check (bench, dumbbell presses) measures
  angle difference between two limbs, which is real, but turning that into "your left side is
  weaker" is a medical-sounding claim from a geometric observation. Report the angle difference,
  not a strength conclusion.
- **Anything requiring depth accuracy beyond what MediaPipe world-landmarks give** — already the
  documented limit for boxing punch classification (confidence-scored, not asserted). The same
  discipline applies to any new metric: if the input is noisy, the output must carry a confidence,
  not a clean number.
