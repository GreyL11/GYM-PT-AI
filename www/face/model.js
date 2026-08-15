// FaceLandmarker construction and the front camera. The only file in the face feature that
// touches MediaPipe or the DOM's media APIs.
//
// Kept apart from pose.js on purpose. The two share a WASM fileset and nothing else: pose runs
// continuously against the rear camera on a moving body, this runs briefly against the front
// camera on a still face. Merging them would mean one module with two lifecycles and two sets of
// resource rules, which is how a camera gets left running.

import { FilesetResolver, FaceLandmarker } from '../vendor/tasks-vision.mjs';

const WASM = './vendor/wasm';
const MODEL = './vendor/face_landmarker.task';

/**
 * One face, video mode, with the transformation matrix switched on.
 *
 * `outputFacialTransformationMatrixes` is the reason the head-angle gate is trustworthy: it gives
 * a real 4x4 rotation rather than an angle inferred from where the nose sits. Blendshapes are
 * deliberately OFF — they describe expressions, which this feature has no business tracking, and
 * they cost inference time to produce something it would immediately throw away.
 */
export async function createFaceLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks(WASM);
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: true,
    minFaceDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

/**
 * The front camera.
 *
 * `facingMode: 'user'` rather than the rear camera the gym flow uses, which is why this cannot
 * share a stream with it — a MediaStream is bound to one camera. On most Android hardware the two
 * cameras cannot both be open at once either, so whoever opens this must release the other first.
 */
export async function startFaceCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

/**
 * Let go of everything.
 *
 * Both halves matter. Stopping the tracks turns the camera light off — leaving a front camera live
 * behind a closed sheet is the single worst thing this feature could do. Closing the landmarker
 * frees its WASM memory, which otherwise sits alongside the pose model's for the rest of the
 * session; two vision models resident at once is what pushes a mid-range phone into swapping.
 */
export function releaseFace(stream, landmarker, video) {
  stream?.getTracks().forEach((t) => t.stop());
  if (video) video.srcObject = null;
  try { landmarker?.close(); } catch { /* already closed */ }
}
