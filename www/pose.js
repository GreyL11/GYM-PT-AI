// Camera + MediaPipe Pose Landmarker. Everything here runs on-device; no frame ever leaves the phone.

// Vendored, not CDN: inside an APK — or at a gym with no signal — a remote import is a dead app.
// Refresh the local copies with `npm run vendor`.
import { FilesetResolver, PoseLandmarker } from './vendor/tasks-vision.mjs';

const WASM = './vendor/wasm';
const MODEL = './vendor/pose_landmarker_lite.task';

// ponytail: the "lite" model. On a mid-range phone it holds 30fps where "full" drops to ~12,
// and joint-angle thresholds are far coarser than the accuracy difference between them.
export async function createLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks(WASM);
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

export async function startCamera(video, facingMode = 'environment') {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

export function stopCamera(stream) {
  stream?.getTracks().forEach((t) => t.stop());
}

const CONNECTIONS = [
  [11, 12], [11, 23], [12, 24], [23, 24],           // torso
  [11, 13], [13, 15], [12, 14], [14, 16],           // arms
  [23, 25], [25, 27], [24, 26], [26, 28],           // legs
  [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32], // feet
];

export function drawSkeleton(ctx, lm, { width, height, bad = false }) {
  ctx.clearRect(0, 0, width, height);
  if (!lm) return;
  const px = (p) => [p.x * width, p.y * height];

  ctx.lineWidth = 4;
  ctx.strokeStyle = bad ? '#ff5a3c' : '#ede6da';
  ctx.beginPath();
  for (const [a, b] of CONNECTIONS) {
    if ((lm[a]?.visibility ?? 0) < 0.4 || (lm[b]?.visibility ?? 0) < 0.4) continue;
    ctx.moveTo(...px(lm[a]));
    ctx.lineTo(...px(lm[b]));
  }
  ctx.stroke();

  ctx.fillStyle = bad ? '#ff5a3c' : '#ffffff';
  for (const p of lm) {
    if ((p.visibility ?? 0) < 0.4) continue;
    const [x, y] = px(p);
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}
