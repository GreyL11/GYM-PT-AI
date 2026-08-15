// The capture record: what one check-in leaves behind, and what it deliberately does not.
//
// Pure except for the four functions at the bottom that read and write store.js.
//
// WHAT IS STORED. Numbers. Region statistics, quality scores, pixel counts, version strings. The
// stored record cannot reconstruct a face and cannot identify a person — it is a few dozen scalars
// about the light that fell on seven patches of skin.
//
// WHAT IS NOT STORED, ever, by this module: an image. Not a thumbnail, not a crop, not a data URL.
// Retaining a capture for validation is a separate, explicit, per-capture act that writes a PNG to
// the user's own filesystem through the browser's download path — see checkin.js. It never enters
// app storage, which means there is nothing for a bug to leak and nothing for a backup to carry.
//
// WHY VERSIONS RIDE ON EVERY RECORD. A stability number computed across two different pipelines is
// not a stability number, it is a comparison of two pipelines. Change the erosion radius, the
// canonical density, the topology, or the model file, and every measurement before that change
// belongs to a different experiment. The version block is what lets the harness notice instead of
// quietly averaging them together.

import * as store from '../store.js';
import { TOPOLOGY_VERSION } from './topology.js';
import { FEATURE_VERSION } from './features.js';
import { LIMITS as MASK_LIMITS } from './mask.js';
import { DENSITY } from './registration.js';

/** Bumped by hand whenever anything upstream of a stored number changes meaning. */
export const PIPELINE_VERSION = 'face-pipeline-1';

/**
 * Model identity, including the quantisation and the CDN revision.
 *
 * `float32/latest` for the segmenter is what the vendor script fetches, and `latest` is a moving
 * target — which is exactly why it is written into every record rather than assumed. If Google
 * republishes it, records either side of that day are distinguishable only if this string was
 * stored at the time.
 */
export const MODELS = {
  landmarker: 'face_landmarker/float16/1',
  segmenter: 'selfie_multiclass_256x256/float32/latest',
};

/** Everything that could change a stored number, in one comparable string set. */
export const versions = (segmenterUsed) => ({
  pipeline: PIPELINE_VERSION,
  topology: TOPOLOGY_VERSION,
  features: FEATURE_VERSION,
  landmarker: MODELS.landmarker,
  segmenter: segmenterUsed ? MODELS.segmenter : null,
  sampling: `density-${DENSITY}`,
  mask: `erode-${MASK_LIMITS.geometryErode}/${MASK_LIMITS.vetoErode}-cov-${MASK_LIMITS.minCoverage}-px-${MASK_LIMITS.minPixels}`,
});

/** One key holds everything the face feature knows, so deleting it deletes all of it. */
const BLANK = {
  consent: { retainImages: false, at: null },
  reference: null,
  captures: [],
  // Protocols the tester has declared do not apply to them — F, for someone who does not shave.
  // A separate map rather than a flag on the captures, because the whole point is that there ARE
  // no captures to carry it.
  notApplicable: {},
  // The collection session in progress, if any. Cleared when the tester ends it.
  session: null,
};

/** ~300 captures at roughly 1.5 KB each. Comfortably inside localStorage beside the training log. */
const CAP = 300;

export const read = () => ({ ...BLANK, ...(store.getSetting('faceLab', null) ?? {}) });

const write = (patch) => store.setSetting('faceLab', { ...read(), ...patch });

export const captures = () => read().captures;

/**
 * Append a capture.
 *
 * REJECTED CAPTURES ARE STORED TOO, and that is a validation decision rather than an oversight: the
 * acceptance rate of the quality gate is itself a result, and a gate that rejects 90% of real
 * attempts is a broken gate that would be invisible if only its successes were recorded. They carry
 * `accepted: false` and validation.js filters them out of every stability statistic.
 */
export function append(record) {
  write({ captures: [...captures(), record].slice(-CAP) });
  return record;
}

export const reference = () => read().reference;

/** Written once, from the first accepted capture. Replacing it invalidates every prior measurement. */
export function setReference(packed, device) {
  write({ reference: { packed, device, at: new Date().toISOString() } });
}

