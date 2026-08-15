// The capture quality gate. Pure — landmarks and luminance arrays in, confidence out.
//
// THIS IS THE MOST IMPORTANT MODULE IN THE FEATURE, and it is the one that says no.
//
// A false skin trend caused by standing nearer a window is worse than no trend at all: it is
// confidently wrong about someone's face, which is the one thing this feature must never be. Every
// signal downstream is a comparison against the same person's past, and a comparison is only as
// honest as the two captures are alike. So this module exists to refuse.
//
// It refuses on framing, on head angle, on blur, on exposure, and — the one most people skip — on
// lighting that does not match how that person usually photographs themselves. A check-in taken
// under a different lamp is not a worse sample of the same thing; it is a sample of something else.
//
// Nothing here reads a pixel directly. It takes summary statistics computed elsewhere, so every
// threshold in it can be tested with plain arrays and no camera.

import { alignment, headPose, poseFromMatrix, regions, toPixels } from './geometry.js';

/**
 * Thresholds, all in one place so they can be argued with.
 *
 * These are starting values chosen from what the maths implies, not from measurement on real
 * captures — there has been no on-device session yet. They are expected to move once there is
 * real data, which is exactly why they are one object and not scattered through the code.
 */
export const LIMITS = {
  // Eye distance as a fraction of frame width. Too small and every region is a handful of pixels;
  // too large and the face is cropped or the lens is distorting it.
  faceMin: 0.11,
  faceMax: 0.42,
  // Radians. ~14° of yaw already changes which part of a cheek faces the light.
  yawMax: 0.25,
  pitchMax: 0.20,
  rollMax: 0.30,
  // Variance of the Laplacian, normalised. Below this the image is soft enough that texture
  // measurements are measuring the blur, not the face.
  sharpnessMin: 0.15,
  // Fraction of pixels allowed to be crushed to black or blown to white in a measured region.
  clipMax: 0.02,
  // Mean luminance, 0-1. Outside this the sensor is fighting and colour ratios drift.
  lumaMin: 0.22,
  lumaMax: 0.82,
  // Left/right illumination imbalance. Side lighting makes one cheek brighter than the other and
  // would read as a real asymmetry finding.
  balanceMax: 0.18,
  // How far this capture's overall brightness may sit from the person's own usual, in their own
  // standard deviations, before comparisons are flagged unreliable.
  lightingDriftMax: 2.0,
  // Below this, the check-in is not stored as baseline evidence.
  acceptMin: 0.6,
};

const clamp01 = (n) => Math.max(0, Math.min(1, n));

/** Score that is 1 inside a band and falls off linearly outside it. */
function band(value, lo, hi, tolerance) {
  if (value >= lo && value <= hi) return 1;
  const d = value < lo ? lo - value : value - hi;
  return clamp01(1 - d / tolerance);
}

/** Score that is 1 at zero and 0 at `max`. */
const under = (value, max) => clamp01(1 - Math.abs(value) / max);

/**
 * Is the face big enough, centred enough, and completely inside the frame?
 *
 * A cropped face is rejected outright rather than scored down. A region that runs off the edge is
 * not a noisier version of that region — it is a different piece of skin, and averaging it in
 * would move the number for a reason that has nothing to do with the person.
 */
export function framing(lm, { width, height, mirrored = false } = {}) {
  const a = alignment(lm);
  if (!a) return { score: 0, reason: 'no face' };

  const size = a.scale;
  const sizeScore = band(size, LIMITS.faceMin, LIMITS.faceMax, 0.10);

  // Centre matters much less than size, so it is weighted lightly — an off-centre face is still
  // perfectly measurable, it just risks clipping.
  const off = Math.hypot(a.eyeMid.x - 0.5, a.eyeMid.y - 0.45);
  const centreScore = clamp01(1 - off / 0.35);

  const rs = regions(lm, { mirrored });
  const clipped = rs
    ? Object.entries(rs).filter(([, b]) => toPixels(b, width, height).clipped).map(([k]) => k)
    : [];

  const score = clipped.length ? 0 : sizeScore * 0.75 + centreScore * 0.25;
  return {
    score,
    size,
    clipped,
    reason: clipped.length ? `${clipped.join(', ')} outside the frame`
      : size < LIMITS.faceMin ? 'too far away'
      : size > LIMITS.faceMax ? 'too close'
      : null,
  };
}

