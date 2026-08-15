# Problem / Opportunity Map

All personas below are **[HYPOTHESIS]** — grounded in what the product actually does, not in
interviews or usage data, because none exist yet (N=1: the builder). Pain scores are estimates for
calibrating priority, not measurements.

---

## Persona A — The unsupervised solo lifter

**Who:** Trains alone (no partner, no PT, no coach), self-taught or semi-self-taught, cares about
form but has no way to check it. This is the builder's own use case.

**Job-to-be-done:** "Tell me if I'm doing this lift in a way that will hurt me or waste the
session, without paying a coach $50–150/session or asking a stranger at the gym."

**Today, without this:** Film themselves on a phone and review it afterward (slow, easy to skip,
no real-time correction); ask a gym-goer for a form check (inconsistent, awkward, not always
available); or — most commonly — do nothing and hope. **[ASSUMPTION]**

**Cost of the problem:**
- Time: minutes lost per session second-guessing form; hours lost to injuries that better form
  would have prevented
- Money: a single PT session ($50–150) costs more than a year of most fitness app subscriptions
- Risk: the actual cost that matters — a rounded-back deadlift or a caved knee is a potential
  injury, not just a missed gain

**Pain score:** Severity 6/10 · Frequency 9/10 (every session) · Urgency 4/10 (rarely acute) ·
Budget 5/10 (fitness spend exists, but this category is used to $0–15/mo)
`PAIN_SCORE ≈ 6 × 9 × 4 × 5 = 1080` — high frequency carries this, not high budget.

**Verdict:** Real problem, proven at N=1, **unproven willingness to pay** because the free/cheap
alternative ("do nothing" or "film and self-review") is good enough for most people most of the
time. This is exactly the persona that funded, better-built competitors (Onyx, and to a lesser
extent Tempo) tried to monetize directly and struggled with.

---

## Persona B — Small independent gym / PT studio owner

**Who:** Runs or manages a gym or training studio, is not a software buyer by profession, cares
about member retention and differentiation from the gym down the street.

**Job-to-be-done:** "Give my members a reason to stay, and give my trainers leverage so one trainer
can safely support more members at once."

**Today, without this:** Trainers physically watch members set by set (does not scale); or members
get zero form feedback outside their paid sessions; some gyms have begun installing camera-based
form-check kiosks or apps as a premium amenity. **[ASSUMPTION + general category knowledge, not
verified this session]**

**Cost of the problem:** Member churn is expensive to a gym (CAC to replace a member is real
money); a trainer's time is the studio's most constrained resource; liability from an unsupervised
bad rep is a real, if usually small, exposure.

**Pain score:** Severity 5/10 · Frequency 6/10 (an ongoing concern, not per-session for the owner)
· Urgency 3/10 · Budget 7/10 (gyms already buy software — CRM, class-booking, access control)
`PAIN_SCORE ≈ 5 × 6 × 3 × 7 = 630`

**Verdict:** Lower raw pain than Persona A but **dramatically higher and more provable budget**,
and the setup-friction problem (Weakness #3 above) mostly disappears if the phone is wall-mounted
in one spot instead of moved between exercises. This is the persona where the same technology's
biggest weakness stops mattering.

---

## Persona C — Rehab / physiotherapy patient doing home exercises

**Who:** Prescribed a home exercise program by a physio, expected to do it correctly and
consistently between clinic visits, with no one watching.

**Job-to-be-done:** "Do my prescribed reps correctly so I actually get better, and let my
therapist know if I'm not."

**Today, without this:** Paper handout with diagrams, occasional video call check-ins, or nothing.
Non-adherence to home exercise programs is a well-documented, large problem in physiotherapy.
**[general clinical-domain knowledge, not verified this session — treat as background context,
not a cited source]**

**Cost of the problem:** Slower recovery, repeat clinic visits, in some health systems this is
literally billed and reimbursed — meaning there is an existing payer (insurer/employer) with an
established habit of paying for exactly this outcome.

**Pain score:** Severity 8/10 · Frequency 8/10 (daily home exercises) · Urgency 6/10 (recovery
timelines matter) · Budget 8/10 (third-party payer, not the patient's own wallet)
`PAIN_SCORE ≈ 8 × 8 × 6 × 8 = 3072` — the highest of the four, and for the right structural
reason: **someone other than the end user pays**, which sidesteps the "is this worth $10/mo to me"
question entirely.

**Verdict:** Highest ceiling, by far. Also the highest bar to enter — clinical validation, likely
regulatory scrutiny, and a B2B2C sales cycle through health systems or insurers, not something a
solo developer starts with. Named here because it's the honest answer to "who has budget", not
because it's the recommended next step.

---

## Persona D — Boxing hobbyist training alone

**Who:** Shadowboxes or hits a bag with no partner or coach present.

**Job-to-be-done:** "Tell me my guard is dropping and count my output."

**Today, without this:** Mirror, or nothing. **[ASSUMPTION]**

**Pain score:** Severity 4/10 · Frequency 5/10 · Urgency 2/10 · Budget 3/10
`PAIN_SCORE ≈ 4 × 5 × 2 × 3 = 120` — lowest of the four, and **entirely unvalidated**: this
persona exists in the codebase (a full, tested module) with zero evidence any real person asked
for it.

---

## Ranked priority

| Rank | Persona | Pain score | Budget reality | Recommended stance |
|---|---|---|---|---|
| 1 | C — Rehab/physio patient | 3072 | Third-party payer, proven category | Highest ceiling; not a solo-dev starting point — flag for later, needs a clinical partner |
| 2 | B — Gym/studio owner | 630 | Proven software buyer, budget exists today | **Best near-term target** — solves the setup-friction problem structurally |
| 3 | A — Solo lifter (the builder) | 1080 | Unproven; free alternatives are "good enough" | Proven use case, unproven paying market — this is what the 4-week test should measure |
| 4 | D — Boxing hobbyist | 120 | Unvalidated | Do not invest further until A is proven |
