# Competitive & Alternative Analysis

**This file corrects something I told you earlier in this conversation.** I said Onyx "was
beautifully built and shut down." Live search shows Onyx is on the App Store in 2026, free to
start. I was wrong, and the honest implication is bigger than one wrong fact: **phone-camera-only
AI form checking is not a gap in the market in 2026 — it's a crowded, price-converged category.**
Everything below is built on live search results run this session, cited at the bottom.

---

## Direct competitors (phone camera, no dedicated hardware) — same category as this app

| Product | Core promise | Pricing (found) | Notes |
|---|---|---|---|
| **Onyx** | Point your phone, it counts reps and corrects form, on-demand workouts | Free to start | Was a well-funded startup; still live and on the App Store in 2026 |
| **CueForm AI** | AI form check for squat/bench/deadlift specifically | Free tier + **$10/mo** unlimited | Narrow lift focus, content marketing (blog posts ranking "best form apps") |
| **FormCheck AI** | General AI form feedback | **~$12–13/mo or $90/yr**, or freemium from $4.86 | Direct freemium-to-paid analog to what this app would need |
| **SensAI** | AI coaching that "remembers injury history" and adjusts the whole program | Not disclosed in search | Positions on personalization/memory across sessions, not just single-rep correction |
| **Zing Coach** | Live rep counter + prompts for bodyweight/home training | Not disclosed | Positioned at home/bodyweight, not barbell lifts |
| **REPS AI Fitness Coach** | "Point your phone's camera at yourself, AI counts every completed rep with form validation" | Not disclosed | Nearly identical one-line pitch to this app's core loop |

**[MARKET EVIDENCE]** The category has converged on **roughly $10–13/month or ~$90/year** as the
going consumer rate for "phone camera checks your form." That is the real price ceiling for a
consumer subscription version of this product — not a number to invent, a number the market has
already set.

## Dedicated-hardware competitors

| Product | Core promise | Notes |
|---|---|---|
| **Tempo** | Smart-gym stand, docks an iPhone, on-device computer vision, "video never leaves the device" | Same on-device-privacy story this app already has — but sold with hardware, which removes the setup-friction problem entirely |
| **Forme** | Full-length smart mirror, AI form correction | Positions as "replace a personal trainer" |
| **BodyPark ATOM** | Pocket AI camera, 34-point skeletal tracking, voice cues, bar-path/center-of-gravity/power tracking (Kickstarter) | More advanced sensing claims than this app currently makes (bar path, power) |

**[ASSUMPTION]** The hardware players exist because the phone-camera version has a real UX problem
— they're solving the exact setup-friction weakness identified in the baseline by fixing the camera
in place. This is evidence *for* the "gym wall-mount / fixed install" opportunity, not against the
core idea.

## B2B / payer-funded alternatives (the rehab/employer lane)

| Product | Model | Notes |
|---|---|---|
| **Hinge Health** | Employer/insurer pays: annual platform fee per eligible member + fees per completed therapy session | Large, well-known digital MSK (musculoskeletal) care company |
| **Sword Health** | Per-employee-per-month, outcomes-linked ("paid when members improve") | Positions itself as ~20% cheaper than Hinge on the same comparison page |

**[MARKET EVIDENCE]** Both of these are large, real businesses proving the Persona C thesis from
the problem map: **someone other than the end user will pay, per member, for camera/sensor-guided
exercise correction, when there's a clinical/employer relationship behind it.** Neither is a
company a solo developer competes with directly — they're evidence the *category* of "movement
correction has payer-grade value," not a target to displace.

## Category size context

**[MARKET EVIDENCE, aggregated third-party estimate, not independently verified]** The "smart
fitness" market is cited at $33.47B (2025) growing to $106.52B by 2030. Treat this as directional
context for "this category matters to someone," not as a number that predicts this app's revenue.

---

## What does this change about the strategy already given?

Three things, honestly:

1. **"Nobody else does on-device camera form checking" is no longer a defensible differentiator.**
   At least five apps make nearly the identical pitch in 2026. The earlier claim that this is
   structurally rare needs to be replaced with something sharper.

2. **The real remaining differentiators, checked against what's actually in this codebase:**
   - **Form-gated progression** — weight only goes up on a clean, full-rep set; automatic 10%
     deload after 3 stalled sessions. None of the competitor one-liners found mention this. Most
     describe form *feedback*, not form feedback wired into a *progression decision*.
   - **Personal calibration that explicitly refuses to learn safety faults away** — the
     safety/efficiency fault split. This is a trust argument, not a feature bullet, and it's the
     kind of thing that matters to a clinical or gym buyer, not a consumer scrolling the App Store.
   - **Zero marginal cost, fully offline architecture.** Tempo makes the same on-device privacy
     claim but sells $2,000+ hardware to get there. This app gets the same property for free. That
     is a real cost-structure advantage for a B2B/gym-installation play, not a consumer app store
     bullet point (consumers don't shop on "your data stays local").

3. **The setup-friction weakness is now confirmed, not just theorized** — it's precisely the
   problem the hardware competitors (Tempo, Forme, BodyPark) all exist to solve, at a much higher
   price point and with venture funding behind them. A solo developer cannot out-hardware Tempo.
   The gym-wall-mount angle from the problem map is the low-cost way to get the same fix.

| Opportunity | Existing solution | Their weakness | Our potential advantage | Difficulty | Revenue potential |
|---|---|---|---|---|---|
| Consumer phone-camera form check | Onyx, CueForm, FormCheck AI, SensAI, Zing, REPS — 5+ live competitors at ~$10/mo | Crowded, price-converged, none publicly emphasize form-gated progression | Progression tied to measured form quality, not just a form score | Low (already built) | **Low** — undifferentiated in a saturated, low-price category |
| Fixed gym installation | Tempo, Forme, BodyPark — all hardware, $500–2000+ | High price, hardware logistics, still a startup-stage category | Software-only, zero hardware cost, wall-mounted phone/tablet | Medium (needs a kiosk-mode UI + a sales conversation) | **Medium-high** — B2B software pricing on top of a gym's existing budget |
| Payer-funded rehab/MSK | Hinge Health, Sword Health — large, funded, clinically validated | Enterprise sales cycles, expensive to build clinical credibility | None yet — this app has no clinical validation | High | **High ceiling, not a near-term path** |
