// What the check-in is allowed to know about you.
//
// The chat could previously only answer from what you typed into it, so "why am I not gaining?"
// got a general answer about gaining rather than an answer about you — while the app sat on
// months of your training, sleep, weight and eating and said nothing.
//
// This assembles those into a small factual brief. It computes NOTHING itself: every number below
// comes from insights.js, nutrition.js, t_inputs.js, skin.js or planner.js, all of which are pure
// and tested. That is deliberate — the arithmetic stays where it can be checked, and this file is
// only allowed to gather and phrase it.
//
// TWO RULES SHAPE EVERYTHING HERE:
//
// 1. Absent is absent. A number that has not been logged is left out entirely rather than sent as
//    null, zero or "unknown". A model handed `sleep: null` will happily write a sentence about
//    your sleep; a model handed nothing cannot.
//
// 2. Small on purpose. Every fact costs tokens, latency and — since this leaves the phone — some
//    privacy. A month of set-by-set history would be worse than useless: it would bury the four
//    numbers that actually answer most questions.

import * as evidence from './evidence.js';
import * as insights from './insights.js';
import * as nutrition from './nutrition.js';
import * as planner from './planner.js';
import * as skin from './skin.js';
import * as health from './health.js';
import * as store from './store.js';
import * as tInputs from './t_inputs.js';

const round = (n, dp = 0) => (typeof n === 'number' && Number.isFinite(n)
  ? Math.round(n * 10 ** dp) / 10 ** dp : null);

/** Drop every key whose value is null/undefined/empty, recursively. See rule 1 above. */
function prune(obj) {
  if (Array.isArray(obj)) {
    const out = obj.map(prune).filter((v) => v != null);
    return out.length ? out : null;
  }
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const p = prune(v);
      if (p != null && !(typeof p === 'object' && !Object.keys(p).length)) out[k] = p;
    }
    return Object.keys(out).length ? out : null;
  }
  return obj === '' ? null : obj;
}

/**
 * How many of the listed lifts carry the full movement + decision detail.
 *
 * Three, not six. The detail is the expensive part of this brief — a pattern with its confidence
 * and a decision with the numbers behind it is roughly as many characters as everything else about
 * that lift put together — and the lifts are already ranked by how much you actually train them.
 * Anything past the third is a lift you have done a handful of times, where the honest state is
 * usually "not enough evidence" anyway. A question about a lift further down is a question for
 * retrieval, not for standing context.
 */
const DETAILED_LIFTS = 3;

/**
 * The differentiated half: where this lift breaks down, and what progression last decided.
 *
 * Everything here comes from evidence.js, which is where the absent-vs-zero rule lives. Two
 * consequences worth stating, because both are the point:
 *
 *   A pattern is only ever included at `ok`. Below the evidence floor, or with no watched sets at
 *   all, the LIMITATION is included instead — so the model is told "nothing has been watched",
 *   which is a fact, rather than being handed silence, which it will fill in.
 *
 *   A decision is only ever included if it was actually recorded. Loads move for reasons the log
 *   cannot recover, and the absence is reported as an absence.
 */
function detail(exId) {
  const m = evidence.movementEvidence(exId);
  const p = evidence.progressionEvidence(exId);
  const top = m.status === 'ok' ? m.facts.patterns[0] : null;

  return {
    // Confidence travels as the fraction insights.js computed, with both counts beside it, so the
    // wording has to be earned from the numbers rather than picked.
    formPattern: top ?? null,
    formEvidence: top ? null : formState(m),
    lastDecision: p.status === 'ok'
      ? {
        decision: p.facts.decision,
        reason: p.facts.reason,
        from: p.facts.from,
        to: p.facts.to,
        unit: p.facts.unit,
        // The thresholds it was actually compared against. "Form broke down" is the conclusion;
        // 0.38 against a 0.34 limit is the reason, and only one of those can be checked.
        basis: prune({
          sets: p.facts.sets ?? null,
          repsHit: p.facts.repsHit ?? null,
          faultsPerRep: p.facts.faultsPerRep ?? null,
          cleanLimit: p.facts.cleanLimit ?? null,
          stalledSessions: p.facts.stalledSessions || null,
        }),
      }
      : null,
    decisionEvidence: p.status === 'ok' ? null : 'none recorded',
  };
}

