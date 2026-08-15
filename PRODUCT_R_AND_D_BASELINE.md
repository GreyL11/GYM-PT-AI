# Product R&D Baseline

**Method note (read first):** this was produced by reading the actual repository — 12 modules,
~6,700 lines, 118 automated tests — not by trusting file names or prior descriptions. Where a claim
comes from code, it's marked **[CODE]**. Where it's inference about a market, it's marked
**[ASSUMPTION]**. Nothing below is **[MARKET EVIDENCE]** in the sense of live research — this
session had no web access when this file was written, so competitor claims later in this cycle are
general knowledge, not a fresh market scan. That distinction matters for how much weight to put on
any conclusion here.

---

## 1. Current Product Definition

> This product helps **one specific person (the developer)** train correctly with no coach present,
> by watching them through a phone camera, counting reps, calling out form corrections in real
> time, deciding what to train each session, adjusting the weight week to week based on whether
> form held up, and logging enough detail (which fault, how often, per-rep timing) to eventually
> answer "am I actually improving."

It also does two adjacent things: a day-by-day nutrition/macro log, and — as of this session — a
boxing mode (rounds, punch counting, guard checking). Both are real, working code, not stubs.

**[CODE]** There is no multi-user concept anywhere in the codebase. `store.js` is a single
`localStorage` key on one device. There is no way for this to currently be "a product for users" —
it is a tool built by and for one person.

## 2. Current User Journey

```
Discovery      → N/A. Not published, not discoverable, not marketed. [CODE: no landing page,
                  no App/Play listing found in repo, distribution is a GitHub Release APK]
Onboarding     → Install unsigned APK → grant camera permission → fill a 6-field profile
                  (bodyweight, experience, goal, days/week, equipment, injuries)
First value    → "Today's plan" screen shows a concrete session immediately after the profile
                  is saved. This is fast — one screen, no empty state. [CODE: app.js showToday()]
Core usage     → Pick a lift or today's plan → camera framing check → live rep counting +
                  form correction → rest screen → repeat
Repeat usage   → Progress screen (1RM trend, fault fingerprint, weekly volume) and the day
                  planner give reasons to open it again the next day
Outcome        → A trained lift, logged with enough fidelity to see whether form and strength
                  are trending in the right direction
```

**Friction points found in code, not guessed:**

- **Setup friction is structural, not a bug.** Every lift needs the phone positioned and angled
  correctly (side-on for most lifts, front-on for lateral raises and boxing), 2–3 m away, at a
  specific height. `app.js` has an entire `cameraCheck()` gate that refuses to start until this is
  right — which is the correct engineering call, but it also means the setup cost is paid **every
  set**, not once. **[ASSUMPTION]** this is the single biggest reason a second user would stop
  using it inside a few sessions — it is the exact failure mode that killed comparable funded
  products (see Phase 2).
- **No account, no cloud.** A lost or wiped phone loses the entire training history. This is
  fine for a single power-user; it is disqualifying for anything with a second user, let alone a
  paying one.
- **iOS does not exist.** Camera + MediaPipe + Capacitor is genuinely portable, but nothing has
  been built, signed, or tested on iOS. Roughly half of the plausible paying market is excluded by
  default.
- **Distribution is an unsigned debug APK behind a GitHub Release.** Anyone trying to install it
  has to fight Play Protect. This is a real barrier for exactly one type of person: someone who
  didn't build it and has no reason to trust it.

## 3. Existing Feature Inventory

