// What the app can honestly say it knows, in a shape something else can reason over.
//
// This module computes NOTHING. Every number below comes from insights.js, coach.js's stored
// verdicts, or store.js — all of which are pure and tested. Its only job is to draw one line the
// source modules draw differently in each of their own idioms, and draw it the same way everywhere:
//
//   ABSENT   no evidence exists. No number is reported, because any number would be invented.
//   ZERO     evidence exists and the measurement is zero. The zero is reported, because it is real.
//
// Those are not the same fact and they must never render the same way. "You have no recurring
// faults" and "nothing has been watched for faults yet" are opposite statements about your form,
// and the difference between them is entirely in whether any set carried faultEvents. insights.js
// already keeps that distinction internally (`wasTracked` vs `hasUsableEvents`); this lifts it to
// the boundary so it survives being handed to anything else.
//
// DEPENDENCIES ARE DELIBERATELY ONE-WAY. Nothing here imports chat.js, digest.js, or touches the
// DOM, the network, or a prompt. Delete the model integration tomorrow and this module still
// answers "what does the app actually know about my squat" for a screen, a test, or devcheck.js.
// If that ever stops being true, this file has become a prompt builder wearing a different name.

import { EXERCISES } from './exercises.js';
import * as insights from './insights.js';
import * as store from './store.js';

/**
 * The one shape everything here returns.
 *
 * `status` is the first thing any consumer must branch on, which is why it is never absent and
 * never optional:
 *
 *   ok                     there is evidence, and `facts` holds it. May legitimately be empty or
 *                          zero — an empty `patterns` under `ok` is a real finding: watched, and
 *                          nothing recurred.
 *   no_evidence            nothing was ever logged. There are no facts and no counts, because
 *                          reporting `sets: 0` here would state a measurement nobody took.
 *   insufficient_evidence  something was logged, but below the source module's own floor for
 *                          saying anything. `coverage` still reports how much there is, since
 *                          "3 more sets and this can answer" is itself useful and true.
 *   unknown_exercise       the argument did not name a lift this app has. Not an empty result —
 *                          an empty result would read as "you have never trained it".
 *
 * `limitation` is a plain sentence, present whenever status is not `ok`, and is meant to be
 * repeated to a person verbatim rather than paraphrased into a guess.
 */
const result = (domain, status, rest = {}) => ({ domain, status, ...rest });

const none = (domain, limitation) => result(domain, 'no_evidence', { limitation });

/** ISO day for a period bound, from whatever shape the source kept its timestamp in. */
const iso = (at) => (at ? new Date(at).toISOString() : null);

// ── training, across everything ──────────────────────────────────────────────────────────

/**
 * The whole log at a glance: how much work, spread over which muscle groups, how recently.
 *
 * Every count here is gated on the log being non-empty rather than allowed to fall out as a zero.
 * `weeklyVolume()` returns every muscle group whether or not it was trained, so an ungated read
 * hands out a table of zeros from a fresh install — a fabricated measurement of six muscle groups
 * nobody has trained yet, sitting next to a productive range to be judged against.
 */
export function trainingEvidence(now = new Date()) {
  const s = insights.summary(now);
  if (!s.totalSets) {
    return none('training', 'No sets have been logged yet, so there is nothing to summarise.');
  }

  // Only the groups actually worked. A group at 0 this week, for someone who HAS trained, is a
  // real measurement — but it is a measurement about this week, and it belongs to the caller to
  // ask for. Reporting all six every time buries the two that were trained.
  const worked = Object.entries(s.volume).filter(([, n]) => n > 0);

  return result('training', 'ok', {
    period: { days: 7, label: 'muscle-group volume covers the last 7 days' },
    facts: {
      setsAllTime: s.totalSets,
      setsPerGroupThisWeek: Object.fromEntries(worked),
      productiveRange: `${insights.VOLUME_TARGET.low}-${insights.VOLUME_TARGET.high} sets per group per week`,
      liftsTrained: s.lifts.length,
    },
    coverage: { lifts: s.lifts.length, groupsThisWeek: worked.length },
    // Said out loud because it is the honest reading of an empty week for an established lifter,
    // and because the alternative — six zeros — is the thing this module exists to prevent.
    ...(worked.length ? {} : { limitation: 'Nothing has been logged in the last 7 days.' }),
  });
}

// ── one lift ─────────────────────────────────────────────────────────────────────────────

/**
 * Strength trend and stall state for a single lift.
 *
 * `strength()` returns null below two sessions rather than a trend of one point, and that refusal
 * is passed through as `insufficient_evidence` with the real session count attached — never
 * softened into "stable", which is a claim about a direction nobody has measured.
 */
export function liftEvidence(exId) {
  const ex = EXERCISES[exId];
  if (!ex) {
    return result('lift', 'unknown_exercise', {
      limitation: `There is no lift called "${exId}" in this app.`,
    });
  }

  const sessions = insights.sessions(exId);
  if (!sessions.length) return none('lift', `No sets of ${ex.name} have been logged.`);

  const st = insights.strength(exId);
  const stalled = insights.stalledSessions(exId);
  const period = { from: iso(sessions[0].at), to: iso(sessions.at(-1).at) };

  if (!st) {
    return result('lift', 'insufficient_evidence', {
      period,
      coverage: { sessions: sessions.length, sets: sessions.reduce((a, x) => a + x.sets, 0) },
      facts: { name: ex.name, currentLoadKg: sessions.at(-1).load },
      limitation: `Only ${sessions.length} training day${sessions.length === 1 ? '' : 's'} of ${ex.name} logged — a trend needs at least two.`,
    });
  }

  return result('lift', 'ok', {
    period,
    facts: {
      name: ex.name,
      estimated1RM: st.current,
      best1RM: st.best,
      changePct: st.changePct,
      overDays: st.days,
      currentLoadKg: sessions.at(-1).load,
      sessionsAtCurrentLoad: stalled,
      deloadDue: insights.shouldDeload(exId),
    },
    coverage: { sessions: st.sessions, sets: sessions.reduce((a, x) => a + x.sets, 0) },
    // Named every time, because it is the difference between a measurement and an estimate and it
    // does not stop being true once the number looks precise.
    limitation: 'Estimated 1RM is a formula over logged sets, not a tested max.',
  });
}

