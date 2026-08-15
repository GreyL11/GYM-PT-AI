# Redesigning You with Google Stitch

The current palette already came out of a Stitch export (see the comment at the top of
`www/index.html`). The referenced `trainer/DESIGN.md` is gone, so this file replaces it: the brief
to paste back in, the per-screen prompts, and the rule for what you take from Stitch and what you
throw away.

## 1. What Stitch is good for here, and what it isn't

Stitch (stitch.withgoogle.com, free with a Google account) turns a text prompt or a screenshot into
mobile UI screens, lets you edit them by chatting, and gives you two exits: **Copy code**
(HTML + Tailwind classes) and **Paste to Figma**. Verify the current mode names and quotas in the
product — it has a cheap fast mode and a slower higher-quality one with a monthly cap, and those
numbers move.

**The hard constraint for this repo:** Stitch's code output is Tailwind. `index.html` explicitly
rejected Tailwind — a CDN build leaves the APK blank with no error. So:

> Stitch is a **design source, not a code source**. You harvest colour, type scale, spacing and
> layout decisions from it and hand-port them into the plain CSS in `www/index.html`. You never
> paste its markup into the app.

That is not a workaround, it is the correct use. This app's screens are driven by real state —
rep counts, plate maths, a 30-day mood line, a streaming chat. Stitch has no idea any of that
exists and will invent plausible-looking numbers. Its job is to tell you what the screen should
*look* like at one moment in time.

**Two exits worth knowing:**
- Screenshot-in is stronger than prompt-in for a redesign. Screenshot your live screens
  (`npm run serve`, phone-width devtools) and ask Stitch to restyle them. You keep your information
  architecture and only change the skin — which is the whole job here.
- **Paste to Figma** is worth doing even if you never open Figma seriously, because it gives you
  the real hex values and type sizes as inspectable layers instead of you eyedropping a PNG.

## 2. Paste-once brief

Put this in the first message of a new Stitch project, before any screen prompt. Everything after
inherits it.

```
A dark-mode Android fitness and wellbeing app called "You". Three things in one app: Lifts, Eat, Mind.
It is used one-handed, in a gym, mid-set, sweating, sometimes at arm's length propped against a wall.

Design language: set like print, not like a dashboard. A masthead, a running order, a hairline rule,
a footnote. Depth comes from steps between near-black surfaces, never from outlines or drop shadows.
No cards-in-a-grid, no two-tile-over-a-stat-strip fitness layout, no glassmorphism, no gradients
except a scrim over camera video.

Palette — near-black base, bone-white ink, exactly one accent used sparingly on the next action:
  background #0d0d0f, surfaces #101013 / #141418 / #17171b / #1e1e23 / #26262c
  text #eceaf0, secondary text #8f8f9c, hairline #2a2a31
  accent (pink) #ff4d8d, on-accent #1a0010
  danger #c5020c, on-danger #ffdad6
  "eat" ink #ede6da on #14100a
Colour is spent once per screen, on the thing to do next. Everything else is ink on near-black.

Type: Inter for prose. Headlines are heavy and uppercase with tight negative tracking. JetBrains Mono
uppercase with wide letter-spacing for anything read as an instrument — reps, kilos, timers, angles,
grams, dates. Tabular numerals.

Geometry: corner radius 2px on buttons and inputs, 14-16px only on floating panels. Minimum touch
target 64px tall. Screen margin 20px, gutter 16px, vertical rhythm 24px between blocks. Respect
Android safe areas top and bottom.

Tone of copy: plain, short, never motivational. "End set", not "Crush it". Never invent a metric.
```

Then set the Stitch theme panel to match rather than fighting it: dark, primary `#ff4d8d`, Inter,
smallest available corner radius.

## 3. Screen prompts

Thirteen surfaces. Each has its real content listed so Stitch doesn't invent a different app. Do
them one at a time in the same project so the theme carries.

**1. Today — the landing screen** (`#sheet-today`)
```
Landing screen. Top: small uppercase mono line with the weekday and a greeting. Below it a huge
heavy uppercase session title ("PUSH DAY"), a mono meta line ("WEEK 3 · 4 LIFTS · LAST TRAINED TUE"),
and one full-width accent Start button. Below a hairline: the running order of today's lifts as
plain rows — lift name left, "3 x 8 @ 62.5 KG" in mono right, no boxes. Below another hairline, a
row of readouts as bare figures under mono labels: Protein 118/160 g, Water 1.5/3 L, Mood 4/5.
Footnote in small grey mono. Fixed bottom tab bar, 5 tabs: Lifts, Eat, Mind, Stats, Me — thin
single-stroke line icons above short labels, active tab marked by a 2px accent rule on top of the
tab, not by a filled pill.
```

