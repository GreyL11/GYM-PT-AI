// Candidate appearance features. Pure — typed arrays in, numbers out.
//
// EVERY NUMBER IN THIS FILE IS A CANDIDATE, NOT A PRODUCT CLAIM. Nothing here has been shown to be
// stable on a real face. validation.js decides that from real captures, and until it does, the
// honest status of each of these is UNVALIDATED. That is not modesty, it is the phase.
//
// ── WHY LOG SPACE, AND THE ONE THING IT ACTUALLY GUARANTEES ──────────────────────────────
//
// A phone runs continuous auto-exposure and auto-white-balance. Between two photographs of the same
// cheek it will apply different per-channel gains, and in linear light that multiplies every pixel:
//
//     linear'_c(x) = k_c * linear_c(x)
//
// Take the negative logarithm — optical density, which is the domain the skin-colour literature
// works in because pigment absorption is additive there (Tsumura et al., JOSA A 16(9):2169) — and
// the multiplication becomes an addition of a constant across the WHOLE FRAME:
//
//     D'_c(x) = D_c(x) - log(k_c)
//
// A constant added everywhere cancels EXACTLY in any difference between two places in the same
// frame. So every feature below that is reported is a DIFFERENCE — region against the whole-face
// skin reference, or one channel against another — and every one of them is provably invariant to
// whatever gains the camera chose. That is not an argument from a paper; test_face_features.mjs
// multiplies a synthetic capture by random per-channel gains and asserts the differences do not
// move.
//
// ── WHAT IT DOES NOT GUARANTEE, said as plainly ──────────────────────────────────────────
//
//   A change of ILLUMINANT SPECTRUM is not a gain. Daylight and a tungsten bulb change the relative
//   reflectance response, and no amount of differencing removes that. The lighting gate in
//   quality.js is the only defence, and it is uncalibrated.
//
//   The camera pipeline is NOT a pure sRGB encode. Phones apply local, scene-dependent tone mapping
//   before the canvas ever sees a pixel, and local tone mapping is spatially varying — which means
//   the "constant across the frame" assumption above is an approximation, not an identity, on real
//   hardware. How good an approximation is an empirical question and Protocol A measures it.
//
// ── WHAT IS DELIBERATELY NOT IMPLEMENTED ─────────────────────────────────────────────────
//
// MELANIN / HAEMOGLOBIN SEPARATION. V2 proposed projecting log-density onto pigment basis vectors.
// It is not here. The basis vectors in that literature are obtained by independent component
// analysis per dataset and per camera; shipping specific numeric vectors recalled rather than
// verified would be exactly the failure this phase exists to prevent, and a wrong basis produces a
// confident number rather than an obviously broken one. Deferred until the vectors can be derived
// from this app's own captures or taken from a source that is actually in hand.
//
// Also absent, and staying absent: absolute colour or tone, erythema or "redness" indices, pore and
// wrinkle metrics, blemish counts, hydration, age, and any composite score.

const EPS = 1e-4;

/** How the numbers below were computed. Stored with every capture so a measurement can be traced. */
export const FEATURE_VERSION = 'feat-1';

/** Near-saturation, per channel, in 0-255. Above this a pixel carries a highlight, not skin. */
const SPECULAR = 245;

/** Radius, in canonical pixels, of the local mean subtracted before texture is measured. */
const HIGHPASS_RADIUS = 3;

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/**
 * sRGB electro-optical transfer function, 0-255 in, linear 0-1 out.
 *
 * The standard piecewise definition. Undoing it is the first honest step toward something
 * proportional to scene light — with the caveat in the header that a phone's pipeline is not
 * actually a pure sRGB encode.
 */
