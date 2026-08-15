// Face geometry: alignment, head pose, and the regions everything else measures inside.
//
// Pure. No DOM, no MediaPipe import, no pixels — it takes an array of {x, y, z} landmarks in
// normalized [0,1] image coordinates and returns numbers. That is deliberate: this is the layer
// that decides WHERE we measure, and getting it wrong silently corrupts every signal built on top,
// so it has to be testable without a camera.
//
// LANDMARK INDICES ARE NOT REMEMBERED, THEY ARE THE LIBRARY'S OWN. Every index below was extracted
// from FaceLandmarker's exported constants (FACE_LANDMARKS_LEFT_EYE, _RIGHT_EYE, _LEFT_IRIS,
// _RIGHT_IRIS, _FACE_OVAL) rather than copied from a blog post. Hardcoding numbers from memory is
// exactly how a region ends up measuring an eyebrow for six months without anyone noticing.
//
// MediaPipe's left/right are the SUBJECT's left and right, not the viewer's. A selfie camera also
// mirrors the image. Both facts are handled in one place — see `mirrored` in regions().

/** Extracted from FaceLandmarker.FACE_LANDMARKS_* — see the module note above. */
export const EYE = {
  left: [249, 263, 362, 373, 374, 380, 381, 382, 384, 385, 386, 387, 388, 390, 398, 466],
  right: [7, 33, 133, 144, 145, 153, 154, 155, 157, 158, 159, 160, 161, 163, 173, 246],
};
export const IRIS = { left: [474, 475, 476, 477], right: [469, 470, 471, 472] };
export const FACE_OVAL = [
  10, 21, 54, 58, 67, 93, 103, 109, 127, 132, 136, 148, 149, 150, 152, 162, 172, 176, 234,
  251, 284, 288, 297, 323, 332, 338, 356, 361, 365, 377, 378, 379, 389, 397, 400, 454,
];

/** Outer eye corners, the two most stable points on a face for alignment. From the eye sets. */
const OUTER_EYE = { left: 263, right: 33 };
/** Chin and forehead extremes of the oval, used for vertical anchoring. */
const CHIN = 152;
const FOREHEAD_TOP = 10;

const at = (lm, i) => lm?.[i];
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Centroid of a set of landmark indices. */
export function centroid(lm, indices) {
  const pts = indices.map((i) => at(lm, i)).filter(Boolean);
  if (pts.length !== indices.length) return null;
  return { x: mean(pts.map((p) => p.x)), y: mean(pts.map((p) => p.y)) };
}

/**
 * The frame of reference every measurement is expressed in.
 *
 * `scale` is the distance between the outer eye corners. For ONE person that distance is fixed in
 * the real world, so it is a direct proxy for how far the camera was — which is what makes a
 * region measured today comparable with the same region measured last week. Iris width is the more
 * famous choice (it barely varies between humans), but between-person constancy buys nothing here:
 * every comparison this app makes is a person against their own history. Eye corners survive blinks
 * and are visible at more head angles, which does buy something.
 *
 * `roll` lets regions rotate with the head instead of sliding off the cheek when someone tilts.
 */
export function alignment(lm) {
  const l = at(lm, OUTER_EYE.left);
  const r = at(lm, OUTER_EYE.right);
  const chin = at(lm, CHIN);
  const top = at(lm, FOREHEAD_TOP);
  if (!l || !r || !chin || !top) return null;

  const dx = l.x - r.x;
  const dy = l.y - r.y;
  const scale = Math.hypot(dx, dy);
  if (scale < 1e-6) return null;

  return {
    scale,
    roll: Math.atan2(dy, dx),
    eyeMid: { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 },
    chin: { x: chin.x, y: chin.y },
    top: { x: top.x, y: top.y },
    height: Math.hypot(chin.x - top.x, chin.y - top.y),
  };
}

/**
 * Head orientation, without the transformation matrix.
 *
 * FaceLandmarker can return a 4×4 facial transformation matrix, which is the better source and is
 * used when present (see poseFromMatrix). This is the fallback and the cross-check, from geometry
 * alone:
 *
 *   yaw   — the nose sits mid-way between the eye corners when facing forward. Turning the head
 *           slides it toward the near eye. Measured as that offset over the eye distance, so it is
 *           scale-free: -1 fully left, 0 forward, +1 fully right.
 *   pitch — the eye line sits at a fixed fraction of face height when level. Nodding moves it.
 *   roll  — straight from the eye-corner angle.
 *
 * All three are ratios of distances that shrink together with camera distance, so none of them
 * depends on how close the phone is.
 */
