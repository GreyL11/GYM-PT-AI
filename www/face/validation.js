// The empirical validation engine: does a candidate signal survive contact with a real face?
//
// Pure. Capture records in, per-signal verdicts out. No camera, no model, no network, no key.
//
// THIS MODULE IS THE POINT OF PHASE 3.5. Everything else in www/face/ produces numbers; this is the
// only thing that decides whether a number is allowed to become an intelligence. Its default answer
// is no, and the states below are pipeline states — they say what is known about a MEASUREMENT, and
// nothing whatsoever about a person's skin.
//
// THE GATES BELOW WERE WRITTEN BEFORE ANY CAPTURE EXISTED. That ordering is not a formality. A
// threshold chosen after seeing the data is a threshold chosen to pass, and the failure mode of this
// whole feature is a signal that was tuned until it looked stable. When a signal fails here the
// correct response is to DELETE IT, and validation.js is deliberately incapable of doing anything
// else — there is no severity, no partial credit, and no "close enough".

import { dayKey } from '../store.js';

/** The capture groups. `assumedUnchanged` records what the operator asserted, not what is true. */
export const PROTOCOLS = {
  A: { id: 'A', label: 'Same-session repeatability', minCaptures: 10, assumedUnchanged: true },
  B: { id: 'B', label: 'Across-session, comparable conditions', minCaptures: 7, assumedUnchanged: true },
  C: { id: 'C', label: 'Lighting stress', minCaptures: 6, assumedUnchanged: true },
  D: { id: 'D', label: 'Geometry stress', minCaptures: 6, assumedUnchanged: true },
  E: { id: 'E', label: 'Occlusion stress', minCaptures: 4, assumedUnchanged: false },
  F: { id: 'F', label: 'Facial hair / shaving', minCaptures: 6, assumedUnchanged: false },
};

/**
 * Pass/fail criteria, fixed in advance.
 *
 * `noiseRatio` is the one that matters and deserves its derivation written down, because "must be
 * stable" is not a number.
 *
 *   noise  = MAD of the signal across Protocol A — ten captures in a minute, where the person's
 *            appearance genuinely did not change. Whatever this number is, it is measurement error.
 *   spread = MAD across Protocol B — comparable captures on different days, which contains the same
 *            measurement error PLUS whatever really varies day to day.
 *
 * If noise is as large as spread, the signal carries nothing but its own error, and a "change" in it
 * is a coin flip. Requiring noise <= 0.5 * spread demands that real day-to-day variation be at least
 * twice the noise before anyone is told about it. That is the V2 document's "repeatability floor
 * below 0.5 MAD", made non-circular by naming which MAD.
 *
 * `lightingRatio` compares how far lighting alone moves the signal against that same noise — and it
 * is computed ONLY over captures the quality gate ACCEPTED, which is the whole test: not "does bad
 * light break it", but "does light the gate was happy with break it anyway".
 */
export const GATES = {
  noiseRatio: 0.5,
  lightingRatio: 2.0,
  availability: 0.8,
  falseChangeRate: 0.10,
  // A change is only ever reported beyond this many robust deviations, so it is also the threshold
  // the false-change proxy counts against.
  changeMads: 2.0,
};

export const STATES = {
  UNVALIDATED: 'UNVALIDATED',
  COLLECTING_DATA: 'COLLECTING_DATA',
  PROVISIONALLY_STABLE: 'PROVISIONALLY_STABLE',
  VALIDATED: 'VALIDATED',
  UNSTABLE: 'UNSTABLE',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
};

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const mad = (xs) => {
  if (xs.length < 2) return null;
  const c = median(xs);
  return median(xs.map((x) => Math.abs(x - c)));
};

/**
 * Coefficient of variation, and the refusal that makes it honest.
 *
 * CV is spread over mean, which only means anything on a ratio scale — a quantity with a true zero
 * that cannot go negative. Most features here are DIFFERENCES that cross zero, where the mean can be
 * arbitrarily near zero and CV explodes to a number that looks like a catastrophe and is an artefact.
 * So this returns null for those rather than a figure, and the caller reports the absence.
 */
export function coefficientOfVariation(xs, ratioScale) {
  if (!ratioScale || xs.length < 2) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (!(mean > 0)) return null;
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (xs.length - 1));
  return sd / mean;
}

