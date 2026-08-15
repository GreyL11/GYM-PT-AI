# Health Intelligence Implementation Report

## 1. What existed before
Nine deterministic domain modules (training/`insights.js`, sleep+bodyfat+training-for-testosterone
already in `t_inputs.js`, skin+routine in `skin.js`, nutrition in `nutrition.js`, progression
verdicts in `store.verdicts`), evidence discipline in `evidence.js`, an LLM pipeline
(`chat.js`/`digest.js`/`validate.js`/`explain.js`) already proven safe. **Nothing synthesized
across domains into one recommendation.**

## 2. What was reused (nearly everything)
`t_inputs.js` **is** the testosterone/hormonal domain — already evidence-gated, already cites
Leproult & Van Cauter 2011, already refuses a score, already returns `'unknown'` below its floor.
`health.js` adds zero new hormonal arithmetic; it only classifies `t_inputs.advice()`'s own output.
Also reused as-is: `nutrition.waterTarget/fluid/dayEntries`, `skin.HABITS`/`store.day().skin`,
`planner.today/doneToday`, `store`'s additive-key + capped-array pattern, `digest()`'s
`prune()`/absent discipline, and the entire `chat.js`/`validate.js` LLM machinery — no second AI
pipeline was built.

## 3. Architecture implemented
One new pure module, `www/health.js`, sitting above the existing domain modules:
```
RAW DATA (existing store) → existing domain modules (unchanged)
    → candidate generators (thin wrappers, health.js)
    → priority engine (explicit tiers, health.js)
    → selectNextBestAction() → { action, why, runnerUps }
    → UI card (app.js) / hormonal panel (mood.js)
    → outcome log (store.actions[], additive)
    → digest() carries the pick into the existing LLM pipeline (no new one)
```

## 4. Health evidence model
Every candidate carries `status: 'ok' | 'no_evidence' | 'insufficient_evidence'` (evidence.js's own
vocabulary) and a `limitation` string. Absence routes to `TIER.DATA_COLLECTION`
("Log today's water"), never a health verdict. Verified by test: zero meals today → hydration
candidate is `no_evidence`/`DATA_COLLECTION`, never "dehydrated"; a rest day is `GOING_WELL`, never
"unhealthy"; a good workout log never becomes a testosterone claim.

## 5. Candidate action system
Four generators, each a thin wrapper: `hydrationCandidate`, `skinRoutineCandidate`,
`trainingCandidate`, `hormonalLifestyleCandidate`. Each candidate: `{id, domain, tier, title,
reason, status, evidence, limitation, urgency}`. No generator invents an action the underlying
module didn't already support.

## 6. Priority engine
**Explicit tiers, not scores**: `ACTIONABLE_NOW(1) < DATA_COLLECTION(2) < GOING_WELL(3)`. Ties
within a tier break on a fixed, documented `DOMAIN_ORDER` (training → hormonal → hydration → skin),
never a weighted number. `selectNextBestAction()` always returns a `reasonSelected` sentence and a
`runnerUps` list with each loser's own stated reason.

## 7. Next Best Action experience
One card at the top of the existing Today sheet (`#health-card`) — no new tab, no new sheet.
Hidden entirely on `GOING_WELL` (nothing to show beats a false "all good" banner). Shows title,
reason, and a **Why this?** disclosure with the deterministic selection reasoning plus what was
**not concluded** for the runners-up, verbatim from their own limitations.

