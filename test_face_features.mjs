// The feature arithmetic, and the one invariance the whole design rests on.
// Run: node test_face_features.mjs
//
// THE TEST THAT MATTERS IS `a per-channel camera gain cancels exactly`.
//
// Every reported feature is a DIFFERENCE taken in log-density space, and the claim made for that
// choice is not a soft one — it is that whatever per-channel gains the phone's auto-white-balance
// picked between two photographs, they vanish from the reported numbers identically. That claim is
// either true to floating-point precision or the design is wrong, so it is asserted here against
// random gains rather than argued for in a comment.
//
// If that test ever fails, the correct response is to delete the feature set, not to loosen the
// tolerance.

import assert from 'node:assert/strict';

const f = await import('./www/face/features.js');
const reg = await import('./www/face/registration.js');
const topo = await import('./www/face/topology.js');
const pipeline = await import('./www/face/pipeline.js');

const ok = [];
const check = (name, fn) => { fn(); ok.push(name); };
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg} (${a} vs ${b}, tol ${tol})`);

// ── the transfer function ────────────────────────────────────────────────────────────────

check('sRGB linearisation hits its known anchors', () => {
  close(f.linearise(0), 0, 1e-12, 'black');
  close(f.linearise(255), 1, 1e-12, 'white');
  // The piecewise join at 0.04045 must be continuous, or every dark pixel gets a small lie.
  const belowV = 0.04045 * 255;
  close(f.linearise(belowV - 1e-6), f.linearise(belowV + 1e-6), 1e-6, 'continuous at the knee');
  // Middle grey: sRGB 128 is famously near 0.216 linear, not 0.5.
  close(f.linearise(128), 0.2158, 1e-3, 'sRGB 128 is not linear 0.5');
  for (let v = 1; v <= 255; v += 1) assert.ok(f.linearise(v) > f.linearise(v - 1), 'monotonic');
});

check('density is finite even for pure black', () => {
  assert.ok(Number.isFinite(f.density(0)), 'a crushed pixel must not return Infinity');
  assert.ok(Number.isFinite(f.density(255)));
  assert.ok(f.density(0) > f.density(255), 'darker means denser');
});

check('a multiplicative gain is an additive shift in density', () => {
  // The identity the whole design rests on, checked directly before anything is built on it.
  const k = 1.37;
  const v = 96;
  const lifted = 255 * (() => {
    const c = f.linearise(v) * k;
    return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  })();
  close(f.density(v) - f.density(lifted), Math.log(k), 1e-9, 'the shift is exactly log(k)');
});

// ── robust statistics ────────────────────────────────────────────────────────────────────

check('median and MAD behave, including on even lengths and outliers', () => {
  assert.equal(f.median([3, 1, 2]), 2);
  assert.equal(f.median([4, 1, 2, 3]), 2.5);
  assert.equal(f.median([]), null);
  assert.equal(f.mad([1, 1, 1, 1]), 0, 'no spread is a real zero and is reported');
  assert.equal(f.mad([]), null, 'no data is not a zero');
  // One wild value must not move the centre — this is why medians are used throughout.
  assert.equal(f.median([1, 2, 3, 4, 1e9]), 3);
});

// ── the invariance ───────────────────────────────────────────────────────────────────────

const mulberry = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function synthFace() {
  const lm = new Array(topo.VERTEX_COUNT);
  const at = (a, d) => ({ x: 0.5 + a * 0.2, y: 0.45 + d * 0.2, z: 0 });
  const ellipse = (idxs, ca, cd, ra, rd) => idxs.forEach((i, k) => {
    const t = (2 * Math.PI * k) / idxs.length;
    lm[i] = at(ca + ra * Math.cos(t), cd + rd * Math.sin(t));
  });
  ellipse(topo.RINGS.faceOval.vertices, 0, 0.55, 1.55, 2.10);
  ellipse(topo.RINGS.leftEye.vertices, 0.5, 0, 0.26, 0.13);
  ellipse(topo.RINGS.rightEye.vertices, -0.5, 0, 0.26, 0.13);
  ellipse(topo.RINGS.leftIris.vertices, 0.5, 0, 0.07, 0.07);
  ellipse(topo.RINGS.rightIris.vertices, -0.5, 0, 0.07, 0.07);
  ellipse(topo.RINGS.leftBrow.vertices, 0.5, -0.30, 0.30, 0.07);
  ellipse(topo.RINGS.rightBrow.vertices, -0.5, -0.30, 0.30, 0.07);
  ellipse(topo.RINGS.lips.vertices, 0, 1.30, 0.42, 0.16);
  lm[263] = at(0.5, 0); lm[33] = at(-0.5, 0);
  lm[1] = at(0, 0.72); lm[10] = at(0, -1.55); lm[152] = at(0, 2.65);
  const rnd = mulberry(7);
  for (let i = 0; i < topo.VERTEX_COUNT; i += 1) {
    if (lm[i]) continue;
    const t = 2 * Math.PI * rnd();
    const r = Math.sqrt(rnd());
    lm[i] = at(1.45 * r * Math.cos(t), 0.55 + 2.0 * r * Math.sin(t));
  }
  return lm;
}

const encode = (linear) => {
  const c = Math.max(0, Math.min(1, linear));
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
};

/**
 * A face-like image with a real regional difference in it: the left cheek is deliberately shifted
 * toward the red channel, so a colour feature has something true to find.
 */
const image = (gain = [1, 1, 1]) => (px, py) => {
  if (px < 0 || py < 0 || px >= 1280 || py >= 720) return null;
  const shade = 0.34 * (0.85 + 0.30 * Math.sin(px / 190) * Math.cos(py / 230));
  const grain = 0.018 * Math.sin(px * 1.7) * Math.cos(py * 2.3);
  const redward = px > 640 ? 1.10 : 1.0;
  const lin = [(shade + grain) * redward, (shade + grain) * 0.74, (shade + grain) * 0.63];
  return [encode(lin[0] * gain[0]), encode(lin[1] * gain[1]), encode(lin[2] * gain[2])];
};

const W = 1280;
const H = 720;
const lm = synthFace();
const plans = reg.planAll(reg.toReference(lm)).plans;

const run = (gain) => pipeline.analyse({
  lm, matrix: null, width: W, height: H, read: image(gain), isSkin: () => true, plans,
});

check('a per-channel camera gain cancels exactly in every differenced feature', () => {
  const base = run([1, 1, 1]);
  assert.equal(base.stage, 'complete');

  const rnd = mulberry(99);
  for (let trial = 0; trial < 6; trial += 1) {
    // Gains well inside the range a phone's auto-white-balance actually applies.
    const gain = [0.65 + rnd() * 0.7, 0.65 + rnd() * 0.7, 0.65 + rnd() * 0.7];
    const lifted = run(gain);
    assert.equal(lifted.stage, 'complete');

    let compared = 0;
    for (const [name, region] of Object.entries(base.regions)) {
      if (!region.features || !lifted.regions[name]?.features) continue;
      for (const [feat, spec] of Object.entries(f.FEATURES)) {
        if (!spec.differenced) continue;
        const a = region.features[feat];
        const b = lifted.regions[name].features[feat];
        if (a === null || b === null) continue;
        // 1e-3 is the rounding the feature record itself applies at 4 decimal places, not slack.
        close(a, b, 2e-4, `${name}.${feat} under gain ${gain.map((g) => g.toFixed(2))}`);
        compared += 1;
      }
    }
    assert.ok(compared > 0, 'the invariance was actually exercised on real features');
  }
});

check('the differencing is doing the work — absolute densities DO move under gain', () => {
  // Guards against a false pass: if the pipeline silently produced nothing, the test above would
  // also "pass". The absolute statistic must visibly respond to the same gain.
  const plan = plans.leftCheek;
  const flat = reg.sampleRegion(plan, lm, W, H, image([1, 1, 1]));
  const lit = reg.sampleRegion(plan, lm, W, H, image([1.4, 1.0, 1.0]));
  const m = new Uint8Array(plan.inside.length).fill(1);
  const a = f.regionStats(flat, m);
  const b = f.regionStats(lit, m);
  assert.ok(a && b);
  assert.ok(Math.abs(a.absolute.densityR - b.absolute.densityR) > 0.1, 'absolute density moves a lot');
});

check('a real regional colour difference survives', () => {
  const r = run([1, 1, 1]);
  const left = r.regions.leftCheek?.features;
  const right = r.regions.rightCheek?.features;
  assert.ok(left && right, 'both cheeks measured');
  // The synthetic image is redder on one side of the frame. The chroma feature must see it.
  assert.ok(Math.abs(left.dChromaRG - right.dChromaRG) > 1e-3, 'a genuine difference is not cancelled away');
});

check('local contrast refuses rather than guessing when a region is nearly empty', () => {
  const plan = plans.leftCheek;
  const sampled = reg.sampleRegion(plan, lm, W, H, image());
  const nearly = new Uint8Array(plan.inside.length);
  nearly[0] = 1;
  const c = f.localContrast(sampled, nearly);
  assert.equal(c.value, null);
  assert.equal(c.reason, 'too_few_interior_pixels');
});

check('the face reference pools pixels and refuses below a floor', () => {
  const r = run([1, 1, 1]);
  assert.ok(r.faceReference.n > 200, 'pooled across regions');
  assert.equal(f.faceReference({}), null, 'no regions is no reference, not a zero one');
  assert.equal(f.faceReference({ a: { pixels: { dr: [1], dg: [1], db: [1] } } }), null, 'below the floor');
});

check('relative() is null-safe at both ends', () => {
  assert.equal(f.relative(null, {}), null);
  assert.equal(f.relative({}, null), null);
});

check('the feature register declares what each number is', () => {
  assert.ok(f.FEATURE_NAMES.length >= 7);
  for (const [name, spec] of Object.entries(f.FEATURES)) {
    assert.equal(typeof spec.differenced, 'boolean', `${name} declares gain invariance`);
    assert.equal(typeof spec.ratioScale, 'boolean', `${name} declares whether CV means anything`);
    assert.ok(spec.unit && spec.of, `${name} says what it is`);
  }
  // The two features that are NOT differenced are exactly the two expected to be fragile.
  const fragile = f.FEATURE_NAMES.filter((n) => !f.FEATURES[n].differenced);
  assert.deepEqual(fragile.sort(), ['localContrast', 'specularFraction']);
});

check('melanin/haemoglobin projection is deliberately absent', () => {
  // V2 proposed it; the basis vectors could not be verified, so it is not here. This test exists so
  // that adding it later is a conscious act rather than a drive-by import.
  assert.equal(f.FEATURE_NAMES.includes('melanin'), false);
  assert.equal(f.FEATURE_NAMES.includes('haemoglobin'), false);
  assert.equal(typeof f.melanin, 'undefined');
});

console.log(`face features: ${ok.length} checks passed`);