/**
 * Pull one signal's values out of the record set, oldest first.
 *
 * SORTED BY TIMESTAMP, ALWAYS. Reading chronology off array position is a bug this codebase has
 * already shipped once, in insights.strength(), and every stability number here would be wrong in a
 * way nobody would notice.
 *
 * Only ACCEPTED captures contribute. A capture the quality gate rejected is not a noisy sample of
 * the signal — it is a sample of something else, and averaging it in is the exact mistake the gate
 * exists to prevent.
 */
export function series(records, protocol, region, feature) {
  const chronological = [...records]
    .filter((r) => r?.protocol === protocol && r.accepted)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));

  const eligible = protocol === 'B' ? oncePerDay(chronological) : chronological;

  return eligible.map((r) => {
    const reg = r.regions?.[region];
    return { at: r.at, available: Boolean(reg?.available), value: reg?.features?.[feature] ?? null };
  });
}

/**
 * One capture per calendar day. Applied to Protocol B and to nothing else.
 *
 * B exists to supply `spread` — the day-to-day variation that `noise` is measured against. Seven B
 * captures taken ten minutes apart would make `spread` measure the same thing `noise` does, drive
 * the ratio to 1, and fail every signal for a reason that has nothing to do with any signal. The
 * corpus would have been collected wrongly and the report would blame the measurement.
 *
 * Extra same-day captures are kept in storage — they are real data and cost nothing — but they do
 * not enter the spread. The first accepted capture of each day is the one that counts.
 */
