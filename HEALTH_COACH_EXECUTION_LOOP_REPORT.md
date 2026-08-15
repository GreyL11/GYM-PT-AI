# Health Coach Execution Loop — Implementation Report

## 1. What existed before
`www/health.js` already computed a deterministic Next Best Action: four candidate generators
(hydration, skin routine, training, hormonal lifestyle) wrapped in an explicit tiered priority
engine, `selectNextBestAction()`, a "Why this?" explanation, an outcome log (`store.actions[]`),
and Done/Skip/Later on one card. `preferredHour()` existed but fed nothing. There was no notion of
STARTING an action, no multi-step guidance, and no reminder infrastructure of any kind.

## 2. What was reused
Everything. No domain module was rewritten. `skin.HABITS` (the real, fixed 4-item routine —
sunscreen, washed-after-training, moisturised, left-it-alone; there is no per-user product
configuration in this app, so the walkthrough steps are exactly these four, never invented product
names), `nutrition.waterTarget/fluid/FOODS.water`, `planner.today/doneToday`, `t_inputs.read()`'s
own known/missing breakdown, `store.getSetting/setSetting` (reused verbatim for reminder
preferences — no new settings shape), and the entire priority engine/candidate generators
unchanged. The existing water-logging function (`logFood`) and the existing training-session
entry point (`el.btnStartToday`) are called directly from the walkthrough rather than reimplemented.

## 3. Walkthrough architecture
Each candidate now carries a `guidance` field:
```
{ mode: 'single', intro, step: { id, instruction, quickLog?, deepLink?, boundary? } }
{ mode: 'steps',  intro, steps: [{ id, title, instruction }, ...] }
```
`mode: 'steps'` is used by exactly one domain (skincare) because it is the only one with more than
one real, already-configured item to check off. The other three are `single` — matching the
spec's own hydration example (intro + one instruction + Done/Later), not padded into fake wizards.

Critically, **no step index is ever persisted**. A walkthrough resumes by re-deriving "what's left"
from the same real data every other screen reads (`missing` skin habits, `left` exercises) — an app
restart, a tab switch, or a five-minute gap all resume correctly for free, because there is no
separate progress variable that could go stale or get lost.

## 4. Action state machine
`health.js` now exports `ACTION_STATE` (`offered/started/completed/skipped/postponed/cancelled`)
and `actionState(id)`, which reads the last event off the existing `store.actions[]` log — no new
storage. Transitions: `offered → started/skipped/postponed`, `started → completed/postponed/
cancelled`, `postponed → offered` (after `POSTPONE_MS`), `cancelled → offered` (immediately —
backing out isn't a punishment). `recordOutcome()` is now idempotent: a second `completed`/`skipped`
the same day is a no-op rather than a duplicate log row (a lightweight guard, not a full transition
table — the UI only ever offers the buttons valid for the current state anyway).
One correctness detail: ids like `hydration:drink` aren't date-scoped, so `actionState()` treats a
`started` event from a *previous* day as stale and reports `offered`, not "still in progress."

## 5. Single-step actions
Hydration and the hormonal-lifestyle candidate. The card shows title/reason, then Start → the
step's instruction, Done/Cancel/Later. Hydration's step adds three quick-log buttons (Glass/
Bottle/Litre) that call the app's existing `logFood('water', …)` — real intake, never a fabricated
amount on Done. Training's step is a single deep-link ("Open session") into the existing
camera-driven lift flow via the existing `btnStartToday` handler — no second training UI.

## 6. Multi-step actions
Skincare only. `guidance.steps` is `missing.map(h => ({id, title: h.label, instruction: h.why}))` —
literally the app's own `skin.HABITS` entries not yet done today, in their fixed order. One step
shown at a time; its Done button calls the new `skin.setHabitDone(id, true)`, then recomputes what's
left. When nothing remains, the walkthrough fires the action's own single `completed` event and the
card recalculates to the next priority item. "Back" was deliberately not built for this domain:
every step is a one-way checkbox completion (nothing to undo by going back), matching the spec's
own instruction not to force sophistication a domain doesn't need.

## 7. Skincare walkthrough integration
`skin.setHabitDone()` writes to the exact same field the Mind → Skin panel's habit chips already
write (`store.day().skin.habits`) — there is one source of truth, not two counters. Verified by
test (`test_health.mjs`): completing all four habits through the coach walkthrough is read back
identically by `store.day().skin.habits`, and the `skinRoutineCandidate` itself flips to
`GOING_WELL` from that same field — nothing coach-side is double-counted. The `GOING_WELL` copy now
also says *"You've completed N of your last M recorded evening routines"* (via new
`skin.routineAdherence()`, floor of 3 data points) — adherence, never an appearance claim; the
existing `limitation` string ("tracks whether the routine was followed, not whether it changed your
skin") is untouched and still attached to the `ACTIONABLE_NOW` variant.

## 8. Hydration walkthrough integration
No invented hydration prescription — the target is still `nutrition.waterTarget()`, unchanged. The
`no_evidence` (nothing logged) variant says *"We don't have enough intake data yet. Log water to
personalize hydration guidance"* rather than any dehydration claim (already true before this pass;
preserved and now tested against the guidance text too). Completion is honest: Done never adds
water; only the quick-log buttons do, and they call the app's real meal-logging path, so any amount
recorded is a real logged entry, never fabricated.

## 9. Training integration
Not rebuilt. The walkthrough's only content is "N of M lifts left today" (from the existing
`planner` data, unchanged) plus one button that calls the app's existing `btnStartToday` handler —
the same entry point the dashboard's own Start button uses. Completion is never claimed by the
coach: the training candidate itself becomes `GOING_WELL` once `planner.doneToday()` says the
session is done, exactly as before this pass. This was a deliberate scope choice — see Limitations.

