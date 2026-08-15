// Registration, anatomical regions, the mask algebra, and the capture pipeline.
// Run: node test_face_pipeline.mjs
//
// No camera, no model, no network, no key. Every face below is synthetic and every pixel comes from
// a function, which is the only way these can be run on every commit.
//
// WHAT THESE TEST, in priority order:
//
//   1. That nothing produces NaN or Infinity. A single non-finite value entering a median poisons a
//      baseline silently and forever.
//   2. That absent is absent. A region that could not be measured must have no features AT ALL, not
//      features full of zeros.
//   3. That the veto actually vetoes, and that every discarded pixel is accounted for.
//   4. That the same input twice gives byte-identical output. Without that, no stability number
//      downstream means anything.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const geo = await import('./www/face/geometry.js');
const topo = await import('./www/face/topology.js');
const reg = await import('./www/face/registration.js');
const mask = await import('./www/face/mask.js');
const pipeline = await import('./www/face/pipeline.js');
const record = await import('./www/face/record.js');

const ok = [];
const check = (name, fn) => { fn(); ok.push(name); };

// ── a synthetic face ─────────────────────────────────────────────────────────────────────
// Ring vertices are placed where the real anatomy is; every other vertex is scattered
// deterministically inside the oval so the derived triangles have area. It is not a face, but it
// has a face's topology, which is all these modules read.

const mulberry = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function synthFace({ cx = 0.5, cy = 0.45, eyeGap = 0.20, roll = 0, yaw = 0, squash = 1 } = {}) {
  const lm = new Array(topo.VERTEX_COUNT);
  const ux = Math.cos(roll);
  const uy = Math.sin(roll);
  const dx = -uy;
  const dy = ux;
  // Frame coords (along, down) in eye-gap units → image coords.
  const at = (a, d) => ({
    x: cx + (ux * a + dx * d * squash) * eyeGap + yaw * eyeGap * 0.5,
    y: cy + (uy * a + dy * d * squash) * eyeGap,
    z: 0,
  });

  const ellipse = (idxs, ca, cd, ra, rd, phase = 0) => {
    idxs.forEach((i, k) => {
      const t = phase + (2 * Math.PI * k) / idxs.length;
      lm[i] = at(ca + ra * Math.cos(t), cd + rd * Math.sin(t));
    });
  };

  ellipse(topo.RINGS.faceOval.vertices, 0, 0.55, 1.55, 2.10);
  ellipse(topo.RINGS.leftEye.vertices, 0.5, 0.0, 0.26, 0.13);
  ellipse(topo.RINGS.rightEye.vertices, -0.5, 0.0, 0.26, 0.13);
  ellipse(topo.RINGS.leftIris.vertices, 0.5, 0.0, 0.07, 0.07);
  ellipse(topo.RINGS.rightIris.vertices, -0.5, 0.0, 0.07, 0.07);
  ellipse(topo.RINGS.leftBrow.vertices, 0.5, -0.30, 0.30, 0.07);
  ellipse(topo.RINGS.rightBrow.vertices, -0.5, -0.30, 0.30, 0.07);
  ellipse(topo.RINGS.lips.vertices, 0, 1.30, 0.42, 0.16);

  // The two landmarks alignment() reads directly, and the rest of the mesh.
  lm[263] = at(0.5, 0);
  lm[33] = at(-0.5, 0);
  lm[1] = at(0, 0.72);
  lm[10] = at(0, -1.55);
  lm[152] = at(0, 2.65);

  const rnd = mulberry(7);
  for (let i = 0; i < topo.VERTEX_COUNT; i += 1) {
    if (lm[i]) continue;
    // Scattered inside the oval, deterministically.
    const t = 2 * Math.PI * rnd();
    const r = Math.sqrt(rnd());
    lm[i] = at(1.45 * r * Math.cos(t), 0.55 + 2.0 * r * Math.sin(t));
  }
  return lm;
}

