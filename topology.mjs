// Regenerates www/face/topology.js from the vendored MediaPipe bundle. Run: npm run topology
//
// Why this is a build step and not a hand-written table: geometry.js already carries the rule that
// landmark indices are the library's own, never recalled. This enforces it. Every ring below is
// walked out of a FACE_LANDMARKS_* connection list and verified closed; every triangle is derived
// from the tesselation edge graph. Nothing is typed in.
//
// The output is committed, unlike www/vendor/, because it is small, it is source the tests import,
// and regenerating it requires node_modules to be installed.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { FaceLandmarker: F } = await import('./www/vendor/tasks-vision.mjs');

/**
 * Walk an edge list into an ordered vertex cycle.
 *
 * The library gives contours as unordered {start, end} pairs. A polygon needs them in order, and a
 * ring that is not one closed loop is a ring we would silently rasterise wrong — so this throws
 * rather than returning something plausible.
 *
 * NOT every contour set is a cycle, and that is a real finding rather than an inconvenience: the
 * eyebrow sets are TWO open polylines each (upper and lower line, 4 degree-1 endpoints across 10
 * vertices). Those are emitted unordered with `hull: true`, and the consumer takes the convex hull
 * at runtime where it actually has coordinates. A hull over-approximates a brow, and for an
 * EXCLUSION zone over-approximating is the safe direction — it discards a little skin, never
 * admits an eyebrow.
 */
function ordered(conns, name) {
  const adj = new Map();
  const add = (a, b) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); };
  for (const { start, end } of conns) { add(start, end); add(end, start); }

  const all = [...adj.keys()].sort((a, b) => a - b);
  const endpoints = [...adj].filter(([, to]) => to.length === 1).map(([v]) => v);
  if (endpoints.length) return { vertices: all, hull: true, why: `${endpoints.length / 2} open polyline(s)` };

  // Walk one closed cycle from the lowest vertex.
  const start = all[0];
  const out = [start];
  let prev = null;
  let cur = start;
  for (;;) {
    const next = adj.get(cur).find((v) => v !== prev);
    if (next === undefined) throw new Error(`${name}: unwalkable at vertex ${cur}`);
    if (next === start) break;
    out.push(next);
    prev = cur;
    cur = next;
  }
  // More than one closed component — the lips are an outer and an inner ring. Picking "the outer
  // one" needs coordinates this script does not have, so hand over the hull decision too.
  if (out.length !== adj.size) {
    return { vertices: all, hull: true, why: `${out.length} of ${adj.size} vertices in the first cycle — nested rings` };
  }
  return { vertices: out, hull: false, why: 'single closed cycle' };
}

const rings = {
  faceOval: ordered(F.FACE_LANDMARKS_FACE_OVAL, 'faceOval'),
  leftEye: ordered(F.FACE_LANDMARKS_LEFT_EYE, 'leftEye'),
  rightEye: ordered(F.FACE_LANDMARKS_RIGHT_EYE, 'rightEye'),
  leftBrow: ordered(F.FACE_LANDMARKS_LEFT_EYEBROW, 'leftBrow'),
  rightBrow: ordered(F.FACE_LANDMARKS_RIGHT_EYEBROW, 'rightBrow'),
  lips: ordered(F.FACE_LANDMARKS_LIPS, 'lips'),
  leftIris: ordered(F.FACE_LANDMARKS_LEFT_IRIS, 'leftIris'),
  rightIris: ordered(F.FACE_LANDMARKS_RIGHT_IRIS, 'rightIris'),
};

// Faces, as the 3-cycles of the tesselation edge graph. The library exports edges only.
const T = F.FACE_LANDMARKS_TESSELATION;
const adj = new Map();
const add = (a, b) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); };
for (const { start, end } of T) { add(start, end); add(end, start); }

const seen = new Set();
const faces = [];
for (const { start: a, end: b } of T) {
  for (const c of adj.get(a)) {
    if (!adj.get(b).has(c)) continue;
    const tri = [a, b, c].sort((x, y) => x - y);
    const key = tri.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    faces.push(tri);
  }
}

const edges = new Set();
for (const { start, end } of T) edges.add(start < end ? `${start},${end}` : `${end},${start}`);

const V = adj.size;
const E = edges.size;
const euler = V - E + faces.length;

const fmt = (a) => `[${a.join(', ')}]`;
const out = `// GENERATED — do not edit by hand. Run \`npm run topology\` to rebuild from the vendored bundle.
//
// Mesh topology, read out of MediaPipe FaceLandmarker's own exported constants. That provenance is
// the entire point: a hand-typed index list is how a region ends up measuring an eyebrow for six
// months without anyone noticing, and this feature's whole value rests on a region being the same
// piece of face every time.
//
// RINGS are FACE_LANDMARKS_* connection lists walked into ordered vertex cycles, each verified
// closed at generation time.
//
// FACES are DERIVED. FACE_LANDMARKS_TESSELATION exports ${T.length} edges (${E} unique, undirected) and no
// faces at all, so triangles here are the 3-cycles of that edge graph: ${faces.length} of them. The Euler
// characteristic of the result is V - E + F = ${V} - ${E} + ${faces.length} = ${euler}. FaceMesh is a disc with holes
// at the eyes and mouth, so a small non-positive value is expected — but a COMPLETE triangulation is
// not guaranteed, and registration must therefore count the canonical pixels that land in no
// triangle rather than quietly filling them in. See registration.js.

export const VERTEX_COUNT = ${V};

/** How this file was built, carried into every capture record so a measurement can be traced. */
export const TOPOLOGY_VERSION = 'mesh-1:v${V}-e${E}-f${faces.length}';

/**
 * The library's own contour sets.
 *
 * \`hull: false\` — vertices are an ordered closed cycle, usable as a polygon directly.
 * \`hull: true\`  — the set is not one closed loop (the brows are two open polylines each), so the
 *                 vertices are unordered and the consumer must take their convex hull.
 */
export const RINGS = {
${Object.entries(rings).map(([k, v]) => `  ${k}: { vertices: ${fmt(v.vertices)}, hull: ${v.hull} },`).join('\n')}
};

/** ${faces.length} triangles, derived as the 3-cycles of the tesselation edge graph. */
export const FACES = [
${faces.map((t) => `  ${fmt(t)},`).join('\n')}
];
`;

writeFileSync(join(import.meta.dirname, 'www', 'face', 'topology.js'), out);
console.log(`topology: ${V} vertices, ${E} unique edges, ${faces.length} faces, euler ${euler}`);
for (const [k, v] of Object.entries(rings)) console.log(`  ring ${k}: ${v.vertices.length} vertices, ${v.hull ? "HULL" : "polygon"} — ${v.why}`);
