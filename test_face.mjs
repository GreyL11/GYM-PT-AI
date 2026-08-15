// Self-check for face geometry and the capture quality gate. Run: node test_face.mjs
//
// These test the REFUSALS above all else. A quality gate that accepts everything is not a gate,
// and the failure mode of this whole feature is a confident conclusion drawn from two photos taken
// under different lamps. So most of what follows builds a deliberately bad capture and asserts
// that the thing says no.

import assert from 'node:assert/strict';

const geo = await import('./www/face/geometry.js');
const q = await import('./www/face/quality.js');

const ok = [];
const check = (name, fn) => { fn(); ok.push(name); };

/**
 * A synthetic face. Only the landmarks the modules actually read are placed meaningfully; the rest
 * exist so indices resolve. `eyeGap` is in normalized frame width, which is exactly the quantity
 * the distance gate judges.
 */
function face({ cx = 0.5, cy = 0.45, eyeGap = 0.20, roll = 0, noseShift = 0, faceH = 0.55 } = {}) {
  const lm = Array.from({ length: 478 }, () => ({ x: cx, y: cy, z: 0 }));
  const ux = Math.cos(roll);
  const uy = Math.sin(roll);
  const half = eyeGap / 2;
  // 263 = subject's left outer eye corner, 33 = right. From FaceLandmarker's own sets.
  lm[263] = { x: cx + ux * half, y: cy + uy * half, z: 0 };
  lm[33] = { x: cx - ux * half, y: cy - uy * half, z: 0 };
  // Nose tip: on the eye axis when facing forward, slid along it by noseShift (in eye-gaps).
  lm[1] = { x: cx + ux * noseShift * eyeGap, y: cy + uy * noseShift * eyeGap, z: 0 };
  // Face vertical extremes, perpendicular to the eye axis.
  const dx = -uy;
  const dy = ux;
  lm[10] = { x: cx - dx * faceH * 0.35, y: cy - dy * faceH * 0.35, z: 0 };
  lm[152] = { x: cx + dx * faceH * 0.65, y: cy + dy * faceH * 0.65, z: 0 };
  return lm;
}

/** A luminance buffer of constant value, optionally with sharp edges to make it "in focus". */
function luma(w, h, value, { edges = false, clipDark = 0, clipBright = 0 } = {}) {
  const a = new Float64Array(w * h).fill(value);
  if (edges) for (let i = 0; i < a.length; i += 2) a[i] = Math.min(1, value + 0.25);
  for (let i = 0; i < clipDark; i += 1) a[i] = 0;
  for (let i = 0; i < clipBright; i += 1) a[a.length - 1 - i] = 1;
  return a;
}

// ── geometry ─────────────────────────────────────────────────────────────────────────────

check('alignment measures eye distance, and scales with camera distance', () => {
  const near = geo.alignment(face({ eyeGap: 0.30 }));
  const far = geo.alignment(face({ eyeGap: 0.15 }));
  assert.ok(Math.abs(near.scale - 0.30) < 1e-9);
  assert.ok(Math.abs(far.scale - 0.15) < 1e-9);
  assert.ok(near.scale > far.scale, 'closer face reads larger — this is the distance proxy');
});

check('a tilted head is measured as roll, not as a moved face', () => {
  const a = geo.alignment(face({ roll: 0.3 }));
  assert.ok(Math.abs(a.roll - 0.3) < 1e-6);
  // Rolling must not change the apparent size, or tilting would read as leaning in.
  assert.ok(Math.abs(a.scale - 0.20) < 1e-9);
});

check('regions scale with the face, so the same patch of skin is measured at any distance', () => {
  const near = geo.regions(face({ eyeGap: 0.30 }));
  const far = geo.regions(face({ eyeGap: 0.15 }));
  // Every box should be exactly half the size when the face is half as wide.
  for (const k of Object.keys(near)) {
    assert.ok(Math.abs(near[k].half / far[k].half - 2) < 1e-6, `${k} did not scale with the face`);
  }
});

check('regions rotate with the head instead of sliding off the cheek', () => {
  const level = geo.regions(face({ roll: 0 }));
  const tilted = geo.regions(face({ roll: Math.PI / 2 }));
  // A quarter turn should swap the axes the cheeks are separated along.
  const levelDx = Math.abs(level.leftCheek.cx - level.rightCheek.cx);
  const tiltedDy = Math.abs(tilted.leftCheek.cy - tilted.rightCheek.cy);
  assert.ok(levelDx > 0.05, 'cheeks separate horizontally on a level head');
  assert.ok(tiltedDy > 0.05, 'and vertically on a head turned 90 degrees');
});

check('the selfie camera mirror swaps left and right exactly once', () => {
  const normal = geo.regions(face(), { mirrored: false });
  const mirrored = geo.regions(face(), { mirrored: true });
  // The subject's left cheek must appear on the other side of the frame when mirrored — getting
  // this wrong would report one cheek's readings as the other's, forever.
  assert.ok(Math.abs(normal.leftCheek.cx - mirrored.rightCheek.cx) < 1e-9);
  assert.ok(Math.abs(normal.rightCheek.cx - mirrored.leftCheek.cx) < 1e-9);
});

