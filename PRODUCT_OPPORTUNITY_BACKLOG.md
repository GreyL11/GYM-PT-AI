# Product Opportunity Backlog

Money-feature scoring, build-vs-validate calls, and the roadmap. Updated as the loop runs — this is
a living document, not a one-time report.

`MONEY_FEATURE_SCORE = Pain + WTP + Frequency + RevenueImpact + Differentiation + Retention − Risk`
(each dimension scored 0–10, informed by the baseline/problem-map/competitive docs, not measured)

## Ranked candidates

| Rank | Opportunity | Score | Why |
|---|---|---|---|
| 1 | **Multi-profile kiosk mode** (many members, one shared device, namespaced local data) | 38 | The literal prerequisite for the chosen primary business model — a gym kiosk with only one profile slot cannot be piloted at all |
| 2 | **Owner usage dashboard** (sessions/week, most common corrections across all profiles on the kiosk) | 31 | Gives the paying party (the owner) something to look at, not just the using party (the member) |
| 3 | **Worst-rep video clip per set** | 24 | The most viscerally convincing feature not yet built — "here's the elbow flare, not just a claim about it" — strong for both a sales demo and consumer trust |
| 4 | Cloud backup / account (multi-device sync) | 19 | Real gap, but not required for a single-kiosk pilot; required later for the consumer freemium lane, which is explicitly de-prioritized |
| 5 | Signed Play Store listing | 8 | Not a "money feature" — a hygiene prerequisite for *any* distribution beyond a hand-installed APK on one gym's one device |
| — | Consumer paywall / subscription UI | — | **Not scored** — see Monetization Strategy: this is explicitly the lane not being pursued right now |
| — | Nutrition module — further investment | — | **Reject further investment.** Real, working code, but it's the most saturated category in the entire market and doesn't strengthen the actual bet |
| — | Boxing — further investment | — | **Reject further investment until Rank 1–3 are validated.** Zero demand evidence; a second discipline before the first has a paying or even repeat non-builder user |

Not padded to 10 — six real candidates plus two explicit "stop investing here" calls is the honest
list. Inventing four more to hit a round number would violate the brief's own rule against features
that sound complete rather than justified.

---

## #1 PRODUCT BET

> **If we build exactly one thing next, it's multi-profile kiosk mode.**

Not because it's technically interesting — it's a straightforward data-namespacing change plus a
profile picker screen. It's the pick because **every other recommendation in this cycle depends on
it being possible to demo this app to a gym owner as "your members can each use this," not "here is
my personal training app."** Right now the entire codebase assumes one person, one phone,
one `localStorage` key. That's correct for how it was built and wrong for the one path this R&D
cycle identified as having real near-term revenue potential.

**Honest alternative reading:** the single highest-leverage action available is not a build at all
— it's the conversation with the gym owner the builder already has access to, per this
conversation's earlier advice. Kiosk mode is the thing to build **in order to have that
conversation with something to show**, not a substitute for having it.

---

## Build vs Validate

| Opportunity | Assumption being made | Cheapest validation | Call |
|---|---|---|---|
| Multi-profile kiosk mode | A gym owner would actually let this be installed and used by members | **Ask first.** One conversation, zero code, before building | 🟡 Validate, then build fast — it's cheap to build once confirmed |
| Owner usage dashboard | The owner cares about a dashboard, not just member usage | Ask in the same conversation: "what would you want to see" | 🟡 Validate alongside kiosk mode |
| Worst-rep video clip | This visibly increases trust/conversion, not just "looks cool" | Show a mocked screen recording in the same sales conversation before building the real recording pipeline | 🟡 Validate with a mock first |
| Consumer subscription/paywall | Strangers will pay $8–10/mo for a crowded-category app with no distribution | Do not build — the competitive evidence already answers this: acquisition cost would exceed anything a solo, unmarketed app can generate | 🔴 Do not build |
| Cloud backup/accounts | Needed for freemium consumer path | Freemium path itself is de-prioritized, so this is moot until that changes | 🔴 Do not build yet |
| iOS build | Half the paying market is excluded | True, but requires buying/renting a Mac before any other question matters | 🟡 Validate demand (does the one gym prospect even care) before spending on hardware |
| Continued boxing/nutrition investment | Users want a second discipline / a nutrition log specifically from this app | Zero validation exists; the honest move is to stop, not to validate — there's no live user asking | 🔴 Do not build further |

