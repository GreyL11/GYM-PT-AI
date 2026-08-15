// Which sampled pixels are allowed to become a measurement, and an honest count of everything
// thrown away on the way. Pure — typed arrays in, typed arrays and integers out.
//
// THE DIVISION OF LABOUR, which is the whole architecture in one line:
//
//   LANDMARKS DEFINE GEOMETRY. SEGMENTATION ONLY VETOES.
//
// The skin segmentation runs at 256x256 against a 1280x720 capture, so one mask pixel covers
// roughly five source pixels across. That is far too coarse to draw the edge of a cheek, and it is
// perfectly good at answering "is this hair". So it never draws an edge here. The mesh draws every
// edge; the segmentation is only ever allowed to remove.
//
// EROSION ALWAYS ERRS TOWARD DISCARDING. Both erosions below shrink the usable set and neither can
// grow it. That direction is chosen deliberately: losing good skin costs sample size, which shows
// up honestly as a lower coverage ratio, and one strand of hair inside a texture measurement costs
// the trend its integrity. A boundary error that can only delete is not an accuracy problem.
//
// NOTHING HERE EVER RETURNS ZERO FOR A MISSING MEASUREMENT. A region that loses too many pixels
// comes back unavailable, with the count that made it unavailable and the dominant reason.

/** Below either of these a region is unavailable. Coverage is the ratio that matters; the pixel
 *  floor is there because a tiny region can hit a high ratio and still be twenty pixels. */
export const LIMITS = {
  minCoverage: 0.45,
  minPixels: 120,
  // Canonical pixels. ~2 pulls the sampled area off its own polygon edge.
  geometryErode: 2,
  // Larger, because this one absorbs the segmentation's own resolution: at 256x256 one mask pixel
  // is about 2.4 canonical pixels, so 5 is a shade over two mask pixels of slack.
  vetoErode: 5,
};

/**
 * Binary erosion with a square kernel. A pixel survives only if every pixel within `r` survives.
 *
 * Square rather than disk on purpose — separable, exact, and the difference between a square and a
 * disk at r=2 is a pixel of extra conservatism, which is the direction this file already leans.
 */
export function erode(mask, w, h, r) {
  if (r <= 0) return mask;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let keep = 1;
      for (let d = -r; d <= r && keep; d += 1) {
        const xx = x + d;
        if (xx < 0 || xx >= w || !mask[y * w + xx]) keep = 0;
      }
      tmp[y * w + x] = keep;
    }
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let keep = 1;
      for (let d = -r; d <= r && keep; d += 1) {
        const yy = y + d;
        if (yy < 0 || yy >= h || !tmp[yy * w + x]) keep = 0;
      }
      out[y * w + x] = keep;
    }
  }
  return out;
}

const count = (m) => { let n = 0; for (let i = 0; i < m.length; i += 1) n += m[i]; return n; };

/**
 * Apply erosion and the segmentation veto to one sampled region.
 *
 * @param sampled   from registration.sampleRegion()
 * @param plan      from registration.planRegion(), for the candidate and unmapped counts
 * @param isSkin    (px, py) => boolean, or null when no segmentation ran. Null is NOT treated as
 *                  "everything is skin" quietly — it is recorded, so a capture measured without a
 *                  veto can never be mistaken later for one that passed it.
 *
 * @returns {mask, coverage, available, reason, counts}
 */
export function apply(sampled, plan, isSkin) {
  const { w, h, valid, sx, sy } = sampled;
  const n = w * h;

  const geom = erode(valid, w, h, LIMITS.geometryErode);
  const afterErosion = count(geom);

  let skinMask = null;
  let afterVeto = afterErosion;
  let final = geom;

  if (isSkin) {
    const raw = new Uint8Array(n);
    for (let k = 0; k < n; k += 1) {
      if (!valid[k]) continue;
      raw[k] = isSkin(sx[k], sy[k]) ? 1 : 0;
    }
    skinMask = erode(raw, w, h, LIMITS.vetoErode);
    final = new Uint8Array(n);
    for (let k = 0; k < n; k += 1) final[k] = geom[k] && skinMask[k] ? 1 : 0;
    afterVeto = count(final);
  }

  const counts = {
    candidates: plan.candidates,
    unmapped: plan.unmapped,
    offImage: sampled.offImage,
    sampled: count(valid),
    afterErosion,
    afterVeto,
    erosionRejected: count(valid) - afterErosion,
    segmentationRejected: afterErosion - afterVeto,
    vetoed: Boolean(isSkin),
  };

  const coverage = counts.candidates > 0 ? afterVeto / counts.candidates : 0;
  const available = afterVeto >= LIMITS.minPixels && coverage >= LIMITS.minCoverage;

  return {
    mask: final,
    coverage: Math.round(coverage * 1000) / 1000,
    available,
    reason: available ? null : dominantReason(counts),
    counts,
  };
}

/**
 * Why a region was lost, naming the single biggest cause rather than listing everything.
 *
 * One reason, because it is the one the person or the report can act on, and because a list reads
 * as an excuse. Same discipline as quality.guide().
 */
function dominantReason(c) {
  if (!c.candidates) return 'no_region';
  if (c.afterVeto < LIMITS.minPixels && c.candidates < LIMITS.minPixels) return 'region_too_small';
  const losses = [
    ['unmapped_by_topology', c.unmapped],
    ['outside_image', c.offImage],
    ['eroded_away', c.erosionRejected],
    ['not_skin', c.segmentationRejected],
  ].sort((a, b) => b[1] - a[1]);
  return losses[0][1] > 0 ? losses[0][0] : 'insufficient_pixels';
}

/**
 * Look up the segmentation category for a source pixel.
 *
 * The mask arrives at its own resolution — 256x256 — independent of the capture, so this scales
 * rather than assuming they match. Nearest-neighbour, because the values are class indices and
 * interpolating a class index is meaningless.
 */
export function categoryLookup(mask, maskW, maskH, imageW, imageH) {
  if (!mask || !maskW || !maskH || !imageW || !imageH) return null;
  return (px, py) => {
    const mx = Math.min(maskW - 1, Math.max(0, Math.round((px / imageW) * maskW)));
    const my = Math.min(maskH - 1, Math.max(0, Math.round((py / imageH) * maskH)));
    return mask[my * maskW + mx];
  };
}
