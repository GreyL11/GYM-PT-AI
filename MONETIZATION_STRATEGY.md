# Monetization Strategy

Grounded in the competitive analysis: the consumer phone-camera-form-check category has already
converged on ~$10–13/mo pricing, with 5+ live competitors. That fact eliminates some options below
outright rather than leaving them open.

## A. Subscription (consumer, direct to lifter)

| Tier | What's in it |
|---|---|
| Free | Live form correction, rep counting, day planner — the whole current app, honestly |
| Pro (~$8–10/mo, matching the market) | Cloud backup/multi-device sync, calibration profiles, video clip of the worst rep per set (not yet built), full history export |

**Evaluation:** Technically straightforward — this is closest to the app as it exists today. But
per the competitive analysis, **this is the most crowded, least differentiated lane available**,
competing directly against apps with the same one-line pitch and existing App Store presence.
**[ASSUMPTION]** a solo, unmarketed, Android-only, unsigned-APK app has close to zero chance of
acquiring paying users in this lane without significant marketing spend this project doesn't have.

## B. Usage-based pricing

Doesn't fit. There's no metered resource — no API calls, no cloud inference, no per-analysis cost.
Charging "per session analyzed" would be charging for something that costs the business nothing to
provide, which is a hard sell against free competitors. **Reject.**

## C. Freemium

The natural free→paid trigger, if this ever has a userbase: **"I am getting real value from the
free tier and now I've lost my phone / want the same coaching on a second device / want my history
back."** That's a legitimate freemium trigger (matches the rule: value first, upgrade because you
need *more*, not because a working feature was deliberately hobbled). The problem isn't the trigger
design — it's that **step zero (cloud backup) doesn't exist in the codebase yet**, so there is
currently no version of freemium this app could actually ship.

## D. B2B / SaaS (gym, studio, trainer)

| What a gym would pay for | Why |
|---|---|
| Per-location or per-kiosk monthly fee | Gyms already buy CRM/booking/access-control software; this is a known budget category |
| Multi-member usage without a per-user cloud cost | Cost structure is genuinely better than a hosted competitor because there's no inference bill |
| Simple usage reporting for the owner ("members did X sessions this week") | Gives the owner something to show, not just something members use |

**Evaluation:** This is the strongest model on the table, for a structural reason found in the
competitive analysis: the hardware competitors (Tempo, Forme, BodyPark) exist specifically because
the phone-in-hand version has a UX problem gyms don't have — a gym can bolt a phone or tablet to
the rack once and never move it. That removes this app's single biggest weakness (setup friction)
for free, and it's a budget-holder (the owner), not the setup-friction sufferer (the member), who
decides to pay.

## E. Revenue-linked pricing

Only realistic with the kind of outcome attribution Hinge/Sword have (member retention lift,
reduced injury claims) — years and a data set away. **Reject for now**, revisit if the B2B lane
gets real customers and real retention data.

## F. Services → SaaS path

**Concretely available today, unlike the others:** sell setup + customization as a one-time or
small-monthly service to a single local gym (install the kiosk, calibrate the lifts the gym
actually has equipment for, train the staff). This validates B2B demand with real money before any
platform work, and it's the only option on this page that requires zero new code to start
attempting.

| Model | Target customer | Why they pay | Pricing hypothesis | Scalability | Risk | Revenue potential |
|---|---|---|---|---|---|---|
| A. Consumer subscription | Solo lifter | Convenience over "do nothing" | $8–10/mo | High (if it worked) | Crowded, unproven acquisition | Low near-term |
| B. Usage-based | — | — | — | — | — | Not applicable |
| C. Freemium | Solo lifter | Wants backup/history | Free → $8–10/mo | High (if built) | Backup doesn't exist yet | Low near-term (blocked) |
| D. B2B gym/studio | Gym owner | Retention + trainer leverage | $50–200/mo per location | Medium — sales-driven, not viral | Requires an actual sales conversation | **Highest realistic near-term** |
| E. Revenue-linked | Insurer/employer | Outcome-tied savings | % of savings or PMPM | High long-term | Needs years of outcome data | High ceiling, far away |
| F. Services→SaaS | One local gym | Wants the D outcome now | Flat setup fee + retainer | Low (one customer at a time) | Low — this is a sale, not a build | **Best validation-per-dollar today** |

---

### PRIMARY BUSINESS MODEL: **F → D** (services-led entry into gym/studio B2B)

Start by selling the current app as a done-for-you kiosk install to **one** local gym — the one
the builder is already a member of, per this conversation's own earlier advice. That single
relationship either produces a paying customer and real usage data, or it produces a clear "no,
because X" that's worth more than any further speculation in this document.

### SECONDARY BUSINESS MODEL: **D at scale**

If the first gym pays and members actually use the kiosk repeatedly, productize what was learned
into a repeatable per-location SaaS offering for other gyms.

### FUTURE EXPANSION MODEL: **Payer-funded rehab (Persona C)**

Real, proven, highest-ceiling — but requires clinical validation and a health-system or insurer
relationship that isn't a next-quarter action for a solo developer. Named here so it's on the map,
not because it's next.

### Explicitly not recommended right now

**Consumer subscription (A) and its freemium variant (C).** Not because the product is bad — it's
that the competitive analysis shows this exact pitch already has 5+ funded or established players
at a converged price point, and this app currently has zero acquisition channel, zero accounts
system, and zero iOS support. Spending the next month polishing a consumer paywall would be
optimizing the least defensible lane on this page.
