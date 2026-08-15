// FaceLandmarker construction and the front camera. The only file in the face feature that
// touches MediaPipe or the DOM's media APIs.
//
// Kept apart from pose.js on purpose. The two share a WASM fileset and nothing else: pose runs
// continuously against the rear camera on a moving body, this runs briefly against the front
// camera on a still face. Merging them would mean one module with two lifecycles and two sets of
// resource rules, which is how a camera gets left running.

import { FilesetResolver, FaceLandmarker, ImageSegmenter } from '../vendor/tasks-vision.mjs';

const WASM = './vendor/wasm';
const MODEL = './vendor/face_landmarker.task';
const SEGMENTER = './vendor/selfie_multiclass_256x256.tflite';

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
 * The skin segmenter, which exists to answer one question: is this pixel face skin, or is it hair?
 *
 * IMAGE mode, not VIDEO, and that is the whole cost model. It runs ONCE, on the frame that was
 * actually accepted — never on a preview frame — so 16 MB of model and a few tens of milliseconds
 * of inference are paid once per check-in rather than thirty times a second.
 *
 * It must still be created when the sheet OPENS rather than at the moment of capture. Loading 16 MB
 * takes a second or two on a phone, and paying that at the instant someone has finally held still
 * is the worst possible moment to stall.
 *
 * `numFaces`-style options do not apply here; the confidence masks are switched off because we only
 * ever ask which class won, and producing six float masks to throw five away is inference time
 * spent on nothing.
 */
export async function createSegmenter() {
  const fileset = await FilesetResolver.forVisionTasks(WASM);
  return ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: SEGMENTER, delegate: 'GPU' },
    runningMode: 'IMAGE',
    outputCategoryMask: true,
    outputConfidenceMasks: false,
  });
}

/**
 * Which category index means face skin.
 *
 * ASKED, NOT ASSUMED. The model card documents the order as background/hair/body-skin/face-skin/
 * clothes/others, which would make it 3 — and a model file republished under the same `latest` URL
 * with a different label order would silently turn every hair pixel into a skin measurement. The
 * task exposes its own labels, so the answer comes from the loaded model rather than from a PDF.
 *
 * Returns null when no label matches, and the caller must then run WITHOUT a veto rather than
 * guessing an index. A capture measured without segmentation is recorded as such.
 */
export function skinCategory(segmenter) {
  try {
    const labels = segmenter?.getLabels?.() ?? [];
    const i = labels.findIndex((l) => String(l).toLowerCase().replace(/[\s_]/g, '-') === 'face-skin');
    return i >= 0 ? { index: i, labels } : { index: null, labels };
  } catch {
    return { index: null, labels: [] };
  }
}

/**
 * Let go of everything.
 *
 * Both halves matter. Stopping the tracks turns the camera light off — leaving a front camera live
 * behind a closed sheet is the single worst thing this feature could do. Closing the landmarker
 * frees its WASM memory, which otherwise sits alongside the pose model's for the rest of the
 * session; two vision models resident at once is what pushes a mid-range phone into swapping.
 */
export function releaseFace(stream, landmarker, video, segmenter) {
  stream?.getTracks().forEach((t) => t.stop());
  if (video) video.srcObject = null;
  try { landmarker?.close(); } catch { /* already closed */ }
  // The segmenter is the larger of the two by a wide margin. Leaving it resident behind a closed
  // sheet is what pushes a mid-range phone into swapping the next time the gym flow opens a camera.
  try { segmenter?.close(); } catch { /* already closed */ }
}