/** Head square-on to the camera? Uses the transformation matrix when it is there. */
export function pose(lm, matrix) {
  const p = poseFromMatrix(matrix) ?? headPose(lm);
  if (!p) return { score: 0, reason: 'no face' };
  const yaw = under(p.yaw, LIMITS.yawMax);
  const pitch = p.pitch == null ? 1 : under(p.pitch, LIMITS.pitchMax);
  const roll = under(p.roll, LIMITS.rollMax);
  const score = Math.min(yaw, pitch, roll);
  return {
    score,
    yaw: p.yaw,
    pitch: p.pitch,
    roll: p.roll,
    reason: score > 0.5 ? null
      : yaw <= pitch && yaw <= roll ? 'turn to face the camera'
      : pitch <= roll ? 'hold the phone level with your face'
      : 'straighten your head',
  };
}

/**
 * Blur, from the variance of the Laplacian.
 *
 * The standard cheap sharpness measure: a second-derivative kernel responds to edges, so a sharp
 * image has high variance in the result and a soft one has almost none. Reported normalised
 * because absolute values are meaningless across resolutions.
 *
 * @param luma  luminance 0-1, row-major
 */
export function sharpness(luma, w, h) {
  if (!luma || w < 3 || h < 3) return { score: 0, value: 0, reason: 'no image' };
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      // 4-neighbour Laplacian.
      const v = 4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - w] - luma[i + w];
      sum += v;
      sumSq += v * v;
      n += 1;
    }
  }
  if (!n) return { score: 0, value: 0, reason: 'no image' };
  const variance = sumSq / n - (sum / n) ** 2;
  // Scaled so that a normally-lit sharp photo lands near 1. Empirical, and expected to move once
  // there are real captures to calibrate against.
  const value = Math.sqrt(Math.max(0, variance)) * 8;
  return {
    score: clamp01(value / LIMITS.sharpnessMin / 2),
    value,
    reason: value < LIMITS.sharpnessMin ? 'hold still — that came out blurry' : null,
  };
}

/**
 * Exposure: is the sensor clipping, and is the overall level usable?
 *
 * Clipped pixels carry no information at all — a blown-out highlight is the same white whatever
 * was underneath it — so a region with many of them cannot be compared with one without.
 */
export function exposure(luma) {
  if (!luma?.length) return { score: 0, reason: 'no image' };
  let dark = 0;
  let bright = 0;
  let sum = 0;
  for (const v of luma) {
    if (v <= 0.02) dark += 1;
    else if (v >= 0.98) bright += 1;
    sum += v;
  }
  const mean = sum / luma.length;
  const clip = (dark + bright) / luma.length;
  const clipScore = clamp01(1 - clip / LIMITS.clipMax);
  const levelScore = band(mean, LIMITS.lumaMin, LIMITS.lumaMax, 0.15);
  return {
    score: Math.min(clipScore, levelScore),
    mean,
    clip,
    reason: clip > LIMITS.clipMax ? 'harsh light — some of your face is pure white or pure black'
      : mean < LIMITS.lumaMin ? 'too dark in here'
      : mean > LIMITS.lumaMax ? 'too bright — try facing away from the light'
      : null,
  };
}

/**
 * Directional lighting, from left/right cheek brightness.
 *
 * This is the check that stops the feature inventing findings. Light from one side makes one cheek
 * brighter than the other, and every asymmetry signal downstream would read that as the person
 * changing. Reported as a fraction of their combined brightness, so it is exposure-independent.
 */
export function balance(leftLuma, rightLuma) {
  if (leftLuma == null || rightLuma == null) return { score: 1, reason: null };
  const total = leftLuma + rightLuma;
  if (total < 1e-6) return { score: 0, reason: 'too dark to tell' };
  const imbalance = Math.abs(leftLuma - rightLuma) / total;
  return {
    score: clamp01(1 - imbalance / LIMITS.balanceMax),
    imbalance,
    reason: imbalance > LIMITS.balanceMax ? 'the light is coming from one side' : null,
  };
}

