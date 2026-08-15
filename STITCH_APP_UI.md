# You — the current design, for Stitch

Everything below describes **what the app looks like today**, not a wishlist. It is the baseline to
redesign from. Section 3 says which parts of it are load-bearing and must survive; everything not
listed there is yours to change.

Paste section 1 first as its own message, opening with:

> Here is an existing Android app I want redesigned. This is what it currently looks like — the
> palette, type, layout and screen contents are all live in the shipped app, not a proposal.
> Keep the information architecture and the constraints at the end; improve the visual design.

Then paste one screen at a time.

**Attach screenshots with them if you can** — Stitch takes image input, and a picture of the real
screen tells it more about the current design than any paragraph here. Run `npm run serve`, open
`http://localhost:8080` in Chrome, switch devtools to a 390px-wide phone, and grab Today, Eat,
Stats, Mind and Me. The camera screen needs the APK on a real phone.

---

## 1. The app as it stands today (paste this first)

An Android fitness and wellbeing app called **You**. Dark mode only, portrait only, one-handed.
Three things in one app: **Lifts**, **Eat**, **Mind**. It runs offline on the phone — no account,
no cloud, no sign-in screen anywhere.

It is used in a gym, mid-set, sweating, often with the phone propped against a wall two metres away,
and at night in bed. The phone's camera watches you lift and counts reps and calls out form faults
as they happen, so one whole screen is live video with a heads-up display over it.

**Navigation:** a fixed bottom tab bar with 5 tabs — Lifts, Eat, Mind, Stats, Me. Thin single-stroke
line icons above short labels. Every other screen is a full-height sheet with a back arrow header,
a scrolling body, and a fixed footer holding the main action.

**Current design language** — this is the intent the shipped app is already built to, and the thing
to push further rather than replace: set like print, not like a dashboard. A masthead, a running order, a hairline
rule, a footnote. Depth comes from steps between near-black surfaces, never from outlines, borders
or drop shadows. No card grids, no two-tiles-over-a-stat-strip fitness layout, no glassmorphism,
no gradients except a dark scrim over camera video, no rings or gauges, no illustrations, no photos.

**Current palette** — near-black base, bone-white ink, exactly one accent, spent once per screen on
the thing to do next. These are the exact values shipping right now:
```
background        #0d0d0f
surfaces          #101013  #141418  #17171b  #1e1e23  #26262c
text              #eceaf0
secondary text    #8f8f9c
hairline          #2a2a31
accent (pink)     #ff4d8d   on-accent #1a0010
danger            #c5020c   on-danger #ffdad6
"Eat" cream       #ede6da   on-cream  #14100a
```
Lifts and actions use the pink. The Eat section uses the cream instead. There is no third hue.

**Current type:** Inter for prose. Headlines heavy (800–900), uppercase, tight negative tracking.
JetBrains Mono, uppercase, wide letter-spacing, for anything read as an instrument — reps, kilos,
timers, angles, grams, dates, labels. Tabular numerals everywhere numbers change.

**Current geometry:** corner radius 2px on buttons and inputs; 14–16px only on floating panels and
chat bubbles. Minimum touch target 64px tall. Screen margin 20px, gutter 16px, 24px between blocks.
Android safe areas respected top and bottom.

**Copy tone:** plain, short, never motivational. "End set", not "Crush it". Never a fake metric,
never a badge, never a streak flame.

---

## 2. Screens as they are today

### Today — the landing screen
Masthead: a small uppercase mono line with the weekday and a greeting ("FRI · MORNING, JASWANTH").
Under it a huge heavy uppercase session title ("PUSH DAY"), a mono meta line
("WEEK 3 · 4 LIFTS · LAST TRAINED TUE"), and one full-width pink **Start** button.

Below a hairline: today's running order as plain rows — lift name left, "3 × 8 @ 62.5 KG" in mono
right. No boxes, no thumbnails, hairlines only. Then a small grey mono footnote line.

Below another hairline, a readout strip — bare figures under mono labels, tappable:
Protein 118/160 g · Water 1.5/3 L · Mood 4/5.