export function oncePerDay(sorted) {
  const seen = new Set();
  const out = [];
  for (const r of sorted) {
    const key = dayKey(new Date(r.at));
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

const values = (s) => s.filter((p) => p.available && finite(p.value)).map((p) => p.value);

/**
 * How often the signal would have been called "changed" across captures the operator asserted were
 * unchanged.
 *
 * A PROXY, and labelled one. It applies the change rule — deviation beyond GATES.changeMads of the
 * robust centre — to Protocol B, whose whole premise is that nothing really changed. Every flag is
 * therefore a false positive, IF the premise holds. The premise is an assertion by whoever collected
 * the captures, not a fact this module can check, which is precisely why it is not called a
 * false-positive rate.
 */
export function falseChangeRate(xs) {
  if (xs.length < 4) return null;
  const c = median(xs);
  const m = mad(xs);
  if (!finite(m)) return null;

  // A MAD of exactly zero is the pathological case and it must NOT be waved through as "no spread
  // to divide by". It means more than half the captures are identical, which happens precisely when
  // a signal sits flat and then jumps — and every jump is then infinitely many deviations out. The
  // early version of this returned null here, which let the single worst-behaved shape a signal can
  // have sail past the gate untested.
  if (m <= 0) {
    const flagged = xs.filter((x) => x !== c).length;
    return flagged / xs.length;
  }
  const flagged = xs.filter((x) => Math.abs(x - c) / (1.4826 * m) > GATES.changeMads).length;
  return flagged / xs.length;
}

/**
 * Evaluate one signal — one feature, in one region — across every protocol.
 *
 * Returns the state, the metrics behind it, and the reason. `metrics` may legitimately hold nulls:
 * a metric that could not be computed is absent, never zero, because zero variance and no
 * measurement of variance are opposite findings.
 */
export function evaluateSignal(records, region, feature, spec = {}) {
  const byProtocol = {};
  for (const id of Object.keys(PROTOCOLS)) {
    const s = series(records, id, region, feature);
    byProtocol[id] = { captures: s.length, available: s.filter((p) => p.available).length, values: values(s) };
  }

  const A = byProtocol.A;
  const B = byProtocol.B;
  const C = byProtocol.C;

  const noise = mad(A.values);
  const spread = mad(B.values);
  const range = (xs) => (xs.length >= 2 ? Math.max(...xs) - Math.min(...xs) : null);
  const ratio = (r) => (finite(r) && finite(noise) && noise > 0 ? r / noise : null);
  const lightingRange = range(C.values);

  const totalAccepted = Object.values(byProtocol).reduce((n, p) => n + p.captures, 0);
  const totalAvailable = Object.values(byProtocol).reduce((n, p) => n + p.available, 0);
  const availability = totalAccepted ? totalAvailable / totalAccepted : null;

  const metrics = {
    captures: Object.fromEntries(Object.entries(byProtocol).map(([k, p]) => [k, p.captures])),
    availability: finite(availability) ? Math.round(availability * 1000) / 1000 : null,
    noiseMad: noise,
    sessionSpreadMad: spread,
    noiseRatio: finite(noise) && finite(spread) && spread > 0 ? noise / spread : null,
    lightingRange,
    lightingRatio: ratio(lightingRange),
    // Reported, NOT gated, and the distinction is deliberate. The Phase 3.5 gates were fixed before
    // any capture existed, and adding a gate now — after the collection tooling was built and while
    // knowing what the corpus will contain — is exactly the goalpost-moving this whole discipline
    // exists to prevent. These two numbers go in the report so a human can see them and decide, in
    // a later phase, on the record, whether they should ever become gates.
    geometryRatio: ratio(range(byProtocol.D.values)),
    facialHairRatio: ratio(range(byProtocol.F.values)),
    falseChangeRate: falseChangeRate(B.values),
    coefficientOfVariation: coefficientOfVariation(B.values, spec.ratioScale === true),
  };

  const state = decide(byProtocol, metrics);
  return { region, feature, ...state, metrics };
}

/**
 * The state machine. Order is load-bearing and each branch is a different claim.
 *
 * Nothing here can reach VALIDATED without Protocol C. A signal that is beautifully repeatable and
 * has never been shown a different lamp is not validated — it is untested against the confound that
 * kills this entire feature category, and calling it validated would be the single most damaging
 * thing this module could do.
 */
function decide(byProtocol, m) {
  const shortfalls = Object.values(PROTOCOLS)
    .filter((p) => byProtocol[p.id].captures < p.minCaptures)
    .map((p) => `${p.id}:${byProtocol[p.id].captures}/${p.minCaptures}`);

  if (Object.values(byProtocol).every((p) => !p.captures)) {
    return { state: STATES.UNVALIDATED, reason: 'no captures have been recorded for this signal' };
  }

  // Measured often enough to judge, but the region kept coming back unavailable. That is a finding
  // about the REGION, not about the feature, and it is not the same as an unstable feature.
  if (finite(m.availability) && m.availability < GATES.availability
    && byProtocol.A.captures >= PROTOCOLS.A.minCaptures) {
    return {
      state: STATES.INSUFFICIENT_DATA,
      reason: `region available in only ${Math.round(m.availability * 100)}% of accepted captures (need ${GATES.availability * 100}%)`,
    };
  }

  if (byProtocol.A.captures < PROTOCOLS.A.minCaptures || byProtocol.B.captures < PROTOCOLS.B.minCaptures) {
    return { state: STATES.COLLECTING_DATA, reason: `waiting on ${shortfalls.join(', ')}` };
  }

  // The false-change proxy is checked FIRST among the stability gates, and the order is a fix
  // rather than a preference. A signal that sits flat and then jumps has an across-session MAD of
  // exactly zero, which makes the noise ratio undefined — so checking the ratio first classified
  // the single worst-behaved shape a signal can have as "not enough data" and let it live. This
  // gate needs no ratio and speaks plainly about exactly that shape.
  if (finite(m.falseChangeRate) && m.falseChangeRate > GATES.falseChangeRate) {
    return {
      state: STATES.UNSTABLE,
      reason: `flagged a change in ${Math.round(m.falseChangeRate * 100)}% of captures asserted unchanged (limit ${GATES.falseChangeRate * 100}%)`,
    };
  }
  if (!finite(m.noiseRatio)) {
    return { state: STATES.INSUFFICIENT_DATA, reason: 'the day-to-day spread could not be measured, so noise cannot be judged against it' };
  }
  if (m.noiseRatio > GATES.noiseRatio) {
    return {
      state: STATES.UNSTABLE,
      reason: `same-session noise is ${m.noiseRatio.toFixed(2)} of the across-session spread (limit ${GATES.noiseRatio}) — the signal is mostly its own error`,
    };
  }

  if (byProtocol.C.captures < PROTOCOLS.C.minCaptures) {
    return {
      state: STATES.PROVISIONALLY_STABLE,
      reason: `repeatable, but lighting stress is untested (${byProtocol.C.captures}/${PROTOCOLS.C.minCaptures} captures)`,
    };
  }
  if (!finite(m.lightingRatio)) {
    return { state: STATES.PROVISIONALLY_STABLE, reason: 'lighting captures exist but the ratio could not be computed' };
  }
  if (m.lightingRatio > GATES.lightingRatio) {
    return {
      state: STATES.UNSTABLE,
      reason: `lighting alone moves it ${m.lightingRatio.toFixed(2)}x its own noise (limit ${GATES.lightingRatio}) — with captures the quality gate accepted`,
    };
  }

  return { state: STATES.VALIDATED, reason: `noise ${m.noiseRatio.toFixed(2)} of spread, lighting ${m.lightingRatio.toFixed(2)}x noise, available ${Math.round(m.availability * 100)}%` };
}

/**
 * Which region each occlusion condition is aimed at.
 *
 * `hand` is deliberately absent: a hand can land anywhere, so there is no region to hold to
 * account, and inventing one would manufacture a pass or a failure out of nothing.
 */
export const OCCLUSION_TARGETS = {
  glasses: ['leftUnderEye', 'rightUnderEye'],
  'hair-forehead': ['forehead'],
  'hair-cheek': ['leftCheek', 'rightCheek'],
};

/**
 * Protocol E asks a different question from every other protocol, and needs a different answer.
 *
 * Everywhere else the question is "does this number hold still". Here it is "does the pipeline
 * correctly REFUSE". A region with hair across it must come back unavailable; if it comes back with
 * a confident measurement, the veto did not work and the number is a measurement of hair.
 *
 * TWO OUTCOMES BOTH COUNT AS CORRECT, which is why this cannot be scored like the others:
 *
 *   the whole capture was rejected by the quality gate — the obstruction made it unusable, and the
 *   gate said so before any region was measured;
 *   the capture was accepted and the OBSTRUCTED REGION specifically went unavailable.
 *
 * The failure is the third case: accepted, and the obstructed region measured anyway.
 */
export function occlusionBehaviour(records) {
  const inE = (records ?? []).filter((r) => r?.protocol === 'E');
  const baseline = inE.filter((r) => r.condition === 'baseline' && r.accepted);

  const availability = (list, region) => {
    const seen = list.filter((r) => r.regions?.[region]);
    if (!seen.length) return null;
    return seen.filter((r) => r.regions[region].available).length / seen.length;
  };

  const out = [];
  for (const [condition, targets] of Object.entries(OCCLUSION_TARGETS)) {
    const attempts = inE.filter((r) => r.condition === condition);
    if (!attempts.length) continue;
    const rejected = attempts.filter((r) => !r.accepted);
    const accepted = attempts.filter((r) => r.accepted);

    for (const region of targets) {
      const occluded = availability(accepted, region);
      const base = availability(baseline, region);
      out.push({
        condition,
        region,
        attempts: attempts.length,
        rejectedOutright: rejected.length,
        baselineAvailability: base,
        occludedAvailability: occluded,
        // No accepted captures means the gate refused every one — the first correct outcome.
        verdict: accepted.length === 0 ? 'refused_by_gate'
          : occluded === null ? 'no_data'
            : base === null ? 'no_baseline'
              : occluded < base ? 'excluded_correctly'
                : 'measured_through_occlusion',
      });
    }
  }
  return out;
}

/** Every signal in the grid. `features` is the FEATURES map from features.js. */
export function evaluateAll(records, regions, features) {
  const out = [];
  for (const region of regions) {
    for (const [feature, spec] of Object.entries(features)) {
      out.push(evaluateSignal(records, region, feature, spec));
    }
  }
  return out;
}

/** Which signals may become product intelligence. Exactly one state qualifies. */
export const productReady = (signals) => signals.filter((s) => s.state === STATES.VALIDATED);

/** Counts by state, for the report. */
export function summarise(signals) {
  const by = Object.fromEntries(Object.keys(STATES).map((k) => [k, 0]));
  for (const s of signals) by[s.state] += 1;
  return by;
}
