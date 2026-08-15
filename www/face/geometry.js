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

import { RINGS } from './topology.js';

// Was three hand-copied index lists. They are now read off topology.js, which is generated from the
// library's own constants — because two copies of the same indices is exactly the drift this file's
// header warns about, and one of them would eventually be the stale one.
export const EYE = { left: RINGS.leftEye.vertices, right: RINGS.rightEye.vertices };
export const IRIS = { left: RINGS.leftIris.vertices, right: RINGS.rightIris.vertices };
export const FACE_OVAL = RINGS.faceOval.vertices;

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

// ── anatomical geometry ──────────────────────────────────────────────────────────────────
//
// Everything above places SQUARES by formula, and that is all the per-frame framing gate needs: it
// only asks "is the area I would measure inside the picture", thirty times a second, on a phone.
//
// Everything below places POLYGONS built out of the mesh's own contour rings — the actual eyebrows,
// the actual eye lids, the actual face oval. That costs more and is computed once per capture, and
// it buys two things a square cannot have:
//
//   The boundaries are anatomy. A forehead bounded by the brow ring underneath and the oval arc
//   above is the forehead on any face; a square 0.45 eye-distances up is the forehead on some.
//
//   THERE IS NO `mirrored` FLAG DOWN HERE, and its absence is the point. Squares had to be placed
//   by formula, so a selfie-flipped image had to flip the formula, and getting that wrong swapped
//   left and right for every asymmetry signal. Landmark 263 is the subject's left eye wherever it
//   lands in the frame, so a polygon built from it needs no such correction and cannot acquire one.
//
// These polygons are deliberately GENEROUS. They propose an area; mask.js disposes of it — clipping
// to the oval, subtracting eyes, brows, lips and irises, eroding the edge, and finally vetoing
// against the skin segmentation. A region that is slightly too big survives that. One that is too
// small has already thrown away skin nobody can get back.

/** Region polygons are inset from their bounding anatomy by these fractions of eye distance. */
export const INSET = {
  // Distance kept between the brow ring and the bottom of the forehead patch.
  browClearance: 0.10,
  // Fraction of the brow→oval-top span left unmeasured at the top. The hairline is not landmarked
  // — the oval's top arc runs along it, and hair crosses it differently every day.
  hairline: 0.34,
  // How far the oval is pulled inward before it bounds a cheek. The oval IS the silhouette, so a
  // patch touching it is half background the moment the head turns a few degrees.
  ovalInset: 0.16,
  // Vertical band under the eye, measured down from the lower lid.
  underEyeTop: 0.06,
  underEyeBottom: 0.30,
  // Gap between the under-eye band and the top of the cheek patch.
  cheekTop: 0.36,
};

const dot = (px, py, ux, uy) => px * ux + py * uy;

/**
 * The face's own coordinate system: along the eye axis, and down the face.
 *
 * Both axes are in EYE-DISTANCE units, so every number expressed in this frame is free of how far
 * away the phone was. `a` is positive toward the subject's left eye, `d` positive toward the chin.
 */
export function frame(lm) {
  const a = alignment(lm);
  if (!a) return null;
  const ux = Math.cos(a.roll);
  const uy = Math.sin(a.roll);
  return { origin: a.eyeMid, ux, uy, dx: -uy, dy: ux, scale: a.scale, roll: a.roll };
}

/** Image point → frame coordinates. */
export function project(p, f) {
  const vx = p.x - f.origin.x;
  const vy = p.y - f.origin.y;
  return { a: dot(vx, vy, f.ux, f.uy) / f.scale, d: dot(vx, vy, f.dx, f.dy) / f.scale };
}

/** Frame coordinates → image point. */
export function unproject(q, f) {
  return {
    x: f.origin.x + (f.ux * q.a + f.dx * q.d) * f.scale,
    y: f.origin.y + (f.uy * q.a + f.dy * q.d) * f.scale,
  };
}

/** Convex hull, monotone chain. Used for the rings the library does not give as a closed loop. */
export function hull(pts) {
  if (pts.length < 3) return [...pts];
  const s = [...pts].sort((p, q) => (p.a - q.a) || (p.d - q.d));
  const cross = (o, p, q) => (p.a - o.a) * (q.d - o.d) - (p.d - o.d) * (q.a - o.a);
  const half = (src) => {
    const out = [];
    for (const p of src) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(s), ...half([...s].reverse())];
}

/** Ray casting. Points on the boundary may fall either way; callers erode, so it does not matter. */
export function inPolygon(a, d, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const pi = poly[i];
    const pj = poly[j];
    if ((pi.d > d) !== (pj.d > d)
      && a < ((pj.a - pi.a) * (d - pi.d)) / (pj.d - pi.d) + pi.a) inside = !inside;
  }
  return inside;
}

/** A named ring as frame-space points, hulled where the library did not hand us a closed loop. */
function ring(lm, f, name) {
  const spec = RINGS[name];
  const pts = spec.vertices.map((i) => at(lm, i)).filter(Boolean);
  if (pts.length !== spec.vertices.length) return null;
  const proj = pts.map((p) => project(p, f));
  return spec.hull ? hull(proj) : proj;
}

/** Push every vertex of a polygon toward its centroid by `t`. Shrinks, never reorders. */
function shrink(poly, t) {
  const ca = poly.reduce((s, p) => s + p.a, 0) / poly.length;
  const cd = poly.reduce((s, p) => s + p.d, 0) / poly.length;
  return poly.map((p) => ({ a: p.a + (ca - p.a) * t, d: p.d + (cd - p.d) * t }));
}

/** Grow a polygon away from its centroid by `t`. Exclusions are grown; regions never are. */
const grow = (poly, t) => shrink(poly, -t);

