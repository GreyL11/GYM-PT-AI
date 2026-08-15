// Canonical registration: making "the same piece of cheek" mean the same thing in every capture.
//
// Pure. No DOM, no MediaPipe, no pixels of its own — it takes landmarks and a pixel-reading
// callback, and returns arrays of numbers.
//
// THE PROBLEM THIS SOLVES, because it is not obvious and it is the reason the whole phase exists.
//
// A patch placed by formula — even a good formula, sized in eye-distance units and rotated with the
// head, which is what geometry.regions() does — is not the same skin twice. Three things move it:
//
//   Residual pose. The quality gate accepts up to ~14 degrees of yaw. Fourteen degrees slides a
//   real amount of cheek under a fixed patch, and the part that slides in was in shadow.
//   Expression. A smile lifts the cheek surface through a patch that has not moved.
//   Perspective. A phone at arm's length is not an orthographic camera, so the projection of a
//   curved cheek changes with distance even after scale is normalised away.
//
// Each of those produces a number that moves for a reason that has nothing to do with the person's
// appearance, and a baseline cannot tell that apart from a change.
//
// THE FIX. FaceLandmarker returns a mesh with FIXED TOPOLOGY: vertex 234 is the same anatomical
// point in every capture, forever. So instead of sampling a fixed area of the IMAGE, we sample a
// fixed area of the MESH — piecewise-affine, one affine map per triangle, from a stored canonical
// layout of that person's own face into whatever the camera happened to see this time.
//
// WHAT THIS COSTS AND WHAT IT CANNOT DO, stated plainly:
//
//   The canonical layout is PER PERSON, taken from their own first accepted capture. There is no
//   universal face here and none is needed — every comparison this app makes is a person against
//   their own history. Google publishes a canonical_face_model.obj, and it is deliberately NOT used:
//   Google's own issue tracker records it as outdated and inconsistent with the current landmark
//   set, and a stale upstream asset is a worse foundation than the user's own face.
//
//   The triangulation is DERIVED (see topology.js) because the library exports edges, not faces. It
//   is very nearly complete but not provably so, so canonical pixels landing in no triangle are
//   COUNTED AND REPORTED rather than filled in.
//
//   Registration cannot fix what the landmarker got wrong. Landmark jitter is the noise floor under
//   every number downstream, and Protocol A exists to measure it.

import { FACES, VERTEX_COUNT } from './topology.js';
import { anatomy, frame, inPolygon, project, unproject } from './geometry.js';

/**
 * The canonical frame every reference layout is expressed in.
 *
 * Arbitrary, and that is fine — it only has to be the SAME arbitrary choice every time. Eye
 * midpoint at (0.5, 0.45) with an eye distance of 0.2 puts a face at a comfortable size in a
 * notional unit image, which keeps the numbers readable when debugging.
 */
export const CANONICAL = { origin: { x: 0.5, y: 0.45 }, ux: 1, uy: 0, dx: 0, dy: 1, scale: 0.2, roll: 0 };

/** Canonical pixels sampled per eye-distance unit. Fixes texture scale across regions and captures. */
export const DENSITY = 120;

/** Patch side length is clamped to this, so one odd capture cannot allocate an enormous buffer. */
export const PATCH = { min: 12, max: 96 };

/** Triangles smaller than this in canonical area are skipped — a sliver is a division by nearly zero. */
const MIN_AREA = 1e-9;

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/**
 * Freeze a capture's landmarks into a canonical layout.
 *
 * Every landmark is projected into that capture's own face frame — which removes where the phone
 * was, how far away, and how tilted — and then re-expressed in CANONICAL. What survives is the
 * shape of that person's face and nothing about the photograph.
 */
export function toReference(lm) {
  const f = frame(lm);
  if (!f) return null;
  const out = [];
  for (let i = 0; i < VERTEX_COUNT; i += 1) {
    const p = lm[i];
    if (!p || !finite(p.x) || !finite(p.y)) return null;
    out.push(unproject(project(p, f), CANONICAL));
  }
  return out;
}

