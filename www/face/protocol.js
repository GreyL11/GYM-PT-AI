// Guided collection of the empirical validation corpus. Pure — records in, progress out.
//
// THIS MODULE ANSWERS "HAVE WE COLLECTED ENOUGH?" AND NOTHING ELSE.
//
// validation.js answers a completely different question — "does this signal hold still?" — and the
// two must never be allowed to look like one another. A protocol reading COMPLETE means a tester
// took the photographs that were asked for. It says nothing whatsoever about whether any
// measurement survived them, and a dashboard that let those two greens sit in the same column would
// be the most misleading thing this feature could ship. So they are separate modules, separate
// vocabularies, and separate sections on screen.
//
// Collection states are NOT_STARTED / COLLECTING / COMPLETE / NOT_APPLICABLE.
// Signal states are UNVALIDATED / COLLECTING_DATA / PROVISIONALLY_STABLE / VALIDATED / UNSTABLE /
// INSUFFICIENT_DATA. There is deliberately no word in common.

import { dayKey } from '../store.js';
import { PROTOCOLS } from './validation.js';

export const COLLECTION = {
  NOT_STARTED: 'NOT_STARTED',
  COLLECTING: 'COLLECTING',
  COMPLETE: 'COMPLETE',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
};

/**
 * What each protocol asks a tester to actually do.
 *
 * `conditions` are LABELS, not measurements. The app cannot read lux or colour temperature — there
 * is no such API on this device stack — so it records what the tester was asked to arrange and
 * leaves it at that. A label that claims to be a measurement would be worse than no label.
 *
 * `counts: 'attempted'` on Protocol E is the one that looks like a mistake and is not. Occlusion is
 * the protocol where a REJECTION is the correct outcome: hair across the lens should fail the gate,
 * and a corpus that only counted successes would never accumulate the evidence that it does.
 *
 * `distinctDays` on Protocol B is derived from what B is FOR — see `dayLimited` below.
 */
export const SPEC = {
  A: {
    ...PROTOCOLS.A,
    purpose: 'Measure how much the pipeline\'s own numbers wobble when nothing about you has changed.',
    instruction: 'Ten captures, one after another, in one sitting. Step away and re-frame between each one — that is the point, not a nuisance.',
    conditions: ['baseline'],
    minConditions: 1,
    counts: 'accepted',
    distinctDays: false,
  },
  B: {
    ...PROTOCOLS.B,
    purpose: 'Measure how much the numbers move from one day to the next, which is what a real change would have to beat.',
    instruction: 'One capture a day, in the same place and the same light, for seven days. Only the first capture of each day counts.',
    conditions: ['baseline'],
    minConditions: 1,
    counts: 'accepted',
    distinctDays: true,
  },
  C: {
    ...PROTOCOLS.C,
    purpose: 'Find out whether a signal reports a change in you when the only thing that changed was the light.',
    instruction: 'Same face, same day, deliberately different lighting. Use at least four of the conditions below.',
    conditions: ['baseline', 'brighter', 'dimmer', 'side-lit', 'warm', 'cool'],
    minConditions: 4,
    counts: 'accepted',
    distinctDays: false,
  },
  D: {
    ...PROTOCOLS.D,
    purpose: 'Test whether canonical registration really does hold a region on the same piece of face when you move.',
    instruction: 'Small, realistic variations only. If the gate rejects it, you moved too far — that is the gate working, not a failure to collect.',
    conditions: ['baseline', 'closer', 'farther', 'roll-left', 'roll-right', 'yaw-left', 'yaw-right', 'expression'],
    minConditions: 4,
    counts: 'accepted',
    distinctDays: false,
  },
  E: {
    ...PROTOCOLS.E,
    purpose: 'Check that a contaminated region goes UNAVAILABLE instead of quietly returning a measurement of hair.',
    instruction: 'Deliberately obstruct part of your face. A rejected capture is a valid result here and is recorded as one.',
    conditions: ['baseline', 'glasses', 'hair-forehead', 'hair-cheek', 'hand'],
    minConditions: 3,
    counts: 'attempted',
    distinctDays: false,
  },
  F: {
    ...PROTOCOLS.F,
    purpose: 'Find out whether facial hair makes the chin and jaw unmeasurable. It may. That is a legitimate answer.',
    instruction: 'Only if it applies to you. Capture across a shaving cycle — days apart, not minutes.',
    conditions: ['baseline', 'stubble', 'beard', 'freshly-shaved'],
    minConditions: 2,
    counts: 'accepted',
    distinctDays: false,
    optional: true,
  },
};

export const IDS = Object.keys(SPEC);

/** Captures belonging to one protocol, oldest first. Never trusts array order. */
export const forProtocol = (records, id) => [...(records ?? [])]
  .filter((r) => r?.protocol === id)
  .sort((a, b) => String(a.at).localeCompare(String(b.at)));

/**
 * Protocol B, collapsed to one capture per calendar day.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT OPTIONAL. B's whole job is to supply `spread` — the day-to-day
 * variation that the noise from A is divided by. Take seven B captures ten minutes apart and
 * `spread` measures the same thing `noise` does, the ratio goes to 1, and every signal fails the
 * gate for a reason that has nothing to do with the signal. The corpus would have been collected
 * wrongly and the report would blame the measurement.
 *
 * So a day contributes exactly one B capture: the first accepted one. The rest are stored — they
 * are real data and they cost nothing to keep — but they do not advance the count and they do not
 * enter the spread.
 */