export function linearise(v) {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Optical density. Bounded below by EPS so a crushed-black pixel cannot return Infinity. */
export const density = (v) => -Math.log(Math.max(EPS, linearise(v)));

/** Median of a Float64Array slice. Sorts a copy; n is at most a few thousand. */
export function median(xs) {
  if (!xs.length) return null;
  const s = Float64Array.from(xs).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median absolute deviation. The robust spread used everywhere in this feature set. */
export function mad(xs, centre = null) {
  if (!xs.length) return null;
  const c = centre ?? median(xs);
  return median(xs.map((x) => Math.abs(x - c)));
}

/**
 * Per-pixel density triples for the valid pixels of a sampled region.
 *
 * Returns the raw arrays rather than statistics, because the whole-face reference needs to pool
 * pixels ACROSS regions before any median is taken — a median of medians is not a median, and the
 * reference is the one statistic everything else is expressed against.
 */
export function densities(sampled, mask) {
  const dr = [];
  const dg = [];
  const db = [];
  const idx = [];
  for (let k = 0; k < mask.length; k += 1) {
    if (!mask[k]) continue;
    const r = density(sampled.r[k]);
    const g = density(sampled.g[k]);
    const b = density(sampled.b[k]);
    if (!finite(r) || !finite(g) || !finite(b)) continue;
    dr.push(r); dg.push(g); db.push(b); idx.push(k);
  }
  return { dr, dg, db, idx };
}

/** Luminance density, in the same log domain. Rec.709 weights, applied in linear light. */
export function luminanceDensity(sampled, k) {
  const y = 0.2126 * linearise(sampled.r[k]) + 0.7152 * linearise(sampled.g[k]) + 0.0722 * linearise(sampled.b[k]);
  return -Math.log(Math.max(EPS, y));
}

/**
 * High-frequency surface variation.
 *
 * A local mean is subtracted first, so this measures structure at the scale of a few canonical
 * pixels rather than the shading gradient across a cheek — shading is lighting, and lighting is not
 * the subject. Only pixels whose ENTIRE kernel is valid contribute, so the mask edge cannot masquer-
 * ade as texture.
 *
 * Reported as the MAD of the residual, not the standard deviation: one bright hair the segmentation
 * missed should not be able to set the number by itself.
 *
 * CONFOUNDS, all real and all measured elsewhere: blur (hard-gated in quality.js), sampling ratio
 * (a face further away supplies fewer source pixels per canonical pixel and downsampling suppresses
 * exactly this content), and any non-skin pixel that survived the veto.
 */
export function localContrast(sampled, mask) {
  const { w, h } = sampled;
  const lum = new Float64Array(w * h);
  for (let k = 0; k < w * h; k += 1) if (mask[k]) lum[k] = luminanceDensity(sampled, k);

  const r = HIGHPASS_RADIUS;
  const residual = [];
  for (let y = r; y < h - r; y += 1) {
    for (let x = r; x < w - r; x += 1) {
      const k = y * w + x;
      if (!mask[k]) continue;
      let sum = 0;
      let n = 0;
      let whole = true;
      for (let dy = -r; dy <= r && whole; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          const kk = (y + dy) * w + (x + dx);
          if (!mask[kk]) { whole = false; break; }
          sum += lum[kk]; n += 1;
        }
      }
      if (!whole || !n) continue;
      const v = lum[k] - sum / n;
      if (finite(v)) residual.push(v);
    }
  }
  if (residual.length < 32) return { value: null, n: residual.length, reason: 'too_few_interior_pixels' };
  return { value: mad(residual, 0), n: residual.length, reason: null };
}

/** Fraction of valid pixels carrying a specular highlight rather than skin colour. */
export function specularFraction(sampled, mask) {
  let n = 0;
  let hot = 0;
  for (let k = 0; k < mask.length; k += 1) {
    if (!mask[k]) continue;
    n += 1;
    if (sampled.r[k] >= SPECULAR && sampled.g[k] >= SPECULAR && sampled.b[k] >= SPECULAR) hot += 1;
  }
  return n ? { value: hot / n, n } : { value: null, n: 0 };
}

/**
 * Everything measurable about one region, before it is expressed against the face reference.
 *
 * These are ABSOLUTE densities and are deliberately NOT reported as features — they move with every
 * gain the camera applies. They exist only so the relative step below can subtract them.
 */
export function regionStats(sampled, mask) {
  const d = densities(sampled, mask);
  if (d.dr.length < 32) return null;

  const chromaRG = d.dr.map((v, i) => v - d.dg[i]);
  const chromaGB = d.dg.map((v, i) => v - d.db[i]);
  const contrast = localContrast(sampled, mask);
  const spec = specularFraction(sampled, mask);

  return {
    n: d.dr.length,
    absolute: {
      densityR: median(d.dr),
      densityG: median(d.dg),
      densityB: median(d.db),
      chromaRG: median(chromaRG),
      chromaGB: median(chromaGB),
    },
    localContrast: contrast.value,
    localContrastN: contrast.n,
    specularFraction: spec.value,
    pixels: d,
  };
}

/**
 * The whole-face skin reference, pooled across every available region of ONE capture.
 *
 * This is the statistic the segmentation veto exists to make trustworthy, and it is what every
 * reported feature is expressed against. Pooling raw pixels rather than averaging region medians is
 * deliberate: the regions differ enormously in size, and a median of medians would silently weight a
 * small under-eye patch the same as a whole cheek.
 */
export function faceReference(regions) {
  const dr = [];
  const dg = [];
  const db = [];
  for (const r of Object.values(regions)) {
    if (!r?.pixels) continue;
    dr.push(...r.pixels.dr); dg.push(...r.pixels.dg); db.push(...r.pixels.db);
  }
  if (dr.length < 200) return null;
  const chromaRG = dr.map((v, i) => v - dg[i]);
  const chromaGB = dg.map((v, i) => v - db[i]);
  return {
    n: dr.length,
    densityR: median(dr),
    densityG: median(dg),
    densityB: median(db),
    chromaRG: median(chromaRG),
    chromaGB: median(chromaGB),
  };
}

const round = (n, dp = 4) => (finite(n) ? Math.round(n * 10 ** dp) / 10 ** dp : null);

/**
 * The reported features for one region: differences against the same-frame face reference.
 *
 * EVERY ONE IS A DIFFERENCE, and that is the entire reason they are the reported set. See the
 * header — a per-channel camera gain is a constant in this domain and cancels here exactly.
 *
 *   dDensityR/G/B   how much darker this region reads than the face overall, per channel.
 *   dChromaRG/GB    how this region's channel BALANCE differs from the face overall. This is the
 *                   nearest thing here to a colour signal, and it is not called redness, because a
 *                   ratio of log densities is not an erythema measurement and saying so would be
 *                   the first step to a medical claim.
 *   localContrast   absolute, NOT differenced — it is already a within-region residual statistic,
 *                   and there is no reference contrast to subtract that would not itself be noise.
 *                   Its scale invariance comes from canonical sampling, not from differencing, and
 *                   is therefore weaker. Expect this one to be the first to fail validation.
 *   specularFraction absolute, and a fraction, so gain cancels only approximately — a global
 *                   exposure lift genuinely creates specular pixels. Confounded by design.
 */
export function relative(stats, ref) {
  if (!stats || !ref) return null;
  return {
    n: stats.n,
    dDensityR: round(stats.absolute.densityR - ref.densityR),
    dDensityG: round(stats.absolute.densityG - ref.densityG),
    dDensityB: round(stats.absolute.densityB - ref.densityB),
    dChromaRG: round(stats.absolute.chromaRG - ref.chromaRG),
    dChromaGB: round(stats.absolute.chromaGB - ref.chromaGB),
    localContrast: round(stats.localContrast),
    specularFraction: round(stats.specularFraction),
  };
}

/**
 * Which reported features exist, and what each one is.
 *
 * Kept beside the code that computes them so the two cannot drift, and consumed by validation.js so
 * a feature added above is automatically a feature the validation engine tracks.
 *
 * `differenced` is the property that matters: true means a per-channel camera gain provably cancels.
 *
 * `ratioScale` decides whether a coefficient of variation is meaningful. The differenced features
 * cross zero — a region can read lighter or darker than the face average — so their mean is not a
 * scale and CV on them is an artefact that explodes near zero. validation.js refuses to compute it
 * for those rather than reporting a number nobody should read.
 */
export const FEATURES = {
  dDensityR: { differenced: true, ratioScale: false, unit: 'log density', of: 'region vs same-frame face skin' },
  dDensityG: { differenced: true, ratioScale: false, unit: 'log density', of: 'region vs same-frame face skin' },
  dDensityB: { differenced: true, ratioScale: false, unit: 'log density', of: 'region vs same-frame face skin' },
  dChromaRG: { differenced: true, ratioScale: false, unit: 'log density ratio', of: 'region vs same-frame face skin' },
  dChromaGB: { differenced: true, ratioScale: false, unit: 'log density ratio', of: 'region vs same-frame face skin' },
  localContrast: { differenced: false, ratioScale: true, unit: 'log density (MAD)', of: 'within region, high-passed' },
  specularFraction: { differenced: false, ratioScale: true, unit: 'fraction', of: 'within region' },
};

export const FEATURE_NAMES = Object.keys(FEATURES);