---

## Roadmap

### NOW — Next 7 days
| Item | Problem | Expected value | Revenue impact | Effort | Confidence | Priority |
|---|---|---|---|---|---|---|
| Have the gym-owner conversation | No validated buyer exists yet | Turns every hypothesis above into either a real lead or a real "no" | Direct — this is the sale | Low (a conversation) | High | **P0** |
| Multi-profile kiosk mode | Can't demo "for your members," only "for me" | Makes the pilot conversation concrete | High if the pilot happens | Medium | Medium | P0 |
| Signed Play Store artifact (or at minimum a clean signed APK for the pilot gym) | Unsigned APK triggers Play Protect, kills trust on the spot in a sales context | Removes a trust barrier at the exact moment it would matter most | Indirect | Low | High | P1 |

### NEXT — 30 days
| Item | Problem | Expected value | Revenue impact | Effort | Confidence | Priority |
|---|---|---|---|---|---|---|
| Owner usage dashboard | Owner has nothing to look at between visits | Gives the paying party a reason to keep paying | Direct | Medium | Medium | P1 |
| Worst-rep video clip | Corrections are asserted, not shown | Strengthens both the pilot demo and any future consumer story | Indirect | Medium | Medium | P2 |
| Formalize a per-location pricing offer ($X/month or flat setup fee) based on what the pilot conversation actually revealed | No priced offer exists | Turns a validated interest into an invoice | Direct | Low | Depends entirely on NOW-phase outcome | P1 |

### LATER — 90 days
| Item | Problem | Expected value | Revenue impact | Effort | Confidence | Priority |
|---|---|---|---|---|---|---|
| Repeatable per-location SaaS packaging (if pilot succeeds) | One-off install doesn't scale | Second and third gym customer without re-deriving everything | High | High | Depends on pilot | P1 (conditional) |
| iOS build | Excludes ~half the plausible market | Opens the consumer/second-market lane if ever revisited | High | Low without a validated buyer first | P3 |
| Rehab/clinical exploration (Persona C) | Highest ceiling, unaddressed | Long-term expansion, not a near-term revenue action | Very high, very long-dated | High effort, needs a partner | P3 (track, don't start) |

---

## Backlog table (Phase 10 format, maintained going forward)

| Rank | Opportunity | Problem | User | Value score | Revenue potential | Confidence | Status | Next action |
|---|---|---|---|---|---|---|---|---|
| 1 | Multi-profile kiosk mode | Can't pilot with a real gym on current single-profile design | Gym owner / members | 38 | High (conditional on pilot) | Medium | Not started | Have the gym conversation first |
| 2 | Owner usage dashboard | Owner has no reason to keep paying beyond initial interest | Gym owner | 31 | High (conditional) | Medium | Not started | Design alongside kiosk mode |
| 3 | Worst-rep video clip | Corrections are claimed, not shown | Lifter / gym owner (demo) | 24 | Medium | Medium | Not started | Mock it for the pilot demo before building the real pipeline |
| 4 | Cloud backup / accounts | History dies with the phone | Consumer lifter | 19 | Low near-term | Low priority | Deliberately deferred | Revisit only if consumer lane is reopened |
| 5 | Signed distribution | Unsigned APK is a trust barrier | Any external user | 8 | Indirect | High | Not started | Do before showing the app to anyone outside this session |
| — | Nutrition module expansion | N/A — no evidence anyone wants more | Nobody validated | — | — | — | **Stop investing** | None |
| — | Boxing expansion | N/A — zero real usage yet | Nobody validated | — | — | — | **Stop investing** | Prove lifting retention first |