## 10. Hormonal-health boundary
The walkthrough for this domain is the boundary statement itself, not a task: `guidance.step.
boundary` carries `{known, missing, supports, doesNotMeasure}`, all sourced from `t_inputs.read()`'s
own verdicts (already-tested, unchanged). `doesNotMeasure` is the same testosterone-boundary
sentence as `limitation`, so the walkthrough cannot say anything the card wasn't already saying.
Done is a read receipt; no testosterone score, no TRT/steroid/SARM text exists anywhere in
`health.js` (re-verified by the existing grep-based test, still passing).

## 11. Reminder architecture
Split in two, per the "test scheduling independently of the plugin" requirement:
- **`www/reminders.js`** — pure: hour-slot computation from user prefs, and a deterministic
  string→id hash so the same logical reminder always maps to the same notification id (re-scheduling
  replaces rather than duplicates). No Capacitor import, no `Date.now()`, fully unit-tested in Node.
- **`www/notify.js`** — the only file that touches the plugin, and it does **not**
  `import '@capacitor/local-notifications'`. This app ships no bundler (`serve.mjs`'s own comment:
  "no build step to serve" — everything in `www/` is loaded as flat ES modules, in both the browser
  dev preview and the real Capacitor WebView). Importing the npm package's own bundle here would
  wire the plugin to a second, disconnected `@capacitor/core` instance rather than the real native
  bridge — quietly falling back to the (barely-functional) web shim on an actual device while
  looking fine in a browser tab. Instead `notify.js` reads `window.Capacitor.Plugins.
  LocalNotifications`, which the native Android runtime injects automatically for every plugin
  listed in `capacitor.plugins.json` before any page script runs — the documented no-bundler access
  pattern, and it happens to also be less code. In a plain browser tab that global is simply absent,
  which every function already treats as "nothing to do."
- `@capacitor/local-notifications@^6.1.3` was added as an npm dependency (matches
  `@capacitor/core@^6.2.1`) purely so `npx cap sync android` can find and register the native
  Android plugin class — confirmed: `capacitor.build.gradle` gained
  `implementation project(':capacitor-local-notifications')` and `capacitor.settings.gradle`
  registered the module, both from a real `npx cap sync android` run, no hand-editing.

## 12. Hydration reminders
One repeating daily notification per hour slot in `[startHour, endHour)` stepped by
`intervalHours` — no polling, no re-scheduling until the preference itself changes. A small
settings block was added to the Eat tab, next to the existing water buttons (`reminders-enabled`
checkbox + start/end/interval number inputs), reading/writing through `store.getSetting/setSetting`
(no new storage shape). Enabling checks/requests native permission first; if denied (or no native
runtime — e.g. this session's browser verification), the preference reverts to disabled and the UI
says so honestly ("Could not schedule reminders — check notification permission for this app"),
rather than pretending it's scheduled. Verified live in-browser: toggling on with no `Capacitor`
global present reverted the checkbox and showed exactly that message, with zero console errors.

## 13. Postponed-action reminders
Generic, not hydration-specific: every "Later" tap on any action calls
`notify.onOutcome(action, 'postponed', health.reminderDelayMs(action.id))`, which schedules one
one-shot reminder at `now + delay` titled with the action's own title. Completing, skipping, or
cancelling the same action cancels any reminder still pending for it.

## 14. Reminder deduplication/cancellation
Both reminder kinds use `reminders.js`'s deterministic id (`hydrationId(hour)` /
`postponeId(actionId)`), so scheduling an id that already exists replaces it rather than adding a
second one. `syncHydrationReminders()` persists the exact hour list it last scheduled
(`hydrationScheduledHours` setting) and is a no-op when called again with unchanged preferences —
this is what makes app-restart-safe: `notify.initReminders()` runs on every launch but only touches
the OS scheduler when something actually changed.

