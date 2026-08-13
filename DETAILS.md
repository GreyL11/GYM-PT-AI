# Trainer — how it works

A personal training app that watches you lift through the phone camera, counts your reps out loud,
corrects your form mid-set, decides what you train each day, and adjusts your weights week to week.

Everything runs on the phone. No server, no account, no network. Camera frames never leave the
device and there is nothing to log into.

---

## 1. The idea

Most training apps are spreadsheets with a timer: you tell them what you did, they store it. This
one watches. That changes what it can know — it doesn't just record that you did five reps, it
records that three of them had your elbows flared and the last two took 40% longer than the first.

Three layers, each built on the one below:

| Layer | What it does | Where |
|---|---|---|
| **Vision** | Camera → 33 body landmarks, 30fps, on-device | `pose.js` |
| **Rules** | Landmarks → joint angles → rep counting and form faults | `exercises.js` |
| **Coaching** | Faults → spoken cues; sets → progression, planning, analytics | `coach.js`, `planner.js`, `insights.js` |

No machine learning anywhere except the pose model itself. Every training decision is arithmetic
you could do on paper — which makes it debuggable, testable, instant, and free.

---

## 2. How a set actually works

1. **Pose estimation.** MediaPipe Pose Landmarker (lite, GPU) returns 33 landmarks per frame in two
   spaces: normalized image coordinates, and metric "world" coordinates centred on your hips.
