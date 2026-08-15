// The Face check-in sheet: camera lifecycle, live guidance, capture, and the validation panel.
//
// Display and device wiring only. Every judgement — whether a capture is good enough, which pixels
// may be measured, what the numbers are, whether a signal is trustworthy — lives in quality.js,
// mask.js, features.js and validation.js, all of which are pure and tested with no camera. Nothing
// in this file decides anything.
//
// PHASE 3.5 SCOPE. This is a MEASUREMENT AND VALIDATION instrument, not a finished feature. It
// captures, measures, and records, and it says so on screen. It does not tell anyone anything about
// their skin, because nothing here has yet earned the right to: every candidate signal is
// UNVALIDATED until real captures say otherwise, and validation.js is the only thing that can
// change that.
//
// THE PIXEL BOUNDARY, which is the largest privacy change in this app's history and is confined to
// this file:
//
//   <video> → drawImage → an offscreen canvas that is NEVER attached to the document
//           → getImageData → one transient Uint8ClampedArray
//           → region statistics → about a dozen numbers per region
//           → the canvas is cleared, the ImageData is dropped, the frame is never referenced again
//
// No image is written to storage. No image is sent anywhere — this module does not import chat.js
// and a test asserts that it never will. Retaining a capture for validation is a separate, explicit
// press of a button that hands a PNG to the browser's own download path and into the user's own
// filesystem; it never enters app storage.

import { createFaceLandmarker, createSegmenter, skinCategory, startFaceCamera, releaseFace } from './model.js';
import { anatomy } from './geometry.js';
import * as q from './quality.js';
import * as mask from './mask.js';
import { analyse } from './pipeline.js';
import { planAll, unpackReference } from './registration.js';
import { FEATURES } from './features.js';
import * as record from './record.js';
import * as validation from './validation.js';
import * as protocol from './protocol.js';

const $ = (id) => document.getElementById(id);

let stream = null;
let landmarker = null;
let segmenter = null;
let skinIndex = null;
let running = false;
let capturing = false;
let steady = { frames: 0, ready: false };
let plans = null;
let lastResult = null;

/** The offscreen canvas. Created once, never attached to the DOM, cleared after every capture. */
let scratch = null;

/**
 * Generation counter, copied from the gym loop for the same reason it exists there.
 *
 * `running` is only observed on the NEXT animation frame, so leaving and re-entering quickly can
 * leave the previous loop's pending callback alive to see `running === true` again and carry on.
 * Two loops driving one landmarker is not reentrant and it froze the gym flow once already.
 */
let gen = 0;

/** Called before the camera opens, so the caller can release the rear camera first. */
let onBeforeOpen = () => {};

export function init({ beforeOpen }) {
  onBeforeOpen = beforeOpen ?? (() => {});
  wireLab();
}

export async function open() {
  onBeforeOpen();
  $('face-guide').textContent = 'Starting the camera…';
  $('face-state').textContent = '';
  steady = { frames: 0, ready: false };
  loadReference();
  renderLab();

  try {
    // Both models are created on entry and destroyed on exit rather than kept alive for the
    // session: holding two vision models resident to save a one-off load is the wrong trade on a
    // phone that is also holding a pose model. The segmenter in particular is 16 MB, and loading it
    // at the moment someone finally holds still would stall at the worst possible instant.
    if (!landmarker) landmarker = await createFaceLandmarker();
    if (!stream) stream = await startFaceCamera($('face-cam'));
  } catch (err) {
    $('face-guide').textContent = `Camera unavailable: ${err.message}`;
    return;
  }

  running = true;
  gen += 1;
  const mine = gen;
  requestAnimationFrame(() => loop(mine));

  // The segmenter loads AFTER the loop is already running, and its failure is not fatal.
  //
  // Both halves matter. It is 16 MB — by far the largest asset in the app — and blocking the camera
  // preview on it would leave someone staring at a dead screen for a second or two every time they
  // open the sheet. And if it never arrives at all, the honest response is to keep measuring
  // without a veto and RECORD THAT FACT, not to refuse to run: `segmenterUsed: false` rides on the
  // capture, the version block drops the segmenter line, and record.comparable() will refuse to
  // pool those captures with vetoed ones. A capture measured without the veto can never be mistaken
  // later for one that passed it.
  loadSegmenter();
}