/** sRGB encode, so a test can apply a true linear gain without 8-bit rounding hiding the result. */
const encode = (linear) => {
  const c = Math.max(0, Math.min(1, linear));
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
};
const decode = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** A smooth, textured, deterministic image. Returns floats, not bytes — see the gain test. */
function synthImage({ gain = [1, 1, 1], base = 0.35 } = {}) {
  return (px, py) => {
    if (px < 0 || py < 0 || px >= 1280 || py >= 720) return null;
    const shade = base * (0.85 + 0.3 * Math.sin(px / 190) * Math.cos(py / 230));
    const grain = 0.02 * Math.sin(px * 1.7) * Math.cos(py * 2.3);
    const lin = [
      (shade + grain) * 1.00,
      (shade + grain) * 0.74,
      (shade + grain) * 0.63,
    ];
    return [encode(lin[0] * gain[0]), encode(lin[1] * gain[1]), encode(lin[2] * gain[2])];
  };
}

const W = 1280;
const H = 720;
const finiteDeep = (v) => {
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(finiteDeep);
  if (v && typeof v === 'object') return Object.values(v).every(finiteDeep);
  return true;
};

// ── topology ─────────────────────────────────────────────────────────────────────────────

check('topology is the library\'s own, and self-consistent', () => {
  assert.equal(topo.VERTEX_COUNT, 468);
  assert.ok(topo.FACES.length > 800, 'triangulation derived from the tesselation edge graph');
  for (const [a, b, c] of topo.FACES) {
    assert.ok(a < b && b < c, 'faces are stored sorted, so duplicates cannot hide');
    assert.ok(c < topo.VERTEX_COUNT, 'no face references a vertex that does not exist');
  }
  // The brows and lips are NOT closed loops and must be flagged for hulling — getting this wrong
  // silently rasterises a bowtie instead of an eyebrow.
  assert.equal(topo.RINGS.leftBrow.hull, true);
  assert.equal(topo.RINGS.lips.hull, true);
  assert.equal(topo.RINGS.faceOval.hull, false);
  assert.equal(topo.RINGS.leftEye.hull, false);
});

// ── geometry: anatomical regions ─────────────────────────────────────────────────────────

check('anatomy places every region from the mesh rings', () => {
  const a = geo.anatomy(synthFace());
  assert.ok(a, 'a well-formed face yields an anatomy');
  for (const name of ['forehead', 'leftCheek', 'rightCheek', 'leftUnderEye', 'rightUnderEye', 'nose']) {
    assert.ok(a.regions[name], `${name} exists`);
    assert.ok(a.regions[name].length >= 3, `${name} is a polygon`);
    assert.ok(finiteDeep(a.regions[name]), `${name} has no NaN`);
  }
  assert.ok(a.exclusions.length >= 5, 'eyes, brows and lips are all excluded');
});

check('the forehead sits above the brows and the cheeks below the eyes', () => {
  const a = geo.anatomy(synthFace());
  const meanD = (poly) => poly.reduce((s, p) => s + p.d, 0) / poly.length;
  assert.ok(meanD(a.regions.forehead) < 0, 'forehead is above the eye line');
  assert.ok(meanD(a.regions.leftCheek) > meanD(a.regions.leftUnderEye), 'cheek sits below the under-eye band');
  assert.ok(meanD(a.regions.leftUnderEye) > 0, 'under-eye is below the eye line');
});

check('the subject\'s left cheek is on the +a side whichever way the image is flipped', () => {
  // The mirrored flag does not exist down here, and this is why: landmark 263 is the subject's left
  // eye wherever it lands in the frame. A swapped cheek would look like a real asymmetry finding.
  const a = geo.anatomy(synthFace());
  const meanA = (poly) => poly.reduce((s, p) => s + p.a, 0) / poly.length;
  assert.ok(meanA(a.regions.leftCheek) > 0);
  assert.ok(meanA(a.regions.rightCheek) < 0);
});

check('a degenerate face yields null rather than a polygon of NaN', () => {
  const flat = new Array(topo.VERTEX_COUNT).fill({ x: 0.5, y: 0.5, z: 0 });
  assert.equal(geo.anatomy(flat), null);
  assert.equal(geo.frame(flat), null);
  const short = new Array(20).fill({ x: 0.5, y: 0.5, z: 0 });
  assert.equal(geo.anatomy(short), null);
});

check('convex hull closes the rings the library left open', () => {
  const pts = [{ a: 0, d: 0 }, { a: 1, d: 0 }, { a: 1, d: 1 }, { a: 0, d: 1 }, { a: 0.5, d: 0.5 }];
  const h = geo.hull(pts);
  assert.equal(h.length, 4, 'the interior point is dropped');
  assert.ok(geo.inPolygon(0.5, 0.5, h), 'and is still inside the result');
  assert.ok(!geo.inPolygon(2, 2, h));
});