2. **Joint angles.** Angles come from the world landmarks — metric, so no distortion from the
   phone's aspect ratio. Four joints are computed per frame: knee, elbow, hip, and shoulder
   (meaning the upper arm's angle relative to your torso).
3. **Smoothing.** An exponential moving average (α = 0.4) over the primary angle. Heavy enough to
   kill landmark jitter, light enough not to lag a fast rep.
4. **Rep counting.** A two-state machine per lift — `start` → `end` → `start` is one rep, with 12°
   of hysteresis at each endpoint so noise can't double-count.
5. **Fault checks.** Each lift has a small list of rules. A rule only runs in the phase it applies
   to, and must hold for 3 consecutive frames before it's spoken.
6. **Cue.** One correction at a time, throttled to once per 6 seconds per fault. Stacking cues
   mid-rep is noise, not coaching.

### Why some things are deliberately not checked

A rule that can't see what it claims to see is worse than no rule. Knee cave-in on squats is only
evaluated when you tell the app the camera is front-on, because it is genuinely invisible from the
side. Spinal rounding isn't checked at all — no camera-based system detects it reliably through a
shirt, and a false "your back is fine" is dangerous.

---

## 3. The exercise catalogue

28 lifts across 6 groups. Each carries its own rules, camera angle, and planning metadata.

| Group | Lifts | What gets checked |
|---|---|---|
| **Chest** | Bench press, Incline bench, Decline bench, Dumbbell bench, Incline dumbbell, Chest dip, Push-up | Elbow flare, lockout, wrist stacking, left/right evenness, bounce off the chest; push-ups add body-line sag; the chest dip faults on staying UPRIGHT, which is the triceps dip's rule inverted |
| **Back** | Deadlift, Barbell row, Seated cable row, Straight-arm pulldown, Lat pulldown | Bar drifting off the shins, lockout, hip height at the pull; rows add heaving and elbow path; pulldowns add leaning back; the straight-arm pulldown counts off the shoulder and faults on a bent elbow |
| **Shoulders** | Overhead press, Lateral raise, Front raise, Rear delt raise, Cable lateral, Cable front raise | Lower-back arch, lockout, bar path off vertical; raises add going above shoulder height and bending the elbow; the rear delt raise faults on standing up out of the hinge instead |
| **Biceps** | Barbell curl, Hammer curl, Cable curl | Elbows drifting forward, torso swing, full stretch at the bottom, negative speed |
| **Triceps** | Cable pushdown, Skullcrusher, Overhead cable extension, Dip | Elbows leaving the ribs, torso lean, full extension; the skullcrusher and the overhead extension are the same "upper arms do not move" rule at 92° and 158° |
| **Legs** | Back squat, Romanian deadlift, Lunge | Depth, torso fold, heels lifting, knee cave-in (front view); RDL adds knee bend and bar drift |

Which delt a raise trains is the *plane* the arm travels through, and that is a camera-angle
difference rather than a rules difference — so the lateral, front and rear raises come from one
builder that differs only in `view` and whether the torso rule is "do not lean" or "stay hinged".

Not included, for a reason that will keep recurring: dumbbell flyes, cable crossovers and face
pulls all move the arms toward the camera. That is world-z, the noisiest channel MediaPipe emits
and the axis the angle maths deliberately ignores.

Each lift also declares equipment needed, compound vs isolation, which injuries it aggravates, and
a bodyweight ratio for estimating a sensible starting weight.

---

## 4. Everything is a tunable threshold

Every rule compares a measured angle against a number, and **every one of those numbers is
editable per lift** on the Adjust screen, saved to your phone.

This is not a power-user escape hatch, it's the core design assumption. Your limb proportions,
your squat depth and your camera tilt are not the textbook values the app ships with. If it nags at
form you know is fine, loosen it. If it stays quiet through an ugly rep, tighten it.

The rep endpoints themselves are thresholds too, not constants — your range of motion is the most
personal number in the system.

### Calibration

Rather than making you find those numbers with sliders, **Calibrate** records 15 seconds of you
lifting and derives them. It takes the 5th and 95th percentile of your actual range — percentiles,
not min/max, so one bad frame can't define your squat — and writes your rep endpoints, your
lockout, and your bottom position.

It calibrates **anatomy only**. Elbow flare, torso lean and upper-arm drift are deliberately left
alone, because learning those from your own reps would bake whatever you currently do wrong in as
the new definition of correct.

This matters more than it sounds. In testing, a lifter whose squat bottoms out at 120° — short of
the 95° default — had **every rep go uncounted**. After calibration the same reps counted.

---

## 5. What it knows about you

A one-time profile, six fields, all of which change what the app does:

| Field | What it drives |
|---|---|
| Bodyweight | Starting weight for every lift, via a per-lift ratio |
| Experience | Multiplies those starting weights (1.0 / 1.35 / 1.7) |
| Goal | Rep scheme — strength 5×5, muscle 4×8, endurance 3×15 |
| Days per week | Which split you get, and which weekdays you train |
| Equipment | Lifts you can't perform are never prescribed |
| Injuries | Lifts that aggravate them are removed entirely |

**Age, sex and height are deliberately not collected.** Nothing in the planner would use them, and
a question that changes no decision is just friction.

### The weekly plan

| Days | Split |
|---|---|
| 2–3 | Full body A / B / C |
| 4 | Upper / Lower, twice |
| 5 | Push / Pull / Legs / Upper / Lower |
| 6 | Push / Pull / Legs, twice |

Training days are spread across the week for recovery (3 days → Mon/Wed/Fri). Each session is a
list of muscle groups; the planner fills each slot from the lifts you can actually do, compounds
first, never repeating a lift within a session. Open the app and it names the day, names the
session, and lists each lift with sets, reps and weight. Rest days say what's coming next instead
of showing an empty screen.

You can ignore all of it — **All lifts** gives you the full catalogue to pick freely.

---

## 6. What it learns from you

Every set is logged: date, lift, reps done vs reps targeted, weight, which faults fired and how
often, and the duration of each individual rep. The analytics layer reads that back.

| Insight | How |
|---|---|
| **Estimated 1RM + trend** | Adjusted Epley, `load × (1 + (reps−1)/30)`, compared against your own first session |
| **Fault fingerprint** | Which correction dominates each lift, as a share — your measured weak point |
| **Auto-deload** | Three sessions stuck at the same weight is a stall, not a bad day. Drops 10% and rebuilds |
| **Weekly volume** | Hard sets per muscle group over 7 days, against the 10–20 productive range |
| **Recovery warning** | Flags a group in today's session that was trained under 48h ago |
| **In-set fatigue** | Compares the last two reps' duration against the first two. Slower means the set is done |

Progression is linear and **gated on form**: hit every rep with few corrections and the weight goes
up; miss reps or break down and it holds. Form data is part of the progression decision, which is
only possible because the app was watching.

These surface in three places — the Progress screen, the setup screen before you lift ("watch:
elbows flaring, 93% of your corrections here"), and the rest summary.

---

## 6b. Eating

Targets come out of the profile that already exists: protein is 1.8 g/kg of bodyweight (1.4 for
endurance), fat is a 0.8 g/kg floor, calories are a per-kg figure scaled by how often you train and
nudged by the goal, and carbs are whatever calories are left. A test asserts the four macros add
back up to the calorie number, so a typo in one of them cannot pass.

**No food API, no downloaded database, no language model.** The app has no network and no account;
an API key baked into the APK is a key that stops working on gym wifi, and a made-up macro from a
model is worse than a rough one you can see and correct. Instead there is a table of ~47 staples,
each with macros **per serving** — "1 large egg", "100 g chicken breast", "1 cup dal" — which
removes all unit arithmetic: a log entry is a food and a quantity. Anything missing you type once
and it is yours for good, and your own entry overrides a table value you disagree with.

Water is a food, not a subsystem. A glass is an ordinary log entry pointing at a `water` food, so
the date filtering, the undo button, the backup and the day view all work on it without a line of
new code — the only additions are an `ml` field on drinks and a target. Fluid is summed from that
field wherever it appears, so tea and milk count; alcohol deliberately carries no `ml`, because it
is a diuretic and counting a pint toward hydration would be worse than ignoring it.

The water target has no feedback loop, unlike the calorie one. The honest signal for hydration is
the colour of your urine, which no phone is going to measure, so it stays a nudge.

Which meal something belongs to is read off the clock rather than asked for. Picking "lunch" from a
dropdown after you already picked the food is a tap that tells the app what the timestamp said.

### Correcting the target from the scale

The calorie formula is a population average applied to one person, so it is a starting guess in
exactly the way `startingLoad()` is. What corrects it is bodyweight over 28 days, and the
correction is **offered, never applied** — a fortnight of water weight would otherwise walk the
target somewhere silly.

The suggestion is anchored to what you **ate**, not to the target you were given: eating 2,200 and
staying flat means maintenance is 2,200, whatever the formula claimed. It stays quiet unless there
are 10+ days between weigh-ins, 7+ days of food logged, and a correction bigger than scale noise —
and it refuses outright when the average logged intake is under 75% of target, because that is a
logging problem and "eat more" is the opposite of the right advice.

That last case is also what the coach line leads with. Gaining weight on a large deficit means the
log is incomplete, and every other reading is computed from a number that is simply wrong.

---

## 7. Data

One localStorage key, `gym-trainer/v1`:

```js
{
  loads:      { squat: 72.5, ... },        // current working weight per lift
  thresholds: { squat: { depthGap: 0.02 } }, // your calibration overrides
  profile:    { bodyweight: 82, ... },     // + optional kcalTarget, accepted from the scale
  log: [{
    at: '2026-08-12T18:04:11.000Z',
    exId: 'squat', set: 2,
    reps: 5, target: 5, load: 70,
    faults: { depth: 1, torso: 3 },        // fault id → times fired
    repMs: [2140, 2260, 2380, 2900, 3400], // per-rep duration
  }],
  meals:   [{ at: '...', foodId: 'whey', qty: 2 }],  // what you ate, not its macros
  foods:   { 'my:chicken-curry': { name, serving, kcal, protein, carbs, fat } },
  weights: [{ at: '...', kg: 82 }],        // one point per day, max 400
}
```

Sets are capped at the most recent 500, meals at 3000 (about 18 months).

**Profile → Backup** exports the whole object as JSON and restores it. Two ways out, because
neither works everywhere: a blob download is the one you want, but a Capacitor WebView with no
`DownloadListener` drops those silently, so clipboard sits next to it. Restore validates the shape
before writing anything — a half-applied restore that wipes the log is worse than one that fails.

### Why meals store an id, not macros

A meal is `{ foodId, qty }`. Correcting a food's numbers therefore corrects every meal ever logged
with it. That is right when you are fixing an *estimate of a fixed thing* — the chicken did not
change, our number for it did — and wrong when the *thing itself* changed, like a new recipe.

Nothing in the data distinguishes those two, so the app asks instead of guessing, and only at the
one moment it matters: saving over a custom food you have already eaten shows how many entries it
would rewrite and offers to keep the new version as a separate food. Table foods never reach this,
because their values only change when a new version of the app ships — and that is always a
correction, so retroactive is exactly what you want.

The alternative, freezing macros into every log entry, buys immutable history at the price of
making every typo permanent — and the common case genuinely is "I finally read the label".

---

## 8. Architecture

```
www/
  index.html      one page, all five screens, plain CSS design tokens
  app.js          wiring, HUD, frame loop, screen navigation
  exercises.js    28 lifts, rule engine, rep state machine   ← pure, no DOM
  planner.js      profile, splits, session building, loads   ← pure logic
  insights.js     log analytics                              ← pure functions
  nutrition.js    macro targets, food table, the coach read  ← pure logic
  technique.js    how to perform each lift (spoken brief)    ← data only
  coach.js        rep callouts, cue throttling, progression
  pose.js         camera + MediaPipe + skeleton drawing
  store.js        localStorage
  sw.js           offline cache
  vendor/         MediaPipe wasm + pose model + fonts (generated, not in git)
```

The four modules doing the actual thinking — `exercises`, `planner`, `insights`, `nutrition` —
touch no DOM and no browser APIs, which is exactly why they can be tested in Node.

**No build step and no framework.** Native ES modules, plain CSS. `node serve.mjs` is 25 lines of
`node:http`. The only runtime dependency is MediaPipe.

### Design

The visual language came from a Google Stitch export: neon green on near-black, Inter for text and
JetBrains Mono for anything you read as an instrument, 64px touch targets for sweaty hands. The
export's Tailwind / Google Fonts / Material Symbols CDN links were all removed — each one would
leave the APK blank with no signal.

Training is red and eating is green, everywhere, without exception. The home screen is two cards
side by side and the fastest thing on it should be telling which is which. Both accent colours are
tokens (`--train`, `--eat`) rather than literals, so that stays true by construction.

Lists are tiles rather than ruled rows, and the primary button on a screen glows in its own accent
so the next thing to do is the brightest thing present. Half a phone width is not much, so anything
inside the two-up cards is one line or it is wrong — a wrapped "2,830 kcal" reads as two numbers,
and truncating it to "2,8…" is worse than either.

---

## 9. Build and release

Capacitor wraps the web app so the WebView is a secure context, which is what makes the camera work
as an ordinary Android permission with no HTTPS hosting anywhere.

MediaPipe is vendored locally, not loaded from a CDN — 24 MB of wasm plus a 5.8 MB pose model,
bundled into the APK. That's the difference between an app that works in a basement gym and one
that shows a blank screen. Cold start went from 6.3s to 0.86s as a side effect.

Push to `main` → GitHub Actions runs the tests, vendors the assets, builds the APK, and publishes it
as a **release asset** — a direct one-tap download, because build artifacts are zipped and require a
signed-in GitHub session, which is useless from a phone.

Latest build: https://github.com/GreyL11/GYM-PT-AI/releases/latest (~15 MB)

---

## 10. Tests

83 checks across five suites, run in CI before every APK.

| Suite | Covers |
|---|---|
| `test_exercises.mjs` (30) | Angle maths, rep counting in both directions, jitter rejection, every fault rule, view gating, visibility gating, calibration, a how-to brief for every lift |
| `test_planner.mjs` (11) | Weekday mapping, equipment and injury filtering, rep schemes, load scaling, no duplicate lifts per session |
| `test_insights.mjs` (9) | 1RM edges, session grouping, stall detection, deload maths, fingerprint shares, volume windows, fatigue |
| `test_coach.mjs` (9) | Warm-up ramps, preview-then-commit progression, rep correction, bodyweight rep progression, deload |
| `test_nutrition.mjs` (23) | Macro arithmetic, food table consistency, the day's log, meal slots, water and fluid, weight trend, target correction and its refusals, backup round-trip |

Fed by synthetic landmark frames built to exact joint angles — so the rules are tested against
geometry, not recordings.

**These caught real bugs:**

- Textbook Epley (`1 + reps/30`) reports a 1-rep max as 3% *above* the weight you just lifted. The
  assertion that a single should equal itself failed, and every number on the Progress screen would
  otherwise have been quietly inflated.
- The food table's "macros must explain the calories" check failed on beer. Alcohol is a fourth
  energy source at 7 kcal/g that the four macros cannot express, so drinks now declare it.
- The calorie correction originally added its delta to the *target* rather than to what was
  actually eaten, which told someone eating 2,200 and holding steady to eat 3,125 instead of 2,420.

---

## 11. Honest limits

- **It has never been tested on a real body in a real gym.** Calibration removes most of the
  guesswork, but nothing here has faced a real barbell yet.
- **Spinal rounding is invisible.** No camera system reads it reliably through a shirt.
- **Bench is the weakest of the lifts.** A phone at 45° gets elbow flare and lockout well; bar
  path and touch point only roughly.
- **Calibration trusts your reps.** It assumes the 15 seconds you record are your best form. Bad
  reps in, wrong range out — though only your range of motion, never your fault tolerances.
- **One device, no backup.** Clearing site data erases your history.
- **Unsigned debug APK.** Fine for your own phone; Play Protect will warn you.

## 12. Next

Considered and not built: saving a 3-second clip of your worst rep, a plate calculator, data
export/import, an in-app update check, and an LLM check-in ("slept badly, shoulder is tweaky") —
the last of which would need a proxy server for the API key and would end the app's offline
guarantee.

In-set fatigue is measured and reported but not acted on: it tells you the set slowed down, it
won't cut a set short. Stopping someone mid-lift on a heuristic is a decision worth making
deliberately rather than defaulting into.
