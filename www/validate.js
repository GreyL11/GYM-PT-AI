// Checking an answer's numbers against the evidence that produced it. Pure — no DOM, no network,
// no provider, no second model.
//
// WHAT THIS IS. A containment layer for one claim class. Every number the evidence packet contains
// is indexed as it is built, so checking a claim is a lookup, not a judgement. Nothing here scores
// plausibility, and nothing here asks a model whether a model was right.
//
// WHAT THIS IS NOT, said plainly because the failure mode of a validator is people trusting it past
// its edges:
//
//   It checks that a number EXISTS in the evidence. It does not check that the number was used for
//   the right thing. Evidence holding `ofSets: 6` will accept "6 kg", "6 days" and "rep 6", because
//   binding a number to its referent means parsing the sentence, and parsing the sentence is the
//   line this layer does not cross. See CLAIM_VALIDATION_REPORT.md §"not enforced".
//
//   It sees digits. A model that writes "two thirds of your sets" makes an unchecked claim. The
//   answer to that is upstream — the explain prompt asks for digits — not a word-number parser here.
//
//   It says nothing about whether a sentence with no numbers in it is true.

import * as claims from './claims.js';

const round = (v, dp) => {
  const f = 10 ** dp;
  return Math.round((v + Number.EPSILON) * f) / f;
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Every number in the evidence packet, with the path it came from.
 *
 * Derived from the packet itself rather than listed by hand, so a field added to evidence.js is
 * automatically checkable and cannot fall out of sync with a duplicate list somewhere. Walks the
 * object; booleans and strings are skipped, since a claim can only be checked against a quantity.
 *
 * One derived entry, and only one: `from`/`to` siblings also yield their difference. It is there
 * because "that is 2.5 kg more than last time" is a correct, natural sentence about a decision
 * whose difference is not itself stored, and it is the ONLY arithmetic admitted — a validator that
 * accepts any combination of any two evidence numbers accepts almost any number at all.
 */
export function provenance(evidence, path = '', out = []) {
  if (Array.isArray(evidence)) {
    evidence.forEach((v, i) => provenance(v, `${path}[${i}]`, out));
    return out;
  }
  if (evidence && typeof evidence === 'object') {
    for (const [k, v] of Object.entries(evidence)) {
      provenance(v, path ? `${path}.${k}` : k, out);
    }
    // Only when the load actually moved. A hold has from === to, and admitting that zero would put
    // a 0 in the index that supports any "0" claim anywhere in the answer — which is exactly the
    // collapse the decimal rule below refuses to allow. A weight that did not move is already said
    // by `decision: 'hold'`; it does not need a number too.
    if (isNum(evidence.from) && isNum(evidence.to) && evidence.from !== evidence.to) {
      out.push({
        id: `${path}.△`,
        value: Math.abs(evidence.to - evidence.from),
        derived: 'to − from',
      });
    }
    return out;
  }
  if (isNum(evidence)) out.push({ id: path, value: evidence });
  return out;
}

/**
 * Does one indexed value support this claim, and by which rule?
 *
 * The rules, all deterministic, all documented here because a rounding policy nobody wrote down is
 * a rounding policy that drifts:
 *
 *   exact       An integer in evidence must be quoted exactly. 6 supports "6" and nothing else.
 *   decimal     A non-integer may be quoted at its own precision or rounder, but never at zero
 *               decimals — 0.38 supports "0.38" and "0.4", and must NOT support "0", which is
 *               what unrestricted rounding would allow.
 *   percent     A value may be written as a percentage of itself: 0.38 → "38%", 0.333… → "33%" or
 *               "33.3%". Rounding is half-up at the precision the claim was written to. "40%" from
 *               0.38 fails, because two-significant-figure rounding is not a rule anyone declared.
 *
 * An integer may also be written as a percentage where that is meaningful (1 → "100%"), which is
 * how a confidence of exactly 1.0 survives being stored as an integer.
 */
function rule(value, claim) {
  const { kind, decimals } = claim;

  if (kind === 'percentage') {
    if (round(value * 100, decimals) === claim.value) return 'percent';
    return null;
  }
  if (Number.isInteger(value)) return value === claim.value ? 'exact' : null;
  // Non-integer: the claim must carry at least one decimal place of its own, so that rounding
  // cannot collapse a real quantity to a number that says something else.
  if (decimals >= 1 && round(value, decimals) === claim.value) return 'decimal';
  return null;
}

/**
 * Check one claim against the whole index.
 *
 * A recommendation is not checked at all. "Try three sets of five next time" proposes numbers; it
 * does not report them, and requiring a proposal to appear in the evidence would reject correct
 * advice. This exemption is the single biggest hole a determined model could walk through, and it
 * is why the structured path classifies by FIELD rather than by the sentence's wording.
 */
export function checkClaim(claim, index) {
  if (claim.claimed === 'recommendation') {
    return { ...claim, status: 'exempt', why: 'a suggested number, not a report' };
  }
  for (const entry of index) {
    const by = rule(entry.value, claim);
    if (by) return { ...claim, status: 'supported', source: entry.id, rule: by };
  }
  return { ...claim, status: 'unsupported' };
}

/** Free-text answer: classify a sentence at a time, then check. Used for the conversational path. */
export function checkProse(text, index) {
  return verdict(claims.extractProse(text).map((c) => checkClaim(c, index)));
}

/**
 * A structured answer, where the class of each statement is known rather than guessed.
 *
 * This is the strong path, and the reason the explain flow asks for JSON. `observed` and `meaning`
 * are statements about what happened and must be traceable; `suggestion` proposes something and is
 * exempt. No word list, no sentence heuristics, no ambiguity about which is which — the model put
 * each sentence in a labelled box and the label is what decides.
 */
export function checkAnswer(answer, index) {
  const parts = [
    ...(answer?.observed ?? []).flatMap((s) => claims.extract(s, 'observed')),
    ...claims.extract(answer?.meaning ?? '', 'inference'),
    ...claims.extract(answer?.suggestion ?? '', 'recommendation'),
  ];
  return verdict(parts.map((c) => checkClaim(c, index)));
}

function verdict(checked) {
  const unsupported = checked.filter((c) => c.status === 'unsupported');
  return {
    ok: unsupported.length === 0,
    checked,
    unsupported,
    // Written for the model, not for a person: this is what a single retry is told, and it names
    // the offending numbers and nothing else. No corrected values are supplied — handing back a
    // "right" number would be inventing evidence to fix invented evidence.
    feedback: unsupported.length
      ? `These numbers are not in the evidence you were given: ${unsupported.map((c) => c.raw).join(', ')}. Use only numbers that appear there, or say the figure is not available.`
      : null,
  };
}
