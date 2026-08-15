// "Why did it decide that?" — the flow, without the provider.
//
// The model call arrives as an injected `ask`, so everything here is testable with no key, no
// network and no mocking library: the policy is what needs proving, not that fetch works.
//
// THE ORDER MATTERS AND IS THE POINT:
//
//   evidence → ask → validate → (one retry with feedback) → validate → render, or fall back
//
// Nothing reaches the caller until it has passed. There is no streaming here on purpose — see
// chat.explain(). And when it does not pass, the fallback is not an apology, it is the same
// explanation assembled from the same numbers by arithmetic, which is what the rest screen would
// have shown anyway. A failed model call costs the person nothing.

import * as evidence from './evidence.js';
import * as validate from './validate.js';

/** One retry, then stop. A loop that keeps paying for attempts until one passes is a cost attack
 *  on the user's own key, and a model that failed twice on the same evidence will fail again. */
const MAX_ATTEMPTS = 2;

/**
 * What the model is allowed to see for this question. Deliberately tiny.
 *
 * The decision and the form pattern for one lift — no chat history, no profile, no eating, no
 * sleep. A narrow question does not need a wide context, and every extra field is another number
 * the answer could reach for.
 *
 * The timestamp is left out. Nothing in the answer needs a date, and a date in the packet is a
 * whole class of claim ("since Tuesday", "three weeks ago") that the validator would have to
 * either check or wave through.
 */
export function packet(exId) {
  const p = evidence.progressionEvidence(exId);
  if (p.status !== 'ok') return null;

  const m = evidence.movementEvidence(exId);
  return {
    decision: p.facts,
    // Included only when it is real. Where the form was not watched, the LIMITATION goes up
    // instead — so the model is told the silence means "unwatched", not "clean".
    form: m.status === 'ok' ? { patterns: m.facts.patterns, setsWatched: m.coverage.setsWatched } : null,
    formEvidence: m.status === 'ok' ? null : m.limitation,
    thresholdNote: 'faultsPerRep is compared against cleanLimit. At or above it, the load is held.',
  };
}

/**
 * The explanation the app can give with no model at all.
 *
 * Every number in it is read straight off the verdict, so it is correct by construction. This is
 * the fallback when the call fails or the answer will not validate — and it is why failing closed
 * costs nothing: the person still gets the real reason, in the app's own voice.
 */
export function plainly(exId) {
  const p = evidence.progressionEvidence(exId);
  if (p.status !== 'ok') return null;
  const f = p.facts;
  const move = f.decision === 'progress' ? `Next time ${f.to} ${f.unit}.`
    : f.decision === 'deload' ? `Dropping to ${f.to} ${f.unit} to rebuild.`
      : `Staying at ${f.to} ${f.unit}.`;

  const why = f.reason === 'reps missed' ? `You got ${f.totalReps} reps across ${f.sets} sets and the target was not met.`
    : f.reason === 'form broke down' ? `Every rep was there, but corrections ran at ${f.faultsPerRep} per rep and the limit for adding weight is ${f.cleanLimit}.`
      : f.reason === 'stalled three sessions' ? `The load has not moved in ${f.stalledSessions} sessions.`
        : `All ${f.totalReps} reps, with corrections at ${f.faultsPerRep} per rep against a ${f.cleanLimit} limit.`;

  return `${move} ${why}`;
}

/**
 * Ask, check, retry once, or fall back.
 *
 * @param exId  the lift
 * @param ask   (packet, feedback) => Promise<{observed, meaning, suggestion} | null>
 * @returns {status, answer?, plain, attempts, unsupported?}
 *
 *   ok           validated. `answer` is safe to show.
 *   unverified   the model produced unsupported numbers twice. `answer` is DISCARDED — not shown,
 *                not trimmed, not partially rendered. `plain` is what the caller shows.
 *   unavailable  no answer came back at all. `plain` again.
 *   no_evidence  no decision was ever recorded for this lift. Nothing to explain, and nothing
 *                invented to fill the gap.
 */
export async function explainDecision(exId, ask) {
  const ev = packet(exId);
  if (!ev) return { status: 'no_evidence', plain: null, attempts: 0 };

  const plain = plainly(exId);
  const index = validate.provenance(ev);
  let feedback = null;
  let last = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const answer = await ask(ev, feedback);
    if (!answer) return { status: 'unavailable', plain, attempts: attempt };

    const check = validate.checkAnswer(answer, index);
    if (check.ok) return { status: 'ok', answer, plain, attempts: attempt, checked: check.checked };

    // Same evidence, plus precisely what was wrong. Never a corrected number — supplying one would
    // be inventing evidence to patch invented evidence.
    feedback = check.feedback;
    last = check;
  }

  return { status: 'unverified', plain, attempts: MAX_ATTEMPTS, unsupported: last.unsupported };
}