// ── movement patterns: the thing only this app knows ─────────────────────────────────────

/**
 * Which faults recur on a lift, how often, and roughly which rep they start on.
 *
 * This is the app's one genuinely differentiated read, and the one place where absent-vs-zero does
 * the most work. Three distinct outcomes, which a naive read collapses into one:
 *
 *   no sets carry faultEvents   → no_evidence. Nothing was watched. Says nothing about form.
 *   watched, but below the floor → insufficient_evidence, with the count, so it can say how close.
 *   watched enough, nothing recurred → ok, with an empty pattern list. THIS is "your form held up",
 *                                      and it is the only one of the three that may be said that way.
 *
 * Confidence is carried through exactly as insights.faultTimeline() computed it — matching sets
 * over observed sets — and is never rounded up, relabelled as a word, or invented where the source
 * declined to produce one.
 */
export function movementEvidence(exId, lookback = 6) {
  const ex = EXERCISES[exId];
  if (!ex) {
    return result('movement', 'unknown_exercise', {
      limitation: `There is no lift called "${exId}" in this app.`,
    });
  }

  const watched = insights.trackedSets(exId, lookback);
  if (!watched) {
    return none('movement', `No set of ${ex.name} has been recorded with per-rep fault tracking, so nothing is known about where it breaks down.`);
  }
  if (watched < insights.MIN_SETS_FOR_PATTERN) {
    return result('movement', 'insufficient_evidence', {
      coverage: { setsWatched: watched, setsNeeded: insights.MIN_SETS_FOR_PATTERN },
      limitation: `Only ${watched} watched set${watched === 1 ? '' : 's'} of ${ex.name} — a pattern needs ${insights.MIN_SETS_FOR_PATTERN}.`,
    });
  }

  const patterns = insights.topPatterns(exId, lookback).map((p) => ({
    signal: p.label,
    status: p.status,                 // 'recurring' | 'occasional' | 'not observed'
    confidence: p.confidence,         // matchingSets / setsWatched, exactly
    inSets: p.matchingSets,
    ofSets: p.evidenceSets,
    // Only when the events actually placed it. A fault that never fired has no rep to report, and
    // ±1 rep at a boundary is a known limit of how the rep index is stamped.
    ...(p.breakdownStartRep ? { startsAroundRep: p.breakdownStartRep } : {}),
  }));

  return result('movement', 'ok', {
    period: { lastSets: lookback },
    facts: { name: ex.name, patterns },
    coverage: { setsWatched: watched },
    limitation: patterns.length
      ? 'The rep a fault is attributed to can be off by one at a rep boundary.'
      : `Watched ${watched} sets of ${ex.name} and no fault recurred often enough to be a pattern.`,
  });
}

// ── the progression decision ─────────────────────────────────────────────────────────────

/**
 * What progression last decided for a lift, and the numbers behind it.
 *
 * A missing verdict is the interesting case and is why this returns `no_evidence` rather than
 * anything reconstructed. Loads move for reasons the log cannot recover — a decision made before
 * verdicts were recorded, a weight typed in by hand, a restored backup — and inferring "it went up,
 * so it must have been a clean session" would manufacture exactly the kind of decision history this
 * whole layer exists to keep honest. What was not written down is not known.
 */
export function progressionEvidence(exId) {
  const ex = EXERCISES[exId];
  if (!ex) {
    return result('progression', 'unknown_exercise', {
      limitation: `There is no lift called "${exId}" in this app.`,
    });
  }

  const v = store.lastVerdict(exId);
  if (!v) {
    return none('progression', `No progression decision has been recorded for ${ex.name}. Decisions made before this was kept are not recoverable, and are not guessed at.`);
  }

  return result('progression', 'ok', {
    period: { at: iso(v.at) },
    facts: {
      name: ex.name,
      decision: v.decision,           // 'progress' | 'hold' | 'deload'
      reason: v.reason,               // the deterministic engine's own words
      from: v.from,
      to: v.to,
      unit: v.unit,
      // The inputs the branch was taken on, so the decision can be explained rather than restated.
      ...(v.evidence ?? {}),
    },
    coverage: { setsInDecision: v.evidence?.sets ?? null },
    limitation: 'This is the decision the app made and the numbers it used. It is not a judgement about whether the weight was right for you on the day.',
  });
}

/**
 * Everything known about one lift, for a question about that lift.
 *
 * Deliberately three narrow reads composed at the edge rather than one wide function: each half
 * can be absent independently — a lift can have months of strength history and no watched sets, or
 * a verdict and only one session — and flattening them would lose which half is missing.
 */
export const forLift = (exId, lookback = 6) => ({
  lift: liftEvidence(exId),
  movement: movementEvidence(exId, lookback),
  progression: progressionEvidence(exId),
});

/** Which lifts there is anything at all to ask about, most-trained first. */
export const liftsWithEvidence = () =>
  insights.summary().lifts.map((l) => ({ exId: l.exId, name: l.name }));