Fixed bottom tab bar: Lifts, Eat, Mind, Stats, Me. The active tab is marked by a 2px pink rule
along the top edge of the tab, not by a filled pill or a coloured icon.

### Live session (camera)
Full-bleed rear camera of a person squatting, thin skeleton overlay drawn on them.
- Top left: lift name, heavy uppercase. Under it a small bordered chip in pink, mono: "SET 2 / 4".
- Top right: an outlined pink button, "Adjust".
- Right edge, vertically centred: an enormous mono rep count "7" in pink with a soft glow, and
  "/ 10" small and grey beneath it.
- Centre, only while framing up: a huge uppercase line ("STAND BACK") with a mono subtitle.
- Near the bottom: a full-width solid red bar with one short bold correction — "KNEES CAVING IN".
- Under it: one line of grey mono status text.
- Bottom: two buttons side by side — solid pink "End set", outlined "Change lift".
- Dark gradient scrims top and bottom so text survives any footage.

Everything on this screen must be readable from two metres away in a bright room.

### Pick a lift
Header with back arrow. A row of filter chips (All, Push, Pull, Legs, Boxing). Then a plain list
of lifts: name in medium weight left, small grey mono detail right ("BARBELL · 62.5 KG"), separated
by hairlines. No cards.

### Lift setup
Back-arrow header. Huge heavy uppercase lift name. A subdued hint card, one line, saying where to
put the phone. A grey mono line: "LAST: 3 × 8 @ 60 KG · 2 CORRECTIONS". A distinct plate-loading
line in mono: "BAR + 20 + 1.25 PER SIDE". A collapsed disclosure, "How to do this lift", which
opens to a block of instructions with a small "Read it out" button in its header.

Then three steppers — Sets, Reps, Weight (kg) — each a label with a minus button, a large mono
value, and a plus button, the whole row at least 64px tall. Then a labelled toggle row, "Warm-up
sets". Fixed footer: outlined "Calibrate" and solid pink "Start".

### Rest
A grey mono summary line. A very large mono countdown, "1:42", centred. A thin progress bar
draining beneath it. Below, a rep correction control: minus button, a large number with the caption
"REPS COUNTED", plus button. Footer: one wide pink "Next set". Almost empty — this is looked at
while breathing hard.

### Boxing setup
Same shape as lift setup. Huge title, hint card. Chip rows for **Session** (shadow, bag, pads) and
**Stance** (orthodox, southpaw). Three steppers: Rounds, Round length (seconds), Rest (seconds).
Footer: "Start bout".

### Eat
Header "Eat", back arrow. This screen's colour is the cream, not the pink.
1. A macro readout block — Calories, Protein, Carbs, Fat as four figures with mono labels and thin
   progress rules. Protein emphasised.
2. A **Water** block: label and a value, a fill bar, then its own row of three wide buttons —
   "+ Glass", "+ Bottle", "+ Litre". This sits above the food list, not inside it.
3. **TODAY** — the day's logged foods as rows, each with a serving stepper.
4. **ADD** — a horizontal row of category chips, then a list of foods; each row is one tap to log,
   with half and double serving as one more tap.
5. A collapsed disclosure, "Something not on the list": name and serving text fields, then four
   steppers (Calories, Protein, Carbs, Fat), and a save button.

Footer: one wide cream button, "Done".

### Stats
Header "Progress". First a chart block: a dual-line chart over 28 days — bodyweight in pink,
calories in cream — on near-black, hairline axes, no gridlines, a mono drift label top-right, and a
small two-item legend. Below it, one block per lift: lift name, a sparkline of working weight over
time, and a single plain-English line underneath in grey. No pies, no rings, no gauges.

### Mind
Its own sheet with its own bottom sub-tab bar: **Talk · Today · Skin · Trends**.