/**
 * Why the form state is a short token here and a full sentence in evidence.js.
 *
 * These repeat once per lift; the RULES string that explains them is sent once. Putting the
 * explanation in the part that does not repeat is the cheaper half of the same information.
 * evidence.js keeps the long form for callers that show it to a person verbatim.
 *
 * The `ok` branch is the one that has to exist. A lift that WAS watched and had nothing recur
 * would otherwise emit no form field at all, and silence is the one thing a model reliably fills
 * in — the same absent-vs-zero mistake as a table of zeros, one level up.
 */
const formState = (m) => (
  m.status === 'ok' ? `watched ${m.coverage.setsWatched} sets, nothing recurring`
    : m.status === 'insufficient_evidence'
      ? `only ${m.coverage.setsWatched} of ${m.coverage.setsNeeded} sets watched`
      : 'not watched'
);

/**
 * Everything worth knowing, in about a page.
 *
 * @param profile  the training profile, so goals and targets are interpretable
 * @returns a plain object, safe to JSON.stringify into a prompt
 */
export function digest(profile = planner.getProfile()) {
  const s = insights.summary();
  const t = tInputs.read(
    { days: store.days(), weights: store.weights(), log: store.read().log, rounds: store.read().rounds },
    store.dayKey, store.shiftKey,
  );

  const today = planner.today();
  const coachAction = health.candidates(health.context())
    .find((a) => a.tier === health.TIER.ACTIONABLE_NOW) ?? null;
  const entries = nutrition.dayEntries();
  const targets = nutrition.targets(profile);
  const eaten = nutrition.totals(entries);
  const trend = nutrition.weightTrend(28);
  const series = nutrition.dailySeries(28);
  const loggedDays = series.filter((d) => d.kcal !== null);
  const trained = Object.fromEntries(Object.entries(s.volume ?? {}).filter(([, n]) => n > 0));

  return prune({
    goal: profile.goal,
    trainingAge: profile.trainingAge,
    daysPerWeek: profile.daysPerWeek,
    bodyweightKg: profile.bodyweight,

    training: {
      setsAllTime: s.totalSets || null,
      // Hard sets per muscle group over the last 7 days, against the range that grows anything.
      //
      // Only the groups actually trained. weeklyVolume() returns every group, zeroed, so the old
      // `Object.keys(volume).length` gate was counting muscle groups — always truthy — and shipped
      // a table of zeros from a fresh install. prune() drops nulls, not zeros, so it survived all
      // the way to the model, which reads "Chest: 0" next to a productive range as something to
      // write a paragraph about. That is rule 1 above, broken by a zero instead of a null.
      setsPerGroupThisWeek: Object.keys(trained).length ? trained : null,
      // Meaningless on its own — it is the yardstick for the line above, not a fact about anyone.
      productiveRange: Object.keys(trained).length
        ? `${insights.VOLUME_TARGET.low}-${insights.VOLUME_TARGET.high} sets per group per week`
        : null,
      // Same rule: a zero here is a fresh install, and what it means is already said properly by
      // t_inputs.advice() in appsView.nextMove.
      daysTrainedLast30: t.training?.days || null,
      todaysSession: today ? today.name : 'rest day',
      // Only lifts with a real trend — a one-session "trend" is noise.
      lifts: (s.lifts ?? []).slice(0, 6).map((l, i) => prune({
        name: l.name,
        estimated1RM: l.strength ? round(l.strength.current, 1) : null,
        changePct: l.strength?.changePct ?? null,
        stalled: l.stalled || null,
        // `topFault`, which is what insights.summary() actually returns. This read `l.fault` and so
        // was always undefined, always pruned — the single most useful movement fact the app holds
        // has never once reached the model.
        weakestPoint: l.topFault?.label ?? null,
        ...(i < DETAILED_LIFTS ? detail(l.exId) : {}),
      })),
    },

    // Each block is gated on there being real data, not merely pruned of nulls. A verdict of
    // "unknown" or a count of 0 survives a null-prune and reads to a model as something to discuss
    // — it will write you a paragraph about your unknown sleep. Absent has to mean absent.
    sleep: t.sleep?.nights ? {
      // The MAIN sleep, not the day's total. The two are only different for someone who naps, and
      // where they differ the total rides along so the model does not read one as the other — a
      // 4h night with a 3h nap is not a 7h night, and the verdict below is about the night.
      mainSleepHours: round(t.sleep.avg, 1),
      totalAsleepHours: t.sleep.totalAvg ?? null,
      napDays: t.sleep.napDays ?? null,
      nightsLogged: t.sleep.nights,
      verdict: t.sleep.verdict === 'unknown' ? null : t.sleep.verdict,
    } : null,

    weight: trend.now != null ? {
      latestKg: trend.now,
      changeKg28d: trend.change,
      verdict: t.weight?.verdict === 'unknown' ? null : t.weight?.verdict,
    } : null,

    eating: {
      targetKcal: targets.kcal,
      targetProteinG: targets.protein,
      todayKcal: entries.length ? eaten.kcal : null,
      todayProteinG: entries.length ? eaten.protein : null,
      daysLoggedLast28: loggedDays.length || null,
      averageKcalWhenLogged: loggedDays.length
        ? round(loggedDays.reduce((a, d) => a + d.kcal, 0) / loggedDays.length) : null,
      waterTodayMl: entries.length ? nutrition.fluid(entries) : null,
      waterTargetMl: nutrition.waterTarget(profile),
    },

    // The app's own conclusions, so the model agrees with the rest of the app instead of
    // freelancing a different answer from the same numbers.
    appsView: {
      nextMove: t.advice?.text,
      eatingRead: loggedDays.length >= 3 ? nutrition.coachLine(profile, series) : null,
      skinRead: skin.scored().length >= 8 ? skin.advice().text : null,
    },

    // The Health Coach's own current pick, so a question like "why is this my next thing" gets an
    // answer grounded in the same reasoning the Today card shows — never a second opinion the model
    // invented from the raw facts above. health.js computed this; digest() only carries it along.
    coach: coachAction ? {
      action: coachAction.title,
      reason: coachAction.reason,
      domain: coachAction.domain,
      limitation: coachAction.limitation,
    } : null,
  }) ?? {};
}