## 15. Adaptive delivery
`health.reminderDelayMs(actionId, now)` and `health.reminderExplanation(actionId)` close the
`preferredHour()` loop, but narrowly: they only affect *when a postpone reminder fires*, nothing
about `selectNextBestAction`'s tier/domain ordering. With no history, delay is the plain
`POSTPONE_MS` (2h) with an explanation admitting there's no personalization yet. With ≥3 real
completions (reusing `preferredHour`'s own floor), the delay nudges toward the start of the bucket
the user actually finishes in — clamped to `[30 min, 6 h]` so a thin estimate can neither bury a
reminder for the day nor fire one back immediately. `reminderExplanation()` answers "why did you
remind me now" in one descriptive sentence, never a causal health claim.

## 16. LLM role
Untouched. `health.js` still imports nothing from `chat.js`/`face/`, never calls `fetch`, and
carries no Capacitor import either (new test asserts this). `digest()`'s existing `coach` fact and
its one RULES line are unchanged — the model still only explains the deterministic pick, never
invents steps, schedules anything, or infers testosterone.

## 17. Face boundary
Unchanged and re-verified: `health.js` still imports nothing under `www/face/`. This entire pass
added no interaction with face measurement at all — the reminder/adaptation layer has nothing to do
with it.

## 18. Known limitations
- Training's coach-side "completed" event is never emitted — completion is left entirely to
  `planner.doneToday()`/the real exercise log, so the card simply stops recommending training once
  it's done. This was a deliberate simplification: synthesizing a `completed` event for training
  would mean guessing "session finished" from inside an unrelated render call, which risks logging
  an event the user never actually interacted with the coach about.
- No "Back" for skincare steps (see §6) — each step is a one-way habit checkbox, so there is nothing
  meaningful to reverse.
- Hydration reminders and postpone reminders are both `IMPLEMENTED` + `BROWSER TESTED` (graceful
  degradation confirmed live) but NOT `REAL DEVICE TESTED` — no Android SDK/device in this
  environment (same constraint as every prior phase's report).
- The reminder body text is fixed/generic ("A good moment to drink some water.", "Still there" +
  the action's own title) — no per-notification personalization beyond timing.

## 19. Tests
`test_health.mjs`: 21 → **36** checks — added guidance-shape checks (single vs steps, skincare
steps match `skin.HABITS` exactly, no invented product names), the full state machine (offered→
started→completed, started→postponed/cancelled, cancelled≠completed, idempotent no-duplicate
completion, stale cross-day `started` handling, skin double-count check), and adaptive-delivery
checks (no-history floor, bounded+explainable delay with real history, adaptation never changes
`selectNextBestAction`'s pick).
`test_reminders.mjs` (new): 9 checks — disabled/empty/inverted-window/non-positive-interval all
produce no schedule, exact hour-slot computation with no duplicates, every hour stays inside the
window, id determinism (same key → same id) and non-collision across hydration/postpone kinds.

## 20. Full test result
```
npm test → exit 0
19 files, 378 checks total (test_health.mjs 21 → 36; +test_reminders.mjs, 9 new)
```
No existing test was deleted, weakened, or skipped.

## 21. Browser verification
Live end-to-end in the dev preview (`preview_start` → `serve.mjs`):
- Profile created, Today screen showed the Next Best Action card with **Start/Skip/Later**.
- **Start** on the hormonal candidate opened the boundary walkthrough (What we know / don't know /
  does not measure) with Done/Cancel/Later; **Cancel** returned cleanly to the offered view.
- Logged a skin score with no habits done → card recalculated to **"Continue your evening
  routine"**; **Start** → stepped through all 4 real `skin.HABITS` one at a time with their own
  `why` text; the last **Done** completed the whole action and the card moved on to the next
  priority item. `store.day().skin.habits` afterward held exactly the 4 real habit ids — one source
  of truth confirmed live, not just in tests.
- **Skip** on hormonal, then hydration's `no_evidence` card → **Start** → quick-log **+Glass**
  logged a real 250 ml entry, reflected immediately and honestly ("250 of 2900 ml… 2650 ml short"),
  no fabricated total.
- Toggled **"Remind me to drink water"** in the Eat tab with no native runtime present → reverted
  to off with an honest message, zero console errors, page fully responsive throughout.
- **Later** (postpone) on hydration was accepted without error; with every remaining candidate now
  suppressed/`GOING_WELL`, the card correctly hid entirely rather than showing something stale.

## 22. Real-device status
**Not tested on a device** — no Android SDK/emulator available in this environment (consistent with
every prior phase). What *was* verified without a device:
- `npx cap sync android` ran cleanly and registered the plugin —
  `android/app/src/main/assets/capacitor.plugins.json` now lists
  `com.capacitorjs.plugins.localnotifications.LocalNotificationsPlugin`, and
  `capacitor.build.gradle`/`capacitor.settings.gradle` reference it correctly.
- `notify.js`'s design was specifically chosen to avoid a class of bug that only shows up on a real
  device (see §11) — reasoned through statically, not observed.

## 23. Files changed by this work
`www/health.js`, `www/skin.js`, `www/mood.js` (added `openSkin()` only), `www/app.js`,
`www/index.html`, `www/sw.js` (new files added to precache shell), `package.json` (+dependency,
+test script entry), `package-lock.json`, `test_health.mjs` (extended), plus new files
`www/reminders.js`, `www/notify.js`, `test_reminders.mjs`, and this report. Native wiring from
`npx cap sync android`: `android/app/capacitor.build.gradle`, `android/capacitor.settings.gradle`
(and the untracked, gitignored `capacitor.plugins.json`).

## 24. Files intentionally untouched
Pre-existing, uncommitted modifications from earlier work this session, found already in this state
and left exactly as found: `.gitignore`, `android/app/build.gradle` (debug-keystore signing config
— unrelated to plugins), `android/app/debug.keystore`, `www/chat.js`, `www/digest.js`,
`www/face/checkin.js`, `www/store.js`, `HEALTH_INTELLIGENCE_AUDIT.md`,
`HEALTH_INTELLIGENCE_IMPLEMENTATION_REPORT.md`.

## 25. What remains unverified
Real-device notification delivery and permission-prompt UX; whether the `[30 min, 6 h]` reminder-
delay bounds feel right against real usage; whether the fixed hydration reminder body text should
vary; training's "no coach-side completed event" tradeoff against real multi-day use (§18).

| Capability | Status | Evidence |
|---|---|---|
| Existing Health Intelligence preserved | Done | all 4 candidate generators, priority engine, evidence rules unchanged; full suite green |
| Next Best Action preserved | Done | `selectNextBestAction()` untouched; browser-verified live |
| Action state machine | Done | `ACTION_STATE`, `actionState()`, idempotent `recordOutcome()`; 12 new tests |
| Single-step walkthroughs | Done | hydration, training, hormonal — browser-verified |
| Multi-step walkthroughs | Done | skincare, real `skin.HABITS` steps only — browser-verified |
| Skincare walkthrough | Done | `skin.setHabitDone()` = single source of truth; no-double-count tested + verified live |
| Hydration walkthrough | Done | honest absence copy; quick-log is real logging, never fabricated; browser-verified |
| Training integration | Partial | deep-links to existing session flow; no rebuilt planner/wizard (see Limitations) |
| Hormonal boundary preserved | Done | boundary-statement walkthrough; grep+behavioral tests still pass |
| Local notification infrastructure | Done | `window.Capacitor.Plugins.LocalNotifications`, no bundler-breaking import; plugin registered via `cap sync` |
| Hydration reminders | Done | window/interval prefs, UI in Eat tab; browser-verified degrade-gracefully path |
| Postpone reminders | Done | generic, any domain, via `reminderDelayMs` |
| Reminder deduplication | Done | deterministic ids + persisted "last scheduled" list; 9 pure tests |
| Reminder cancellation | Done | `onOutcome()` cancels on completed/skipped/cancelled/started |
| Permission-denied handling | Done | reverts preference + honest message; browser-verified live |
| Adaptive delivery | Done | `reminderDelayMs`/`reminderExplanation`, delivery-only |
| Adaptation evidence floor | Done | reuses `preferredHour`'s ≥3 floor; tested |
| Priority remains deterministic | Done | test asserts adaptation never changes `selectNextBestAction`'s pick |
| LLM pipeline preserved | Done | `digest()`/RULES unchanged; no Capacitor import in `health.js` (new test) |
| Claim validation preserved | Done | `validate.js`/`explain.js` untouched |
| Face boundary preserved | Done | no face import anywhere in the new code; existing test still passes |
| Full automated tests | Done | 19 files, exit 0, +15 checks |
| Browser/app tested | Done | live walkthrough, quick-log, reminder-toggle degradation all verified |
| Real-device tested | Not done | no Android SDK/device available in this environment |
