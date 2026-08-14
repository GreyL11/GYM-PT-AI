# You

Three things you look after, in one app: **Lifts**, **Eat**, **Mind**.

Live form checking and session coaching for squat, bench press, skullcrusher and cable pushdown.
Pose estimation runs on-device — camera frames never leave the phone. No server, no account, no
network needed once installed. The one exception is the Mind check-in, which is the only screen
that talks to anything (see below) and works without it.

The repo directory is still `gym-trainer` and the Android package is still `com.jaswanth.trainer`
— renaming the package would make Android treat it as a different app, so you would install fresh
and lose your training history.

## Get the APK

On the phone, open [releases/latest](https://github.com/GreyL11/GYM-PT-AI/releases/latest) and tap
`you.apk`. Chrome warns about the file type — download anyway, tap it, and allow installs from
Chrome when Android asks. Builds up to `build-8` are named `trainer.apk`; it is the same app and
installs over the top, since the package id has not changed.

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

**Water** has its own buttons at the top of the screen — glass, bottle, litre — because logging a
drink through the food picker is four taps for something you do ten times a day. Anything with a
volume counts toward it, so your tea and your milk are not invisible. Beer is not: it is a diuretic,
and counting a pint toward hydration would be worse than not counting it.

There is no food API, no downloaded database and no language model. The app has no network and no
account, and a nutrition API would need a key baked into the APK that stops working on gym wifi.
The table covers the staples; you cover the rest, once.

The targets are a starting guess in exactly the way starting loads are. What corrects them is the
**Coach** card: bodyweight against calories over 28 days. Log your weight (it is the same field in
your profile that scales your lifts) and it will tell you when the two numbers disagree — including
when the honest answer is "you are eating more than you are logging".

## Mind

A notebook with a voice, not therapy and not a therapist. Three panels under the **Mind** tab.

**Talk** — an end-of-day check-in that streams from Gemini and remembers the conversation. This is
the only part of the app that uses the network, and the only part that needs a key: paste one into
the setup card and it is stored on the device in plain text, so set a spend limit on it. Everything
else on this screen works without a key. Swapping provider is `www/chat.js` and nothing else — no
other file knows what is behind the chat.

The chat is the *interface*. What has evidence behind it is the rest:

**Today** — mood 1–5, sleep, and the day's plans. Plan two or three specific things the night
before, tick them off the next day. That loop (behavioural activation) is the highest-evidence
thing an app like this can actually deliver, which is why the placeholder says "walk to the shop at
7" rather than "get outside more". Fixed wake time is the part of the sleep card that does the
work.

**Trends** — 30-day mood line, and the difference in average mood on days you trained, slept 7h+,
or did what you planned. **Days you trained is read straight off your lifting log** — that is the
reason this lives in the trainer instead of being its own app. Every comparison stays grey until
there are at least four logged days on both sides; the alternative is an app confidently telling
you something it invented from three data points.

Every fortnight Today offers a **PHQ-9**. It is a screener, not a diagnosis. It exists so the rest
can be judged — without a number that moves you will keep whichever feature felt nicest rather than
the one that helped. Answering item 9 above zero surfaces help immediately, whatever the total says.

Crisis numbers are hard-coded to India (Tele-MANAS 14416, KIRAN 1800-599-0019) plus
findahelpline.com, in four places: under the composer and in the risk panel in `index.html`, and in
the system prompt and `BLOCKED_REPLY` in `chat.js`. Change all four if you are somewhere else.

## Back it up

Everything lives in one localStorage key on one phone. No account, no cloud, nothing to recover
from — lose the phone and a year of training goes with it. **Profile → Backup** writes the lot out
as JSON: save the file, or copy it and paste it somewhere you trust. The same screen restores it.

The file download is the one you want, but a Capacitor WebView with no `DownloadListener` drops
blob downloads silently, so **Copy** is there as the path that works everywhere. If nothing lands
in your downloads, use it.

## Loading the bar

The setup screen shows what to hang on each end — `Bar + 20 + 1.25 per side` — so you are not doing
`(62.5 − 20) ÷ 2` in your head twenty times a session. It appears for barbell lifts only; a cable
stack is a pin position and dumbbells come as they come.

Tell it your bar and which plates your gym stocks in **Profile**. This matters more than it sounds:
plates go on in pairs, so the smallest change you can make is *twice* your smallest plate. A gym
whose smallest plate is 2.5 kg cannot make 62.5 kg at all — and rather than prescribing it anyway,
progression now steps in 5s there and every weight it suggests is one the bar can actually be
loaded to. If you dial in something impossible by hand, it says what you would really end up with.

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
| `www/mood_insights.js` | Mind's arithmetic: mood vs training, sleep, plans. Pure, `insights.js`'s sibling |
| `www/checks.js` | PHQ-9 / GAD-7 items, scoring, and the item-9 rule |
| `www/chat.js` | Gemini call, SSE parsing, the check-in system prompt. The only networked file |
| `www/mood.js` | Mind display wiring |
| `www/app.js` | Wiring, HUD, settings sliders, wake lock |
| `www/store.js` | localStorage: loads, thresholds, set log, meals, bodyweight, mood days, checks, chat |
| `www/vendor/` | MediaPipe wasm + pose model. Generated, gitignored |
| `android/` | Capacitor shell. Regenerate with `npx cap add android` |
| `vendor.mjs` | Rebuilds `www/vendor/` |
| `serve.mjs` | Static dev server, no dependencies |

## Adding a lift

Add an entry to `EXERCISES` in `www/exercises.js`: `rep: {start, end}` angles, a `primary` angle
function, and a `faults` array. Add its thresholds to `RANGES` in `www/app.js` so they get sliders —
a test enforces that. Then add it to `PLAN` in `www/coach.js`.