/**
 * Does this capture's lighting match how this person usually photographs themselves?
 *
 * Everything above judges a capture on its own. This one judges it against their history, which is
 * the only thing that makes a COMPARISON valid — a perfectly exposed photo under a warm bathroom
 * bulb is a perfectly good photo and a bad match for thirty daylight ones.
 *
 * Returns full marks until there is enough history to have an opinion. Refusing to compare on the
 * grounds of a history that does not exist yet would block the feature from ever starting.
 */
export function lightingMatch(meanLuma, history) {
  const past = (history ?? []).filter((n) => typeof n === 'number');
  if (past.length < 4) return { score: 1, drift: null, reason: null, known: false };
  const mu = past.reduce((a, b) => a + b, 0) / past.length;
  const sd = Math.sqrt(past.reduce((a, b) => a + (b - mu) ** 2, 0) / past.length);
  if (sd < 0.01) {
    // Their captures are extremely consistent; use an absolute tolerance instead of dividing by a
    // standard deviation near zero, which would call any difference at all enormous.
    const drift = Math.abs(meanLuma - mu) / 0.08;
    return {
      score: clamp01(1 - drift / LIMITS.lightingDriftMax), drift, known: true,
      reason: drift > LIMITS.lightingDriftMax ? 'the light is different from your usual check-ins' : null,
    };
  }
  const drift = Math.abs(meanLuma - mu) / sd;
  return {
    score: clamp01(1 - drift / LIMITS.lightingDriftMax),
    drift,
    known: true,
    reason: drift > LIMITS.lightingDriftMax ? 'the light is different from your usual check-ins' : null,
  };
}

/**
 * The single thing to tell the person right now.
 *
 * One instruction, never a list. A panel reading "move closer, hold still, turn to face the camera,
 * the light is coming from one side" is not guidance, it is a wall — and someone holding a phone at
 * arm's length can act on exactly one thing at a time.
 *
 * Ordered by what blocks what. There is no point asking someone to hold still while they are out
 * of frame, and no point mentioning the lighting until they are the right distance away, because
 * moving will change it anyway.
 */
export function guide(parts) {
  const order = ['framing', 'pose', 'exposure', 'sharpness', 'balance', 'lighting'];
  for (const k of order) {
    const p = parts[k];
    if (p?.reason) return { instruction: p.reason, blocking: k };
  }
  return { instruction: null, blocking: null };
}

/**
 * How many frames in a row have been good enough to capture from.
 *
 * The face has to be still, not merely acceptable in one lucky frame: a capture taken mid-movement
 * is blurred in a way the sharpness check can miss when the blur runs along an edge it happens not
 * to sample. Counting consecutive good frames costs nothing and rules that out.
 *
 * Any bad frame resets it to zero rather than decrementing. Half-steady is not steady.
 */
export function steadiness(state, accepted) {
  const frames = accepted ? (state?.frames ?? 0) + 1 : 0;
  return { frames, ready: frames >= STEADY_FRAMES };
}

/** ~2/3 second at 30fps. Long enough to rule out a lucky frame, short enough not to be a chore. */
export const STEADY_FRAMES = 20;

/**
 * One verdict from all of it.
 *
 * Combined as a WEIGHTED MINIMUM, not an average. A capture that is perfect in four ways and
 * cropped in the fifth is not 80% usable — it is unusable, and averaging would hide that. The
 * lowest component sets the ceiling; the others can only pull it further down.
 */
export function assess(parts) {
  const named = Object.entries(parts).filter(([, p]) => p && typeof p.score === 'number');
  if (!named.length) return { overall: 0, accepted: false, warnings: ['nothing to assess'] };

  const scores = named.map(([, p]) => p.score);
  const worst = Math.min(...scores);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  // Two thirds the weakest link, one third the general standard.
  const overall = Math.round((worst * 0.67 + avg * 0.33) * 100) / 100;

  const warnings = named.map(([, p]) => p.reason).filter(Boolean);
  return {
    ...Object.fromEntries(named.map(([k, p]) => [k, Math.round(p.score * 100) / 100])),
    overall,
    accepted: overall >= LIMITS.acceptMin,
    // Kept separate from `accepted`: a capture can be good enough to store while still being a
    // poor basis for a strong claim, and the trend layer needs to know the difference.
    trustworthy: overall >= 0.8,
    warnings,
  };
}