/**
 * The rules the model must follow when using the brief.
 *
 * Kept beside the data it governs rather than in chat.js, because the two have to change together:
 * a fact added above without a rule here is a fact the model may do anything with.
 */
export const RULES = `The user's own logged data follows as JSON. Use it when it helps answer them.

- Use only these numbers. Never estimate, extrapolate or invent a figure, and never fill a gap with a typical value.
- Anything absent from the JSON was not logged. Say you do not have it rather than guessing, and say what they would need to log for you to answer.
- These are logs, not measurements of their body. Sleep is what they typed, weight is what the scale said that morning, food is what they remembered to record.
- "appsView" is what the rest of the app already tells them. Agree with it or explain the difference — do not quietly contradict it.
- "formPattern" is what the camera saw across recent sets. "confidence" is exactly inSets/ofSets; "startsAroundRep" is where in a set it begins, give or take a rep. Speak to the fraction: 6 of 6 sets is a pattern, 2 of 6 is a tendency, neither is a certainty.
- "formEvidence" replaces it when there is no pattern to give. "not watched" means nothing is known about that lift's form — say so; do not reassure them. "watched N sets, nothing recurring" means it was watched and held up. These are opposite findings.
- "mainSleepHours" is their longest block of sleep, which is what the sleep evidence is about. Where "totalAsleepHours" also appears they nap, and the two are different facts — a 4h night plus a 3h nap is not a 7h night, and the verdict refers to the night.
- "lastDecision" is a decision the app already made; "basis" holds the numbers it used and the threshold they were compared against. Explain it, never re-decide it. "decisionEvidence": "none recorded" means no decision was saved and none can be recovered — do not infer one from a load that changed.
- Separate what was observed from what you think follows from it, so they can tell which is which. Two things moving together in the same weeks is not one causing the other, and this data cannot show that it is.
- Numbers are context for a conversation, not a report. Do not list them back unless asked; answer the question.
- "coach" is the app's own current top recommendation and its "limitation" line. If they ask why this is the suggestion, explain THIS reason — do not invent a different one from the raw numbers, and repeat the limitation if it mentions testosterone: this app cannot measure hormone levels from lifestyle data, ever.
- Never diagnose anything, never estimate a hormone level, and never say whether a figure is normal, healthy, low or high. That needs a doctor and a blood test.`;