**2. Live session HUD** (the camera overlay in `#stage`)
```
Full-bleed rear camera view of a person squatting, with a thin skeleton overlay. On top: at top-left
the lift name in heavy uppercase and a small bordered chip "SET 2 / 4" in accent; top-right an
outlined accent "Adjust" button. Right-hand side, vertically centred: an enormous mono rep count "7"
in accent with a soft glow, and "/ 10" small and grey beneath it. Near the bottom a full-width red
alert bar with one short bold correction: "KNEES CAVING IN". Below it a single line of grey mono
status text. Bottom: two buttons side by side, "End set" solid accent and "Change lift" outlined.
Dark gradient scrims top and bottom so text stays readable over any footage. Everything must be
legible at 2 metres away in a bright room.
```

**3. Lift setup** (`#sheet-setup`)
```
Back arrow header. Huge heavy uppercase lift name. A subdued hint card, one line: where to put the
phone. Grey mono line "LAST: 3 x 8 @ 60 KG · 2 CORRECTIONS". A distinct plate-loading line, mono,
that reads "BAR + 20 + 1.25 PER SIDE". A collapsed "How to do this lift" disclosure. Then three
number steppers — Sets, Reps, Weight (kg) — each a label with a minus button, a large mono value,
and a plus button, all at least 64px tall. A labelled toggle row "Warm-up sets". Fixed footer with
two buttons: outlined "Calibrate" and solid accent "Start".
```

**4. Rest timer** (`#sheet-rest`)
```
Rest screen. Grey mono summary line at top. A very large mono countdown "1:42" centred. A thin
horizontal progress bar draining beneath it. Below, a correction control: a minus button, a large
number with the caption "REPS COUNTED", a plus button. Fixed footer: one wide accent "Next set"
button. Calm, almost empty — this is a screen you look at while breathing hard.
```

**5. Lift picker** (`#sheet-picker`) — *ask for the list form, not a card grid*
```
A pick-a-lift list. Filter chips across the top (All, Push, Pull, Legs, Boxing). Then a plain list
of lifts: name in medium weight on the left, small grey mono detail on the right ("BARBELL · 62.5 KG"),
separated only by hairlines, no cards and no thumbnails.
```

**6. Eat** (`#sheet-eat`)
```
Header "Eat" with back arrow. First a macro readout block: Calories, Protein, Carbs, Fat as four
figures with mono labels and thin progress rules, protein emphasised. Then a Water block with its
own row of three wide buttons "+ Glass", "+ Bottle", "+ Litre" above a fill bar. Then "TODAY" — the
day's logged foods as rows with a serving stepper on each. Then "ADD" — a horizontal row of category
chips and a list of foods, each row tappable with half/double serving affordances. A collapsed
"Something not on the list" disclosure containing text fields and four steppers. Footer: one wide
button in bone-white (not pink) — this section's colour is cream #ede6da, not the accent.
```

**7. Stats / Progress** (`#sheet-progress`)
```
Header "Progress". First a chart block: a dual-line chart, bodyweight in pink and calories in cream,
28 days, on near-black with hairline axes and no gridlines, a mono drift label top-right, and a small
two-item legend. Below it, per-lift blocks: lift name, a sparkline of working weight over time, and a
plain-English one-line read underneath in grey. No pie charts, no rings, no gauges.
```

**8. Mind — Talk** (`#sheet-mind`, talk panel)
```
A chat screen. User messages right-aligned on solid accent pink with one square corner; assistant
messages left-aligned on a raised dark surface. A composer at the bottom with a text field and a
send button, and directly under the composer a small grey line of crisis helpline numbers that is
always visible. Above the composer area, a dismissible setup card asking for an API key with a
password field and a save button. Sub-tab bar at the very bottom with three tabs: Talk, Today, Trends.
```

**9. Mind — Today**
```
A daily check-in. First a mood row: five large tappable numbers 1-5, the selected one filled accent.
Then a sleep row: hours slept and a wake time field. Then "PLANS" — two or three text rows with
checkboxes, placeholder text reading "walk to the shop at 7". Then a quiet prompt offering a
fortnightly questionnaire. Spacious, calm, low-contrast — this screen is used at night in bed.
```

