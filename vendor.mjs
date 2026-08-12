// Rebuilds www/vendor/ from node_modules plus downloads (pose model, webfonts), so nothing
// derived is committed. CI runs this after `npm ci`.
import { cpSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'node_modules/@mediapipe/tasks-vision';
const OUT = join(import.meta.dirname, 'www', 'vendor');

/**
 * fetch, but it does not give up the first time a network hiccups.
 *
 * Everything below is downloaded from Google over the public internet, from a CI runner, and a
 * single dropped connection here fails the whole build and ships no APK. That is a silly reason
 * not to have a release. Three tries with a widening gap costs nothing when the network is fine.
 */
async function get(url, init, tries = 3) {
  for (let i = 1; ; i += 1) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      // 4xx will not fix itself; only retry the ones that might.
      if (res.status < 500 || i === tries) throw new Error(`${res.status} ${res.statusText}`);
    } catch (err) {
      if (i === tries) throw new Error(`${url} failed after ${tries} tries: ${err.message}`);
      console.log(`vendor: ${url} — ${err.message}, retrying (${i}/${tries - 1})`);
    }
    await new Promise((r) => setTimeout(r, i * 2000));
  }
}
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

// Google Fonts serves woff2 only to browser user agents; node's default UA gets ttf.
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Inter:wght@500;700;800;900&family=JetBrains+Mono:wght@700&display=swap';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

mkdirSync(OUT, { recursive: true });
cpSync(join(SRC, 'wasm'), join(OUT, 'wasm'), { recursive: true });
copyFileSync(join(SRC, 'vision_bundle.mjs'), join(OUT, 'tasks-vision.mjs'));

const model = join(OUT, 'pose_landmarker_lite.task');
if (existsSync(model)) {
  console.log('vendor: wasm + bundle refreshed, model already present');
} else {
  const res = await get(MODEL_URL);
  writeFileSync(model, Buffer.from(await res.arrayBuffer()));
  console.log('vendor: wasm + bundle refreshed, model downloaded');
}

// ── webfonts ─────────────────────────────────────────────────────────────────────────────
// Self-hosted because a CDN font request inside the APK fails with no signal, and the whole
// design leans on heavy Inter plus mono digits. Latin subset only — the UI has no other script.
const fontDir = join(OUT, 'fonts');
mkdirSync(fontDir, { recursive: true });

const css = await (await get(FONT_CSS, { headers: { 'User-Agent': CHROME_UA } })).text();
const blocks = [...css.matchAll(/\/\*\s*latin\s*\*\/\s*@font-face\s*\{([^}]+)\}/g)].map((m) => m[1]);
if (!blocks.length) throw new Error('no latin @font-face blocks found — did the Google Fonts CSS format change?');

// Google serves ONE variable woff2 per family and lists it under every requested weight, so
// download per unique URL and emit a single rule spanning the weight range. Naively writing one
// file per weight stores four identical 48 KB copies of Inter.
const byUrl = new Map();
for (const block of blocks) {
  const family = block.match(/font-family:\s*'([^']+)'/)[1];
  const weight = Number(block.match(/font-weight:\s*(\d+)/)[1]);
  const url = block.match(/url\((https:[^)]+\.woff2)\)/)[1];
  const entry = byUrl.get(url) ?? { family, weights: [] };
  entry.weights.push(weight);
  byUrl.set(url, entry);
}

const rules = [];
for (const [url, { family, weights }] of byUrl) {
  const file = `${family.replace(/\s+/g, '')}.woff2`;
  const res = await get(url, { headers: { 'User-Agent': CHROME_UA } });
  writeFileSync(join(fontDir, file), Buffer.from(await res.arrayBuffer()));
  const lo = Math.min(...weights), hi = Math.max(...weights);
  rules.push(`@font-face{font-family:'${family}';font-style:normal;`
    + `font-weight:${lo === hi ? lo : `${lo} ${hi}`};`
    + `font-display:swap;src:url('${file}') format('woff2');}`);
}
writeFileSync(join(fontDir, 'fonts.css'), `${rules.join('\n')}\n`);
console.log(`vendor: ${rules.length} webfont file(s) downloaded`);