/** Round-tripped through storage, so it is written small and read back defensively. */
export const packReference = (ref) => ref.map((p) => [Math.round(p.x * 1e5) / 1e5, Math.round(p.y * 1e5) / 1e5]);

export function unpackReference(packed) {
  if (!Array.isArray(packed) || packed.length !== VERTEX_COUNT) return null;
  const out = [];
  for (const pair of packed) {
    if (!Array.isArray(pair) || !finite(pair[0]) || !finite(pair[1])) return null;
    out.push({ x: pair[0], y: pair[1] });
  }
  return out;
}

/** Signed double area. Zero means the three points are collinear and the triangle is unusable. */
const area2 = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);

/**
 * Build the sampling plan for one region, once, against a person's stored reference.
 *
 * This is the expensive step — it locates every canonical pixel inside a triangle of the mesh — and
 * it is why the reference is stored rather than recomputed: the plan depends only on the reference,
 * so it is built once per session and reused by every capture.
 *
 * The masks baked in here are worth being explicit about. Region membership, the face-oval bound and
 * the eye/brow/lip exclusions are all evaluated in CANONICAL space and then carried through the mesh
 * — which means they track anatomy automatically. A blink in some later capture is excluded not
 * because anything re-detected the eye, but because the canonical eye area maps, through the same
 * triangles, onto wherever the eye now is.
 */
export function planRegion(refAnatomy, polygon, refLm) {
  const pts = polygon;
  const minA = Math.min(...pts.map((p) => p.a));
  const maxA = Math.max(...pts.map((p) => p.a));
  const minD = Math.min(...pts.map((p) => p.d));
  const maxD = Math.max(...pts.map((p) => p.d));
  const spanA = maxA - minA;
  const spanD = maxD - minD;
  if (!(spanA > 0) || !(spanD > 0)) return null;

  const clamp = (n) => Math.max(PATCH.min, Math.min(PATCH.max, Math.round(n)));
  const w = clamp(spanA * DENSITY);
  const h = clamp(spanD * DENSITY);
  const n = w * h;

  // Triangles that could possibly matter here, in canonical image coordinates.
  const box = {
    x0: unproject({ a: minA, d: minD }, CANONICAL).x, x1: unproject({ a: maxA, d: maxD }, CANONICAL).x,
    y0: unproject({ a: minA, d: minD }, CANONICAL).y, y1: unproject({ a: maxA, d: maxD }, CANONICAL).y,
  };
  const near = [];
  for (const [i0, i1, i2] of FACES) {
    const a = refLm[i0];
    const b = refLm[i1];
    const c = refLm[i2];
    if (!a || !b || !c) continue;
    if (Math.min(a.x, b.x, c.x) > box.x1 || Math.max(a.x, b.x, c.x) < box.x0) continue;
    if (Math.min(a.y, b.y, c.y) > box.y1 || Math.max(a.y, b.y, c.y) < box.y0) continue;
    if (Math.abs(area2(a, b, c)) < MIN_AREA) continue;
    near.push([i0, i1, i2]);
  }

  const tri = new Int32Array(n * 3).fill(-1);
  const bary = new Float32Array(n * 3);
  const inside = new Uint8Array(n);
  let candidates = 0;
  let unmapped = 0;

  for (let j = 0; j < h; j += 1) {
    for (let i = 0; i < w; i += 1) {
      const k = j * w + i;
      // Pixel centres, so a patch never samples exactly on its own boundary.
      const a = minA + (spanA * (i + 0.5)) / w;
      const d = minD + (spanD * (j + 0.5)) / h;

      if (!inPolygon(a, d, pts)) continue;
      if (!inPolygon(a, d, refAnatomy.bounds)) continue;
      if (refAnatomy.exclusions.some((ex) => inPolygon(a, d, ex))) continue;
      candidates += 1;

      const p = unproject({ a, d }, CANONICAL);
      let placed = false;
      for (const [i0, i1, i2] of near) {
        const A = refLm[i0];
        const B = refLm[i1];
        const C = refLm[i2];
        const total = area2(A, B, C);
        const w0 = area2(p, B, C) / total;
        const w1 = area2(A, p, C) / total;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        tri[k * 3] = i0; tri[k * 3 + 1] = i1; tri[k * 3 + 2] = i2;
        bary[k * 3] = w0; bary[k * 3 + 1] = w1; bary[k * 3 + 2] = w2;
        inside[k] = 1;
        placed = true;
        break;
      }
      // Inside the region, inside the face, not excluded — and in no triangle. The derived
      // triangulation has a gap here. Counted, never guessed at.
      if (!placed) unmapped += 1;
    }
  }

  return { w, h, tri, bary, inside, candidates, unmapped, spanA, spanD };
}