export function headPose(lm) {
  const a = alignment(lm);
  const nose = at(lm, 1);
  if (!a || !nose) return null;

  // Project the nose onto the eye axis; the perpendicular offset from the midpoint is yaw.
  const ux = Math.cos(a.roll);
  const uy = Math.sin(a.roll);
  const yaw = ((nose.x - a.eyeMid.x) * ux + (nose.y - a.eyeMid.y) * uy) / a.scale;

  // How far down the face the eye line sits. ~0.35 looking straight ahead; smaller looking up.
  const eyeDrop = a.height > 1e-6
    ? Math.hypot(a.eyeMid.x - a.top.x, a.eyeMid.y - a.top.y) / a.height
    : null;

  return { yaw, pitch: eyeDrop == null ? null : eyeDrop - 0.35, roll: a.roll };
}

/**
 * Head pose from FaceLandmarker's own 4×4 transformation matrix, when available.
 *
 * Column-major, as MediaPipe returns it. The upper-left 3×3 is the rotation, so the Euler angles
 * come straight out of it — no landmark heuristics, no tuned constants. Prefer this; headPose()
 * exists for when the matrix is absent and as something to sanity-check it against.
 */
export function poseFromMatrix(m) {
  if (!m || m.length !== 16) return null;
  const r = (row, col) => m[col * 4 + row];
  const sy = Math.hypot(r(0, 0), r(1, 0));
  if (sy < 1e-6) return null;
  return {
    yaw: Math.atan2(-r(2, 0), sy),
    pitch: Math.atan2(r(2, 1), r(2, 2)),
    roll: Math.atan2(r(1, 0), r(0, 0)),
  };
}

/**
 * The regions we measure inside, as squares in normalized image coordinates.
 *
 * Every box is sized as a FRACTION OF EYE DISTANCE and positioned relative to face anchors, never
 * in absolute pixels. That is the whole trick: a cheek patch is then the same piece of face
 * whether the phone was at arm's length or a foot away, which is the precondition for comparing
 * today against last month at all.
 *
 * Boxes are deliberately small and well inside their features. A forehead patch that occasionally
 * catches hair, or a cheek patch that catches the jaw shadow, does not produce a slightly worse
 * measurement — it produces a confident measurement of hair.
 *
 * `mirrored` handles the selfie camera. A front camera flips the image, so the subject's left
 * cheek appears on the right of the frame. Getting this wrong swaps left and right for every
 * asymmetry comparison, which would look like a real finding rather than a bug.
 */
export function regions(lm, { mirrored = false } = {}) {
  const a = alignment(lm);
  if (!a) return null;

  const s = a.scale;
  const ux = Math.cos(a.roll);
  const uy = Math.sin(a.roll);
  // Face-down direction, perpendicular to the eye axis.
  const dx = -uy;
  const dy = ux;

  /** Place a box `along` the eye axis and `down` the face, both in eye-distance units. */
  const box = (along, down, size) => ({
    cx: a.eyeMid.x + ux * along * s + dx * down * s,
    cy: a.eyeMid.y + uy * along * s + dy * down * s,
    half: (size * s) / 2,
  });

  const side = mirrored ? -1 : 1;

  return {
    // Above the brows, inside the hairline. Kept narrow: foreheads vary hugely in height.
    forehead: box(0, -0.45, 0.45),
    // Out along the eye axis and below the eye — the flat of the cheek, clear of the nose fold
    // and clear of the jaw.
    leftCheek: box(0.42 * side, 0.45, 0.38),
    rightCheek: box(-0.42 * side, 0.45, 0.38),
    // Directly under each eye, above the cheek box. Small, because the useful area is small.
    leftUnderEye: box(0.30 * side, 0.16, 0.20),
    rightUnderEye: box(-0.30 * side, 0.16, 0.20),
    // Bridge of the nose, between the eyes and above the tip.
    nose: box(0, 0.28, 0.26),
    // Between the lower lip and the chin point.
    chin: box(0, 0.95, 0.30),
  };
}

/** Turn a normalized box into integer pixel bounds, clipped to the image. */
export function toPixels(box, width, height) {
  const x0 = Math.round((box.cx - box.half) * width);
  const y0 = Math.round((box.cy - box.half) * height);
  const x1 = Math.round((box.cx + box.half) * width);
  const y1 = Math.round((box.cy + box.half) * height);
  return {
    x: Math.max(0, x0),
    y: Math.max(0, y0),
    w: Math.min(width, x1) - Math.max(0, x0),
    h: Math.min(height, y1) - Math.max(0, y0),
    // A box the face has pushed off the edge of the frame is not a smaller sample of the same
    // thing, it is a different piece of face. Callers must drop it rather than measure it.
    clipped: x0 < 0 || y0 < 0 || x1 > width || y1 > height,
  };
}