async function loadSegmenter() {
  if (segmenter) return;
  try {
    const made = await createSegmenter();
    // The sheet may have closed while 16 MB was arriving.
    if (!running) { try { made.close(); } catch { /* already closed */ } return; }
    segmenter = made;
    const found = skinCategory(segmenter);
    skinIndex = found.index;
    if (skinIndex === null) {
      // Measuring without a veto is allowed and is recorded as such. Guessing an index is not: the
      // wrong index turns every hair pixel into a skin measurement, silently, forever.
      console.warn('face: no face-skin label among', found.labels, '— capturing without the veto');
    }
  } catch (err) {
    console.warn('face: skin segmentation unavailable —', err.message, '— capturing without the veto');
  }
  renderLab(lastResult);
}

/** Hand back the camera and both models. Called on every exit path, including navigating away. */
export function close() {
  running = false;
  capturing = false;
  gen += 1;
  releaseFace(stream, landmarker, $('face-cam'), segmenter);
  stream = null;
  landmarker = null;
  segmenter = null;
  // A consent-gated preview must not survive the sheet it was taken in.
  revokeShot();
  if (scratch) {
    scratch.getContext('2d').clearRect(0, 0, scratch.width, scratch.height);
    scratch = null;
  }
}

/** The stored canonical face, and the sampling plans built from it. Rebuilt per session, not stored. */
function loadReference() {
  const stored = record.reference();
  const ref = stored ? unpackReference(stored.packed) : null;
  plans = ref ? (planAll(ref)?.plans ?? null) : null;
}

let lastVideoTs = -1;

function loop(mine) {
  if (!running || mine !== gen) return;
  try {
    frame();
  } catch (err) {
    running = false;
    $('face-guide').textContent = `Stopped: ${err.message}`;
    return;
  }
  requestAnimationFrame(() => loop(mine));
}

function frame() {
  const video = $('face-cam');
  if (video.readyState < 2 || video.currentTime === lastVideoTs) return;
  lastVideoTs = video.currentTime;

  const res = landmarker.detectForVideo(video, performance.now());
  const lm = res.faceLandmarks?.[0];
  const matrix = res.facialTransformationMatrixes?.[0]?.data;

  if (!lm) {
    steady = { frames: 0, ready: false };
    paint(null, { instruction: 'Bring your face into the frame' }, null);
    return;
  }

  // Per preview frame, only the two checks that need no pixels. The other four need the regions
  // located first and are far too expensive to run thirty times a second — they run once, on the
  // frame that is actually captured.
  const parts = {
    framing: q.framing(lm, { width: video.videoWidth, height: video.videoHeight, mirrored: true }),
    pose: q.pose(lm, matrix),
  };
  const live = q.gate(parts);
  steady = q.steadiness(steady, live.failures.length === 0);

  paint(lm, { instruction: live.instruction }, live);

  // NOTHING IS CAPTURED OUTSIDE A COLLECTION SESSION, and that is the answer to "how do we avoid a
  // confusing pile of random captures". A capture with no protocol, no condition and no repetition
  // is not evidence — it is a photograph of someone idly holding their phone, and a corpus full of
  // them would be worse than an empty one because it would look like data.
  //
  // It also means the ordinary Face tab records nothing at all, which is the honest state of this
  // feature: there is no product here yet, only guidance and collection.
  if (steady.ready && !capturing && record.session()) capture(lm, matrix, video);
}

/** Draw the outline and say the ONE thing that needs fixing. Never a percentage. */
function paint(lm, guidance, live) {
  const canvas = $('face-overlay');
  const video = $('face-cam');
  if (canvas.width !== video.videoWidth && video.videoWidth) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Is anything actually going to happen if they hold still? Everything below depends on it.
  const armed = Boolean(record.session());

  if (lm) {
    const a = anatomy(lm);
    if (a) {
      // The regions themselves, faintly — so the person can see what is being looked at rather
      // than being scanned by something opaque. Green only means "about to capture", so it is
      // reserved for when a capture is genuinely coming.
      ctx.strokeStyle = armed && steady.ready ? '#7ee2a8' : '#ffffff55';
      ctx.lineWidth = Math.max(2, canvas.width * 0.003);
      for (const poly of Object.values(a.regions)) outline(ctx, poly, a.frame, canvas);
    }
  }

  // THE SCREEN MUST NOT CLAIM TO BE DOING SOMETHING IT IS NOT.
  //
  // Captures only happen inside a collection session. Without one, holding still used to fill the
  // bar to 100% and print "Hold it — measuring" while nothing whatsoever happened — which is the
  // exact failure this entire feature began with, reintroduced by the change that added sessions.
  // So the bar tracks progress toward a real capture and stays empty when there is none to make.
  $('face-guide').textContent = guidance.instruction
    ?? (!armed ? 'Nothing is being recorded'
      : steady.ready ? 'Holding still — capturing now'
        : 'Hold still');

  const pct = armed ? Math.round((steady.frames / q.STEADY_FRAMES) * 100) : 0;
  $('face-progress').style.width = `${Math.min(100, pct)}%`;
  $('face-state').textContent = live ? checkLine(live, armed) : '';
}

