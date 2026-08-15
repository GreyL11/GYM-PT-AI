// The Face Wellness check-in sheet: camera lifecycle, live framing guidance, resource release.
//
// Display and device wiring only. Every judgement — whether a capture is good enough, what to tell
// the person, whether they have held still — is quality.js and geometry.js, which are pure and
// tested with no camera. Nothing in this file decides anything.
//
// PHASE 2 SCOPE: guidance only. No pixels are read, nothing is measured, nothing is stored. This
// exists to prove the camera opens, the loop runs, the guidance is usable in the hand, and every
// resource is handed back on the way out — before any analysis is built on top of it.

import { createFaceLandmarker, startFaceCamera, releaseFace } from './model.js';
import { regions, alignment } from './geometry.js';
import * as q from './quality.js';

const $ = (id) => document.getElementById(id);

let stream = null;
let landmarker = null;
let running = false;
let steady = { frames: 0, ready: false };

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
}

export async function open() {
  onBeforeOpen();
  $('face-guide').textContent = 'Starting the camera…';
  $('face-state').textContent = '';
  steady = { frames: 0, ready: false };

  try {
    // The model is created on entry and destroyed on exit rather than kept alive for the session:
    // holding a second vision model resident to save a one-off load is the wrong trade on a phone
    // that is also holding a pose model.
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
}

/** Hand back the camera and the model. Called on every exit path, including navigating away. */
export function close() {
  running = false;
  gen += 1;
  releaseFace(stream, landmarker, $('face-cam'));
  stream = null;
  landmarker = null;
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
    paint(null, { instruction: 'Bring your face into the frame', blocking: 'framing' }, null);
    return;
  }

  // Phase 2 measures geometry only — no pixels are read, so the checks that need image data
  // (sharpness, exposure, lighting balance) are not part of this verdict yet. They arrive in
  // Phase 3 alongside the region sampling that feeds them.
  const width = video.videoWidth;
  const height = video.videoHeight;
  const parts = {
    framing: q.framing(lm, { width, height, mirrored: true }),
    pose: q.pose(lm, matrix),
  };
  const verdict = q.assess(parts);
  steady = q.steadiness(steady, verdict.accepted);

  paint(lm, q.guide(parts), verdict);
}

/** Draw the outline and say the one thing. No analysis, no numbers on screen. */
function paint(lm, guidance, verdict) {
  const canvas = $('face-overlay');
  const video = $('face-cam');
  if (canvas.width !== video.videoWidth && video.videoWidth) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (lm) {
    const a = alignment(lm);
    const rs = regions(lm, { mirrored: true });
    if (a && rs) {
      // The regions themselves, faintly — so the person can see what is being looked at rather
      // than being scanned by something opaque.
      ctx.strokeStyle = steady.ready ? '#7ee2a8' : '#ffffff55';
      ctx.lineWidth = Math.max(2, canvas.width * 0.003);
      for (const box of Object.values(rs)) {
        const s = box.half * 2 * canvas.width;
        ctx.strokeRect((box.cx - box.half) * canvas.width, (box.cy - box.half) * canvas.height, s, s);
      }
    }
  }

  $('face-guide').textContent = guidance.instruction
    ?? (steady.ready ? 'Hold it — ready' : 'Hold still');

  const pct = Math.round((steady.frames / q.STEADY_FRAMES) * 100);
  $('face-progress').style.width = `${Math.min(100, pct)}%`;
  $('face-state').textContent = verdict
    ? `capture confidence ${Math.round(verdict.overall * 100)}%`
    : '';
}