check('head pose reads yaw from the nose, scale-free', () => {
  assert.ok(Math.abs(geo.headPose(face({ noseShift: 0 })).yaw) < 1e-9, 'forward is zero');
  const turned = geo.headPose(face({ noseShift: 0.3 }));
  assert.ok(turned.yaw > 0.25, `a turned head should read as yaw, got ${turned.yaw}`);
  // Same turn, different camera distance — yaw must not change.
  const near = geo.headPose(face({ noseShift: 0.3, eyeGap: 0.30 }));
  const far = geo.headPose(face({ noseShift: 0.3, eyeGap: 0.12 }));
  assert.ok(Math.abs(near.yaw - far.yaw) < 1e-6, 'yaw must not depend on distance');
});

check('the transformation matrix is preferred and agrees on an identity pose', () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const p = geo.poseFromMatrix(identity);
  assert.ok(Math.abs(p.yaw) < 1e-9 && Math.abs(p.pitch) < 1e-9 && Math.abs(p.roll) < 1e-9);
  assert.equal(geo.poseFromMatrix(null), null, 'absent matrix falls back rather than inventing');
});

check('a box pushed off the edge of the frame is reported as clipped, not silently shrunk', () => {
  const r = geo.regions(face({ cx: 0.03 }));
  const px = geo.toPixels(r.rightCheek, 640, 480);
  assert.equal(px.clipped, true, 'must be flagged so the caller drops it');
  const inside = geo.toPixels(geo.regions(face()).forehead, 640, 480);
  assert.equal(inside.clipped, false);
});

// ── quality gate: the refusals ───────────────────────────────────────────────────────────

const FRAME = { width: 640, height: 480 };

check('a well-framed face passes framing', () => {
  const f = q.framing(face({ eyeGap: 0.22 }), FRAME);
  assert.ok(f.score > 0.8, `expected a clean pass, got ${f.score}`);
  assert.equal(f.reason, null);
});

check('too far away and too close are both rejected, and say which', () => {
  const far = q.framing(face({ eyeGap: 0.05 }), FRAME);
  assert.ok(far.score < 0.6, `distant face should score low, got ${far.score}`);
  assert.match(far.reason, /too far/);

  const near = q.framing(face({ eyeGap: 0.60, faceH: 0.2 }), FRAME);
  assert.ok(near.score < 0.6, `very close face should score low, got ${near.score}`);
  assert.ok(near.reason, 'and should say why');
});

check('a cropped face scores zero outright rather than being averaged down', () => {
  const f = q.framing(face({ cx: 0.02 }), FRAME);
  assert.equal(f.score, 0, 'a region off the edge is a different piece of skin, not a worse one');
  assert.ok(f.clipped.length > 0);
  assert.match(f.reason, /outside the frame/);
});

check('excessive head rotation is refused, with the right instruction', () => {
  assert.ok(q.pose(face({ noseShift: 0 })).score > 0.9, 'facing forward passes');
  const turned = q.pose(face({ noseShift: 0.5 }));
  assert.ok(turned.score < 0.4, `a turned head should be refused, got ${turned.score}`);
  assert.match(turned.reason, /face the camera/);
  const tilted = q.pose(face({ roll: 0.5 }));
  assert.ok(tilted.score < 0.5, 'and so should a strongly tilted one');
});

check('blur is detected, and a sharp image is not', () => {
  const flat = q.sharpness(luma(40, 40, 0.5), 40, 40);
  assert.ok(flat.value < q.LIMITS.sharpnessMin, 'a featureless image reads as blurred');
  assert.match(flat.reason, /blurry/);

  const sharp = q.sharpness(luma(40, 40, 0.5, { edges: true }), 40, 40);
  assert.ok(sharp.value > flat.value, 'edges must read sharper than flat');
  assert.equal(sharp.reason, null);
});

check('under- and over-exposure are both caught, and so is clipping', () => {
  assert.match(q.exposure(luma(20, 20, 0.05)).reason, /too dark/);
  assert.match(q.exposure(luma(20, 20, 0.95)).reason, /too bright/);

  const clipped = q.exposure(luma(20, 20, 0.5, { clipBright: 40 }));
  assert.ok(clipped.score < 0.5, 'blown highlights carry no information');
  assert.match(clipped.reason, /pure white or pure black/);

  const good = q.exposure(luma(20, 20, 0.5));
  assert.ok(good.score > 0.9);
  assert.equal(good.reason, null);
});

check('side lighting is caught before it can be reported as facial asymmetry', () => {
  assert.ok(q.balance(0.5, 0.5).score > 0.99, 'even light passes');
  const lopsided = q.balance(0.72, 0.28);
  assert.ok(lopsided.score < 0.3, `one-sided light must be refused, got ${lopsided.score}`);
  assert.match(lopsided.reason, /from one side/);
});

