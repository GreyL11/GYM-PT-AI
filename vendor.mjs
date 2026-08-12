// Rebuilds www/vendor/ from node_modules plus the pose model download, so nothing derived
// is committed. CI runs this after `npm ci`.
import { cpSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'node_modules/@mediapipe/tasks-vision';
const OUT = join(import.meta.dirname, 'www', 'vendor');
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

mkdirSync(OUT, { recursive: true });
cpSync(join(SRC, 'wasm'), join(OUT, 'wasm'), { recursive: true });
copyFileSync(join(SRC, 'vision_bundle.mjs'), join(OUT, 'tasks-vision.mjs'));

const model = join(OUT, 'pose_landmarker_lite.task');
if (existsSync(model)) {
  console.log('vendor: wasm + bundle refreshed, model already present');
} else {
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`model download failed: ${res.status} ${res.statusText}`);
  writeFileSync(model, Buffer.from(await res.arrayBuffer()));
  console.log('vendor: wasm + bundle refreshed, model downloaded');
}