// ── registration ─────────────────────────────────────────────────────────────────────────

check('a reference layout is scale, position and roll free', () => {
  const near = reg.toReference(synthFace({ eyeGap: 0.30, cx: 0.5, cy: 0.45 }));
  const far = reg.toReference(synthFace({ eyeGap: 0.15, cx: 0.35, cy: 0.60, roll: 0.25 }));
  assert.ok(near && far);
  let worst = 0;
  for (let i = 0; i < near.length; i += 1) {
    worst = Math.max(worst, Math.hypot(near[i].x - far[i].x, near[i].y - far[i].y));
  }
  // This is the entire claim of the registration layer: the same face at a different distance, in a
  // different part of the frame, at a different tilt, normalises to the same layout.
  assert.ok(worst < 1e-9, `distance/position/roll removed (worst ${worst})`);
});

check('reference packing survives a round trip and rejects junk', () => {
  const ref = reg.toReference(synthFace());
  const back = reg.unpackReference(reg.packReference(ref));
  assert.ok(back);
  assert.equal(back.length, topo.VERTEX_COUNT);
  assert.ok(Math.abs(back[100].x - ref[100].x) < 1e-4);
  assert.equal(reg.unpackReference(null), null);
  assert.equal(reg.unpackReference([[1, 2]]), null, 'wrong length is refused');
  const bad = reg.packReference(ref);
  bad[5] = [NaN, 0];
  assert.equal(reg.unpackReference(bad), null, 'a NaN in storage never reaches a measurement');
});

check('planning locates canonical pixels in mesh triangles, and counts the ones it cannot', () => {
  const built = reg.planAll(reg.toReference(synthFace()));
  assert.ok(built);
  for (const [name, p] of Object.entries(built.plans)) {
    assert.ok(p.w >= reg.PATCH.min && p.w <= reg.PATCH.max, `${name} patch width in range`);
    assert.ok(p.candidates > 0, `${name} has candidate pixels`);
    // Unmapped pixels are a real consequence of a derived triangulation. They must be COUNTED.
    assert.ok(typeof p.unmapped === 'number', `${name} counts unmapped pixels`);
    assert.ok(p.unmapped <= p.candidates);
  }
});

check('planning is deterministic', () => {
  const ref = reg.toReference(synthFace());
  const a = reg.planAll(ref).plans.leftCheek;
  const b = reg.planAll(ref).plans.leftCheek;
  assert.deepEqual([...a.inside], [...b.inside]);
  assert.deepEqual([...a.tri], [...b.tri]);
  assert.equal(a.candidates, b.candidates);
});

// ── mask algebra ─────────────────────────────────────────────────────────────────────────

check('erosion shrinks and never grows', () => {
  const w = 9;
  const h = 9;
  const m = new Uint8Array(w * h).fill(1);
  const e = mask.erode(m, w, h, 1);
  assert.equal(e[0], 0, 'the corner is eaten');
  assert.equal(e[4 * w + 4], 1, 'the middle survives');
  let before = 0;
  let after = 0;
  for (let i = 0; i < m.length; i += 1) { before += m[i]; after += e[i]; }
  assert.ok(after < before);
  // A hole is widened, never filled.
  const holed = new Uint8Array(w * h).fill(1);
  holed[4 * w + 4] = 0;
  const eh = mask.erode(holed, w, h, 1);
  assert.equal(eh[4 * w + 3], 0, 'the neighbour of a hole is removed too');
});

check('erosion by zero is the identity, and a radius past the buffer clears it', () => {
  const m = new Uint8Array(16).fill(1);
  assert.deepEqual([...mask.erode(m, 4, 4, 0)], [...m]);
  assert.ok([...mask.erode(m, 4, 4, 9)].every((v) => v === 0));
});

check('the category lookup scales a 256-wide mask onto a 1280-wide image', () => {
  const m = new Uint8Array(256 * 256);
  m[128 * 256 + 128] = 3;
  const look = mask.categoryLookup(m, 256, 256, 1280, 720);
  assert.equal(look(640, 360), 3, 'the centre of the image hits the centre of the mask');
  assert.equal(look(0, 0), 0);
  assert.equal(look(99999, 99999), 0, 'out of range is clamped, never an index error');
  assert.equal(mask.categoryLookup(null, 0, 0, 0, 0), null);
});