**Talk** — a chat. User messages right-aligned on solid pink with one square corner; replies
left-aligned on a raised dark surface. A composer at the bottom: a growing textarea and a pink Send
button. Directly under the composer, always visible, one small grey line of crisis helpline numbers.
Above the composer, when unconfigured, a setup card: explanatory paragraph, a password field for an
API key, a save button; once saved it becomes a small card with a "Test" button and a status line.

**Today** — stacked cards, calm and low-contrast, used at night in bed:
- an optional bordered pink card offering a fortnightly questionnaire;
- **Mood**: five large tappable numbers 1–5, the chosen one filled pink;
- **Sleep**: two time fields, "Asleep" and "Awake", and a mono line under them showing hours slept;
- **Today's plan**: a checklist of two or three things;
- **Tomorrow**: the same list plus an add row — text field and a pink Add button, placeholder
  "One small thing".

**Skin** — cards: a "Do this" card with one sentence of advice and a small grey evidence line
under it; a "Today's skin" card with a one-line textarea, a "Read that" button, a row of 1–5 score
chips and a wrapping row of multi-select flag chips (Breaking out, Oily, Dry, Red, Sore spots,
Puffy); a "Routine" card of multi-select habit chips; an "Against your log" card of comparison rows.

**Trends** — a 30-day mood line in pink on near-black, no gridlines. Beneath it three comparison
rows: a label ("Days you trained", "Slept 7h+", "Did what you planned"), a difference figure in
mono, and a small grey caption. Show two of the three greyed out and inactive with the caption
"NOT ENOUGH DAYS YET" — that empty state matters more than the filled one and must not look like
data.

### Questionnaire
Its own sheet, no tab bar. A small mono progress marker, "4 / 9". The question in large plain text.
Four full-width stacked answer options, each 64px tall, outlined, the selected one filled pink.
Below, a bordered pink-tinted panel with a heading and helpline numbers. Nothing celebratory, no
score animation.

### Me (profile)
A long single column of labelled rows under mono section headings, hairlines between sections. No
avatar, no photo, no header image.
- One grey intro line: "Only what changes the plan. Everything stays on this phone."
- Name (text field). Bodyweight (kg) and Training days per week (steppers).
- Experience, Goal, Equipment you have, Anything you're nursing, Tracking accuracy — each a label
  above a wrapping row of chips, some single-select, some multi.
- Barbell weight (kg) stepper, and "Plates your gym has (kg)" as a wrapping multi-select chip row
  with a mono note under it.
- A collapsed **Backup** disclosure: a paragraph, two buttons ("Save a copy", "Copy"), a paste
  textarea for restore, and a destructive-feeling "Replace everything" button.

Footer: one wide pink "Save".

### Adjust
An advanced screen of raw form thresholds. A segmented control at the top: "Side-on / Front-on".
Then a vertical list of sliders — label left, current value in mono right, slider beneath, one line
of grey explanation under each. Deliberately dense and technical: this is for someone who knows
what they are changing.

---

## 3. What must survive the redesign

Each of these looks like a style choice and is not. They were arrived at from how the app is
actually used, so treat them as fixed and design around them.

- **64px minimum touch target.** Sweaty hands, mid-set. Do not drop it to 48.
- **The live-session HUD stays huge and high-contrast** — giant mono rep count, full-width red
  fault bar. It is read from two metres away in a bright room. Anything more elegant is worse.
- **Mono, tabular numerals for every changing number.** Proportional digits jitter in a rep counter.
- **Active tab = a 2px rule on the tab's top edge**, not a filled pill or a coloured icon.
- **Crisis helpline numbers stay visible under the chat composer.** Not in a menu, not behind a
  link, not in a footer.
- **Water buttons stay above the food list**, in their own row. Two taps, not four.
- **One accent.** A third hue is the thing this design already fixed once; don't reintroduce it.
- **The greyed-out "NOT ENOUGH DAYS YET" rows in Trends.** The empty state is the honest state and
  must not be restyled into something that reads as data.
- **No streaks, badges, rings, trophies or celebration animations** anywhere in the app.

Everything else — spacing, hierarchy, exact hues, type scale, how blocks are grouped, what a card
is — is open. Push it.
