# Health Intelligence Audit (concise, per budget)

## 1. Existing health domains
Training (sets/reps/load/faults), nutrition (meals/macros/water), sleep (blocks, naps, main vs
total), weight, mood/PHQ-9/GAD-7, skin self-report + routine habits, face capture/validation
(unvalidated), progression verdicts.

## 2. Data actually available per domain
- **Training**: `store.log` (exId, reps, sets, load, faultEvents), `store.rounds` (boxing).
- **Nutrition**: `store.meals` (foodId, qty, at), `nutrition.waterTarget/fluid/targets/totals`.
- **Sleep**: `store.days[key].sleeps[]` (start/end blocks) + legacy `bed/wake`.
- **Weight**: `store.weights` (at, kg).
- **Skin**: `store.days[key].skin = {score 1-5, flags[], habits[]}`. Habits are a **fixed 4-item
  list** (`spf`, `washPost`, `moisturise`, `nopick`) — no serum/cleanser identity yet
  (`FACE_AI_MODEL_RND_V2.md` §7 already found this).
- **Face**: `store.settings.faceLab` — 49 candidate signals, **0 real captures, 0 validated**
  (`FACE_EMPIRICAL_VALIDATION_REPORT.md`, `FACE_PROTOCOL_COLLECTION_REPORT.md`).
- **Verdicts**: `store.verdicts[]` — every progression decision + the numbers behind it.
- **Lab data**: **absent**. No field anywhere for a blood test result.

## 3. Existing deterministic intelligence (all pure, all tested)
`insights.js` (strength trend, fault patterns, stall detection), `t_inputs.js` (**already the
testosterone/hormonal domain** — sleep/weight/training lifestyle inputs, evidence-gated, cites
Leproult & Van Cauter 2011, **never a score**, returns `verdict: 'unknown'` below floor,
`advice()` names one next move), `skin.js` (routine adherence + lagged associations, never
causal), `nutrition.js` (targets/verdict/coachLine), `planner.js` (today's session).

## 4. Existing LLM capabilities (`chat.js`, `digest.js`, `explain.js`, `validate.js`)
Streaming chat with `digest()` as system-injected facts; structured-output `explain()` for
progression decisions, gated by `validate.checkAnswer()` against `provenance()`-indexed evidence;
one retry then discard-to-template. **This is the reusable LLM pipeline** — no second one needed.

## 5. Reusable architecture
`evidence.js`'s absent/zero/insufficient/ok vocabulary is the house style and is reused verbatim.
`store.js` additive-key pattern (`blank` spread, capped arrays) is how new state gets added safely.

## 6. Missing data
No lab results, no serum/product identity (only generic habit ids), no notification
infrastructure (`@capacitor/local-notifications` not a dependency — confirmed absent).

## 7. Biggest opportunity
Nothing synthesizes across domains into **one recommended action**. Every domain already answers
"what do I know" — nothing answers "what should I do right now, and why."

## 8. Architecture decision
One new pure module, `www/health.js`, sitting **above** the existing domain modules (imports
`evidence`, `t_inputs`, `skin`, `nutrition`, `planner`, `mood_insights`, `store` — computes
nothing they don't already compute). Candidate actions are thin wrappers over their existing
verdicts. A small additive `store.actions[]` outcome log (same pattern as `verdicts[]`). One UI
card at the top of the existing Today sheet — no new tab, no new sheet, no second AI pipeline.
LLM involvement is `digest()` gaining the selected action + reason as one more fact block, reusing
the exact `explain()`/`validate` machinery already proven for progression decisions.