const checkLine = (gate, armed) => {
  // What to fix always comes first — it is the only thing they can act on.
  if (gate.failures.length) return `${q.LABELS[gate.failures[0]]} — ${gate.checks[gate.failures[0]].reason}`;
  // Framing is fine and nothing is being recorded. Say so, and say what would change that, rather
  // than "Ready" — which reads as a promise that something is about to happen.
  if (!armed) return 'Framing is good. Tap Validate to start a capture session.';
  if (!steady.ready) return 'Hold still';
  return 'Capturing';
};

function outline(ctx, poly, f, canvas) {
  ctx.beginPath();
  poly.forEach((p, i) => {
    const x = (f.origin.x + (f.ux * p.a + f.dx * p.d) * f.scale) * canvas.width;
    const y = (f.origin.y + (f.uy * p.a + f.dy * p.d) * f.scale) * canvas.height;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.stroke();
}

// ── capture ──────────────────────────────────────────────────────────────────────────────

/** Past mean face luminances, so the lighting check has this person's own history to judge against. */
const lightingHistory = () => record.captures()
  .filter((c) => c.accepted && typeof c.meanFaceLuma === 'number')
  .map((c) => c.meanFaceLuma)
  .slice(-30);

function capture(lm, matrix, video) {
  capturing = true;
  try {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!scratch) scratch = document.createElement('canvas');
    scratch.width = w;
    scratch.height = h;
    const ctx = scratch.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const px = img.data;

    const read = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return null;
      const i = (y * w + x) * 4;
      return [px[i], px[i + 1], px[i + 2]];
    };

    const isSkin = segmentationLookup(w, h);

    const result = analyse({
      lm, matrix, width: w, height: h, read, isSkin, plans, lightingHistory: lightingHistory(), mirrored: true,
    });

    if (result.createdReference) {
      record.setReference(result.createdReference, { w, h });
      loadReference();
    }

    const active = record.session();
    const step = protocol.nextStep(record.captures(), active.protocol, record.notApplicable());

    record.append(record.build({
      protocol: active.protocol,
      session: active.id,
      // The repetition the tester was ASKED for, so a rejected capture does not consume one. The
      // count only advances when a capture is accepted, which is what `nextStep` reads.
      repetition: step?.repetition ?? null,
      condition: currentCondition(),
      accepted: result.accepted,
      quality: {
        accepted: result.quality.accepted,
        comparable: result.quality.comparable ?? false,
        failures: result.quality.failures,
        warnings: result.quality.warnings,
        checks: Object.fromEntries(Object.entries(result.quality.checks)
          .map(([k, c]) => [k, { score: c.score, pass: c.pass, reason: c.reason }])),
      },
      regions: Object.fromEntries(Object.entries(result.regions).map(([k, r]) => {
        const { counts, ...rest } = r;
        return [k, { ...rest, counts }];
      })),
      device: { w, h, ratio: window.devicePixelRatio ?? 1 },
      sampling: result.sampling,
      segmenterUsed: result.segmenterUsed,
      meanFaceLuma: result.meanFaceLuma,
    }));

    lastResult = result;
    renderLab(result);

    // The frame is done with. Clear it rather than leaving a face sitting in a canvas backing store.
    ctx.clearRect(0, 0, w, h);
  } finally {
    steady = { frames: 0, ready: false };
    // A short pause, so holding still does not fire a burst of captures off one steady moment.
    setTimeout(() => { capturing = false; }, 1200);
  }
}

