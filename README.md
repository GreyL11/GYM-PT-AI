# Trainer

Live form checking and session coaching for squat, bench press, skullcrusher and cable pushdown.
Pose estimation runs on-device — camera frames never leave the phone. No server, no account, no
network needed once installed.

## Get the APK

On the phone, open [releases/latest](https://github.com/GreyL11/GYM-PT-AI/releases/latest) and tap
`trainer.apk`. Chrome warns about the file type — download anyway, tap it, and allow installs from
Chrome when Android asks.

Every push to `main` (or a manual run of the **Build APK** workflow) publishes a new release.

It is an unsigned debug build. That is fine for your own phone; it is not Play Store material.

## Run it in a browser instead

```bash
npm install
npm run vendor   # pulls the MediaPipe wasm + pose model into www/vendor (not in git)
npm run serve
```

http://localhost:8080. Camera only works on `localhost` or HTTPS — a LAN address like
`http://192.168.1.20:8080` loads the page and then silently refuses the camera. That restriction is
the whole reason for the APK: a Capacitor WebView is a secure context, so the camera is just a
normal Android permission.

## Using it

Prop the phone side-on, 2–3 m away, whole body in frame. Each lift shows its own camera hint on the
start screen, and **How to** spells out the movement — setup, execution and the usual ways it goes
wrong. The first time you ever do a lift it opens and reads itself out, because being corrected
mid-rep is a poor way to learn a movement and a worse way to learn it under load. Hit **Start session**; it counts reps out loud and calls out faults as they happen.
**End set** when you rack it. The screen is held awake while a set is running.

Progression is linear and gated on form: hit every rep with few corrections and the load goes up
next session; miss reps or break down and it holds.

## Eat

Protein and calorie targets come from the profile you already filled in — bodyweight, goal, days
per week. Tap **Eat**, tap what you ate. Half and double servings are one tap; anything not in the
table you type once and it is yours for good. Your most-eaten foods collect under **Usual**, which
is what makes it two taps a meal by the second week.

There is no food API, no downloaded database and no language model. The app has no network and no
account, and a nutrition API would need a key baked into the APK that stops working on gym wifi.
The table covers the staples; you cover the rest, once.

The targets are a starting guess in exactly the way starting loads are. What corrects them is the
**Coach** card: bodyweight against calories over 28 days. Log your weight (it is the same field in
your profile that scales your lifts) and it will tell you when the two numbers disagree — including
when the honest answer is "you are eating more than you are logging".

## Back it up

Everything lives in one localStorage key on one phone. No account, no cloud, nothing to recover
from — lose the phone and a year of training goes with it. **Profile → Backup** writes the lot out
as JSON: save the file, or copy it and paste it somewhere you trust. The same screen restores it.

The file download is the one you want, but a Capacitor WebView with no `DownloadListener` drops
blob downloads silently, so **Copy** is there as the path that works everywhere. If nothing lands
in your downloads, use it.

## Adjust — read this before deciding it's wrong

**Adjust** exposes the raw thresholds per lift. Your limb proportions, squat depth and camera tilt
are not the textbook numbers, and every reading shifts with them. If it nags at form you know is
fine, loosen the threshold; if it stays quiet through an ugly rep, tighten it. Saved per lift.

Set the camera view to **Front-on** for knee cave-in checking on squats — it is off from the side
because it genuinely is not visible from there.

## What it cannot see

- Spinal rounding under a loose shirt. No camera-based system gets this reliably.
- Bar path on bench, beyond roughly. A phone at 45° gets elbow flare and lockout well, touch point
  approximately.
- Anything out of frame. It says so rather than guessing.

## Tests

```bash
npm test
```

Covers the joint-angle maths, the rep state machine and every fault rule against synthetic frames,
plus the macro arithmetic and the food log. `www/exercises.js` and `www/nutrition.js` are pure — no
DOM, no MediaPipe — specifically so this stays runnable. CI runs it before building the APK.

## Layout

| | |
|---|---|
| `www/exercises.js` | Rep state machine and fault rules. Pure functions, all the real logic |
| `www/coach.js` | Session plan, rep callouts, cue throttling, linear progression |
| `www/nutrition.js` | Macro targets, the food table, the day's log, the 28-day coach read |
| `www/technique.js` | How to perform each lift — the spoken brief and the "How to" panel |
| `www/pose.js` | Camera and MediaPipe Pose Landmarker; skeleton drawing |
| `www/app.js` | Wiring, HUD, settings sliders, wake lock |
| `www/store.js` | localStorage: loads, thresholds, set log, meals, bodyweight |
| `www/vendor/` | MediaPipe wasm + pose model. Generated, gitignored |
| `android/` | Capacitor shell. Regenerate with `npx cap add android` |
| `vendor.mjs` | Rebuilds `www/vendor/` |
| `serve.mjs` | Static dev server, no dependencies |

## Adding a lift

Add an entry to `EXERCISES` in `www/exercises.js`: `rep: {start, end}` angles, a `primary` angle
function, and a `faults` array. Add its thresholds to `RANGES` in `www/app.js` so they get sliders —
a test enforces that. Then add it to `PLAN` in `www/coach.js`.