check('every discarded pixel is accounted for', () => {
  const ref = reg.toReference(synthFace());
  const built = reg.planAll(ref);
  const plan = built.plans.leftCheek;
  const sampled = reg.sampleRegion(plan, synthFace(), W, H, synthImage());
  const applied = mask.apply(sampled, plan, null);
  const c = applied.counts;
  assert.equal(c.sampled - c.afterErosion, c.erosionRejected);
  assert.equal(c.afterErosion - c.afterVeto, c.segmentationRejected);
  assert.ok(c.sampled <= c.candidates);
  assert.equal(c.vetoed, false, 'a capture measured with no segmentation says so');
});

check('the veto removes pixels, and a region of no skin becomes unavailable', () => {
  const ref = reg.toReference(synthFace());
  const plan = reg.planAll(ref).plans.leftCheek;
  const sampled = reg.sampleRegion(plan, synthFace(), W, H, synthImage());

  const all = mask.apply(sampled, plan, () => true);
  const none = mask.apply(sampled, plan, () => false);
  assert.ok(all.counts.afterVeto > 0);
  assert.equal(none.counts.afterVeto, 0);
  assert.equal(none.available, false);
  assert.equal(none.reason, 'not_skin');
  assert.equal(all.counts.vetoed, true);

  // Half the frame is hair. The measurement must shrink, not silently continue at full coverage.
  const half = mask.apply(sampled, plan, (px) => px < W / 2);
  assert.ok(half.counts.afterVeto < all.counts.afterVeto);
  assert.ok(half.coverage < all.coverage);
});

// ── the pipeline ─────────────────────────────────────────────────────────────────────────

const runOnce = (opts = {}) => pipeline.analyse({
  lm: opts.lm ?? synthFace(),
  matrix: null,
  width: W,
  height: H,
  read: opts.read ?? synthImage(),
  isSkin: opts.isSkin === undefined ? () => true : opts.isSkin,
  plans: opts.plans ?? null,
  lightingHistory: opts.lightingHistory ?? [],
});

check('a first capture builds the reference and measures', () => {
  const r = runOnce();
  assert.equal(r.stage, 'complete');
  assert.ok(r.createdReference, 'the first accepted capture defines the canonical face');
  assert.equal(r.createdReference.length, topo.VERTEX_COUNT);
  assert.ok(r.quality.checks.sharpness, 'the pixel checks actually ran');
  assert.ok(r.quality.checks.exposure);
  assert.ok(r.quality.checks.balance);
});

check('no NaN or Infinity reaches any stored value', () => {
  const r = runOnce();
  const { debug, ...stored } = r;
  assert.ok(finiteDeep(stored), 'the persisted half of the result is entirely finite');
});

check('the same capture twice gives identical numbers', () => {
  const ref = reg.toReference(synthFace());
  const plans = reg.planAll(ref).plans;
  const a = runOnce({ plans });
  const b = runOnce({ plans });
  const strip = ({ debug, ...rest }) => JSON.stringify(rest);
  assert.equal(strip(a), strip(b), 'without this, no stability number below means anything');
});

check('an unmeasurable region has NO features key, not zeroed ones', () => {
  const r = runOnce({ isSkin: () => false });
  for (const [name, reg2] of Object.entries(r.regions)) {
    assert.equal(reg2.available, false, `${name} could not be measured`);
    assert.ok(!('features' in reg2), `${name} carries no features object at all`);
    assert.ok(reg2.reason, `${name} says why`);
  }
});

check('a rejected capture measures nothing', () => {
  // Too far away: the framing check refuses before a single pixel is read.
  const r = runOnce({ lm: synthFace({ eyeGap: 0.04 }) });
  assert.equal(r.stage, 'framing');
  assert.equal(r.accepted, false);
  assert.deepEqual(r.regions, {});
  assert.ok(r.quality.failures.includes('framing'));
});

check('a missing pixel check is not a passed one', () => {
  const r = runOnce({ lm: synthFace({ eyeGap: 0.04 }) });
  assert.ok(r.quality.missing.length > 0, 'sharpness and exposure never ran');
  assert.equal(r.quality.accepted, false, 'and their absence blocks acceptance');
});

check('no face at all is a named stage, not an empty measurement', () => {
  const r = pipeline.analyse({
    lm: [], matrix: null, width: W, height: H, read: synthImage(),
  });
  assert.equal(r.stage, 'no_face');
  assert.equal(r.accepted, false);
  assert.deepEqual(r.regions, {});
});

