// The Health Coach: turns what the app already knows into ONE next best action.
//
// Pure. No DOM, no network, no model. Every candidate action is a thin wrapper over a verdict some
// other module already computed and already tests — insights.js, t_inputs.js, skin.js,
// nutrition.js, planner.js. This file adds no new health arithmetic. Its only job is priority and
// explanation, which is exactly why it is allowed to exist as one more layer rather than a second
// intelligence system: everything under it is already trusted, and everything over it (the LLM) is
// forbidden from being the thing that decides.
//
// THE RULE THIS FILE EXISTS TO ENFORCE, restated because it is the whole point:
//
//   ABSENT != ZERO. A domain with nothing logged produces a DATA_COLLECTION action ("log this to
//   unlock guidance"), never a verdict about health drawn from silence.
//
//   NEVER A SCORE. No numeric health score, no testosterone number, no skin score. A candidate
//   action's only numbers are the ones already public in the domain it came from (a litre count,
//   an hour count, a session count).
//
//   PRIORITY IS TIERED, NOT SCORED. Every action carries an explicit tier and an explicit reason.
//   `selectNextBestAction` can always answer, in words, why the winner won and why the runner-up
//   did not.

import * as store from './store.js';
import * as tInputs from './t_inputs.js';
import * as skin from './skin.js';
import * as nutrition from './nutrition.js';
import * as planner from './planner.js';