**10. Mind — Trends**
```
A 30-day mood line chart in accent on near-black, no gridlines. Beneath it three comparison rows,
each: a label ("Days you trained", "Slept 7h+", "Did what you planned"), a difference figure in mono,
and a small grey caption. Show two of the three rows greyed out and inactive with the caption
"NOT ENOUGH DAYS YET" — that state matters more than the active one.
```

**11. Questionnaire** (`#mind-check`)
```
One question per screen. A small mono progress marker "4 / 9". The question in large plain text.
Four full-width answer options stacked, each 64px tall, outlined, the selected one filled accent.
Below: a bordered pink-tinted panel with a heading and helpline numbers, shown as an example of the
support state. Nothing celebratory, no score animation.
```

**12. Me / Profile** (`#sheet-profile`)
```
A settings page as a long single column of labelled rows and steppers under mono section headings:
YOU (bodyweight, height, age, goal, days per week), BAR AND PLATES (bar weight, which plates your
gym stocks as a row of toggle chips), BACKUP (an explanatory paragraph and two buttons, "Download"
and "Copy"). Hairlines between sections, no cards, no avatar, no profile photo.
```

**13. Adjust** (`#sheet-settings`)
```
An advanced screen of raw thresholds. A vertical list of labelled sliders, each with the label left,
the current value in mono right, and the slider beneath, plus one line of grey explanatory text under
each. A camera-view segmented control at the top: "Side-on / Front-on". Deliberately dense and
technical-looking — this is the screen for someone who knows what they're changing.
```

## 4. Harvesting the output

For each screen Stitch gives you: a rendered image, Tailwind HTML, and a Figma paste. Take, in
this order:

1. **Tokens.** Read the hex values and type sizes out of the Tailwind classes or the Figma layers.
   If Stitch moved the palette somewhere better, the only file that changes is the `:root` block at
   `www/index.html:15` — every colour in the app already reads from those variables. That is the
   cheapest possible redesign and you should try it alone first, before touching layout.
2. **Type scale.** `.data`, `.hero`, `.headline` and the `body` font shorthand, all in the same
   `<style>` block. Four declarations carry most of the app's voice.
3. **Spacing.** `--gutter`, `--margin`, `--stack`. Changing these three moves every screen at once.
4. **Layout, per screen, by hand.** Only where Stitch genuinely beat what's there. Read its
   structure, then write the equivalent in the existing class vocabulary — `.sheet`, `.body`,
   `.foot`, `.card`, `.row`, `.stepper`, `.readout`, `.chips`, `.exlist`. New classes only when
   the structure is new.
5. **Icons.** Stitch will emit Material Symbols. The app uses seven hand-drawn one-stroke symbols
   in the `<defs>` block at `www/index.html:700`. If you replace them, replace all seven at one
   stroke weight and keep them on `currentColor` — the tab dim/light behaviour depends on it.

Nothing else. Not the markup, not the classes, not the fake data.

## 5. Do not let Stitch change these

Every one of these is load-bearing, and Stitch cannot know that:

- **`--touch: 64px`.** Chosen for sweaty hands mid-set. Stitch will suggest 48.
- **HUD legibility.** The rep count is huge, mono, glowing and pinned right because it is read from
  two metres away. The cue bar is full-width red for the same reason. Any prettier version is worse.
- **Mono for instruments.** Reps, kilos, timers, angles, grams. Proportional numerals in a rep
  counter jitter as they change.
- **The tab-bar active state** is a top rule, not a filled pill, deliberately — see the comment at
  `www/index.html:579`.
- **Crisis numbers under the composer** and in the risk panel. They stay visible; they are not a
  disclosure, not a footer link, not behind an accordion. Four places, `README.md:98` lists them.
- **The greyed-out comparison rows in Trends.** The empty state is the honest state and it must not
  be redesigned into something that looks like data.
- **Water buttons above the food list.** Two taps, not four, is the entire point.
- **One accent.** If Stitch hands back a third hue, that is the app going back to the three-palette
  mess the current comment describes. Reject it.

## 6. Order of work

Cheapest to most expensive. Stop as soon as it looks right.

1. Screenshot the five main screens, feed them to Stitch with the brief, ask only for a palette and
   type pass. Port the result into `:root` plus the four type rules. Ship. This is a ~40-line diff.
2. If the layout is genuinely the problem, redo Today, Eat and Setup only — they carry the app.
3. Everything else last, and Adjust / Data probably never.

Check with `npm run serve` at 390px wide, then on the phone, then in a bright room with the camera
running — the HUD is the only screen where a redesign can make the app actually worse.
