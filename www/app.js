import { createLandmarker, startCamera, stopCamera, drawSkeleton } from './pose.js';
import { EXERCISES, defaultThresholds, createState, step } from './exercises.js';
import { createCoach, createVoice, PLAN } from './coach.js';
import * as store from './store.js';

const $ = (id) => document.getElementById(id);
const el = {
  cam: $('cam'), overlay: $('overlay'),
  exname: $('exname'), setinfo: $('setinfo'), repnum: $('repnum'), reptarget: $('reptarget'),
  cue: $('cue'), status: $('status'),
  btnEnd: $('btn-end'), btnSkip: $('btn-skip'), btnSettings: $('btn-settings'),
  start: $('sheet-start'), startEx: $('start-ex'), startHint: $('start-hint'), startErr: $('start-err'),
  btnStart: $('btn-start'), facing: $('facing'), voice: $('voice'),
  rest: $('sheet-rest'), restTime: $('resttime'), restSummary: $('rest-summary'), btnNext: $('btn-next'),
  settings: $('sheet-settings'), setEx: $('set-ex'), sliders: $('sliders'), view: $('view'),
  btnReset: $('btn-reset'), btnCloseSettings: $('btn-close-settings'),
};

// Slider bounds for every tunable. [min, max, step, label]
const RANGES = {
  lockout:        [140, 180, 1,     'Lockout angle'],
  torsoLean:      [10, 80, 1,       'Max torso lean'],
  depthGap:       [-0.06, 0.10, 0.005, 'Squat depth margin'],
  heelLift:       [0.05, 0.60, 0.01, 'Heel lift allowed'],
  valgusRatio:    [0.50, 1.00, 0.01, 'Knee cave-in limit'],
  eccentricMs:    [0, 1500, 50,     'Min descent time (ms)'],
  flare:          [45, 100, 1,      'Max elbow flare'],
  wristBend:      [120, 180, 1,     'Min wrist stack angle'],
  asymmetry:      [5, 45, 1,        'Max left/right gap'],
  upperArm:       [10, 70, 1,       'Max upper-arm swing'],
  upperArmTarget: [60, 120, 1,      'Upper-arm angle target'],
  upperArmTol:    [5, 45, 1,        'Upper-arm drift allowed'],
  depth:          [30, 110, 1,      'Bottom depth angle'],
};

const voice = createVoice();
const coach = createCoach({ speak: (t) => voice.speak(t) });

let landmarker = null;
let stream = null;
let setState = createState();
let thresholds = {};
let view = 'side';
let running = false;
let lastVideoTs = -1;
let cueTimer = 0;
let wakeLock = null;

// Without this the phone screens off mid-set and the camera stops. Re-acquired on resume, because
// Android drops the lock whenever the app goes to the background.
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not fatal */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && running) keepAwake();
});

// ── screen plumbing ──────────────────────────────────────────────────────────────────────

function refreshHud() {
  const s = coach.state;
  if (s.finished) {
    el.exname.textContent = 'Session complete';
    el.setinfo.textContent = 'Nice work.';
    el.btnEnd.disabled = el.btnSkip.disabled = true;
    running = false;
    voice.speak('Session complete. Well done.');
    return;
  }
  el.exname.textContent = s.name;
  el.setinfo.textContent = `Set ${s.set}/${s.sets} · ${s.targetReps} reps · ${s.load} kg`;
  el.reptarget.textContent = `/ ${s.targetReps}`;
  el.repnum.textContent = '0';
  el.startEx.textContent = s.name;
  el.startHint.textContent = s.hint;
  thresholds = s.thresholds;
  view = EXERCISES[s.exId].view;
  el.view.value = view;
}

function showCue(text) {
  el.cue.textContent = text;
  el.cue.classList.add('show');
  clearTimeout(cueTimer);
  cueTimer = setTimeout(() => el.cue.classList.remove('show'), 3500);
}

// ── the frame loop ───────────────────────────────────────────────────────────────────────

