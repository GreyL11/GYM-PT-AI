// One capture, end to end. Pure — every pixel arrives through an injected reader, so the whole
// pipeline runs in node against a synthetic image with no camera, no canvas and no model.
//
// THE ORDER IS THE ARCHITECTURE:
//
//   landmarks → framing/pose  ── fail ──▶ stop. No pixel is read for a face that is not there.
//        │
//        ▼
//   reference (create on the first accepted capture, reuse forever after)
//        │
//        ▼
//   canonical sampling ── the same mesh triangles, every time
//        │
//        ▼
//   mask algebra ── erode, then veto against skin segmentation
//        │
//        ▼
//   pixel-based quality ── sharpness, exposure, balance, lighting-vs-history
//        │
//        ▼
//   gate ── blocking failures stop the measurement; comparability failures only stop the comparison
//        │
//        ▼
//   features ── differences against the same-frame face reference
//
// Quality runs AFTER sampling and not before, which looks backwards and is not: three of the four
// pixel checks need the regions to have been located first. Balance is the brightness of the left
// cheek against the right cheek, and there is no such number until something has decided where the
// cheeks are. The gate still has the last word — nothing is recorded as a measurement until it says
// so — but it cannot speak until the sampler has run.

import * as q from './quality.js';
import * as mask from './mask.js';
import * as features from './features.js';
import { planAll, sampleRegion, samplingRatio, toReference, packReference } from './registration.js';
import { alignment, FACE_OVAL } from './geometry.js';

/** Regions carried through the pipeline but never trusted by default. */
export const EXPERIMENTAL = new Set(['chin']);

/** Every pixel of the face rectangle is not needed to judge focus or exposure. */
const FACE_RECT_STEP = 2;

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/**
 * A coarse luminance rectangle over the whole face, for the two checks that need an image rather
 * than a region: focus and overall brightness.
 *
 * Deliberately a plain rectangle from the source image, not a canonical patch. Canonical sampling
 * resamples, and resampling changes exactly the high-frequency content the focus check measures —
 * judging blur on a resampled buffer would be judging the resampler.
 */
export function faceLuma(lm, width, height, read) {
  const pts = FACE_OVAL.map((i) => lm[i]).filter(Boolean);
  if (pts.length !== FACE_OVAL.length) return null;
  const x0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.x)) * width));
  const x1 = Math.min(width, Math.ceil(Math.max(...pts.map((p) => p.x)) * width));
  const y0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.y)) * height));
  const y1 = Math.min(height, Math.ceil(Math.max(...pts.map((p) => p.y)) * height));
  const w = Math.floor((x1 - x0) / FACE_RECT_STEP);
  const h = Math.floor((y1 - y0) / FACE_RECT_STEP);
  if (w < 3 || h < 3) return null;

  const buf = new Float64Array(w * h);
  for (let j = 0; j < h; j += 1) {
    for (let i = 0; i < w; i += 1) {
      const rgb = read(x0 + i * FACE_RECT_STEP, y0 + j * FACE_RECT_STEP);
      buf[j * w + i] = rgb ? (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 : 0;
    }
  }
  return { buf, w, h };
}

/** Mean of a region's sampled luminance over its valid pixels. Null when nothing survived. */
function meanLuma(sampled, m) {
  let sum = 0;
  let n = 0;
  for (let k = 0; k < m.length; k += 1) {
    if (!m[k]) continue;
    sum += (0.2126 * sampled.r[k] + 0.7152 * sampled.g[k] + 0.0722 * sampled.b[k]) / 255;
    n += 1;
  }
  return n ? sum / n : null;
}

/**
 * Run one capture.
 *
 * @param lm            478 landmarks, normalized image coordinates
 * @param matrix        FaceLandmarker's 4x4 transformation matrix, or null
 * @param width,height  source image size in pixels
 * @param read          (px, py) => [r,g,b] 0-255, or null outside the image
 * @param isSkin        (px, py) => boolean from the segmentation, or null when it did not run
 * @param plans         from registration.planAll(reference), or null on the very first capture
 * @param lightingHistory  past mean face luminances, for the comparability check
 * @param mirrored      front camera flip, for the framing check only — anatomy needs no such flag
 *
 * @returns a result whose `stage` says how far it got. Every early exit names itself rather than
 *          returning an empty measurement that reads like a measurement of nothing.
 */