check('lighting is compared against the person, and stays quiet until it knows them', () => {
  assert.equal(q.lightingMatch(0.5, []).known, false, 'no history means no opinion');
  assert.equal(q.lightingMatch(0.5, [0.5, 0.5]).score, 1, 'two samples is not a habit');

  const usual = [0.50, 0.52, 0.48, 0.51, 0.49, 0.50];
  assert.ok(q.lightingMatch(0.50, usual).score > 0.9, 'a typical capture matches');
  const odd = q.lightingMatch(0.75, usual);
  assert.ok(odd.score < 0.3, `a very different lamp should be flagged, got ${odd.score}`);
  assert.match(odd.reason, /different from your usual/);
});

check('a person whose captures are near-identical does not get flagged for a trivial difference', () => {
  // Standard deviation near zero would make any difference read as enormous if divided by it.
  const rigid = [0.500, 0.500, 0.501, 0.499, 0.500, 0.500];
  assert.ok(q.lightingMatch(0.505, rigid).score > 0.8, 'half a percent is not a different room');
  assert.ok(q.lightingMatch(0.80, rigid).score < 0.3, 'but a real change still trips it');
});

// ── the combined verdict ─────────────────────────────────────────────────────────────────

check('one bad component sinks the capture — good scores cannot average it away', () => {
  const v = q.assess({
    framing: { score: 1 }, pose: { score: 1 }, sharpness: { score: 1 },
    exposure: { score: 1 }, balance: { score: 0.05, reason: 'the light is coming from one side' },
  });
  assert.ok(v.overall < q.LIMITS.acceptMin, `weighted minimum, not mean — got ${v.overall}`);
  assert.equal(v.accepted, false);
  assert.deepEqual(v.warnings, ['the light is coming from one side']);
});

check('a good capture is accepted and marked trustworthy', () => {
  const v = q.assess({
    framing: { score: 0.95 }, pose: { score: 0.95 }, sharpness: { score: 0.9 },
    exposure: { score: 0.95 }, balance: { score: 0.95 },
  });
  assert.ok(v.accepted && v.trustworthy, `expected a clean pass, got ${v.overall}`);
  assert.deepEqual(v.warnings, []);
});

check('storable and trustworthy are different bars', () => {
  // Good enough to keep as evidence, not good enough to base a strong claim on.
  const v = q.assess({
    framing: { score: 0.75 }, pose: { score: 0.72 }, sharpness: { score: 0.7 },
    exposure: { score: 0.75 }, balance: { score: 0.74 },
  });
  assert.equal(v.accepted, true);
  assert.equal(v.trustworthy, false, 'the trend layer must be able to tell these apart');
});

check('nothing to assess is refused rather than defaulted to fine', () => {
  const v = q.assess({});
  assert.equal(v.accepted, false);
  assert.equal(v.overall, 0);
});

// ── live guidance ────────────────────────────────────────────────────────────────────────

check('guidance gives one instruction at a time, in the order that unblocks things', () => {
  // Everything wrong at once. Framing must win: there is no point telling someone to hold still
  // while they are out of shot, and moving will change the lighting anyway.
  const g = q.guide({
    framing: { score: 0, reason: 'too far away' },
    pose: { score: 0, reason: 'turn to face the camera' },
    exposure: { score: 0, reason: 'too dark in here' },
    balance: { score: 0, reason: 'the light is coming from one side' },
  });
  assert.equal(g.instruction, 'too far away');
  assert.equal(g.blocking, 'framing');

  // With framing fixed, the next blocker surfaces rather than the whole list at once.
  assert.equal(q.guide({
    framing: { score: 1, reason: null },
    pose: { score: 0, reason: 'turn to face the camera' },
    exposure: { score: 0, reason: 'too dark in here' },
  }).instruction, 'turn to face the camera');

  assert.equal(q.guide({ framing: { score: 1 }, pose: { score: 1 } }).instruction, null);
});

check('steadiness needs consecutive good frames, and any bad one starts it over', () => {
  let s = { frames: 0, ready: false };
  for (let i = 0; i < q.STEADY_FRAMES - 1; i += 1) s = q.steadiness(s, true);
  assert.equal(s.ready, false, 'nearly there is not there');

  s = q.steadiness(s, false);
  assert.equal(s.frames, 0, 'half-steady is not steady — it resets, it does not decrement');

  for (let i = 0; i < q.STEADY_FRAMES; i += 1) s = q.steadiness(s, true);
  assert.equal(s.ready, true);
});

check('a single lucky frame in a shaky hold never reaches ready', () => {
  let s = { frames: 0, ready: false };
  for (let i = 0; i < 60; i += 1) s = q.steadiness(s, i % 3 === 0);
  assert.equal(s.ready, false, 'one good frame in three is not holding still');
});

console.log(ok.map((n) => `  ok  ${n}`).join('\n'));
console.log(`\n${ok.length} checks passed`);