function loop() {
  if (!running) return;
  const v = el.cam;
  if (v.readyState >= 2 && v.currentTime !== lastVideoTs) {
    lastVideoTs = v.currentTime;
    if (el.overlay.width !== v.videoWidth) {
      el.overlay.width = v.videoWidth;
      el.overlay.height = v.videoHeight;
    }
    const tMs = performance.now();
    const res = landmarker.detectForVideo(v, tMs);
    const lm = res.landmarks?.[0];
    const w = res.worldLandmarks?.[0];

    if (lm && w) {
      const out = step(coach.state.exId, { lm, w, tMs, view }, setState, thresholds);
      const cue = coach.onFrame(out);
      if (cue) showCue(cue);
      el.repnum.textContent = String(out.reps);
      el.status.textContent = out.visible ? `${Math.round(out.angle)}° · ${out.phase}` : 'Step back into frame';
      drawSkeleton(el.overlay.getContext('2d'), lm, {
        width: el.overlay.width, height: el.overlay.height, bad: out.faults.length > 0,
      });
    } else {
      el.status.textContent = 'No one in frame';
      drawSkeleton(el.overlay.getContext('2d'), null, { width: el.overlay.width, height: el.overlay.height });
    }
  }
  requestAnimationFrame(loop);
}

// ── buttons ──────────────────────────────────────────────────────────────────────────────

el.btnStart.addEventListener('click', async () => {
  el.btnStart.disabled = true;
  el.startErr.textContent = '';
  try {
    voice.enabled = el.voice.checked;
    voice.unlock(); // must happen inside the gesture or iOS stays silent all session
    el.startErr.textContent = 'Loading pose model…';
    landmarker ??= await createLandmarker();
    stream = await startCamera(el.cam, el.facing.value);
    el.startErr.textContent = '';
    el.start.hidden = true;
    setState = createState();
    running = true;
    keepAwake();
    coach.announceSet();
    requestAnimationFrame(loop);
  } catch (err) {
    el.startErr.textContent = `${err.name}: ${err.message}`;
    el.btnStart.disabled = false;
  }
});

el.btnEnd.addEventListener('click', () => {
  const r = coach.endSet(setState);
  setState = createState();
  el.restSummary.textContent = r.verdict
    ? `${r.record.reps} reps · ${r.faults} corrections. Next session: ${r.verdict.to} kg (${r.verdict.reason}).`
    : `${r.record.reps} reps · ${r.faults} corrections.`;
  refreshHud();
  startRest(r.rest);
});

el.btnSkip.addEventListener('click', () => {
  coach.skipExercise();
  setState = createState();
  refreshHud();
  if (!coach.state.finished) coach.announceSet();
});

function startRest(seconds) {
  if (coach.state.finished) return;
  let left = seconds;
  el.rest.hidden = false;
  const tick = () => {
    el.restTime.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    if (left-- <= 0) {
      clearInterval(id);
      voice.speak('Rest over.');
    }
  };
  tick();
  const id = setInterval(tick, 1000);
  el.btnNext.onclick = () => {
    clearInterval(id);
    el.rest.hidden = true;
    coach.announceSet();
  };
}

// ── settings ─────────────────────────────────────────────────────────────────────────────

function buildSliders() {
  const s = coach.state;
  el.setEx.textContent = s.name;
  el.sliders.innerHTML = '';
  for (const [key, value] of Object.entries(thresholds)) {
    const range = RANGES[key];
    if (!range) continue;
    const [min, max, stepSize, label] = range;
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<label for="t-${key}">${label}</label>
      <input type="range" id="t-${key}" min="${min}" max="${max}" step="${stepSize}" value="${value}">
      <output>${value}</output>`;
    const input = row.querySelector('input');
    input.addEventListener('input', () => {
      const v = Number(input.value);
      row.querySelector('output').textContent = v;
      thresholds[key] = v;
      store.setThreshold(s.exId, key, v);
    });
    el.sliders.appendChild(row);
  }
}

el.btnSettings.addEventListener('click', () => { buildSliders(); el.settings.hidden = false; });
el.btnCloseSettings.addEventListener('click', () => { el.settings.hidden = true; });
el.view.addEventListener('change', () => { view = el.view.value; });
el.btnReset.addEventListener('click', () => {
  const s = coach.state;
  thresholds = defaultThresholds(s.exId);
  for (const [k, v] of Object.entries(thresholds)) store.setThreshold(s.exId, k, v);
  buildSliders();
});
el.voice.addEventListener('change', () => { voice.enabled = el.voice.checked; });

window.addEventListener('pagehide', () => stopCamera(stream));

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

refreshHud();

// Exposed for poking at in the console: `trainer.store.read()` to see your log.
globalThis.trainer = { coach, store, PLAN, get thresholds() { return thresholds; } };