/** Run the segmenter over the captured frame and hand back a per-pixel skin test, or null. */
function segmentationLookup(w, h) {
  if (!segmenter || skinIndex === null || !scratch) return null;
  let result = null;
  try {
    result = segmenter.segment(scratch);
    const cat = result?.categoryMask;
    if (!cat) return null;
    // Copied out before the result is closed — the underlying buffer belongs to the task and is
    // freed with it, so holding the original would read whatever the next inference put there.
    const copy = Uint8Array.from(cat.getAsUint8Array());
    const look = mask.categoryLookup(copy, cat.width, cat.height, w, h);
    return look ? (x, y) => look(x, y) === skinIndex : null;
  } catch {
    return null;
  } finally {
    try { result?.close?.(); } catch { /* already closed */ }
  }
}


// ── Face Intelligence Validation: guided protocol collection ─────────────────────────────
//
// NOT A PRODUCT SCREEN, and the wording on it works hard to say so. Everything below exists to
// collect a structured corpus and to show what has been collected — never to suggest that anything
// has been learned from it.
//
// The panel keeps two things rigidly apart, because conflating them is the one mistake that would
// undo the whole discipline:
//
//   PROTOCOL COLLECTION STATUS — "have we taken the photographs?" — protocol.js
//   SIGNAL VALIDATION STATUS   — "did any measurement survive them?" — validation.js
//
// A protocol reading COMPLETE is not a signal reading VALIDATED. They live in separate sections,
// behind separate buttons, and share no vocabulary.

const currentCondition = () => $('face-condition')?.value || 'baseline';

function wireLab() {
  $('face-lab-toggle')?.addEventListener('click', () => {
    const panel = $('face-lab');
    panel.hidden = !panel.hidden;
    renderLab(lastResult);
  });
  $('face-protocol')?.addEventListener('change', () => { record.endSession(); renderLab(lastResult); });
  $('face-session')?.addEventListener('click', () => {
    if (record.session()) record.endSession();
    else record.startSession($('face-protocol').value);
    renderLab(lastResult);
  });
  $('face-na')?.addEventListener('change', (e) => {
    record.setNotApplicable($('face-protocol').value, e.target.checked);
    renderLab(lastResult);
  });
  $('face-consent')?.addEventListener('change', (e) => {
    record.setConsent(e.target.checked);
    renderLab(lastResult);
  });
  $('face-validate')?.addEventListener('click', renderValidation);
  $('face-export')?.addEventListener('click', () => exportValidation(false));
  $('face-export-copy')?.addEventListener('click', () => exportValidation(true));
  $('face-download')?.addEventListener('click', downloadCapture);
  $('face-forget')?.addEventListener('click', () => {
    if (!window.confirm('Delete every face capture, the canonical reference, the protocol progress and the consent record? Nothing else is touched.')) return;
    record.forget();
    revokeShot();
    if ($('face-export-text')) $('face-export-text').value = '';
    plans = null;
    lastResult = null;
    renderLab();
    if ($('face-validation-out')) $('face-validation-out').textContent = 'Not run yet.';
  });
}

/**
 * Show the current frame, on an explicit press, with consent on.
 *
 * IT SHOWS RATHER THAN DOWNLOADS, and that is a device constraint rather than a preference. The
 * README records that a Capacitor WebView with no DownloadListener drops blob downloads SILENTLY —
 * so on the actual target hardware a "Save image" button would appear to work and do nothing. An
 * <img> the tester can long-press uses Android's own save mechanism, which works.
 *
 * The download is still attempted, because in a desktop browser it is the better path. Both are
 * offered and the note says which one to fall back to.
 *
 * Note the precise privacy claim: the ANALYSIS canvas is never attached to the document. This
 * preview is a separate element, created only on an explicit consent-gated press, and its object
 * URL is revoked when the panel closes or the data is deleted. Nothing is written to app storage
 * either way — there is no code path that puts an image there.
 */
function downloadCapture() {
  const out = $('face-lab-note');
  const img = $('face-shot');
  if (!record.consent().retainImages) {
    out.textContent = 'Turn on "keep validation images" first.';
    return;
  }
  if (!scratch) {
    out.textContent = 'No capture in hand — start a session and hold still until one is taken.';
    return;
  }
  scratch.toBlob((blob) => {
    if (!blob) return;
    const name = `face-${$('face-protocol').value}-${currentCondition()}-${Date.now()}.png`;
    revokeShot();
    shotUrl = URL.createObjectURL(blob);
    img.src = shotUrl;
    img.hidden = false;
    download(shotUrl, name);
    out.textContent = 'If nothing landed in your downloads — which is normal inside the app — long-press the image to save it.';
  }, 'image/png');
}