export const consent = () => read().consent;

export function setConsent(retainImages) {
  write({ consent: { retainImages: Boolean(retainImages), at: new Date().toISOString() } });
}

/** The independent delete control. Removes every face record and nothing else. */
export const forget = () => store.setSetting('faceLab', null);

// ── protocol collection ──────────────────────────────────────────────────────────────────

export const notApplicable = () => read().notApplicable ?? {};

export function setNotApplicable(protocol, value) {
  const next = { ...notApplicable() };
  if (value) next[protocol] = true; else delete next[protocol];
  write({ notApplicable: next });
}

export const session = () => read().session;

/**
 * Start a collection session.
 *
 * The id is the start timestamp, which is unique enough at millisecond resolution and — unlike a
 * random token — readable in an export, so "which sitting was this?" is answerable by looking.
 */
export function startSession(protocol) {
  const at = new Date().toISOString();
  const s = { id: `${protocol}-${at}`, protocol, startedAt: at };
  write({ session: s });
  return s;
}

export const endSession = () => write({ session: null });

/**
 * Everything the evaluation harness needs, and nothing else.
 *
 * A dedicated export rather than making the tester hunt inside a full backup. It deliberately does
 * NOT contain the canonical reference layout: that is 468 coordinates describing the shape of a
 * specific person's face, it is of no use whatsoever to the evaluation, and shipping face geometry
 * in a file meant to be emailed around would be exactly the kind of quiet leak this feature is
 * supposed to be careful about.
 *
 * It contains no image, because no image is ever stored.
 */
export function validationExport() {
  const state = read();
  return {
    kind: 'face-validation-export',
    v: 1,
    at: new Date().toISOString(),
    notApplicable: state.notApplicable ?? {},
    captures: state.captures,
  };
}

/**
 * Assemble one record.
 *
 * Absent is absent: a region that was not measurable carries `available: false` and a reason, and
 * NO features object at all. It never carries zeros, because a zero here would enter a median as a
 * real measurement of nothing.
 */
export function build({
  at, protocol, session: sessionId, repetition, condition,
  accepted, quality, regions, device, sampling, segmenterUsed, meanFaceLuma, note,
}) {
  return {
    at: at ?? new Date().toISOString(),
    protocol: protocol ?? null,
    // Which sitting, which repetition within it, and what the tester was asked to arrange.
    //
    // There is deliberately no `inclusion` field. Whether a capture counts is decided by `protocol`
    // and `accepted`, both of which are already here, and a third field restating them is a third
    // field that can disagree with them.
    ...(sessionId ? { session: sessionId } : {}),
    ...(Number.isInteger(repetition) ? { repetition } : {}),
    ...(condition ? { condition } : {}),
    accepted: Boolean(accepted),
    quality,
    device,
    sampling,
    versions: versions(segmenterUsed),
    regions,
    // The lighting-comparability check judges a capture against this person's own past brightness,
    // so the number has to survive the capture it came from. It rides on the record rather than
    // being recomputed, because recomputing it would need the image, which is gone.
    ...(typeof meanFaceLuma === 'number' ? { meanFaceLuma } : {}),
    ...(note ? { note } : {}),
  };
}

/** Records whose numbers are comparable with each other, keyed by their version fingerprint. */
export function groupByVersion(list) {
  const groups = new Map();
  for (const r of list) {
    const key = JSON.stringify(r?.versions ?? {});
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return groups;
}

/**
 * The largest set of records that share a pipeline version, and what was set aside.
 *
 * Silently mixing versions would produce a stability number that means nothing; silently dropping
 * the minority would hide that it happened. So both come back and the report says so.
 */
export function comparable(list) {
  const groups = [...groupByVersion(list)].sort((a, b) => b[1].length - a[1].length);
  if (!groups.length) return { records: [], excluded: 0, versionGroups: 0 };
  return {
    records: groups[0][1],
    excluded: list.length - groups[0][1].length,
    versionGroups: groups.length,
  };
}