const round = (n, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * Explicit tiers, highest priority first. A NUMBER here is a rank, never a score to be summed or
 * weighted — it exists so two candidates can be ordered and the ordering can be named out loud.
 */
export const TIER = {
  ACTIONABLE_NOW: 1,   // real evidence, real action, not yet done today
  DATA_COLLECTION: 2,  // nothing to recommend yet; logging would unlock something
  GOING_WELL: 3,        // evidence exists and says nothing is needed
};

/**
 * Within ACTIONABLE_NOW, this fixed order breaks ties — not a score. Training first because a
 * session is the one thing with a real expiry (today), then the hormonal-lifestyle inputs because
 * they carry the strongest cited evidence of anything in the app, then hydration because it is the
 * lowest-friction real action, then the skin routine because it is evening-scoped and least urgent
 * earlier in the day.
 */
const DOMAIN_ORDER = ['training', 'hormonalLifestyle', 'hydration', 'skinRoutine'];
const rank = (domain) => {
  const i = DOMAIN_ORDER.indexOf(domain);
  return i === -1 ? DOMAIN_ORDER.length : i;
};

// ── candidate generators ─────────────────────────────────────────────────────────────────
// Each takes the same ctx bag and returns one candidate action, or null. Never two candidates for
// one domain, never a fabricated one when the underlying module reports absence.

function hydrationCandidate(ctx) {
  const entries = nutrition.dayEntries(ctx.now);
  const target = nutrition.waterTarget(ctx.profile);
  if (!entries.length) {
    return action({
      id: 'hydration:log', domain: 'hydration', tier: TIER.DATA_COLLECTION,
      title: 'Log today\'s water', reason: 'Nothing logged today, so intake cannot be read against your target.',
      status: 'no_evidence', evidence: { targetMl: target },
      limitation: 'No meal or drink logged today — this is silence, not "dehydrated".',
      guidance: {
        mode: 'single',
        intro: 'We don\'t have enough intake data yet. Log water to personalize hydration guidance.',
        step: { id: 'log', instruction: 'Log a drink to start tracking today\'s intake.', quickLog: true },
      },
    });
  }
  const have = nutrition.fluid(entries);
  if (have >= target) {
    return action({
      id: 'hydration:met', domain: 'hydration', tier: TIER.GOING_WELL,
      title: 'Hydration target met', reason: `${have} of ${target} ml logged today.`,
      status: 'ok', evidence: { haveMl: have, targetMl: target },
    });
  }
  return action({
    id: 'hydration:drink', domain: 'hydration', tier: TIER.ACTIONABLE_NOW,
    title: 'Drink water now', reason: `${have} of ${target} ml logged today — ${target - have} ml short.`,
    status: 'ok', evidence: { haveMl: have, targetMl: target, shortMl: target - have },
    guidance: {
      mode: 'single',
      intro: `Recorded intake is below today's current target — ${have} of ${target} ml so far.`,
      step: { id: 'drink', instruction: 'Take a moment and drink some water.', quickLog: true },
    },
  });
}

function skinRoutineCandidate(ctx) {
  const today = store.day(ctx.dayKey(ctx.now)).skin;
  if (!today) {
    return action({
      id: 'skin:log', domain: 'skinRoutine', tier: TIER.DATA_COLLECTION,
      title: 'Log today\'s skin', reason: 'Nothing logged today for skin or routine.',
      status: 'no_evidence', evidence: {},
      limitation: 'No entry today — this says nothing about whether your skin changed.',
      guidance: {
        mode: 'single',
        intro: 'Log today\'s skin to start comparing it against your food, sleep and training.',
        step: { id: 'log', instruction: 'Score today\'s skin in Mind → Skin.', deepLink: 'skin' },
      },
    });
  }
  const done = new Set(today.habits ?? []);
  const missing = skin.HABITS.filter((h) => !done.has(h.id));
  if (!missing.length) {
    const adh = skin.routineAdherence(10, ctx.days);
    return action({
      id: 'skin:complete', domain: 'skinRoutine', tier: TIER.GOING_WELL,
      title: 'Evening routine complete',
      reason: `All ${skin.HABITS.length} routine steps logged today.`
        + (adh.of >= 3 ? ` You've completed ${adh.complete} of your last ${adh.of} recorded evening routines.` : ''),
      status: 'ok', evidence: { habitsDone: skin.HABITS.length },
    });
  }
  return action({
    id: 'skin:routine', domain: 'skinRoutine', tier: TIER.ACTIONABLE_NOW,
    title: 'Continue your evening routine', reason: `${missing.map((h) => h.label).join(', ')} not yet logged today.`,
    status: 'ok', evidence: { missing: missing.map((h) => h.id), doneCount: done.size, totalCount: skin.HABITS.length },
    // Adherence, never appearance. health.js must never say the routine changed the skin — see
    // FACE_AI_MODEL_RND_V2.md's routine-intelligence boundary and test_health.mjs's boundary test.
    limitation: 'This tracks whether the routine was followed, not whether it changed your skin.',
    // One real step per remaining habit, in the app's own fixed order — never invented. "Done" on
    // a step is a direct call to skin.setHabitDone, the same store field the Skin panel chips use,
    // so a step finished here and a habit ticked there are one fact, not two counters.
    guidance: {
      mode: 'steps',
      intro: `${missing.length} of ${skin.HABITS.length} routine steps left today.`,
      steps: missing.map((h) => ({ id: h.id, title: h.label, instruction: h.why })),
    },
  });
}

function trainingCandidate(ctx) {
  const session = planner.today(ctx.now, ctx.profile);
  if (!session) {
    return action({
      id: 'training:rest', domain: 'training', tier: TIER.GOING_WELL,
      title: 'Rest day', reason: 'No session scheduled today.', status: 'ok', evidence: {},
    });
  }
  const done = planner.doneToday(session, ctx.now);
  const left = session.exercises.filter((e) => !done.has(e.exId));
  if (!left.length) {
    return action({
      id: `training:${ctx.dayKey(ctx.now)}:done`, domain: 'training', tier: TIER.GOING_WELL,
      title: 'Session complete', reason: `${session.exercises.length} of ${session.exercises.length} lifts done.`,
      status: 'ok', evidence: { sessionName: session.name },
    });
  }
  return action({
    id: `training:${ctx.dayKey(ctx.now)}:${session.name}`, domain: 'training', tier: TIER.ACTIONABLE_NOW,
    title: `Start · ${left[0].name}`, reason: `${session.name}: ${left.length} of ${session.exercises.length} lifts left today.`,
    status: 'ok', evidence: { sessionName: session.name, left: left.length, total: session.exercises.length },
    urgency: 'today',
    // Training already has a real, camera-driven guided flow — this does not rebuild it, it hands
    // you to it. Completion is never claimed here either: the exercise log is the source of truth,
    // and this candidate simply stops existing (replaced by the GOING_WELL "done" one above) once
    // planner.doneToday() says the lift is logged.
    guidance: {
      mode: 'single',
      intro: `${session.name}: ${left.length} of ${session.exercises.length} lifts left today.`,
      step: { id: 'lift', instruction: `Open today's session and do ${left[0].name}.`, deepLink: 'training' },
    },
  });
}

/**
 * The hormonal/lifestyle domain — REUSES t_inputs.js entirely. This function adds no evidence of
 * its own; it only classifies what t_inputs.advice() already decided into a candidate action.
 *
 * t_inputs.js already refuses to estimate testosterone from anything, cites its sources, and
 * returns 'unknown' below its evidence floor. This wrapper cannot weaken that even by accident,
 * because it never reads a raw number out of `days`/`weights`/`log` itself.
 */
function hormonalLifestyleCandidate(ctx) {
  const r = tInputs.read(
    { days: ctx.days, weights: ctx.weights, log: ctx.log, rounds: ctx.rounds },
    ctx.dayKey, ctx.shiftKey,
  );
  const known = [];
  const missing = [];
  (r.sleep.verdict === 'unknown' ? missing : known).push(`sleep (${r.sleep.verdict === 'unknown' ? `${r.sleep.nights} nights` : `${r.sleep.avg}h avg`})`);
  (r.training.days ? known : missing).push(`training (${r.training.days} days in ${tInputs.WINDOW})`);
  (r.weight.verdict === 'unknown' ? missing : known).push('weight trend');

  if (!r.advice.text) {
    return action({
      id: 'hormonal:ok', domain: 'hormonalLifestyle', tier: TIER.GOING_WELL,
      title: 'Lifestyle inputs on track', reason: 'Sleep and training are both within the supportive range.',
      status: 'ok', evidence: { sleep: r.sleep, training: r.training, weight: r.weight },
    });
  }
  const isDataAsk = !r.advice.plan && /Log/.test(r.advice.text);
  return action({
    id: `hormonal:${r.advice.plan ?? 'log'}`, domain: 'hormonalLifestyle',
    tier: isDataAsk ? TIER.DATA_COLLECTION : TIER.ACTIONABLE_NOW,
    title: r.advice.plan ?? 'Log sleep and training',
    reason: r.advice.text,
    status: isDataAsk ? 'insufficient_evidence' : 'ok',
    evidence: { sleep: r.sleep, training: r.training, weight: r.weight, known, missing },
    // Said on every single one of these, unconditionally — see boundary test.
    limitation: 'Lifestyle conditions linked to healthy testosterone, not a hormone measurement. '
      + 'This app cannot determine your testosterone level.',
    // Informational only — there is no separate hormonal action to perform beyond what training/
    // sleep already cover, so this walkthrough is the four-part honesty statement itself, not a
    // task. "Done" is a read receipt, not a claim that anything was measured or changed.
    guidance: {
      mode: 'single',
      intro: r.advice.text,
      step: {
        id: 'lifestyle',
        instruction: r.advice.text,
        boundary: {
          known, missing,
          supports: r.advice.text,
          doesNotMeasure: 'This app cannot determine your testosterone level — that needs a blood test read by a doctor.',
        },
      },
    },
  });
}

function action(a) {
  return { urgency: 'now', evidence: {}, limitation: null, guidance: null, ...a };
}

const GENERATORS = [trainingCandidate, hormonalLifestyleCandidate, hydrationCandidate, skinRoutineCandidate];

/** Build the ctx bag once per call, from store.js — same shape digest.js already assembles. */
export function context(now = new Date()) {
  const s = store.read();
  return {
    now, profile: planner.getProfile(), days: s.days, weights: s.weights, log: s.log,
    rounds: s.rounds, dayKey: store.dayKey, shiftKey: store.shiftKey,
  };
}

/** Every candidate the current evidence actually supports. Never padded, never fabricated. */
export function candidates(ctx = context()) {
  return GENERATORS.map((g) => g(ctx)).filter(Boolean);
}

// ── outcomes: offered / completed / skipped / postponed ─────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long a postpone hides an action before it can be offered again. */
export const POSTPONE_MS = 2 * 60 * 60 * 1000;

/**
 * The action walkthrough's state machine. Explicit names, because "what state is this thing in"
 * has to be answerable the same way "why did this win" is — in words, not a number.
 *
 *   offered   → started | skipped | postponed
 *   started   → completed | postponed | cancelled
 *   postponed → offered (once POSTPONE_MS has passed — see suppressed())
 *   cancelled → offered (immediately — backing out is not a punishment)
 *
 * completed/skipped are terminal for the calendar day; see suppressed().
 */
export const ACTION_STATE = {
  OFFERED: 'offered', STARTED: 'started', COMPLETED: 'completed',
  SKIPPED: 'skipped', POSTPONED: 'postponed', CANCELLED: 'cancelled',
};

/**
 * The current state of one action id, purely from its own event history — no separate "current
 * step" or "in progress" flag is ever persisted, because there is nothing to persist: a walkthrough
 * resumes by re-deriving it (which skin habits are still missing, which lifts are still left) from
 * the same real data every other screen reads. This is only asked "is the last thing that happened
 * to this id still true", so an app restart or a five-day-old 'started' both answer correctly.
 */
export function actionState(actionId, now = new Date(), dayKey = store.dayKey) {
  const last = store.lastActionEvent(actionId);
  if (!last) return ACTION_STATE.OFFERED;
  // A 'started' from a previous day belongs to a previous instance of this id (ids like
  // 'hydration:drink' are not date-scoped) — it must not make today's card open mid-walkthrough.
  if (last.event === ACTION_STATE.STARTED && dayKey(new Date(last.at)) !== dayKey(now)) {
    return ACTION_STATE.OFFERED;
  }
  return last.event;
}

/**
 * Record one outcome event — but idempotently: once an id is completed or skipped for the day,
 * a repeat call (a double-tap, a stale click handler) is a no-op rather than a second log row.
 * ponytail: this is the one guard the state machine actually needs; a full transition-validity
 * table would be enforcing rules the UI already only offers valid buttons for.
 */
export function recordOutcome(actionId, domain, event, now = new Date(), dayKey = store.dayKey) {
  const state = actionState(actionId, now, dayKey);
  if (state === ACTION_STATE.COMPLETED || state === ACTION_STATE.SKIPPED) return null;
  return store.appendAction({ id: actionId, domain, event });
}

/**
 * Is this action currently suppressed by the user's own last choice on it?
 *
 * completed/skipped today → suppressed until the calendar day changes (a skip is not a failure and
 * is not asked again five minutes later). postponed → suppressed only for POSTPONE_MS, then it is
 * eligible again — postponing is "not now", not "not today".
 */
export function suppressed(actionId, now = new Date(), dayKey = store.dayKey) {
  const last = store.lastActionEvent(actionId);
  if (!last) return false;
  if (last.event === 'completed' || last.event === 'skipped') {
    return dayKey(new Date(last.at)) === dayKey(now);
  }
  if (last.event === 'postponed') {
    return now.getTime() - new Date(last.at).getTime() < POSTPONE_MS;
  }
  return false;
}

/**
 * The one action to show, plus a fully-inspectable reason.
 *
 * Selection is: drop suppressed actions → drop GOING_WELL/DATA_COLLECTION from being picked WHILE
 * any ACTIONABLE_NOW candidate exists → sort by tier, then DOMAIN_ORDER → take the first.
 *
 * `why` names the runner-up and why it lost, which is the deterministic, no-LLM answer to
 * "why this now" the spec requires. `notConcluded` lists what the OTHER domains could not say,
 * verbatim from their own `limitation`/absence, never rephrased into a claim.
 */
export function selectNextBestAction(ctx = context()) {
  const all = candidates(ctx).filter((a) => !suppressed(a.id, ctx.now, ctx.dayKey));
  if (!all.length) {
    return { action: null, why: { reasonSelected: 'Every action is already handled for today.', known: [], missing: [], notConcluded: [] }, runnerUps: [] };
  }

  const sorted = [...all].sort((a, b) => (a.tier - b.tier) || (rank(a.domain) - rank(b.domain)));
  const top = sorted[0];
  const runnerUps = sorted.slice(1);

  const reasonSelected = top.tier === TIER.ACTIONABLE_NOW
    ? `${top.domain} is actionable now with real evidence behind it, and ranks ahead of ${runnerUps.map((r) => r.domain).join(', ') || 'nothing else pending'}.`
    : top.tier === TIER.DATA_COLLECTION
      ? 'Nothing is actionable yet; logging this unlocks a real recommendation.'
      : 'Everything checked is already on track.';

  const notConcluded = runnerUps
    .filter((r) => r.limitation)
    .map((r) => `${r.domain}: ${r.limitation}`);

  return {
    action: top,
    why: {
      reasonSelected,
      known: Object.keys(top.evidence),
      missing: runnerUps.filter((r) => r.status !== 'ok').map((r) => r.domain),
      notConcluded,
    },
    runnerUps,
  };
}

// ── hormonal health section (evidence-state view, not a score) ─────────────────────────

export const FACTOR_STATE = { SUPPORTED: 'SUPPORTED', PARTIAL: 'PARTIAL', ABSENT: 'ABSENT' };

/**
 * Per-factor evidence state for the "Hormonal health support" panel. Reuses t_inputs.read() and
 * nutrition's own logged-day count. Lab evidence is always ABSENT — there is no lab-entry field
 * anywhere in this app (confirmed by audit), and this file does not add one; inventing a medical
 * records feature is explicitly out of scope for this pass.
 */
export function hormonalFactors(ctx = context()) {
  const r = tInputs.read(
    { days: ctx.days, weights: ctx.weights, log: ctx.log, rounds: ctx.rounds },
    ctx.dayKey, ctx.shiftKey,
  );
  const loggedDays = nutrition.dailySeries(28, ctx.now).filter((d) => d.kcal !== null).length;
  return {
    sleep: { state: r.sleep.verdict === 'unknown' ? FACTOR_STATE.ABSENT : FACTOR_STATE.SUPPORTED, detail: r.sleep },
    training: { state: r.training.days > 0 ? FACTOR_STATE.SUPPORTED : FACTOR_STATE.ABSENT, detail: r.training },
    weight: { state: r.weight.verdict === 'unknown' ? FACTOR_STATE.ABSENT : FACTOR_STATE.SUPPORTED, detail: r.weight },
    nutrition: { state: loggedDays === 0 ? FACTOR_STATE.ABSENT : loggedDays < 10 ? FACTOR_STATE.PARTIAL : FACTOR_STATE.SUPPORTED, detail: { loggedDays } },
    lab: { state: FACTOR_STATE.ABSENT, detail: null },
  };
}

/** Said unconditionally, everywhere this domain is shown. Not a disclaimer to bury. */
export const HORMONAL_BOUNDARY =
  'We cannot determine testosterone levels from lifestyle tracking. This shows lifestyle '
  + 'conditions with real evidence behind them, not a hormone measurement — that needs a blood '
  + 'test read by a doctor.';

// ── adaptation (descriptive only, never causal) ─────────────────────────────────────────

/**
 * Which hour of day an action tends to actually get COMPLETED, from its own outcome history.
 *
 * Descriptive only. "You tend to complete this in the afternoon" is a fact about a log; it is not
 * a claim that afternoons work better for anyone, and nothing here says that.
 */
export function preferredHour(actionId) {
  const completions = store.actionHistory(actionId).filter((e) => e.event === 'completed');
  if (completions.length < 3) return null;
  const hours = completions.map((e) => new Date(e.at).getHours());
  const buckets = { morning: 0, afternoon: 0, evening: 0 };
  for (const h of hours) {
    if (h < 12) buckets.morning += 1; else if (h < 18) buckets.afternoon += 1; else buckets.evening += 1;
  }
  const [best] = Object.entries(buckets).sort((a, b) => b[1] - a[1]);
  return { bucket: best[0], of: completions.length };
}

/** A representative clock hour for each descriptive bucket preferredHour() can return. */
const BUCKET_HOUR = { morning: 8, afternoon: 13, evening: 18 };

/**
 * How long to wait before reminding about a POSTPONED action.
 *
 * Delivery timing only — never a health fact, never touches priority. Defaults to POSTPONE_MS.
 * With enough completion history (preferredHour's own ≥3 floor), nudges the wait toward the start
 * of the bucket the user actually tends to finish this in, clamped to [30 min, 6 h] so a thin
 * estimate can neither bury a reminder for the rest of the day nor fire one right back immediately.
 */
export function reminderDelayMs(actionId, now = new Date()) {
  const pref = preferredHour(actionId);
  if (!pref) return POSTPONE_MS;
  const target = new Date(now);
  target.setHours(BUCKET_HOUR[pref.bucket], 0, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  const delay = target.getTime() - now.getTime();
  return Math.min(Math.max(delay, 30 * 60 * 1000), 6 * 60 * 60 * 1000);
}

/** The answer to "why did you remind me now?" — always statable, never causal. */
export function reminderExplanation(actionId) {
  const pref = preferredHour(actionId);
  if (!pref) return 'Reminding you after the usual wait — not enough history yet to personalize timing.';
  return `You usually complete this in the ${pref.bucket}, based on ${pref.of} recorded completions, `
    + 'so the reminder was scheduled closer to that time.';
}

export const round1 = round;