export function dayLimited(records) {
  const seen = new Set();
  const out = [];
  for (const r of forProtocol(records, 'B')) {
    if (!r.accepted) continue;
    const key = dayKey(new Date(r.at));
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** The captures that count toward a protocol's target, under that protocol's own rule. */
export function counting(records, id) {
  const spec = SPEC[id];
  if (!spec) return [];
  if (spec.distinctDays) return dayLimited(records);
  const all = forProtocol(records, id);
  return spec.counts === 'attempted' ? all : all.filter((r) => r.accepted);
}

/**
 * Where one protocol stands.
 *
 * Returns counts and a state, and deliberately returns NO judgement about any signal. `rejected` is
 * reported beside `accepted` rather than hidden: a gate that refuses most real attempts is itself a
 * finding, and it would be invisible if the dashboard only showed successes.
 */
export function progress(records, id, notApplicable = {}) {
  const spec = SPEC[id];
  if (!spec) return null;

  const all = forProtocol(records, id);
  const accepted = all.filter((r) => r.accepted);
  const rejected = all.filter((r) => !r.accepted);
  const counted = counting(records, id);
  const conditions = new Set(counted.map((r) => r.condition).filter(Boolean));
  const days = new Set(all.map((r) => dayKey(new Date(r.at))));

  // NOT_APPLICABLE is a first-class answer and must never decay into a verdict. "This tester has no
  // beard" is not a pass, not a failure, and not insufficient data — it is a protocol that does not
  // apply to them, and collapsing it into any of the other three would put a judgement where there
  // is none.
  if (notApplicable?.[id]) {
    return {
      id,
      state: COLLECTION.NOT_APPLICABLE,
      accepted: accepted.length,
      rejected: rejected.length,
      counted: counted.length,
      target: spec.minCaptures,
      conditions: [...conditions],
      conditionsNeeded: spec.minConditions,
      days: days.size,
      remaining: 0,
      note: 'Marked not applicable by the tester.',
    };
  }

  const enough = counted.length >= spec.minCaptures;
  const varied = conditions.size >= spec.minConditions;
  const state = all.length === 0 ? COLLECTION.NOT_STARTED
    : enough && varied ? COLLECTION.COMPLETE
      : COLLECTION.COLLECTING;

  return {
    id,
    state,
    accepted: accepted.length,
    rejected: rejected.length,
    counted: counted.length,
    target: spec.minCaptures,
    conditions: [...conditions],
    conditionsNeeded: spec.minConditions,
    conditionsMissing: spec.conditions.filter((c) => !conditions.has(c)),
    days: days.size,
    remaining: Math.max(0, spec.minCaptures - counted.length),
    note: state === COLLECTION.COLLECTING && enough && !varied
      ? `Enough captures, but only ${conditions.size} of the ${spec.minConditions} conditions needed.`
      : null,
  };
}

/** Every protocol's collection status. Never a signal verdict. */
export const dashboard = (records, notApplicable = {}) =>
  IDS.map((id) => progress(records, id, notApplicable));

/**
 * What to do next, in words a tester can act on.
 *
 * Suggests the least-covered condition rather than cycling blindly, so a half-finished lighting
 * protocol asks for the lamp nobody has tried yet instead of a seventh baseline.
 */
export function nextStep(records, id, notApplicable = {}) {
  const spec = SPEC[id];
  const p = progress(records, id, notApplicable);
  if (!spec || !p) return null;
  if (p.state === COLLECTION.NOT_APPLICABLE) return { done: true, condition: null, message: 'Not applicable — nothing to collect.' };
  if (p.state === COLLECTION.COMPLETE) return { done: true, condition: null, message: 'Collected. Run the evaluation to see what survived.' };

  // Day-limited protocols can be blocked purely by the clock, and saying so is more useful than a
  // capture button that silently does not count.
  if (spec.distinctDays) {
    const today = dayKey(new Date());
    if (dayLimited(records).some((r) => dayKey(new Date(r.at)) === today)) {
      return {
        done: false,
        blocked: true,
        condition: 'baseline',
        message: `Today's capture is already recorded. Come back tomorrow — ${p.remaining} more day${p.remaining === 1 ? '' : 's'} to go.`,
      };
    }
  }

  const counted = counting(records, id);
  const used = new Map(spec.conditions.map((c) => [c, 0]));
  for (const r of counted) if (used.has(r.condition)) used.set(r.condition, used.get(r.condition) + 1);
  const wanted = spec.conditions.slice(0, Math.max(spec.minConditions, 1));
  const next = [...used].filter(([c]) => wanted.includes(c)).sort((a, b) => a[1] - b[1])[0]?.[0]
    ?? spec.conditions[0];

  return {
    done: false,
    blocked: false,
    condition: next,
    repetition: counted.length + 1,
    message: `Capture ${counted.length + 1} of ${spec.minCaptures} — condition: ${next}.`,
  };
}

/** Corpus totals for the dashboard header. */
export function totals(records) {
  const all = records ?? [];
  const tagged = all.filter((r) => r?.protocol);
  return {
    captures: all.length,
    tagged: tagged.length,
    untagged: all.length - tagged.length,
    accepted: all.filter((r) => r?.accepted).length,
    rejected: all.filter((r) => r && !r.accepted).length,
  };
}