let shotUrl = null;

function revokeShot() {
  if (!shotUrl) return;
  URL.revokeObjectURL(shotUrl);
  shotUrl = null;
  const img = $('face-shot');
  if (img) { img.removeAttribute('src'); img.hidden = true; }
}

/** The corpus, as a file the evaluation harness reads directly. Numbers only — never an image. */
function exportValidation(copy) {
  const data = record.validationExport();
  const text = JSON.stringify(data, null, 2);
  const note = $('face-lab-note');

  if (copy) {
    navigator.clipboard.writeText(text).then(() => {
      note.textContent = `Copied — ${Math.ceil(text.length / 1024)} KB, ${data.captures.length} capture record(s). No images; there are none to export.`;
    }).catch(() => {
      // Clipboard needs permission or a secure context. Same fallback the backup card uses: put it
      // on screen and select it so it can be copied by hand.
      const box = $('face-export-text');
      box.value = text;
      box.select();
      note.textContent = 'Could not copy for you — it is selected above, copy it by hand.';
    });
    return;
  }

  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  download(url, `face-validation-${new Date().toISOString().slice(0, 10)}.json`);
  URL.revokeObjectURL(url);
  note.textContent = `Exported ${data.captures.length} capture record(s). If nothing downloaded, use Copy.`;
}

function download(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
}

const bar = (done, total) => {
  const n = total > 0 ? Math.max(0, Math.min(10, Math.round((done / total) * 10))) : 0;
  return '#'.repeat(n) + '.'.repeat(10 - n);
};