/** Every region's plan, built once against one stored reference. */
export function planAll(refLm) {
  const refAnatomy = anatomy(refLm);
  if (!refAnatomy) return null;
  const plans = {};
  for (const [name, poly] of Object.entries(refAnatomy.regions)) {
    const p = planRegion(refAnatomy, poly, refLm);
    if (p) plans[name] = p;
  }
  return { plans, anatomy: refAnatomy };
}

/**
 * Read one region out of a capture, through its plan.
 *
 * `read(px, py)` is handed integer source pixel coordinates and returns `[r, g, b]` 0-255, or null
 * when the coordinates fall outside the image. Nearest-neighbour, deliberately: interpolation would
 * smooth the very high-frequency content the texture signal is trying to measure, and would make
 * blur look like skin.
 *
 * Returns typed arrays plus a valid mask. A pixel is valid only if its plan placed it in a triangle
 * AND the resulting source coordinate was inside the picture AND the colour read back finite.
 */
export function sampleRegion(plan, lm, width, height, read) {
  const n = plan.w * plan.h;
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  const sx = new Int32Array(n).fill(-1);
  const sy = new Int32Array(n).fill(-1);
  const valid = new Uint8Array(n);
  let offImage = 0;

  for (let k = 0; k < n; k += 1) {
    if (!plan.inside[k]) continue;
    const i0 = plan.tri[k * 3];
    const i1 = plan.tri[k * 3 + 1];
    const i2 = plan.tri[k * 3 + 2];
    const A = lm[i0];
    const B = lm[i1];
    const C = lm[i2];
    if (!A || !B || !C) continue;

    // A weighted sum of three points. No division, so no degenerate triangle in THIS capture can
    // produce an infinity here — the only requirement is that the landmarks themselves are finite.
    const w0 = plan.bary[k * 3];
    const w1 = plan.bary[k * 3 + 1];
    const w2 = plan.bary[k * 3 + 2];
    const nx = A.x * w0 + B.x * w1 + C.x * w2;
    const ny = A.y * w0 + B.y * w1 + C.y * w2;
    if (!finite(nx) || !finite(ny)) continue;

    const px = Math.round(nx * width);
    const py = Math.round(ny * height);
    if (px < 0 || py < 0 || px >= width || py >= height) { offImage += 1; continue; }

    const rgb = read(px, py);
    if (!rgb || !finite(rgb[0]) || !finite(rgb[1]) || !finite(rgb[2])) continue;
    r[k] = rgb[0]; g[k] = rgb[1]; b[k] = rgb[2];
    sx[k] = px; sy[k] = py;
    valid[k] = 1;
  }

  return { w: plan.w, h: plan.h, r, g, b, sx, sy, valid, offImage };
}

/**
 * How many source pixels one canonical pixel covers.
 *
 * Recorded with every capture because it is a real confound for anything measuring texture: the
 * same face photographed from further away supplies fewer source pixels per canonical pixel, and
 * downsampling suppresses exactly the high-frequency content the texture signal reads. A trend in
 * this number sitting alongside a trend in texture means the texture trend is about distance.
 */
export function samplingRatio(plan, alignmentScale, width) {
  const sourcePerEye = alignmentScale * width;
  const canonicalPerEye = DENSITY;
  const ratio = sourcePerEye / canonicalPerEye;
  return finite(ratio) && ratio > 0 ? Math.round(ratio * 1000) / 1000 : null;
}