export function analyse({
  lm, matrix, width, height, read, isSkin = null, plans = null, lightingHistory = [], mirrored = true,
}) {
  const align = alignment(lm);
  if (!align) return { stage: 'no_face', quality: q.gate({}), accepted: false, regions: {} };

  const framing = q.framing(lm, { width, height, mirrored });
  const pose = q.pose(lm, matrix);
  if (framing.reason || pose.reason) {
    // Nothing is read from the image. A face that is cropped or turned away is not a worse sample,
    // and spending 200k pixel reads to confirm that would only warm the phone up.
    return {
      stage: 'framing',
      quality: q.gate({ framing, pose }),
      accepted: false,
      regions: {},
    };
  }

  // The first accepted capture defines this person's canonical face and is not itself measured
  // against anything — there is no baseline yet, and pretending otherwise is the failure this
  // whole phase exists to prevent.
  let createdReference = null;
  let activePlans = plans;
  if (!activePlans) {
    const ref = toReference(lm);
    if (!ref) return { stage: 'reference_failed', quality: q.gate({ framing, pose }), accepted: false, regions: {} };
    const built = planAll(ref);
    if (!built) return { stage: 'reference_failed', quality: q.gate({ framing, pose }), accepted: false, regions: {} };
    createdReference = packReference(ref);
    activePlans = built.plans;
  }

  // ── sample, mask, and account for every pixel lost ──────────────────────────────────────
  const sampledByRegion = {};
  const masks = {};
  const stats = {};
  for (const [name, plan] of Object.entries(activePlans)) {
    const sampled = sampleRegion(plan, lm, width, height, read);
    const applied = mask.apply(sampled, plan, isSkin);
    sampledByRegion[name] = sampled;
    masks[name] = applied;
    if (applied.available) {
      const s = features.regionStats(sampled, applied.mask);
      if (s) stats[name] = s;
      else masks[name] = { ...applied, available: false, reason: 'insufficient_pixels' };
    }
  }

  // ── pixel-based quality ────────────────────────────────────────────────────────────────
  const rect = faceLuma(lm, width, height, read);
  const sharpness = rect ? q.sharpness(rect.buf, rect.w, rect.h) : { score: 0, reason: 'no image' };
  const exposure = rect ? q.exposure(rect.buf) : { score: 0, reason: 'no image' };
  const meanFace = rect ? exposure.mean : null;

  const lCheek = sampledByRegion.leftCheek && masks.leftCheek
    ? meanLuma(sampledByRegion.leftCheek, masks.leftCheek.mask) : null;
  const rCheek = sampledByRegion.rightCheek && masks.rightCheek
    ? meanLuma(sampledByRegion.rightCheek, masks.rightCheek.mask) : null;
  const balance = q.balance(lCheek, rCheek);
  const lighting = q.lightingMatch(meanFace ?? 0, lightingHistory);

  const gate = q.gate({ framing, pose, sharpness, exposure, balance, lighting });

  // ── features, only for what survived ───────────────────────────────────────────────────
  const ref = features.faceReference(stats);
  const regions = {};
  for (const name of Object.keys(activePlans)) {
    const m = masks[name];
    const s = stats[name];
    const usable = gate.accepted && m?.available && s && ref;
    regions[name] = {
      available: Boolean(usable),
      experimental: EXPERIMENTAL.has(name),
      reason: usable ? null : (m?.reason ?? (!gate.accepted ? 'capture_rejected' : 'no_face_reference')),
      coverage: m?.coverage ?? 0,
      counts: m?.counts ?? null,
      // Absent, not zero. A region with no features has no `features` key at all, so nothing
      // downstream can read a missing measurement as a measured one.
      ...(usable ? { features: features.relative(s, ref) } : {}),
    };
  }

  return {
    stage: 'complete',
    accepted: gate.accepted,
    comparable: gate.comparable,
    quality: gate,
    regions,
    faceReference: ref ? { n: ref.n } : null,
    meanFaceLuma: finite(meanFace) ? Math.round(meanFace * 1e4) / 1e4 : null,
    sampling: { ratio: samplingRatio(activePlans[Object.keys(activePlans)[0]], align.scale, width) },
    createdReference,
    segmenterUsed: Boolean(isSkin),
    // Never persisted. The dev panel draws from this and it is dropped with the frame.
    debug: { sampled: sampledByRegion, masks, plans: activePlans },
  };
}