## 8. Guided walkthroughs
Given the budget, implemented as **Done / Skip / Later** on the card itself rather than a
multi-step wizard — a real completion loop, scoped to what the evidence actually supports. Skincare
"guidance" deep-links conceptually to the existing Skin panel (already a checklist); no new routine
steps were invented. A full multi-step visual wizard (P1's fuller vision) was **not** built — see
Limitations.

## 9. Outcome/adaptation behavior
`store.actions[]` (additive, capped at 1000, same pattern as `verdicts[]`). `recordOutcome()` /
`suppressed()`: completed/skipped suppress until the calendar day changes; postponed suppresses for
`POSTPONE_MS` (2h) then resurfaces — never silently dropped. `preferredHour()` needs ≥3 real
completions and returns a **descriptive** bucket only ("tends to complete in the afternoon"); tested
that it never claims a causal effect and never fires below the evidence floor.

## 10. Testosterone/hormonal health support
New Mind tab, **Hormonal**. Per-factor `SUPPORTED/PARTIAL/ABSENT` (sleep, training, weight,
nutrition, lab), reusing `t_inputs.read()` verdicts directly — lab is unconditionally `ABSENT` (no
lab-entry field exists anywhere in this app; **not built**, per the P3 budget instruction). The
boundary sentence (`HORMONAL_BOUNDARY`) is shown unconditionally in the panel and repeated in
`digest.js`'s RULES for the LLM. No score, ever — grep-tested.

## 11. Skincare integration
`skinRoutineCandidate` reads `store.day().skin.habits` against `skin.HABITS` and reports adherence
counts only. Its `limitation` field says explicitly: *"This tracks whether the routine was followed,
not whether it changed your skin."* Tested that no appearance-improvement language appears in the
reason text.

## 12. Face intelligence boundary
`health.js` **imports nothing from `www/face/`** — enforced by test (`test_health.mjs`'s final
check reads the module source and asserts no face import, no `fetch`, no `chat.js`). The Health
Coach cannot touch face data even by accident; the two systems remain structurally separate.

## 13. LLM role (unchanged pipeline, one new fact)
`digest()` now includes `coach: {action, reason, domain, limitation}` — the current top actionable
pick, computed by `health.js`, carried as data. One RULES line tells the model to explain *that*
reason rather than inventing a new one, and to repeat the testosterone limitation verbatim if
relevant. No structured-output changes, no new validation path, `validate.js` untouched.

## 14. Known limitations
- Guided walkthrough is single-step (Done/Skip/Later), not the full multi-step wizard the spec
  sketched for skincare — budget prioritized a correct, tested P0 core over an unfinished P1 wizard.
- No native reminders/notifications: `@capacitor/local-notifications` is not a dependency and none
  was added (confirmed absent in the audit; spec said add "if existing infrastructure makes this
  practical" — it doesn't).
- No lab-data entry UI. Deliberately out of scope per the P3 instruction; `lab.state` is always
  `ABSENT` and the architecture (`FACTOR_STATE` enum) already has room for it later.
- `preferredHour` adaptation is descriptive only and currently unused by the selection logic itself
  (it does not yet reorder the domain tie-break) — available for a future pass.

## 15–16. Tests / full result
New: `test_health.mjs`, 21 checks — evidence absent≠zero, no fabricated candidates, deterministic
selection + why, skip≠completion, postpone expires correctly, testosterone boundary (no sleep data
≠ low T, good workout ≠ high T, no numeric score anywhere, no TRT/steroid/SARM/booster text),
skincare adherence≠appearance, face-import boundary.

```
npm test → exit 0
18 files, 354 assertions (was 333; +21 from test_health.mjs)
```
No existing test was deleted or weakened.

## 17. Browser/app smoke test
Verified live: fresh profile+no logs → card shows "Log sleep and training" (`DATA_COLLECTION`, not
a verdict); **Why** discloses the real reasoning including runner-up limitations verbatim; **Skip**
recorded to `store.actions`, card recalculates instantly to the next candidate with **no LLM
call**; Mind → Hormonal panel renders all five factors honestly as `?` with real counts, boundary
sentence present. All other sheets (Lifts, Eat, Stats, Face) still open cleanly, zero console
errors introduced.

## 18. Real-device status
**Not tested on device** — no Android SDK in this environment (consistent with prior face-feature
reports). Browser verification only.

## 19. Files changed
`www/health.js` (new), `test_health.mjs` (new), `HEALTH_INTELLIGENCE_AUDIT.md` (new),
`www/store.js` (+actions log), `www/app.js` (+card render/wiring), `www/mood.js` (+hormonal tab),
`www/digest.js` (+coach fact), `www/index.html` (health card + hormonal panel markup),
`www/sw.js` (+health.js), `package.json` (+test_health.mjs).

## 20. Files intentionally untouched
`android/app/build.gradle`, `android/app/debug.keystore`, `.gitignore`, `www/face/checkin.js` — all
pre-existing modifications from earlier work this session, unrelated to this task, left exactly as
found.

## 21. What remains UNVERIFIED
Real-device behavior; whether the tiered priority order (training > hormonal > hydration > skin)
matches actual user preference over time (no adaptation feeds back into tier order yet);
`preferredHour` has only been unit-tested, never observed against real usage patterns.

| Capability | Status | Evidence |
|---|---|---|
| Health intelligence core | Done | `health.js`, reuses 4 existing domain modules |
| Evidence integrity preserved | Done | absent≠zero/verdict tests pass; no modified evidence.js |
| Candidate actions | Done | 4 generators, no fabrication (tested) |
| Priority engine | Done | explicit `TIER` + `DOMAIN_ORDER`, no scores |
| Next Best Action | Done | `selectNextBestAction()`, browser-verified |
| Why this explanation | Done | `why.reasonSelected` + `notConcluded`, tested + verified live |
| Today/Health Coach UI | Done | one card, top of Today sheet, hides when nothing to show |
| Guided walkthrough | Partial | Done/Skip/Later only, not multi-step wizard |
| Completion/skip/postpone | Done | `store.actions[]`, tested incl. postpone-expiry |
| Outcome adaptation | Partial | `preferredHour()` implemented + tested, not yet fed into priority |
| Reminder integration | Not built | no notification infra exists; documented, not invented |
| Testosterone lifestyle support | Done | reuses `t_inputs.js` entirely; Hormonal tab live |
| No fake testosterone measurement | Done | grep+behavioral tests; no score field anywhere |
| No hormone/drug recommendation engine | Done | tested: no TRT/steroid/SARM/booster text in module |
| Skincare adherence | Done | habit-count only; limitation text forbids appearance claims |
| Face boundary preserved | Done | `health.js` imports nothing from `www/face/` (enforced by test) |
| LLM explanation | Done | `digest().coach` + one RULES line; zero new pipeline |
| Claim validation preserved | Done | `validate.js`/`explain.js` untouched |
| Full automated tests | Done | 354 assertions, 18 files, exit 0 |
| Browser/app tested | Done | live interaction verified (card, why, skip, hormonal panel) |
| Real-device tested | Not done | no Android SDK available in this environment |