function renderLab(result = null) {
  const panel = $('face-lab');
  if (!panel || panel.hidden) return;

  const caps = record.captures();
  const na = record.notApplicable();
  const active = record.session();
  const id = $('face-protocol')?.value ?? 'A';
  const spec = protocol.SPEC[id];

  // ── dashboard: collection only, never a verdict ────────────────────────────────────────
  const t = protocol.totals(caps);
  const rows = protocol.dashboard(caps, na).map((p) => {
    const count = p.state === protocol.COLLECTION.NOT_APPLICABLE
      ? 'n/a'.padStart(6)
      : `${p.counted}/${p.target}`.padStart(6);
    return `  ${p.id}  ${protocol.SPEC[p.id].label.padEnd(38)} ${count}  ${p.state}`
      + (p.rejected ? `   (${p.rejected} rejected)` : '');
  });
  $('face-dashboard').textContent = [
    ...rows,
    '',
    `  corpus: ${t.captures} captures / ${t.accepted} accepted / ${t.rejected} rejected`
      + (t.untagged ? ` / ${t.untagged} untagged` : ''),
  ].join('\n');

  // ── the protocol being collected ───────────────────────────────────────────────────────
  const p = protocol.progress(caps, id, na);
  const step = protocol.nextStep(caps, id, na);

  const conditionSel = $('face-condition');
  if (conditionSel && conditionSel.dataset.for !== id) {
    conditionSel.innerHTML = '';
    for (const c of spec.conditions) {
      const o = document.createElement('option');
      o.value = c;
      o.textContent = c;
      conditionSel.append(o);
    }
    conditionSel.dataset.for = id;
  }
  if (conditionSel && step?.condition && !active) conditionSel.value = step.condition;

  $('face-purpose').textContent = spec.purpose;
  $('face-instruction').textContent = spec.instruction;
  $('face-na').checked = Boolean(na[id]);
  $('face-na-row').hidden = !spec.optional;

  $('face-progress-text').textContent = [
    `${bar(p.counted, p.target)}  ${p.counted} / ${p.target} counted`,
    `accepted ${p.accepted}   rejected ${p.rejected}`
      + (spec.distinctDays ? `   days ${p.days}` : '')
      + (spec.minConditions > 1 ? `   conditions ${p.conditions.length}/${spec.minConditions}` : ''),
    p.conditionsMissing?.length && spec.minConditions > 1
      ? `not yet tried: ${p.conditionsMissing.join(', ')}` : '',
    p.note ?? '',
    step?.message ?? '',
  ].filter(Boolean).join('\n');

  $('face-session').textContent = active ? 'End session' : 'Start capture session';
  $('face-session').disabled = Boolean(step?.done || step?.blocked);
  $('face-session-state').textContent = active
    ? `Recording into ${active.id}. Hold still and a capture is taken automatically.`
    : (step?.blocked ? step.message : 'No session running. Nothing is being recorded.');

  // ── the last capture ───────────────────────────────────────────────────────────────────
  const lines = [];
  if (result) {
    lines.push(result.accepted
      ? 'ACCEPTED'
      : `REJECTED - ${result.quality.failures.map((f) => q.LABELS[f] ?? f).join(', ') || result.stage}`);
    for (const [k, c] of Object.entries(result.quality.checks)) {
      lines.push(`  ${c.pass ? 'ok  ' : 'FAIL'} ${(q.LABELS[k] ?? k).padEnd(30)}${c.reason ? ` ${c.reason}` : ''}`);
    }
    if (result.quality.warnings.length) {
      lines.push(`  warn  not comparable: ${result.quality.warnings.map((w) => q.LABELS[w] ?? w).join(', ')}`);
    }
    if (Object.keys(result.regions).length) {
      lines.push('', 'region            avail  cov    cand  samp  eroded  vetoed  final');
      for (const [name, r] of Object.entries(result.regions)) {
        const c = r.counts ?? {};
        lines.push([
          name.padEnd(17),
          (r.available ? 'yes' : 'no').padEnd(6),
          `${Math.round((r.coverage ?? 0) * 100)}%`.padEnd(6),
          String(c.candidates ?? '-').padEnd(5),
          String(c.sampled ?? '-').padEnd(5),
          String(c.erosionRejected ?? '-').padEnd(7),
          String(c.segmentationRejected ?? '-').padEnd(7),
          String(c.afterVeto ?? '-'),
          r.available ? '' : `  (${r.reason})`,
        ].join(' '));
      }
    }
    lines.push('', `segmenter: ${segmenter ? (skinIndex === null ? 'loaded, NO face-skin label - captured WITHOUT veto' : `face-skin = category ${skinIndex}`) : 'not loaded - captured WITHOUT veto'}`);
    lines.push(`sampling: ${result.sampling?.ratio ?? '-'} source px per canonical px`);
  } else {
    lines.push('No capture yet this session.');
  }
  $('face-lab-out').textContent = lines.join('\n');
}

/**
 * Signal validation — its own section, its own button, its own vocabulary.
 *
 * INSUFFICIENT DATA IS THE EXPECTED ANSWER and it is printed as loudly as any other. A view that
 * quietly showed nothing when there was nothing would be indistinguishable from one showing
 * everything passing.
 */
function renderValidation() {
  const out = $('face-validation-out');
  if (!out) return;
  const { records, excluded, versionGroups } = record.comparable(record.captures());
  const regions = [...new Set(records.flatMap((r) => Object.keys(r.regions ?? {})))].sort();

  if (!records.length) {
    out.textContent = 'INSUFFICIENT DATA - no captures recorded.\nNothing has been validated and no signal is product-ready.';
    return;
  }

  const signals = validation.evaluateAll(records, regions, FEATURES);
  const counts = validation.summarise(signals);
  const ready = validation.productReady(signals);

  const lines = [
    `${records.length} comparable capture(s)${excluded ? `, ${excluded} set aside from ${versionGroups - 1} other pipeline version(s)` : ''}`,
    Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join('   '),
    '',
    ready.length
      ? `PRODUCT-READY: ${ready.map((s) => `${s.region}.${s.feature}`).join(', ')}`
      : 'PRODUCT-READY: none. No appearance intelligence may be shown.',
    '',
  ];
  for (const region of regions) {
    lines.push(region);
    for (const s of signals.filter((x) => x.region === region)) {
      lines.push(`  ${s.feature.padEnd(18)} ${s.state}`);
    }
  }

  const occ = validation.occlusionBehaviour(records);
  if (occ.length) {
    lines.push('', 'occlusion behaviour (protocol E)');
    for (const o of occ) lines.push(`  ${o.condition} -> ${o.region}: ${o.verdict}`);
  }
  out.textContent = lines.join('\n');
}