check('non-finite landmarks cannot poison a measurement', () => {
  const lm = synthFace();
  lm[200] = { x: NaN, y: 0.5, z: 0 };
  lm[201] = { x: 0.5, y: Infinity, z: 0 };
  const r = runOnce({ lm });
  const { debug, ...stored } = r;
  assert.ok(finiteDeep(stored), 'a NaN landmark is dropped, never propagated');
});

check('a reader that returns nothing yields no measurement rather than a black face', () => {
  const r = runOnce({ read: () => null });
  assert.equal(r.accepted, false);
  for (const reg2 of Object.values(r.regions)) assert.ok(!('features' in reg2));
});

check('chin is carried but flagged experimental', () => {
  const r = runOnce();
  if (r.regions.chin) assert.equal(r.regions.chin.experimental, true);
  assert.equal(r.regions.leftCheek.experimental, false);
});

// ── the capture record ───────────────────────────────────────────────────────────────────

check('versions ride on every record and distinguish a segmented capture', () => {
  const withSeg = record.versions(true);
  const without = record.versions(false);
  assert.ok(withSeg.segmenter);
  assert.equal(without.segmenter, null);
  assert.ok(withSeg.topology.startsWith('mesh-1:'));
  assert.ok(withSeg.mask.includes('erode-'));
  assert.notEqual(JSON.stringify(withSeg), JSON.stringify(without));
});

check('records from different pipeline versions are never averaged together', () => {
  const a = { versions: record.versions(true), at: '2026-01-01' };
  const b = { versions: record.versions(false), at: '2026-01-02' };
  const set = [a, a, a, b];
  const c = record.comparable(set);
  assert.equal(c.records.length, 3, 'the largest same-version group is used');
  assert.equal(c.excluded, 1, 'and the rest is reported, not dropped in silence');
  assert.equal(c.versionGroups, 2);
  assert.deepEqual(record.comparable([]), { records: [], excluded: 0, versionGroups: 0 });
});

check('build keeps absent regions absent', () => {
  const r = record.build({
    protocol: 'A',
    accepted: true,
    quality: { accepted: true, failures: [], warnings: [] },
    regions: { leftCheek: { available: false, reason: 'not_skin', coverage: 0.1 } },
    device: { w: W, h: H },
    sampling: { ratio: 2 },
    segmenterUsed: true,
  });
  assert.equal(r.protocol, 'A');
  assert.ok(r.at);
  assert.ok(!('features' in r.regions.leftCheek));
});

// ── the privacy boundary, enforced rather than promised ──────────────────────────────────

check('nothing under www/face/ can reach the network', () => {
  const files = readdirSync('./www/face').filter((f) => f.endsWith('.js'));
  assert.ok(files.length >= 8, 'the whole directory is checked, not a list that can go stale');
  for (const f of files) {
    const src = readFileSync(`./www/face/${f}`, 'utf8');
    // chat.js is the only networked module in the app. A face module importing it is the one edit
    // that could put a face on the wire, so it fails the build rather than a code review.
    assert.ok(!/from\s+['"][^'"]*chat\.js['"]/.test(src), `${f} must not import chat.js`);
    assert.ok(!/\bfetch\s*\(/.test(src), `${f} must not call fetch`);
    assert.ok(!/XMLHttpRequest|navigator\.sendBeacon|WebSocket/.test(src), `${f} must not open a connection`);
  }
});

check('no face module writes an image into storage', () => {
  for (const f of readdirSync('./www/face').filter((x) => x.endsWith('.js'))) {
    const src = readFileSync(`./www/face/${f}`, 'utf8');
    // toDataURL / toBlob turn a canvas into something persistable. toBlob is allowed in exactly one
    // place — the explicit download button — and that hands the file to the user's own filesystem,
    // never to storage.
    assert.ok(!/toDataURL/.test(src), `${f} must not serialise a canvas`);
    if (/toBlob/.test(src)) {
      assert.equal(f, 'checkin.js', 'only the explicit download path may read a canvas out');
      assert.ok(/consent\(\)\.retainImages/.test(src), 'and only behind consent');
    }
    assert.ok(!/localStorage\.setItem\([^)]*(image|png|jpeg|dataUrl)/i.test(src), `${f} must not store an image`);
  }
});

console.log(`face pipeline: ${ok.length} checks passed`);