const minBy = (pts, key) => pts.reduce((b, p) => (key(p) < key(b) ? p : b));
const maxBy = (pts, key) => pts.reduce((b, p) => (key(p) > key(b) ? p : b));

/**
 * The regions the pipeline measures inside, as polygons in frame coordinates.
 *
 * Returns null when any ring is missing a vertex, rather than a partial set — a region built from
 * half a ring is not a noisier region, it is a different piece of face.
 *
 * `chin` is included and is flagged experimental by the caller, not here. Geometry has no opinion
 * about whether a beard makes it unmeasurable; that is what the validation phase is for.
 */
export function anatomy(lm) {
  const f = frame(lm);
  if (!f) return null;

  const oval = ring(lm, f, 'faceOval');
  const lEye = ring(lm, f, 'leftEye');
  const rEye = ring(lm, f, 'rightEye');
  const lBrow = ring(lm, f, 'leftBrow');
  const rBrow = ring(lm, f, 'rightBrow');
  const lips = ring(lm, f, 'lips');
  if (!oval || !lEye || !rEye || !lBrow || !rBrow || !lips) return null;

  const brows = [...lBrow, ...rBrow];
  const browTop = minBy(brows, (p) => p.d).d;
  const ovalTop = minBy(oval, (p) => p.d).d;
  const inner = shrink(oval, INSET.ovalInset);

  // Forehead: bounded below by the brows themselves, above by the oval's forehead arc pulled down
  // out of the hairline. Both boundaries are the mesh's; only the two fractions are ours.
  const lift = (browTop - ovalTop) * INSET.hairline;
  const foreheadTop = inner
    .filter((p) => p.d < browTop)
    .map((p) => ({ a: p.a, d: p.d + lift }))
    .sort((p, q) => p.a - q.a);
  const foreheadBottom = brows
    .map((p) => ({ a: p.a, d: browTop - INSET.browClearance }))
    .sort((p, q) => q.a - p.a);
  const forehead = foreheadTop.length >= 2 ? [...foreheadTop, ...foreheadBottom] : null;

  /** One side. `sign` is +1 for the subject's left, which is +a in the frame. */
  const side = (eye, sign) => {
    const lid = maxBy(eye, (p) => p.d).d;              // lower lid
    const outer = maxBy(eye, (p) => p.a * sign).a;     // outer corner
    const innerEye = minBy(eye, (p) => p.a * sign).a;  // inner corner
    const lipCorner = maxBy(lips, (p) => p.a * sign);
    const edge = (d) => {
      // How far out the inset oval reaches at this height — the lateral bound of the cheek.
      const near = inner.filter((p) => p.a * sign > 0);
      if (!near.length) return outer;
      return near.reduce((b, p) => (Math.abs(p.d - d) < Math.abs(b.d - d) ? p : b)).a;
    };

    const underEye = [
      { a: innerEye, d: lid + INSET.underEyeTop },
      { a: outer, d: lid + INSET.underEyeTop },
      { a: outer, d: lid + INSET.underEyeBottom },
      { a: innerEye, d: lid + INSET.underEyeBottom },
    ];

    const top = lid + INSET.cheekTop;
    const bottom = lipCorner.d;
    const cheek = [
      { a: innerEye, d: top },
      { a: edge(top), d: top },
      { a: edge(bottom), d: bottom },
      { a: lipCorner.a - sign * 0.10, d: bottom },
    ];
    return { underEye, cheek };
  };

  const left = side(lEye, 1);
  const right = side(rEye, -1);

  // Nose bridge: between the inner eye corners, above the lip line. Narrow, because the wings and
  // nostrils are neither flat nor lit like the rest of the face.
  const lInner = minBy(lEye, (p) => p.a).a;
  const rInner = maxBy(rEye, (p) => p.a).a;
  const lipTop = minBy(lips, (p) => p.d).d;
  const eyeLine = Math.max(maxBy(lEye, (p) => p.d).d, maxBy(rEye, (p) => p.d).d);
  const nose = [
    { a: lInner * 0.55, d: eyeLine },
    { a: rInner * 0.55, d: eyeLine },
    { a: rInner * 0.40, d: (eyeLine + lipTop) / 2 },
    { a: lInner * 0.40, d: (eyeLine + lipTop) / 2 },
  ];

  // Chin: between the lip ring and the inset oval's bottom. The region most exposed to facial hair,
  // and the one the validation phase exists to accept or reject.
  const lipBottom = maxBy(lips, (p) => p.d).d;
  const ovalBottom = maxBy(inner, (p) => p.d).d;
  const chinHalf = Math.abs(maxBy(lips, (p) => p.a).a - minBy(lips, (p) => p.a).a) * 0.30;
  const chin = ovalBottom > lipBottom ? [
    { a: -chinHalf, d: lipBottom + 0.08 },
    { a: chinHalf, d: lipBottom + 0.08 },
    { a: chinHalf * 0.8, d: ovalBottom },
    { a: -chinHalf * 0.8, d: ovalBottom },
  ] : null;

  return {
    frame: f,
    // Clipped against, never measured: the silhouette.
    bounds: inner,
    regions: {
      ...(forehead ? { forehead } : {}),
      leftCheek: left.cheek,
      rightCheek: right.cheek,
      leftUnderEye: left.underEye,
      rightUnderEye: right.underEye,
      nose,
      ...(chin ? { chin } : {}),
    },
    // Grown before subtraction. An eyelash or a lip edge inside a "skin" measurement is worth more
    // than the skin it costs to keep them out.
    exclusions: [
      grow(lEye, 0.18), grow(rEye, 0.18),
      grow(lBrow, 0.22), grow(rBrow, 0.22),
      grow(lips, 0.15),
    ],
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
