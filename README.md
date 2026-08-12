# Trainer

Live form checking and session coaching for squat, bench press, skullcrusher and cable pushdown.
Pose estimation runs on-device — camera frames never leave the phone. No server, no account, no
network needed once installed.

## Get the APK

Push to `main` (or run the **Build APK** workflow manually). GitHub Actions builds it and attaches
`trainer-apk` as an artifact on the run — download, unzip, sideload. You will need "Install unknown
apps" enabled for whatever app you open it with.

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
start screen. Hit **Start session**; it counts reps out loud and calls out faults as they happen.
**End set** when you rack it. The screen is held awake while a set is running.

Progression is linear and gated on form: hit every rep with few corrections and the load goes up
next session; miss reps or break down and it holds.

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

Covers the joint-angle maths, the rep state machine and every fault rule against synthetic frames.
`www/exercises.js` is pure — no DOM, no MediaPipe — specifically so this stays runnable. CI runs it
before building the APK.

## Layout

| | |
|---|---|
| `www/exercises.js` | Rep state machine and fault rules. Pure functions, all the real logic |
| `www/coach.js` | Session plan, rep callouts, cue throttling, linear progression |
| `www/pose.js` | Camera and MediaPipe Pose Landmarker; skeleton drawing |
| `www/app.js` | Wiring, HUD, settings sliders, wake lock |
| `www/store.js` | localStorage: loads, thresholds, set log |
| `www/vendor/` | MediaPipe wasm + pose model. Generated, gitignored |
| `android/` | Capacitor shell. Regenerate with `npx cap add android` |
| `vendor.mjs` | Rebuilds `www/vendor/` |
| `serve.mjs` | Static dev server, no dependencies |

## Adding a lift

Add an entry to `EXERCISES` in `www/exercises.js`: `rep: {start, end}` angles, a `primary` angle
function, and a `faults` array. Add its thresholds to `RANGES` in `www/app.js` so they get sliders —
a test enforces that. Then add it to `PLAN` in `www/coach.js`.