| Feature | Actual function [CODE] | User problem | Value | Usage frequency | Revenue potential | Keep/Improve/Remove |
|---|---|---|---|---|---|---|
| Live rep counting + form correction | Pose landmarks → joint angles → per-lift rule engine → voice/haptic/screen cue. 16 gym lifts, each with its own fault set. `exercises.js`, `filter.js` (One-Euro landmark smoothing, verified against real-session bugs) | "No coach is watching me" | **High** — this is the actual differentiator; almost nothing else in consumer fitness does this on-device | Every set, every session | High if the setup friction is solved for someone other than the builder; near-zero otherwise | **Keep — this is the product** |
| Day planner | 6-field profile → weekly split → concrete session with prefilled sets/reps/weight | "What should I train today, and how much" | Medium — genuinely useful, but many free apps do this without a camera | Daily | Low standalone (commodity); valuable as retention glue around the camera feature | Keep |
| Progression + auto-deload | Adds weight only on a clean, full-rep set; backs off 10% after 3 stalled sessions; bodyweight lifts progress on reps | "Am I progressing safely" | Medium-high — form-gated progression is uncommon | Every session | Contributes to differentiation, not standalone revenue | Keep |
| Progress/analytics screen | Estimated 1RM trend (Epley, corrected for a real bug), fault fingerprint, weekly volume by muscle group, recovery warnings | "Show me if this is working" | Medium — depends entirely on weeks of accumulated data existing | Weekly-ish | Needs 4+ weeks of use before it says anything; this is the retention hook if it fires | Keep, needs a "why should I check this today" trigger |
| Calibration | Records ~15s of reps, learns the user's own rep endpoints/lockout/depth from percentiles, refuses to learn technique tolerances | "The thresholds are generic, not mine" | High for anyone whose build differs from the default assumption (which is everyone) | Once per lift, occasionally | Not directly monetizable but core to trust | Keep |
| Boxing (shadowbox/bag/pads) | Round clock, punch detection via 3D wrist-vs-shoulder reach, jab/cross/hook/uppercut classification with a stated confidence, guard/return/elbow/rotation faults | "Track my boxing training the same way" | Medium — adds a second discipline, but built for a userbase of one with no evidence anyone wants boxing specifically | Unknown — zero real sessions run yet | Unclear; expands TAM narrative more than proven demand | **Keep but do not invest further until v1 (lifting) retention is proven** |
| Nutrition/macro log | Manual food log, macro targets from profile, water tracking, weight trend, daily calorie/macro suggestion engine | "Track what I eat" | Low differentiation — this is a commodity category (MyFitnessPal, Cronometer, etc. dominate) | Daily, if used | **Low** — this feature category is where free/ad-supported giants already won; adding it does not make the camera product more valuable | **Reconsider scope** — see Phase 3 |
| Technique briefs | Spoken setup/execution/mistakes per lift, first-time-use + on-demand | "I don't know how to actually do this lift" | Medium — real gap, closes a support/trust issue raised earlier this session | Rare after first use per lift | Not monetizable alone; reduces churn from confusion | Keep |
| Discipline picker (Gym/Boxing) | Top-level segmented selector above muscle-group filter | Structural, prepares for >2 disciplines | N/A (navigation) | N/A | N/A | Keep |

**[CODE] Test coverage:** 118 assertions across 8 suites, all pure-logic (no DOM). This is unusually
disciplined for a solo project and materially reduces the risk of the core rule engine being wrong
— but it says nothing about whether a stranger would find the product valuable enough to keep
opening it, which no test suite can measure.

## 4. Current Strengths

- **The core mechanism is genuinely rare.** On-device, no-cloud, no-cost-per-user camera form
  correction with form-gated progression. Most comparable products either don't exist at consumer
  price points or require a cloud API (cost per user) or dedicated hardware (Tempo's mirror).
- **Zero marginal cost per user.** No backend, no inference bill, no API key. A subscription
  business built on this has unusually good unit economics *if* anyone pays for it.
- **Unusual intellectual honesty in the engine itself.** Faults are split into `safety` (never
  learned away by calibration) vs `efficiency` (personalized). Punch classification carries a
  stated confidence instead of pretending precision it doesn't have. This is a real asset for any
  path that requires trust — clinical, insurance, or B2B — because it is the opposite of the "AI
  theater" failure mode reviewers are quick to call out.
- **Real bugs caught by tests before a phone ever saw them** — phantom reps during setup, a frozen
  camera on app-resume, faults that could structurally never fire. This matters for credibility
  with any technical buyer (a gym, a clinic) who will ask "how do you know it works."

## 5. Critical Weaknesses

- **N=1.** There is no evidence, anywhere, that a second human has used this. Every conclusion
  about retention, willingness to pay, or product-market fit below this line is a **hypothesis**,
  not a finding, until that changes.
- **No accounts, no cloud, no payments, no analytics telemetry.** None of the infrastructure a
  monetized product needs exists yet. This isn't a feature gap, it's a "there is currently no way
  to charge anyone or even find out if they'd use it twice" gap.
- **No iOS.** Structural, not a quick fix — needs a Mac and $99/year minimum.
- **Setup friction is the same failure mode that killed funded, better-resourced competitors**
  (Phase 2). Nothing in the current build addresses it; calibration and framing checks make the
  *first* setup correct, not the *repeated* cost of doing it every set.
- **Nutrition tracking is scope creep relative to the actual differentiator.** It's well-built, but
  it competes in the most saturated category in the entire fitness-app market against products
  with a decade of head start. It does not make the camera coaching more valuable; if anything it
  dilutes what the product is *for* in a stranger's first impression.
- **Boxing was added on zero demand signal.** Not wrong to have built — the engine work was sound —
  but it's a second discipline before the first one has a single non-builder user. Effort spent
  here is effort not spent closing the setup-friction gap, which is the actual blocker.
