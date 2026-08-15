import { createLandmarker, startCamera, stopCamera, cameraAlive, drawSkeleton, MODELS } from './pose.js';
import { createLandmarkFilter } from './filter.js';
import {
  EXERCISES, GROUPS, EQUIPMENT, INJURIES, MIN_RANGE_DEG,
  defaultThresholds, createState, step, calibrate, cameraCheck,
} from './exercises.js';
import { createCoach, createVoice, suggest, warmupsFor } from './coach.js';
import {
  MODES, STANCES, DEFAULT_BOUT, PUNCH_LABELS,
  createBout, createBoutState, boxStep, boutAt, roundStats, trackingWarning,
} from './boxing.js';
import * as insights from './insights.js';
import * as devcheck from './devcheck.js';
import * as nutrition from './nutrition.js';
import * as planner from './planner.js';
import * as store from './store.js';
import * as technique from './technique.js';
import * as tInputs from './t_inputs.js';
import { phrase, explain as askModel } from './chat.js';
import * as explain from './explain.js';
// Wires its own listeners on import; app.js only has to show the sheet and ask it to paint.
import * as mood from './mood.js';
import * as face from './face/checkin.js';

const $ = (id) => document.getElementById(id);
const el = {
  cam: $('cam'), overlay: $('overlay'),
  exname: $('exname'), setinfo: $('setinfo'), repnum: $('repnum'), reptarget: $('reptarget'),
  cue: $('cue'), status: $('status'),
  btnEnd: $('btn-end'), btnSkip: $('btn-skip'), btnSettings: $('btn-settings'),
  picker: $('sheet-picker'), disciplines: $('disciplines'), groups: $('groups'), exlist: $('exlist'),
  facing: $('facing'), voice: $('voice'), btnPickerBack: $('btn-picker-back'),
  today: $('sheet-today'), todayDay: $('today-day'), todayName: $('today-name'),
  todayList: $('todaylist'), todayNote: $('today-note'),
  btnBrowse: $('btn-browse'), btnProfile: $('btn-profile'), btnProgress: $('btn-progress'),
  mind: $('sheet-mind'), mindCheck: $('mind-check'),
  btnMind: $('btn-mind'), btnMindBack: $('btn-mind-back'),
  btnFace: $('btn-face'), btnFaceBack: $('btn-face-back'), face: $('sheet-face'),
  progress: $('sheet-progress'), progressBody: $('progress-body'), progressDyn: $('progress-dyn'),
  btnDevcheck: $('btn-devcheck'), btnDevcheckBack: $('btn-devcheck-back'),
  devcheck: $('sheet-devcheck'), devcheckEx: $('devcheck-ex'), devcheckOut: $('devcheck-out'),
  btnProgressBack: $('btn-progress-back'), btnProgressDone: $('btn-progress-done'),
  profile: $('sheet-profile'), inBw: $('in-bw'), inDays: $('in-days'),
  pExperience: $('p-experience'), pGoal: $('p-goal'), pEquipment: $('p-equipment'),
  pInjuries: $('p-injuries'), profileWarn: $('profile-warn'),
  pModel: $('p-model'), modelNote: $('model-note'),
  boxing: $('sheet-boxing'), boxTitle: $('box-title'), boxHint: $('box-hint'), boxWarn: $('box-warn'),
  boxMode: $('box-mode'), boxStance: $('box-stance'), boxErr: $('box-err'),
  inRounds: $('in-rounds'), inWork: $('in-work'), inRest: $('in-rest'),
  btnBoxBack: $('btn-box-back'), btnBoxStart: $('btn-box-start'),
  inBar: $('in-bar'), pPlates: $('p-plates'), plateNote: $('plate-note'),
  btnSaveProfile: $('btn-save-profile'), btnProfileBack: $('btn-profile-back'),
  btnExportFile: $('btn-export-file'), btnExportCopy: $('btn-export-copy'), backupMsg: $('backup-msg'),
  restoreText: $('restore-text'), btnRestore: $('btn-restore'), restoreErr: $('restore-err'),
  setup: $('sheet-setup'), setupEx: $('setup-ex'), setupHint: $('setup-hint'), setupLast: $('setup-last'),
  setupPlates: $('setup-plates'),
  howto: $('howto'), howtoBody: $('howto-body'), btnHowto: $('btn-howto'), btnHowtoSpeak: $('btn-howto-speak'),
  inSets: $('in-sets'), inReps: $('in-reps'), inLoad: $('in-load'),
  btnBack: $('btn-back'), btnStart: $('btn-start'), startErr: $('start-err'),
  btnCalibrate: $('btn-calibrate'), warmup: $('warmup'), warmupRow: $('warmup-row'),
  bigmsg: $('bigmsg'), bigTitle: $('bigmsg-title'), bigSub: $('bigmsg-sub'),
  restReps: $('rest-reps'), repfix: $('repfix'),
  rest: $('sheet-rest'), restTime: $('resttime'), restFill: $('restfill'),
  restSummary: $('rest-summary'), btnNext: $('btn-next'),
  todayGreet: $('today-greet'), trainStats: $('train-stats'), btnStartToday: $('btn-start-today'),
  btnEatTab: $('btn-eat-tab'),
  weightNow: $('weight-now'), weightSpark: $('weight-spark'), btnLogWeight: $('btn-log-weight'),
  proteinNow: $('protein-now'), proteinFill: $('protein-fill'), inName: $('in-name'),
  coachChart: $('coach-chart'), coachDrift: $('coach-drift'), coachLine: $('coach-line'),
  trendCard: $('trend-card'), trendDrift: $('trend-drift'),
  weekSets: $('week-sets'), weekSub: $('week-sub'), btnStripProtein: $('btn-strip-protein'),
  btnStripWeek: $('btn-strip-week'),
  coachSuggest: $('coach-suggest'), suggestText: $('suggest-text'),
  btnAcceptTarget: $('btn-accept-target'), btnResetTarget: $('btn-reset-target'),
  eat: $('sheet-eat'), eatMacros: $('eat-macros'), eatToday: $('eat-today'), eatCats: $('eat-cats'),
  eatList: $('eatlist'), btnEatBack: $('btn-eat-back'), btnEatDone: $('btn-eat-done'),
  fName: $('f-name'), fServing: $('f-serving'), fKcal: $('f-kcal'), fProtein: $('f-protein'),
  fCarbs: $('f-carbs'), fFat: $('f-fat'), foodErr: $('food-err'), btnSaveFood: $('btn-save-food'),
  waterNow: $('water-now'), waterFill: $('water-fill'), waterAdd: $('water-add'),
  eatCustom: $('eat-custom'), foodClash: $('food-clash'), foodClashText: $('food-clash-text'),
  btnFoodOverwrite: $('btn-food-overwrite'), btnFoodSeparate: $('btn-food-separate'),
  settings: $('sheet-settings'), setEx: $('set-ex'), sliders: $('sliders'), view: $('view'),
  btnReset: $('btn-reset'), btnCloseSettings: $('btn-close-settings'),
  btnCloseSettings2: $('btn-close-settings-2'),
};

// Slider bounds for every tunable. [min, max, step, label]
const RANGES = {
  repStart:       [10, 180, 1,         'Rep start angle'],
  repEnd:         [10, 180, 1,         'Rep finish angle'],
  lockout:        [140, 180, 1,        'Lockout angle'],
  torsoLean:      [10, 80, 1,          'Max torso lean'],
  torsoMin:       [10, 70, 1,          'Min hinge angle'],
  depthGap:       [-0.06, 0.10, 0.005, 'Squat depth margin'],
  depth:          [30, 140, 1,         'Bottom depth angle'],
  heelLift:       [0.05, 0.60, 0.01,   'Heel lift allowed'],
  valgusRatio:    [0.50, 1.00, 0.01,   'Knee cave-in limit'],
  eccentricMs:    [0, 1500, 50,        'Min descent time (ms)'],
  flare:          [45, 100, 1,         'Max elbow flare'],
  wristBend:      [120, 180, 1,        'Min wrist stack angle'],
  asymmetry:      [5, 45, 1,           'Max left/right gap'],
  upperArm:       [10, 70, 1,          'Max upper-arm swing'],
  upperArmTarget: [60, 120, 1,         'Upper-arm angle target'],
  upperArmTol:    [5, 45, 1,           'Upper-arm drift allowed'],
  plank:          [140, 180, 1,        'Min body-line angle'],
  kneeMin:        [120, 178, 1,        'Min knee angle (hinge)'],
  barDrift:       [0.05, 0.40, 0.01,   'Bar drift from body'],
  barPath:        [0.05, 0.60, 0.01,   'Bar path deviation'],
  elbowPath:      [25, 90, 1,          'Max elbow flare (row)'],
  maxHeight:      [70, 140, 1,         'Max raise height'],
  elbowStraight:  [100, 180, 1,        'Min elbow straightness'],
};

const voice = createVoice();
const coach = createCoach({ speak: (t) => voice.speak(t) });

// Landmarks are smoothed before ANY measurement reads them, so fault checks stop working off raw
// jitter. Two filters because the two coordinate spaces have different plausible speeds.
const lmFilter = createLandmarkFilter('normalized');
const wFilter = createLandmarkFilter('world');

let fps = 0;          // measured, and shown, because the model choice depends on it
let lastFrameAt = 0;  // also the stall detector's only evidence that frames are arriving
let reviving = false; // one recovery at a time; resume and the watchdog can fire together

let landmarker = null;
let landmarkerModel = null;   // which model is currently loaded
let stream = null;
let setState = createState();
let thresholds = {};
let view = 'side';
let running = false;
let lastVideoTs = -1;
let cueTimer = 0;
let wakeLock = null;
let pendingEx = null;      // exercise chosen, awaiting its numbers
let filter = 'All';
let cameFromToday = true;  // so Back and "set finished" return where you actually came from

// 'framing'    — waiting for you to walk to the bar and get into position
// 'counting'   — 3, 2, 1 before the set starts
// 'live'       — actually coaching
// 'calibrating'— recording your range of motion, coaching nothing
let mode = 'live';
let scratch = createState();  // throwaway state so framing/calibration never bank reps
let calSamples = [];
let calUntil = 0;
let framedFrames = 0;
let framedLo = Infinity;   // angle band seen during the framing hold — drift means still setting up
let framedHi = -Infinity;
let loopGen = 0;           // bumped on every start, so an old frame loop cannot outlive its set

const CAL_SECONDS = 15;

// Auto-start used to need half a second in the start position, which is not a test of anything:
// setting a seat, threading a pin and sliding plates on all park you at a bent elbow, and an
// overhead press *starts* at a bent elbow. It armed while the lifter was still setting up and then
// counted the loading as reps.
//
// Stillness is what actually separates "ready" from "busy". Setting up is constant movement; the
// moment before a set is the one moment you are deliberately motionless. So: hold the start
// position, and hold it STILL, for a decent beat.
const FRAMED_FRAMES_NEEDED = 45;  // ~1.5s at 30fps
const FRAMED_STILL_DEG = 8;       // total drift allowed across that hold

const buzz = (pattern) => navigator.vibrate?.(pattern);

function big(title, sub) {
  el.bigmsg.hidden = false;
  el.bigTitle.textContent = title;
  el.bigSub.textContent = sub ?? '';
}
const hideBig = () => { el.bigmsg.hidden = true; };

// Without this the phone screens off mid-set and the camera stops. Re-acquired on resume, because
// Android drops the lock whenever the app goes to the background.
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not fatal */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !running) return;
  keepAwake();
  reviveCamera('resumed');
});

/**
 * Get pictures flowing again after the app was away, or after the camera stalled mid-set.
 *
 * Three things can be broken by the time you come back, and they need fixing in order: the video
 * element is paused, the camera track is dead, and the frame loop is parked. That last one is the
 * reason a stall used to be permanent — requestVideoFrameCallback only fires when a frame arrives,
 * so no pictures means no callback means nothing left running to notice or recover. (Under
 * requestAnimationFrame the loop kept spinning uselessly, which was at least alive.)
 */
async function reviveCamera(reason) {
  if (reviving || !running) return;
  reviving = true;
  try {
    if (el.cam.paused) await el.cam.play().catch(() => {});
    if (!cameraAlive(stream)) {
      el.status.textContent = `Camera ${reason} — restarting`;
      stopCamera(stream);
      stream = await startCamera(el.cam, el.facing.dataset.value);
    }
    // The frame loop cannot restart itself once parked, and the dedupe below would reject the
    // first frames of a fresh stream because currentTime starts over.
    lastVideoTs = -1;
    lastFrameAt = 0;
    startLoop();
  } catch (err) {
    running = false;
    big('Camera lost', `${err.name}: ${err.message}. Tap "Change lift" and start again.`);
  } finally {
    reviving = false;
  }
}

// A stall does not announce itself, so something outside the loop has to watch for one. Cheap,
// and only while a set is actually on screen.
const STALL_MS = 2500;
setInterval(() => {
  if (!running || document.visibilityState !== 'visible') return;
  if (lastFrameAt && performance.now() - lastFrameAt > STALL_MS) reviveCamera('stalled');
}, 1000);

// ── picker ───────────────────────────────────────────────────────────────────────────────

/**
 * Disciplines — the top-level question, above muscle group.
 *
 * Boxing first arrived as one more chip beside Chest and Back, which reads fine with two entries
 * and falls apart with four: "which muscle" and "what kind of training" are different questions,
 * and only one of them applies to a round of shadowboxing.
 *
 * Adding a discipline is an entry here plus its own module. `groups` is the optional second-level
 * filter; `rows` returns what to list, given that filter.
 */
const DISCIPLINES = {
  gym: {
    label: 'Gym',
    groups: ['All', ...GROUPS],
    rows: (f) => Object.entries(EXERCISES)
      .filter(([, ex]) => f === 'All' || ex.group === f)
      .map(([id, ex]) => {
        const s = suggest(id);
        return {
          name: ex.name,
          meta: `${s.sets}×${s.reps} · ${s.load ? `${s.load} kg` : 'bodyweight'}`,
          pick: () => showSetup(id),
        };
      }),
  },
  boxing: {
    label: 'Boxing',
    groups: null,   // rounds, not body parts
    rows: () => Object.entries(MODES).map(([id, m]) => {
      const last = store.read().rounds.filter((r) => r.mode === id).at(-1);
      return {
        name: m.label,
        meta: last ? `last: ${last.punches} punches` : 'rounds',
        pick: () => showBoxing(id),
      };
    }),
  },
};

let discipline = 'gym';

function renderDisciplines() {
  el.disciplines.innerHTML = '';
  for (const [id, d] of Object.entries(DISCIPLINES)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = d.label;
    b.setAttribute('aria-pressed', String(id === discipline));
    b.addEventListener('click', () => {
      discipline = id;
      filter = 'All';
      renderPicker();
    });
    el.disciplines.appendChild(b);
  }
}

function renderGroups() {
  const groups = DISCIPLINES[discipline].groups;
  el.groups.hidden = !groups;
  if (!groups) return;
  el.groups.innerHTML = '';
  for (const g of groups) {
    const b = document.createElement('button');
    b.textContent = g;
    b.setAttribute('aria-pressed', String(g === filter));
    b.addEventListener('click', () => { filter = g; renderGroups(); renderList(); });
    el.groups.appendChild(b);
  }
}

function renderList() {
  el.exlist.innerHTML = '';
  for (const row of DISCIPLINES[discipline].rows(filter)) {
    const b = document.createElement('button');
    b.innerHTML = '<span class="nm"></span><span class="meta"></span>';
    b.querySelector('.nm').textContent = row.name;
    b.querySelector('.meta').textContent = row.meta;
    b.addEventListener('click', row.pick);
    el.exlist.appendChild(b);
  }
}

function renderPicker() {
  renderDisciplines();
  renderGroups();
  renderList();
}

// mindCheck is in here so that leaving Mind mid-questionnaire closes it rather than leaving it
// hanging over whatever you opened next.
const SHEETS = () => [el.today, el.profile, el.picker, el.setup, el.rest, el.settings, el.progress, el.eat, el.boxing, el.devcheck, el.mind, el.mindCheck, el.face];

// ── developer data validation (P0.5) ─────────────────────────────────────────────────────
// Not a product screen. Renders devcheck.inspect() as plain text — see devcheck.js for the logic;
// this is display wiring only, which is why it has no dedicated tests (nothing here computes
// anything, it just calls a tested pure function and drops the string into a <pre>).

function renderDevcheck() {
  const exId = el.devcheckEx.value;
  el.devcheckOut.textContent = exId ? devcheck.render(devcheck.inspect(exId)) : 'No lift selected.';
}

function showDevcheck() {
  show(el.devcheck);
  const lifts = devcheck.trainedExercises();
  el.devcheckEx.innerHTML = lifts.length
    ? lifts.map((id) => `<option value="${id}">${EXERCISES[id]?.name ?? id}</option>`).join('')
    : '<option value="">No training logged yet</option>';
  renderDevcheck();
}

el.btnDevcheck.addEventListener('click', showDevcheck);
el.btnDevcheckBack.addEventListener('click', () => show(el.progress));
el.devcheckEx.addEventListener('change', renderDevcheck);

// ── boxing ───────────────────────────────────────────────────────────────────────────────

let bout = null;          // the configured bout: mode, stance, rounds, work, rest, startedAt
let boutState = null;     // punch detector state, from createBoutState()
let boutRound = 1;        // which round the punches below belong to
let boutPunches = [];     // punches thrown in the current round
let boutPhase = null;     // last phase seen, so transitions fire exactly once
let boutDraft = { ...DEFAULT_BOUT };

/** A real bell beats a synthesised voice saying "round one". Two tones for the end of a bout. */
let audioCtx = null;
function bell(times = 1) {
  try {
    audioCtx ??= new (window.AudioContext ?? window.webkitAudioContext)();
    for (let i = 0; i < times; i += 1) {
      const t0 = audioCtx.currentTime + i * 0.32;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.35, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.32);
    }
  } catch { /* no audio is survivable; the screen still shows the clock */ }
}

function showBoxing(modeId) {
  boutDraft = { ...boutDraft, mode: modeId };
  show(el.boxing);
  const m = MODES[modeId];
  el.boxTitle.textContent = m.label;
  el.boxHint.textContent = m.hint;
  el.boxWarn.textContent = trackingWarning(modeId) ?? '';
  el.inRounds.value = boutDraft.rounds;
  el.inWork.value = boutDraft.workSec;
  el.inRest.value = boutDraft.restSec;

  wireChips(el.boxMode, Object.keys(MODES), boutDraft.mode, (v) => showBoxing(v));
  wireChips(el.boxStance, STANCES, boutDraft.stance, (v) => { boutDraft.stance = v; });
}

async function startBout() {
  el.btnBoxStart.disabled = true;
  el.boxErr.textContent = '';
  try {
    await ensureCamera();
    bout = createBout({
      ...boutDraft,
      rounds: Number(el.inRounds.value) || boutDraft.rounds,
      workSec: Number(el.inWork.value) || boutDraft.workSec,
      restSec: Number(el.inRest.value) || boutDraft.restSec,
    });
    boutState = createBoutState();
    boutRound = 1;
    boutPunches = [];
    boutPhase = null;
    bout.startedAt = performance.now();

    for (const s of SHEETS()) s.hidden = true;
    el.exname.textContent = MODES[bout.mode].label;
    el.reptarget.textContent = 'PUNCHES';
    el.repnum.textContent = '0';
    el.btnEnd.textContent = 'End bout';
    mode = 'boxing';
    running = true;
    keepAwake();
    bell();
    voice.speak(`Round one. Box.`);
    startLoop();
  } catch (err) {
    el.boxErr.textContent = `${err.name}: ${err.message}`;
  } finally {
    el.btnBoxStart.disabled = false;
  }
}

function onBoxingFrame(lm, w, tMs) {
  const at = boutAt(bout, performance.now());

  // Round and phase transitions, each fired exactly once.
  if (at.round !== boutRound) {
    logRound();
    boutRound = at.round;
    boutPunches = [];
  }
  if (at.phase !== boutPhase) {
    if (boutPhase !== null) {
      bell(at.phase === 'done' ? 3 : 1);
      if (at.phase === 'rest') voice.speak(`Break. ${roundStats(boutPunches, bout.workSec).count} punches.`);
      else if (at.phase === 'work') voice.speak(`Round ${at.round}. Box.`);
    }
    boutPhase = at.phase;
  }

  if (at.done) { finishBout(); return; }

  const mmss = `${Math.floor(at.left / 60)}:${String(at.left % 60).padStart(2, '0')}`;
  big(mmss, `Round ${at.round}/${bout.rounds} · ${at.phase === 'work' ? 'BOX' : 'REST'}`);
  el.setinfo.textContent = `Round ${at.round}/${bout.rounds} · ${at.phase.toUpperCase()}`;

  // Between rounds nobody is being judged.
  if (at.phase !== 'work') return;

  const out = boxStep({ lm, w, tMs }, boutState, { mode: bout.mode, stance: bout.stance });
  if (!out.visible) { el.status.textContent = 'Step back into frame'; return; }

  if (out.punch) {
    boutPunches.push(out.punch);
    el.repnum.textContent = String(boutPunches.length);
  }
  const fault = out.faults[0];
  if (fault) {
    showCue(fault.cue);
    buzz(fault.severity === 'safety' ? [90, 60, 90] : [70]);
    voice.speak(fault.cue);
  }
  const s = roundStats(boutPunches, bout.workSec);
  el.status.textContent = `${s.perMinute}/min · ${Math.round(fps)}fps`;
}

function logRound() {
  if (!boutPunches.length && !Object.keys(boutState.faultCounts).length) return;
  const s = roundStats(boutPunches, bout.workSec);
  store.appendRound({
    at: new Date().toISOString(),
    mode: bout.mode,
    stance: bout.stance,
    round: boutRound,
    workSec: bout.workSec,
    punches: s.count,
    perMinute: s.perMinute,
    byKind: s.byKind,
    certainty: Math.round(s.certainty * 100) / 100,
    medianReturnMs: s.medianReturnMs,
    faults: { ...boutState.faultCounts },
  });
  boutState.faultCounts = {};
}

function finishBout() {
  logRound();
  running = false;
  mode = 'live';
  const all = store.read().rounds.slice(-bout.rounds);
  const total = all.reduce((a, r) => a + r.punches, 0);
  const kinds = {};
  for (const r of all) for (const [k, n] of Object.entries(r.byKind ?? {})) kinds[k] = (kinds[k] ?? 0) + n;
  const breakdown = Object.entries(kinds).map(([k, n]) => `${PUNCH_LABELS[k] ?? k} ${n}`).join(' · ');
  big(`${total} punches`, breakdown || 'Bout complete');
  voice.speak(`Bout complete. ${total} punches.`);
  el.btnEnd.textContent = 'Done';
}

function show(sheet) {
  running = false;
  // Every navigation in the app funnels through here, which makes it the only place a front
  // camera cannot be left running by accident. Relying on the back button would mean any other
  // route out — a tab, a deep link, the session finishing — leaves the light on.
  if (sheet !== el.face) face.close();
  for (const s of SHEETS()) s.hidden = s !== sheet;
}

function showPicker() {
  pendingEx = null;
  coach.clear();
  show(el.picker);
  renderPicker();
}

// ── today's plan ─────────────────────────────────────────────────────────────────────────

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function showToday() {
  pendingEx = null;
  coach.clear();
  show(el.today);

  const now = new Date();
  const session = planner.today(now);
  const profile = planner.getProfile();
  el.todayDay.textContent = WEEKDAYS[now.getDay()];
  el.todayGreet.textContent = profile.name ?? '';
  el.todayList.innerHTML = '';
  renderEatCards(profile);

  if (!session) {
    const next = planner.nextTrainingDay(now);
    el.todayName.textContent = 'Rest';
    el.trainStats.textContent = next ? `Next · ${next.session.name} · ${next.day}` : '';
    el.btnStartToday.textContent = 'Train anyway';
    el.btnStartToday.disabled = false;
    el.todayNote.textContent = next
      ? `Next up: ${next.session.name} on ${next.day}. Tap "All lifts" if you want to train anyway.`
      : 'No training days set. Check your profile.';
    return;
  }

  el.todayName.textContent = session.name;
  el.trainStats.textContent = `${session.exercises.length} lifts · ${session.exercises.reduce((a, e) => a + e.sets, 0)} sets`;
  const done = planner.doneToday(session, now);
  const left = session.exercises.filter((e) => !done.has(e.exId));
  el.btnStartToday.textContent = left.length ? `Start · ${left[0].name}` : 'Session complete';
  el.btnStartToday.disabled = !left.length;

  session.exercises.forEach((item, i) => {
    const b = document.createElement('button');
    b.innerHTML = '<span class="no"></span><span class="nm"></span><span class="meta"></span>';
    // Numbered, because the order is the plan — and a ticked number reads as progress down a list
    // in a way that six identical tiles never did.
    b.querySelector('.no').textContent = done.has(item.exId) ? '✓' : String(i + 1).padStart(2, '0');
    b.querySelector('.nm').textContent = item.name;
    // Value then unit, the way the design sets an instrument reading: 4×8 REPS.
    const meta = b.querySelector('.meta');
    meta.textContent = done.has(item.exId) ? '' : `${item.sets}×${item.reps}`;
    const unit = document.createElement('span');
    unit.className = 'u';
    unit.textContent = done.has(item.exId) ? 'Done' : 'reps';
    meta.appendChild(unit);
    if (done.has(item.exId)) b.classList.add('done');
    b.addEventListener('click', () => showSetup(item.exId, item));
    el.todayList.appendChild(b);
  });
  const notes = [];
  notes.push(left.length ? `${left.length} of ${session.exercises.length} to go.` : 'Session complete. Good work.');

  // Anything today that you hammered less than 48h ago.
  for (const w of insights.recoveryWarnings(session, now)) {
    notes.push(`${w.group} was trained ${w.hoursAgo}h ago — still recovering.`);
  }
  // Lifts the log says you are stuck on; progression will back them off after this session.
  const stalled = session.exercises.filter((e) => insights.shouldDeload(e.exId)).map((e) => e.name);
  if (stalled.length) notes.push(`Stalled: ${stalled.join(', ')}. Dropping the weight to rebuild.`);

  el.todayNote.textContent = notes.join(' ');
}

const node = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

// ── eat ──────────────────────────────────────────────────────────────────────────────────

let foodCat = 'Protein';

/** The three food cards on the dashboard: calories, meal ticks, protein, bodyweight. */
function renderEatCards(profile = planner.getProfile()) {
  const entries = nutrition.dayEntries();
  const t = nutrition.targets(profile);
  const have = nutrition.totals(entries);

  // No 'under' class: being short of protein at 2pm is the normal state of a day, and a greyed
  // bar reads as failed. The width already says how far along you are.
  const pct = Math.round((have.protein / t.protein) * 100);
  el.proteinNow.innerHTML = `${have.protein}<small> / ${t.protein}g</small>`;
  el.proteinFill.style.width = `${Math.min(100, pct)}%`;
  el.proteinFill.style.background = 'var(--eat)';

  // Bodyweight: the number is the profile's, the history is what makes it mean anything.
  const trend = nutrition.weightTrend();
  const kg = trend.now ?? profile.bodyweight;
  el.weightNow.innerHTML = `${kg}<small> kg${trend.change === null ? '' : ` · ${trend.change > 0 ? '+' : ''}${trend.change}`}</small>`;
  el.weightSpark.innerHTML = '';
  el.weightSpark.appendChild(sparkline(trend.points.map((p) => p.kg)));

  // Sets this week, against the range that actually grows anything.
  const volume = insights.summary().volume;
  const vol = Object.values(volume).reduce((a, b) => a + b, 0);
  el.weekSets.textContent = String(vol);
  el.weekSub.textContent = vol ? `${Object.keys(volume).length} groups` : 'nothing yet';

  renderCoachLine(profile);
}

const SVG = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs) => {
  const n = document.createElementNS(SVG, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};

/**
 * Bodyweight against calories over 28 days.
 *
 * Two series, two completely different units, so each is scaled to its own range inside the same
 * box — this chart is for reading DIRECTION, not values. Gaps stay gaps: a day you logged nothing
 * breaks the line rather than dropping it to zero.
 */
/** The home screen's one sentence, plus the target suggestion if the scale has earned one. */
function renderCoachLine(profile) {
  const series = nutrition.dailySeries(28);
  const trend = nutrition.weightTrend(28);
  el.coachDrift.textContent = trend.change === null ? ''
    : `${trend.change > 0 ? '↗' : trend.change < 0 ? '↘' : '→'} ${trend.change > 0 ? '+' : ''}${trend.change} kg`;
  el.coachDrift.style.color = trend.change === null ? 'var(--on-surface-variant)' : 'var(--eat)';
  el.coachLine.textContent = nutrition.coachLine(profile, series);

  const s = nutrition.suggestion(profile, series);
  el.coachSuggest.hidden = !s && !profile.kcalTarget;
  el.btnAcceptTarget.hidden = !s;
  el.btnResetTarget.hidden = !profile.kcalTarget;
  if (s) {
    // Phrased against what is being EATEN. "Down 485" next to "eat more" is how you get someone
    // to distrust the whole screen.
    const move = s.eatingDelta > 0 ? `${s.eatingDelta} more` : `${Math.abs(s.eatingDelta)} less`;
    el.suggestText.textContent = `You are ${s.reason}. You have averaged ${s.eating} kcal a day — ${move} would do it.`;
    el.btnAcceptTarget.textContent = `Use ${s.to} kcal`;
  } else if (profile.kcalTarget) {
    el.suggestText.textContent = `Target set from your own numbers: ${profile.kcalTarget} kcal a day.`;
  }
}

/** Bodyweight against calories. Lives on Stats: it is a sit-down read, not a between-sets one. */
function renderCoach(profile) {
  const series = nutrition.dailySeries(28);
  const chart = el.coachChart;
  if (!chart) return;
  chart.innerHTML = '';

  const W = 320, H = 150, PAD = 8;
  for (let i = 0; i <= 3; i += 1) {
    const y = PAD + ((H - PAD * 2) / 3) * i;
    chart.appendChild(svgEl('line', { class: 'grid', x1: 0, x2: W, y1: y, y2: y }));
  }

  const x = (i) => (i / (series.length - 1)) * (W - PAD * 2) + PAD;
  const yFor = (lo, hi) => (v) => H - PAD - ((v - lo) / (hi - lo || 1)) * (H - PAD * 2);

  /**
   * The two series are scaled differently on purpose.
   *
   * Bodyweight gets its own min/max, because 2 kg over a month IS the whole story and would be a
   * flat line on any absolute scale. Calories are scaled from zero against the TARGET, because
   * auto-scaling them makes a normal 400 kcal swing look like a crisis — and against the target
   * you can see the one thing that matters, which is whether you are under it.
   */
  const scaler = (key, vals) => {
    if (key === 'kg') {
      const lo = Math.min(...vals), hi = Math.max(...vals);
      const span = hi - lo || Math.max(1, hi * 0.1);
      return yFor(lo - span * 0.15, hi + span * 0.15);
    }
    return yFor(0, Math.max(targetKcal * 1.4, Math.max(...vals) * 1.1));
  };

  const targetKcal = nutrition.targets(profile).kcal;

  /**
   * Points to join up.
   *
   * Calories break at a gap: a day with no food logged is missing data, and drawing through it
   * would invent a meal. Bodyweight joins straight across, because nobody weighs in daily and
   * two weigh-ins a week apart genuinely do describe the line between them.
   */
  const runs = (key) => {
    const points = series.map((d, i) => ({ i, v: d[key] })).filter((p) => p.v !== null);
    if (key === 'kg') return points.length ? [points] : [];
    const out = [];
    let run = [];
    series.forEach((d, i) => {
      if (d[key] === null) { if (run.length) out.push(run); run = []; return; }
      run.push({ i, v: d[key] });
    });
    if (run.length) out.push(run);
    return out;
  };

  for (const [key, cls] of [['kcal', 'kcal'], ['kg', 'kg']]) {
    const all = series.filter((d) => d[key] !== null).map((d) => d[key]);
    if (!all.length) continue;
    const y = scaler(key, all);
    // The line you are aiming at, so "under target" is something you can see rather than compute.
    if (key === 'kcal') {
      chart.appendChild(svgEl('line', { class: 'target', x1: 0, x2: W, y1: y(targetKcal), y2: y(targetKcal) }));
    }
    for (const run of runs(key)) {
      if (run.length > 1) {
        chart.appendChild(svgEl('polyline', { class: cls, points: run.map((p) => `${x(p.i)},${y(p.v)}`).join(' ') }));
      }
      // Every weigh-in is a real measurement, so mark each one. A single lone point would
      // otherwise draw nothing at all.
      if (key === 'kg') {
        for (const p of run) chart.appendChild(svgEl('circle', { class: 'dot', cx: x(p.i), cy: y(p.v), r: 2.5 }));
        const last = run.at(-1);
        chart.appendChild(svgEl('circle', { class: 'dot', cx: x(last.i), cy: y(last.v), r: 4 }));
      }
    }
  }

  const trend = nutrition.weightTrend(28);
  el.trendDrift.textContent = trend.change === null ? ''
    : `${trend.change > 0 ? '↗' : trend.change < 0 ? '↘' : '→'} ${trend.change > 0 ? '+' : ''}${trend.change} kg`;
  el.trendDrift.style.color = trend.change === null ? 'var(--on-surface-variant)' : 'var(--eat)';
}

el.btnAcceptTarget.addEventListener('click', () => {
  const s = nutrition.suggestion(planner.getProfile());
  if (!s) return;
  planner.setProfile({ kcalTarget: s.to });
  buzz(20);
  showToday();
});

el.btnResetTarget.addEventListener('click', () => {
  planner.setProfile({ kcalTarget: null });
  showToday();
});

/** A 28-day bodyweight line. Two points is enough to draw; one is just a dot, so show the
 *  placeholder until there is something to see. */
function sparkline(values) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'spark');
  svg.setAttribute('viewBox', '0 0 100 36');
  svg.setAttribute('preserveAspectRatio', 'none');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  if (values.length < 2) {
    path.setAttribute('class', 'empty');
    path.setAttribute('points', '2,30 98,30');
  } else {
    const lo = Math.min(...values);
    const span = Math.max(...values) - lo || 1;
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'var(--eat)');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('points', values.map((v, i) => {
      const x = (i / (values.length - 1)) * 96 + 2;
      return `${x.toFixed(1)},${(32 - ((v - lo) / span) * 28).toFixed(1)}`;
    }).join(' '));
  }
  svg.appendChild(path);
  return svg;
}

function showEat() {
  show(el.eat);
  renderEat();
}

/** Eating, on the stats screen: hitting protein is a habit, so the useful number is how many days
 *  you hit it — not what today looks like, which the dashboard already shows. */
function renderEatStats(body) {
  const profile = planner.getProfile();
  const series = nutrition.dailySeries(14);
  const logged = series.filter((d) => d.kcal !== null);
  if (!logged.length) return;

  const t = nutrition.targets(profile);
  const hit = logged.filter((d) => d.protein >= t.protein).length;
  const avgKcal = Math.round(logged.reduce((a, d) => a + d.kcal, 0) / logged.length);
  const avgProtein = Math.round(logged.reduce((a, d) => a + d.protein, 0) / logged.length);

  const card = node('div', 'card');
  card.append(node('h2', null, 'Eating'));
  card.append(line('Protein hit', `${hit} of ${logged.length} days`, hit / logged.length >= 0.7 ? '' : 'warn'));
  card.append(line('Average protein', `${avgProtein} g`));
  card.append(line('Average calories', `${avgKcal} kcal`));
  card.append(node('p', 'muted data', `${logged.length} of the last 14 days logged`));
  body.append(card);
}

function renderEat() {
  const profile = planner.getProfile();
  const entries = nutrition.dayEntries();
  const t = nutrition.targets(profile);
  const have = nutrition.totals(entries);

  // Today against target, one bar per macro.
  el.eatMacros.innerHTML = '';
  el.eatMacros.append(node('h2', null, 'Today'));
  for (const k of nutrition.MACROS) {
    const bar = node('div', 'bar');
    const track = node('div', 'track');
    const fill = node('div', 'fill');
    const pct = (have[k] / t[k]) * 100;
    fill.style.width = `${Math.min(100, pct)}%`;
    fill.style.background = 'var(--eat)';
    // Only calories can be genuinely over. Being past your protein target is not a problem, and
    // colouring it like one trains people to stop at the number.
    if (k === 'kcal' && pct > 105) fill.classList.add('over');
    track.append(fill);
    bar.append(node('span', 'name', k === 'kcal' ? 'kcal' : k), track, node('span', 'n', `${have[k]}`));
    el.eatMacros.appendChild(bar);
  }
  el.eatMacros.append(node('p', 'muted data', nutrition.verdict(profile, entries)));

  // Water. Counted from anything with a volume, so the tea counts without being thought about.
  const ml = nutrition.fluid(entries);
  const wantMl = nutrition.waterTarget(profile);
  el.waterNow.innerHTML = `${(ml / 1000).toFixed(1)}<small> / ${(wantMl / 1000).toFixed(1)} L</small>`;
  el.waterFill.style.width = `${Math.min(100, (ml / wantMl) * 100)}%`;
  el.waterFill.style.background = 'var(--eat)';

  // What you have already eaten, newest first. Removal is its own button rather than the whole
  // row: a mis-tap on a list you are only reading should not delete your lunch.
  const foods = nutrition.allFoods();
  el.eatToday.innerHTML = '';
  for (const e of [...entries].reverse()) {
    const f = foods[e.foodId];
    if (!f) continue;
    const row = node('div', 'foodrow logged');
    const text = node('span', 'nm');
    text.append(node('div', null, f.name), node('div', null, `${nutrition.mealSlot(e.at)} · ${e.qty} × ${f.serving}`));
    const drop = node('button', null, '×');
    drop.type = 'button';
    drop.setAttribute('aria-label', `Remove ${f.name}`);
    drop.addEventListener('click', () => { store.removeMeal(e.at); buzz(10); renderEat(); });
    // Protein is the number worth showing for food; for a glass of water it is "0g P", which is
    // just noise. Anything with no protein but a volume reports the volume instead.
    const figure = f.protein ? `${Math.round(f.protein * e.qty)}g P`
      : f.ml ? `${Math.round(f.ml * e.qty)} ml`
      : `${Math.round(f.kcal * e.qty)} kcal`;
    row.append(text, node('span', 'qty', figure), drop);
    el.eatToday.appendChild(row);
  }
  if (!entries.length) el.eatToday.append(node('p', 'muted', 'Nothing yet today.'));

  // Category chips, with your most-eaten foods as the first tab.
  el.eatCats.innerHTML = '';
  for (const c of ['Usual', ...nutrition.FOOD_CATS]) {
    const b = node('button', null, c);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(c === foodCat));
    b.addEventListener('click', () => { foodCat = c; renderEat(); });
    el.eatCats.appendChild(b);
  }

  const ids = foodCat === 'Usual'
    ? nutrition.frequent(12).map((f) => f.foodId)
    : Object.keys(foods).filter((id) => foods[id].cat === foodCat);

  el.eatList.innerHTML = '';
  if (!ids.length) {
    el.eatList.append(node('p', 'muted', 'Nothing here yet. Log a few meals and your usuals collect here.'));
  }
  for (const id of ids) {
    const f = foods[id];
    const row = node('div', 'foodrow');
    const add = document.createElement('button');
    add.innerHTML = '<span class="nm"><div></div><div></div></span>';
    const [nm, sub] = add.querySelectorAll('.nm div');
    nm.textContent = f.name;
    sub.textContent = `${f.serving} · ${f.protein}g P · ${f.kcal} kcal`;
    add.style.flex = '1';
    add.addEventListener('click', () => logFood(id, 1));

    // Half and double servings, because "one and a bit" is how food actually arrives.
    const half = node('button', null, '½');
    half.type = 'button';
    half.addEventListener('click', () => logFood(id, 0.5));
    const twice = node('button', null, '×2');
    twice.type = 'button';
    twice.addEventListener('click', () => logFood(id, 2));

    row.append(add, half, twice);
    el.eatList.appendChild(row);
  }
}

function logFood(foodId, qty) {
  store.appendMeal({ at: new Date().toISOString(), foodId, qty });
  buzz(10);
  renderEat();
}

// A glass is the unit water is stored in, so a bottle is two of them and a litre is four. Keeping
// one food rather than three means removing a mis-tap works the same as for anything else.
el.waterAdd.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) logFood('water', Number(b.dataset.ml) / nutrition.FOODS.water.ml);
});

/** Write the food, log one of it, and put the form back. */
function commitFood(id, food) {
  store.saveFood(id, food);
  el.foodErr.textContent = '';
  el.foodClash.hidden = true;
  el.fName.value = '';
  el.fServing.value = '';
  for (const input of [el.fKcal, el.fProtein, el.fCarbs, el.fFat]) input.value = 0;
  el.eatCustom.open = false;
  logFood(id, 1);
}

el.btnSaveFood.addEventListener('click', () => {
  const name = el.fName.value.trim();
  const kcal = Number(el.fKcal.value) || 0;
  if (!name) { el.foodErr.textContent = 'Give it a name.'; return; }
  if (!kcal) { el.foodErr.textContent = 'Calories cannot be zero.'; return; }

  const food = {
    name,
    serving: el.fServing.value.trim() || '1 serving',
    cat: 'Other',
    kcal,
    protein: Number(el.fProtein.value) || 0,
    carbs: Number(el.fCarbs.value) || 0,
    fat: Number(el.fFat.value) || 0,
  };
  const id = nutrition.foodId(name);

  // Saving over a food you have already eaten rewrites those meals too, because a meal stores the
  // id and not the numbers. Usually that is what you want — you are fixing an estimate. Sometimes
  // the recipe changed and last month's dinners should stay as they were. Only you know which.
  const used = nutrition.usageCount(id);
  if (nutrition.allFoods()[id] && used > 0) {
    el.foodClash.hidden = false;
    el.foodClashText.textContent =
      `You have logged "${nutrition.allFoods()[id].name}" ${used} time${used > 1 ? 's' : ''} already. Changing it changes ${used === 1 ? 'that entry' : 'those entries'} too.`;
    pendingFood = { id, food, name };
    return;
  }
  commitFood(id, food);
});

let pendingFood = null;

el.btnFoodOverwrite.addEventListener('click', () => {
  if (pendingFood) commitFood(pendingFood.id, pendingFood.food);
  pendingFood = null;
});

el.btnFoodSeparate.addEventListener('click', () => {
  if (!pendingFood) return;
  const fresh = nutrition.uniqueFoodId(pendingFood.name);
  commitFood(fresh.id, { ...pendingFood.food, name: fresh.name });
  pendingFood = null;
});

el.btnEatTab.addEventListener('click', showEat);
el.btnEatBack.addEventListener('click', showToday);
el.btnEatDone.addEventListener('click', showToday);
// Bodyweight lives in the profile because it scales the lifts too — so "+ Log" goes there and
// puts the cursor on the one field you came to change.
el.btnLogWeight.addEventListener('click', () => {
  showProfile();
  el.inBw.focus();
  el.inBw.select();
});

// The strip is three readouts, and each one is a door to the screen it came from.
el.btnStripProtein.addEventListener('click', showEat);
el.btnStripWeek.addEventListener('click', showProgress);

// ── progress ─────────────────────────────────────────────────────────────────────────────


function line(k, v, cls) {
  const row = node('div', 'line');
  row.append(node('span', 'k', k), node('span', `v ${cls ?? ''}`.trim(), v));
  return row;
}

/**
 * The three lifestyle inputs that move testosterone, read out of data already logged.
 *
 * There is no number here on purpose. Nothing on a phone measures a hormone, and a "T score" from
 * sleep and training would be a fabrication with a decimal point on it. This says only whether
 * you are doing the things that help — which is a smaller claim, and a true one.
 */
function renderTInputs(body) {
  const { log, rounds, weights } = store.read();
  const r = tInputs.read({ days: store.days(), weights, log, rounds }, store.dayKey, store.shiftKey);

  const card = node('div', 'card');
  card.append(node('span', 'cardlabel', `Testosterone inputs · ${tInputs.WINDOW} days`));

  const row = (name, value, verdict) => {
    const line = node('div', 'line');
    line.append(node('span', 'k', name));
    const v = node('span', 'v', value);
    if (verdict === 'low') v.classList.add('warn');
    if (verdict === 'good') v.classList.add('up');
    if (verdict === 'unknown') v.classList.add('flat');
    line.append(v);
    card.append(line);
  };

  row('Sleep', r.sleep.verdict === 'unknown' ? `${r.sleep.nights} nights logged` : `${r.sleep.avg}h`, r.sleep.verdict);
  row('Training days', String(r.training.days), r.training.verdict);
  row(
    'Weight',
    r.weight.verdict === 'unknown' ? 'not enough weigh-ins' : `${r.weight.kg >= 0 ? '+' : '−'}${Math.abs(r.weight.kg)} kg`,
    r.weight.verdict === 'unknown' ? 'unknown' : null,
  );

  const line = r.advice.text ? node('p', 'coachline', r.advice.text) : null;
  if (line) card.append(line);

  // Stats diagnoses, Mind acts, and until now they never spoke. Handing the plan straight to
  // tomorrow's list closes the loop: flagged here, ticked there, and the input it was about
  // moves on its own — which is the only way this card ever changes.
  if (r.advice.plan) {
    const key = store.shiftKey(1);
    const planned = () => store.day(key).plans.some((p) => p.text === r.advice.plan);
    const btn = node('button', 'train', planned() ? 'Already in tomorrow' : 'Add to tomorrow');
    btn.disabled = planned();
    btn.addEventListener('click', () => {
      store.patchDay({ plans: [...store.day(key).plans, { text: r.advice.plan, done: false }] }, key);
      btn.textContent = 'Added to tomorrow';
      btn.disabled = true;
    });
    card.append(btn);
  }

  if (line) {
    const ask = node('button', null, 'Ask why');
    ask.addEventListener('click', () => { show(el.mind); mood.openTalk(question(r)); });
    card.append(ask);
  }

  card.append(node('p', 'muted',
    'These are inputs, not a reading. Nothing here measures testosterone — no app can, and one '
    + 'that claims to is guessing. That is a morning blood test, twice, read by a doctor. Weight '
    + 'is shown as direction only, because the evidence is about body fat and this app does not '
    + 'know yours.'));

  body.append(card);
  if (line) rephrase(r, line);
}

/** The facts the model is allowed to see: conclusions only, never the underlying log. */
const factsFor = (r) => ({
  windowDays: tInputs.WINDOW,
  sleepAverageHours: r.sleep.avg ?? null,
  nightsLogged: r.sleep.nights,
  trainingDays: r.training.days,
  weightChangeKg: r.weight.verdict === 'known' ? r.weight.kg : null,
  action: r.advice.plan,
  currentWording: r.advice.text,
});

/**
 * Swap the template line for one written about this specific person.
 *
 * Fire-and-forget on purpose: the correct sentence is already on screen, so a slow or failed
 * call costs nothing and shows nothing. Cached against the facts, so opening Stats four times in
 * an evening is one request, not four.
 */
async function rephrase(r, line) {
  const key = store.getSetting('geminiKey', '');
  if (!key) return;
  const facts = factsFor(r);
  const cacheKey = JSON.stringify(facts);
  const cached = store.getSetting('adviceCache', null);
  if (cached?.key === cacheKey) { line.textContent = cached.text; return; }

  const text = await phrase(key, facts);
  if (!text) return; // template stays; never a spinner that resolves to nothing
  store.setSetting('adviceCache', { key: cacheKey, text });
  line.textContent = text;
}

/** Hands the check-in the same numbers, so "why" is answered about you and not in general. */
function question(r) {
  const bits = [];
  if (r.sleep.avg != null) bits.push(`sleeping ${r.sleep.avg}h on average`);
  bits.push(`${r.training.days} training days`);
  if (r.weight.verdict === 'known') bits.push(`weight ${r.weight.kg >= 0 ? 'up' : 'down'} ${Math.abs(r.weight.kg)}kg`);
  return `Last ${tInputs.WINDOW} days: ${bits.join(', ')}. The app says my next move is "${r.advice.plan ?? r.advice.text}". Why that one first?`;
}

function showProgress() {
  show(el.progress);
  const s = insights.summary();
  // Only the generated part is rebuilt; the trend chart above it is markup, not output.
  const body = el.progressDyn;
  body.innerHTML = '';
  renderCoach(planner.getProfile());

  renderEatStats(body);
  // Before the early return below: this reads sleep and weight too, so it has something to say
  // on a phone that has logged nights but not yet finished a set.
  renderTInputs(body);

  if (!s.totalSets) {
    body.append(node('p', 'muted', 'Nothing logged yet. Finish a set and this fills up.'));
    return;
  }

  // Weekly volume — hard sets per muscle group against the 10–20 productive range.
  const vol = node('div', 'card');
  vol.append(node('h2', null, 'This week'));
  vol.append(node('p', 'muted data', `${s.totalSets} sets logged all time`));
  for (const [group, n] of Object.entries(s.volume)) {
    const bar = node('div', 'bar');
    const track = node('div', 'track');
    const fill = node('div', 'fill');
    fill.style.width = `${Math.min(100, (n / 25) * 100)}%`;
    if (n < insights.VOLUME_TARGET.low) fill.classList.add('under');
    if (n > insights.VOLUME_TARGET.high) fill.classList.add('over');
    track.append(fill);
    bar.append(node('span', 'name', group), track, node('span', 'n', String(n)));
    vol.append(bar);
  }
  vol.append(node('p', 'muted data', `Target ${insights.VOLUME_TARGET.low}–${insights.VOLUME_TARGET.high} sets per group`));
  body.append(vol);

  // Per-lift strength and stalls.
  for (const lift of s.lifts) {
    const card = node('div', 'card');
    // A lift is a name, not a section label — set like the key-lift rows in the design.
    card.append(node('h2', 'name', lift.name));
    if (lift.strength) {
      const { current, changePct, days, sessions } = lift.strength;
      card.append(line('Est. 1RM', `${current} kg`));
      card.append(line('Change', `${changePct >= 0 ? '+' : ''}${changePct}% in ${days}d`,
        changePct > 0 ? 'up' : changePct < 0 ? 'warn' : 'flat'));
      card.append(line('Sessions', String(sessions)));
    } else {
      card.append(line('Est. 1RM', 'needs 2 sessions', 'flat'));
    }
    if (lift.deload) card.append(line('Stalled', `${lift.stalled} sessions — deloading`, 'warn'));
    else if (lift.stalled > 1) card.append(line('Stalled', `${lift.stalled} sessions`, 'flat'));
    if (lift.topFault) {
      card.append(line('Weak point', `${lift.topFault.label} (${Math.round(lift.topFault.share * 100)}%)`, 'warn'));
    }
    addDecision(card, lift.exId);
    body.append(card);
  }

  // What you get told off for most, across everything.
  if (s.faults.length) {
    const f = node('div', 'card');
    f.append(node('h2', null, 'Most common corrections'));
    for (const x of s.faults) f.append(line(x.label, `${x.count}`, 'warn'));
    body.append(f);
  }
}

// ── why did it decide that? ──────────────────────────────────────────────────────────────
//
// Lives on the Progress card rather than the rest screen, and that placement is a consequence of
// how progression works rather than a preference. On the rest screen the verdict is deliberately
// still a PREVIEW — coach.js splits decide from commit so a miscounted rep can be corrected with
// the ± buttons, and nothing is written until you leave. Explaining a decision that the next tap
// can still change would be explaining something that did not happen. Here the verdict is recorded,
// final, and the numbers behind it are exactly the ones it was made from.
//
// This is NOT a second chat. One question, one short answer, no conversation, no history — the
// same shape as the Stats line's phrase() call, and it degrades the same way: the app's own
// deterministic explanation is what appears if anything at all goes wrong.

const DECIDED = { progress: 'Moved up', hold: 'Held', deload: 'Deloaded' };

function addDecision(card, exId) {
  const v = store.lastVerdict(exId);
  // No recorded decision means no button. Every lift trained before verdicts were kept is in this
  // state, and an "Explain" button that can only apologise is worse than no button.
  if (!v) return;

  card.append(line('Last decision', `${DECIDED[v.decision] ?? v.decision} — ${v.reason}`,
    v.decision === 'progress' ? 'up' : v.decision === 'deload' ? 'warn' : 'flat'));

  const btn = node('button', null, 'Explain this decision');
  const out = node('p', 'muted data');
  out.style.textAlign = 'left';
  btn.addEventListener('click', () => runExplain(exId, btn, out));
  card.append(btn, out);
}

async function runExplain(exId, btn, out) {
  const key = store.getSetting('geminiKey', '');
  btn.disabled = true;

  // With no key this IS the feature, in full, instantly. The model rewords; it never knows anything
  // the arithmetic did not already know.
  if (!key) {
    out.textContent = explain.plainly(exId);
    btn.remove();
    return;
  }

  btn.textContent = 'Checking the numbers…';
  const r = await explain.explainDecision(exId, (ev, feedback) => askModel(key, ev, undefined, feedback));
  btn.remove();
  out.innerHTML = '';

  if (r.status === 'ok') {
    for (const o of r.answer.observed) out.append(node('p', null, o));
    // The model's reading, labelled as one. Observation and interpretation arrive in separate
    // fields precisely so the screen does not have to guess which is which.
    if (r.answer.meaning) out.append(node('p', 'muted', `What that suggests: ${r.answer.meaning}`));
    if (r.answer.suggestion) out.append(node('p', 'muted', r.answer.suggestion));
    return;
  }

  // Failed closed. The answer that did not check out is discarded whole — not trimmed, not shown
  // with the bad clause removed — and the recorded version stands in its place.
  out.append(node('p', null, explain.plainly(exId)));
  out.append(node('p', 'muted', r.status === 'unverified'
    ? 'Part of the written answer used numbers that are not in your record, so it was thrown away. The above is straight from what was logged.'
    : 'Could not reach the model, so this is straight from what was logged.'));
}

// ── profile ──────────────────────────────────────────────────────────────────────────────

const LABELS = {
  barbell: 'Barbell', dumbbell: 'Dumbbell', cable: 'Cable machine', bodyweight: 'Bodyweight',
  shoulder: 'Shoulder', elbow: 'Elbow', lowerBack: 'Lower back', knee: 'Knee',
  // Boxing modes and stances go through the same chip renderer, and without these the chips
  // read "shadow", "bag", "pads" — the internal ids, straight on screen.
  shadow: MODES.shadow.label, bag: MODES.bag.label, pads: MODES.pads.label,
  orthodox: 'Orthodox', southpaw: 'Southpaw',
  lite: 'Lite', full: 'Full',
};

/** Chip group behaviour. `data-multi` on the container toggles; otherwise it's a radio. */
function wireChips(container, values, selected, onChange) {
  container.innerHTML = '';
  const multi = container.hasAttribute('data-multi');
  for (const v of values) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.value = v;
    b.textContent = LABELS[v] ?? v;
    container.appendChild(b);
  }
  const paint = () => {
    for (const b of container.querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(multi ? selected.includes(b.dataset.value) : selected === b.dataset.value));
    }
  };
  container.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (multi) {
      selected = selected.includes(b.dataset.value)
        ? selected.filter((x) => x !== b.dataset.value)
        : [...selected, b.dataset.value];
    } else {
      selected = b.dataset.value;
    }
    paint();
    onChange(selected);
  });
  paint();
}

let draft = null;

function showProfile() {
  show(el.profile);
  draft = planner.getProfile();
  el.inName.value = draft.name ?? '';
  el.inBw.value = draft.bodyweight;
  el.inDays.value = draft.daysPerWeek;

  // These three are static markup, so wire them by value rather than rebuilding.
  for (const [container, key] of [[el.pExperience, 'trainingAge'], [el.pGoal, 'goal']]) {
    for (const b of container.querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.value === draft[key]));
      b.onclick = () => {
        draft[key] = b.dataset.value;
        for (const o of container.querySelectorAll('button')) {
          o.setAttribute('aria-pressed', String(o === b));
        }
      };
    }
  }
  el.inBar.value = draft.bar;
  wireChips(el.pEquipment, EQUIPMENT, [...draft.equipment], (v) => { draft.equipment = v; checkProfile(); });
  wireChips(el.pInjuries, INJURIES, [...draft.injuries], (v) => { draft.injuries = v; checkProfile(); });

  // Which model this phone can afford is a measurement, not an opinion — so show the number.
  wireChips(el.pModel, Object.keys(MODELS), store.getSetting('model', 'lite'), (v) => {
    store.setSetting('model', v);
    describeModel();
  });
  describeModel();
  // Chip values come back as strings; plates are arithmetic, so they go back to numbers here.
  wireChips(el.pPlates, PLATE_SIZES, draft.plates.map(String), (v) => {
    draft.plates = v.map(Number).sort((a, b) => b - a);
    checkProfile();
  });
  checkProfile();
}

/** Every plate size a gym might stock, largest first. */
const PLATE_SIZES = [25, 20, 15, 10, 5, 2.5, 1.25];
/** Deselecting every plate would leave a bar that can only ever be its own weight. */
const DEFAULT_PLATES = planner.DEFAULT_PROFILE.plates;

/** Report the last measured frame rate, so the model choice is made against evidence. */
function describeModel() {
  const chosen = store.getSetting('model', 'lite');
  const measured = store.getSetting(`fps.${chosen}`, null);
  const parts = [MODELS[chosen].label];
  if (measured) {
    parts.push(`${measured} fps measured on this phone`);
    if (measured < 18) parts.push('below 20 is too slow to catch a fast rep — switch back to Lite');
  } else {
    parts.push('train one set to measure it');
  }
  el.modelNote.textContent = parts.join(' · ');
}

/** Equipment and injuries can between them leave a muscle group with nothing to train. */
function checkProfile() {
  const usable = planner.available(draft);
  const empty = GROUPS.filter((g) => !usable.some((id) => EXERCISES[id].group === g));
  el.profileWarn.textContent = !usable.length
    ? 'That leaves no exercises at all. Add some equipment.'
    : empty.length ? `Nothing left for: ${empty.join(', ')}. Those days will be shorter.` : '';

  // Plates go on in pairs, so the smallest jump you can make is twice your smallest plate — and
  // that, not a preference, is what decides how finely the app is allowed to add weight.
  const bar = Number(el.inBar.value) || draft.bar;
  el.plateNote.textContent = draft.plates.length
    ? `Smallest jump: ${planner.barbellStep({ ...draft, bar })} kg. ${planner.loadoutText(bar + planner.barbellStep({ ...draft, bar }), { ...draft, bar })}.`
    : 'Pick at least one plate, or nothing can go on the bar.';
}

function showSetup(exId, prefill = null) {
  pendingEx = exId;
  cameFromToday = !el.today.hidden;
  const ex = EXERCISES[exId];
  const s = { ...suggest(exId), ...(prefill ?? {}) };
  el.setupEx.textContent = ex.name;
  el.setupHint.textContent = ex.cameraHint;
  el.inSets.value = s.sets;
  el.inReps.value = s.reps;
  el.inLoad.value = s.load;

  const done = store.history(exId).slice(-3);
  const notes = [done.length
    ? `Last time: ${done.map((d) => d.reps).join(', ')} reps at ${done.at(-1).load} kg.`
    : 'First time on this lift.'];

  // Tell them their own weak point before the set, when they can still do something about it.
  const fault = insights.faultFingerprint(exId)[0];
  if (fault && fault.share > 0.3) {
    notes.push(`Watch: ${fault.label.toLowerCase()} — ${Math.round(fault.share * 100)}% of your corrections here.`);
  }
  const str = insights.strength(exId);
  if (str && str.changePct) notes.push(`Est. 1RM ${str.current} kg, ${str.changePct >= 0 ? '+' : ''}${str.changePct}%.`);
  el.setupLast.textContent = notes.join(' ');
  syncWarmupRow();

  // Being corrected mid-rep is a bad way to learn a movement and a worse way to learn it under
  // load, so the first time you ever do a lift you get told how before you start. "First time" is
  // just an empty log for it — no extra state to keep in sync.
  renderHowto(exId, done.length === 0);

  show(el.setup);
}

function renderHowto(exId, autoOpen) {
  const lines = technique.lines(exId);
  el.btnHowto.hidden = !lines.length;
  el.howto.hidden = !lines.length || !autoOpen;
  // Stacked, not the k/v `line()` used elsewhere: these are sentences, and squashing a sentence
  // into a right-aligned mono column makes it unreadable.
  el.howtoBody.innerHTML = '';
  for (const [label, text] of lines) {
    const block = node('div', 'howto-step');
    block.append(node('span', 'k', label), node('p', null, text));
    el.howtoBody.append(block);
  }
  el.btnHowto.textContent = el.howto.hidden ? 'How to do this lift' : 'Hide';

  if (autoOpen && lines.length) {
    voice.speak(technique.script(exId, EXERCISES[exId].cameraHint));
  }
}

el.btnHowto.addEventListener('click', () => {
  el.howto.hidden = !el.howto.hidden;
  el.btnHowto.textContent = el.howto.hidden ? 'How to do this lift' : 'Hide';
});

el.btnHowtoSpeak.addEventListener('click', () => {
  if (pendingEx) voice.speak(technique.script(pendingEx, EXERCISES[pendingEx].cameraHint));
});

/** Warm-ups only make sense on heavy compounds, so hide the toggle when it would do nothing. */
function syncWarmupRow() {
  const eligible = pendingEx && warmupsFor(pendingEx, Number(el.inLoad.value) || 0).length > 0;
  el.warmupRow.hidden = !eligible;
  syncPlates();
}

/**
 * What to hang on the bar for the weight currently dialled in.
 *
 * Barbells only: a cable stack is a pin position and dumbbells come as they come, so showing
 * plate maths for those would be inventing an answer. If the weight cannot be built from the
 * plates this gym has, say so and name what you would really end up with — that is the whole
 * reason this exists.
 */
function syncPlates() {
  const ex = pendingEx && EXERCISES[pendingEx];
  const load = Number(el.inLoad.value) || 0;
  if (!ex || ex.equipment !== 'barbell' || !load) { el.setupPlates.hidden = true; return; }

  const l = planner.loadout(load, planner.getProfile());
  el.setupPlates.hidden = false;
  el.setupPlates.textContent = planner.loadoutText(load, planner.getProfile());
  if (!l.exact) {
    el.setupPlates.append(node('span', 'warn',
      `Your plates cannot make ${load} kg — that is ${l.actual} kg.`));
  }
}

// ── HUD ──────────────────────────────────────────────────────────────────────────────────

function refreshHud() {
  const s = coach.state;
  if (s.idle) return;
  el.exname.textContent = s.name;
  el.setinfo.textContent = `${s.label} · ${s.targetReps} reps · ${s.load ? `${s.load} kg` : 'bodyweight'}`;
  el.reptarget.textContent = `/ ${s.targetReps}`;
  el.repnum.textContent = '0';
  thresholds = s.thresholds;
  view = EXERCISES[s.exId].view;
  el.view.value = view;
}

function showCue(text) {
  el.cue.textContent = text;
  el.cue.classList.add('show');
  clearTimeout(cueTimer);
  cueTimer = setTimeout(() => el.cue.classList.remove('show'), 4500);
}

/**
 * Say so, once, if the phone turns out to have no working text-to-speech.
 *
 * A device can accept speak() and make no sound for the entire session — which reads as "the app
 * is not coaching me" rather than "this phone has no voice installed". The cues are all on screen
 * regardless, so the set is still coached; the lifter just needs to know where to look.
 */
let voiceWarned = false;
function checkVoice() {
  if (voiceWarned || !el.voice.checked) return;
  if (voice.working !== false) return;
  voiceWarned = true;
  showCue('No voice on this phone — watch this bar for corrections.');
  buzz([70, 60, 70]);
}

// ── the frame loop ───────────────────────────────────────────────────────────────────────

/**
 * Wait for the next CAMERA frame, not the next screen repaint.
 *
 * requestAnimationFrame fires on the display's cadence, which has nothing to do with the camera's:
 * at 60Hz against a 30fps stream, half the callbacks had no new frame to analyse and were thrown
 * away by the currentTime check, and the timestamps we recorded were repaint times rather than
 * capture times. Rep tempo and the fatigue measurement are built on those timestamps.
 */
function nextFrame(cb) {
  const v = el.cam;
  if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => cb());
  else requestAnimationFrame(cb);
}

/**
 * @param {number} gen  the generation this loop belongs to. `running` alone was not enough: it is
 *   only observed on the NEXT animation frame, so leaving the camera and starting another lift
 *   quickly left the old loop's pending callback alive to see `running === true` again and keep
 *   going. Two loops then called detectForVideo() on one landmarker, which is not reentrant and
 *   wants monotonic timestamps — that is the freeze.
 */
function loop(gen) {
  if (!running || gen !== loopGen) return;
  try {
    frame();
  } catch (err) {
    // An exception used to escape the callback, so nothing rescheduled the loop and the screen
    // simply stopped — no message, no way back except force-quitting. A dead loop must say so.
    running = false;
    big('Camera stopped', `${err.name}: ${err.message}. Tap "Change lift" and start again.`);
    el.status.textContent = 'Stopped';
    return;
  }
  nextFrame(() => loop(gen));
}

function frame() {
  const v = el.cam;
  if (v.readyState >= 2 && v.currentTime !== lastVideoTs) {
    lastVideoTs = v.currentTime;
    if (el.overlay.width !== v.videoWidth) {
      el.overlay.width = v.videoWidth;
      el.overlay.height = v.videoHeight;
    }
    const tMs = performance.now();
    if (lastFrameAt) {
      const dt = tMs - lastFrameAt;
      if (dt > 0 && dt < 500) fps += 0.1 * (1000 / dt - fps);
    }
    lastFrameAt = tMs;

    const res = landmarker.detectForVideo(v, tMs);
    const lm = lmFilter.apply(res.landmarks?.[0], tMs);
    const w = wFilter.apply(res.worldLandmarks?.[0], tMs);

    if (lm && w) {
      // Boxing has its own detector, its own clock and no rep state machine at all.
      if (mode === 'boxing') {
        onBoxingFrame(lm, w, tMs);
        drawSkeleton(el.overlay.getContext('2d'), lm, {
          width: el.overlay.width, height: el.overlay.height, bad: false,
        });
        return;
      }

      // Framing and calibration run the same analysis but bank nothing into the real set.
      const live = mode === 'live';
      const out = step(pendingEx ?? coach.state.exId, { lm, w, tMs, view },
        live ? setState : scratch, thresholds);

      if (mode === 'calibrating') onCalibrationFrame(out, tMs);
      else if (mode === 'framing') onFramingFrame(out, lm);
      else if (live) {
        const cue = coach.onFrame(out);
        if (cue) {
          showCue(cue);
          // coach.onFrame only returns a cue when out.faults[0] fired it, so this is the same
          // fault object — safe to read severity straight off it. Matches the boxing path, which
          // already did this correctly; gym lifts previously buzzed identically regardless of
          // severity because the severity never reached this point at all (see the exercises.js
          // fix this shipped alongside).
          buzz(out.faults[0]?.severity === 'safety' ? [90, 60, 90] : [70, 60, 70]);
        }
        el.repnum.textContent = String(out.reps);
        checkVoice();
      }

      el.status.textContent = out.visible
        ? `${Math.round(out.angle)}° · ${out.phase} · ${Math.round(fps)}fps`
        // Mid-set the phone has already been placed, so this is the one line telling you why it
        // went quiet. Naming the part is the difference between a fixable problem and a dead set.
        : framingFix(out.missing)[0];
      drawSkeleton(el.overlay.getContext('2d'), lm, {
        width: el.overlay.width, height: el.overlay.height, bad: live && out.faults.length > 0,
      });
    } else {
      el.status.textContent = 'No one in frame';
      if (mode === 'framing') big('Step back', 'I cannot see anyone');
      drawSkeleton(el.overlay.getContext('2d'), null, { width: el.overlay.width, height: el.overlay.height });
    }
  }
}

// ── framing: do not start counting while the lifter walks to the bar ─────────────────────

/** Body parts as a person would say them, not as landmark keys. */
const PART = {
  ankle: 'feet', heel: 'heels', toe: 'toes', knee: 'knees', hip: 'hips',
  shoulder: 'shoulders', elbow: 'elbows', wrist: 'hands', index: 'hands',
};

/** Which way to move the phone to bring a part back into shot. Lower body means tilt down or
 *  step back; upper body usually means the phone is too low or too close. */
const FIX = {
  ankle: 'Tilt the phone down or step back',
  heel: 'Tilt the phone down or step back',
  toe: 'Tilt the phone down or step back',
  knee: 'Tilt the phone down a little',
  hip: 'Move the phone back a step',
  shoulder: 'Tilt the phone up a little',
  elbow: 'Move the phone back a step',
  wrist: 'Move the phone back a step',
};

/**
 * Say what is actually missing.
 *
 * "Step back — I need to see all of you" is the single most infuriating thing this app did: it is
 * the same sentence whether your feet are cut off, the phone is too low, or you are standing
 * behind a rack upright — and it kept saying it while the lifter was already against the wall
 * with nowhere left to step. Naming the part turns a guessing game into one adjustment.
 */
function framingFix(missing) {
  if (!missing?.length) return ['Step back', 'I cannot see you at all — is anything blocking the lens?'];
  const parts = [...new Set(missing.map((k) => PART[k] ?? k))];
  const list = parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
    : parts[0];
  return [`I can't see your ${list}`, FIX[missing[0]] ?? 'Move the phone until all of you is in shot'];
}

function onFramingFrame(out, lm) {
  if (!out.visible) {
    resetFraming();
    big(...framingFix(out.missing));
    return;
  }

  // Catch the setup mistake that silently distorts every angle for the whole set. A lift measured
  // from the wrong side is not slightly wrong, it is measuring a different plane.
  const cam = cameraCheck(lm, view);
  if (cam && !cam.ok) {
    resetFraming();
    big(view === 'side' ? 'Turn side-on' : 'Face the camera',
      view === 'side'
        ? 'This lift is measured from the side — put the phone level with your hip'
        : 'This lift needs a front-on view');
    return;
  }

  if (out.phase !== 'start') {
    resetFraming();
    big('Get set', 'Stand in the starting position');
    return;
  }

  // Still, not merely present. Any drift beyond the band restarts the hold, so moving kit around
  // in the start position never arms the set.
  framedLo = Math.min(framedLo, out.angle);
  framedHi = Math.max(framedHi, out.angle);
  if (framedHi - framedLo > FRAMED_STILL_DEG) {
    resetFraming();
    big('Hold still', 'Set up first, then hold the start position');
    return;
  }

  framedFrames += 1;
  if (framedFrames < FRAMED_FRAMES_NEEDED) {
    // A countdown you can watch is a countdown you can beat — otherwise "Hold it" for a second and
    // a half feels like the app has hung.
    big('Hold it', `${Math.ceil((FRAMED_FRAMES_NEEDED - framedFrames) / 30 * 10) / 10}s`);
    return;
  }
  countIn();
}

function resetFraming() {
  framedFrames = 0;
  framedLo = Infinity;
  framedHi = -Infinity;
}

function countIn() {
  mode = 'counting';
  let n = 3;
  big(String(n), 'Starting');
  voice.speak(String(n));
  const id = setInterval(() => {
    n -= 1;
    if (n > 0) { big(String(n), 'Starting'); voice.speak(String(n)); return; }
    clearInterval(id);
    goLive();
  }, 1000);
}

function goLive() {
  mode = 'live';
  hideBig();
  setState = createState();
  el.repnum.textContent = '0';
  buzz(200);
  coach.announceSet();
}

// ── calibration: learn this lifter's range of motion ─────────────────────────────────────

function onCalibrationFrame(out, tMs) {
  if (out.visible && out.m) calSamples.push(out.m);
  const left = Math.ceil((calUntil - tMs) / 1000);
  if (left > 0) {
    big(String(left), out.visible ? 'Keep repping' : 'I cannot see you — step back');
    return;
  }
  finishCalibration();
}

function finishCalibration() {
  running = false;
  mode = 'live';
  const patch = calibrate(pendingEx, calSamples);
  if (!patch) {
    big('Not enough movement', `I need to see at least ${MIN_RANGE_DEG}° of range. Try again.`);
    voice.speak('I did not see enough movement. Try again.');
    setTimeout(() => { hideBig(); showSetup(pendingEx); }, 3200);
    return;
  }
  for (const [k, v] of Object.entries(patch)) store.setThreshold(pendingEx, k, v);
  thresholds = store.getThresholds(pendingEx, defaultThresholds(pendingEx));
  buzz([100, 80, 100]);
  big('Calibrated', Object.entries(patch).map(([k, v]) => `${k} ${v}`).join(' · '));
  voice.speak('Calibrated to your range.');
  setTimeout(() => { hideBig(); showSetup(pendingEx); }, 3200);
}

function beginSet() {
  for (const s of SHEETS()) s.hidden = true;
  setState = createState();
  scratch = createState();
  resetFraming();
  refreshHud();
  running = true;
  keepAwake();
  // Auto-start rather than counting reps while you are still walking to the bar.
  mode = 'framing';
  big('Get set', coach.state.hint);
  startLoop();
}

/** Claim the loop. Any loop from a previous set sees a stale generation and retires itself. */
function startLoop() {
  // Filters carry per-landmark history. Starting a new set — possibly a different lift, from a
  // different camera position — must not smooth against where the last one left off.
  lmFilter.reset();
  wFilter.reset();
  lastFrameAt = 0;
  loopGen += 1;
  const gen = loopGen;
  nextFrame(() => loop(gen));
}

// ── buttons ──────────────────────────────────────────────────────────────────────────────

el.btnStart.addEventListener('click', async () => {
  el.btnStart.disabled = true;
  el.startErr.textContent = '';
  try {
    await ensureCamera();
    coach.select(pendingEx, {
      sets: Number(el.inSets.value) || undefined,
      reps: Number(el.inReps.value) || undefined,
      load: Number(el.inLoad.value),
      warmup: el.warmup.checked,
    });
    beginSet();
  } catch (err) {
    el.startErr.textContent = `${err.name}: ${err.message}`;
  } finally {
    el.btnStart.disabled = false;
  }
});

/** Model and camera are shared by starting a set and by calibrating. */
async function ensureCamera() {
  voice.enabled = el.voice.checked;
  voice.unlock(); // must happen inside the gesture or iOS stays silent all session
  const wanted = store.getSetting('model', 'lite');
  if (!landmarker || landmarkerModel !== wanted) {
    el.startErr.textContent = 'Loading pose model…';
    landmarker?.close?.();   // the old one holds GPU memory; two loaded at once is asking for it
    landmarker = await createLandmarker(wanted);
    landmarkerModel = wanted;
  }
  // Not `if (!stream)`. See cameraAlive() — a backgrounded camera leaves the object intact and
  // the pictures gone, and reusing it is the frozen-video-on-reopen bug.
  if (!cameraAlive(stream)) {
    stopCamera(stream);
    stream = await startCamera(el.cam, el.facing.dataset.value);
  }
  el.startErr.textContent = '';
}

el.btnCalibrate.addEventListener('click', async () => {
  el.btnCalibrate.disabled = true;
  try {
    await ensureCamera();
    // Thresholds must be loaded before stepping, since rep endpoints live in them.
    thresholds = store.getThresholds(pendingEx, defaultThresholds(pendingEx));
    view = EXERCISES[pendingEx].view;
    for (const s of SHEETS()) s.hidden = true;
    el.repnum.textContent = '0';
    el.exname.textContent = EXERCISES[pendingEx].name;
    el.setinfo.textContent = 'Calibrating';
    scratch = createState();
    calSamples = [];
    calUntil = performance.now() + CAL_SECONDS * 1000;
    mode = 'calibrating';
    running = true;
    keepAwake();
    voice.speak(`Do ${CAL_SECONDS} seconds of slow reps with your best form.`);
    big(String(CAL_SECONDS), 'Slow reps, best form');
    startLoop();
  } catch (err) {
    el.startErr.textContent = `${err.name}: ${err.message}`;
  } finally {
    el.btnCalibrate.disabled = false;
  }
});

const goBack = () => (cameFromToday ? showToday() : showPicker());

// The big Start button: straight into the first lift you have not done yet, or the picker on a
// rest day. Saves the tap through the list on the day you actually train.
el.btnStartToday.addEventListener('click', () => {
  const now = new Date();
  const session = planner.today(now);
  if (!session) return showPicker();
  const done = planner.doneToday(session, now);
  const next = session.exercises.find((e) => !done.has(e.exId));
  return next ? showSetup(next.exId, next) : showPicker();
});

el.btnBack.addEventListener('click', goBack);
el.btnBoxBack.addEventListener('click', showPicker);
el.btnBoxStart.addEventListener('click', startBout);
el.btnPickerBack.addEventListener('click', showToday);
el.btnBrowse.addEventListener('click', showPicker);
el.btnProfile.addEventListener('click', showProfile);
el.btnProgress.addEventListener('click', showProgress);
/**
 * Face Wellness owns the FRONT camera, and most Android hardware will not open both at once — so
 * the gym stream has to be handed back before this asks for one, not merely stopped being used.
 * Leaving on the way out is the same problem in reverse, which is why close() runs on every exit
 * path rather than only on the back button.
 */
face.init({
  beforeOpen: () => {
    running = false;
    stopCamera(stream);
    stream = null;
    lastVideoTs = -1;
  },
});

el.btnFace.addEventListener('click', () => { show(el.face); face.open(); });
el.btnFaceBack.addEventListener('click', () => { face.close(); showToday(); });

el.btnMind.addEventListener('click', () => { show(el.mind); mood.render(); });
el.btnMindBack.addEventListener('click', showToday);
el.btnProgressBack.addEventListener('click', showToday);
el.btnProgressDone.addEventListener('click', showToday);
el.btnProfileBack.addEventListener('click', () => (planner.hasProfile() ? showToday() : null));

el.btnSaveProfile.addEventListener('click', () => {
  const bodyweight = Number(el.inBw.value) || draft.bodyweight;
  planner.setProfile({
    ...draft,
    name: el.inName.value.trim(),
    bodyweight,
    daysPerWeek: Number(el.inDays.value) || draft.daysPerWeek,
    bar: Number(el.inBar.value) || draft.bar,
    plates: draft.plates.length ? draft.plates : DEFAULT_PLATES,
  });
  // Weighing yourself IS editing this field, so there is no second place to log it. One point per
  // day, so opening the profile to change something else does not fake a weigh-in.
  store.appendWeight(bodyweight);
  showToday();
});

// ── backup ───────────────────────────────────────────────────────────────────────────────
//
// Two ways out, because neither is reliable everywhere: a file download is the one you want, but
// a Capacitor WebView with no DownloadListener drops blob downloads on the floor without saying
// so. Clipboard works in both, and pasting into your own notes is a real backup.

el.btnExportFile.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([store.exportAll()], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `trainer-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  el.backupMsg.textContent = 'Saved. If nothing downloaded, use Copy instead.';
});

el.btnExportCopy.addEventListener('click', async () => {
  const text = store.exportAll();
  try {
    await navigator.clipboard.writeText(text);
    el.backupMsg.textContent = `Copied — ${Math.ceil(text.length / 1024)} KB. Paste it somewhere safe.`;
  } catch {
    // Clipboard needs permission or a secure context; select the text so it can be copied by hand.
    el.restoreText.value = text;
    el.restoreText.select();
    el.backupMsg.textContent = 'Could not copy for you — it is selected below, copy it by hand.';
  }
});

el.btnRestore.addEventListener('click', () => {
  try {
    store.importAll(el.restoreText.value);
    el.restoreErr.textContent = '';
    el.restoreText.value = '';
    showToday();
  } catch (err) {
    el.restoreErr.textContent = err.message;
  }
});

let lastSet = null;   // so the ± correction can re-describe the set it just amended

function describeSet(r, verdict) {
  const bits = [`${r.faults} corrections.`];
  // Warm-up ramps change the bar every set, so the loading for what is coming next belongs here,
  // on the screen you are looking at while you strip plates off.
  const next = coach.state;
  if (!next.idle && !r.done && EXERCISES[next.exId]?.equipment === 'barbell' && next.load) {
    bits.push(`Next: ${planner.loadoutText(next.load, planner.getProfile()).toLowerCase()}.`);
  }
  if (r.slowdown > 1.25) bits.push(`Reps slowed ${Math.round((r.slowdown - 1) * 100)}% by the end.`);
  if (verdict) {
    const unit = verdict.reps ? 'reps' : 'kg';
    bits.push(`Next time: ${verdict.to} ${unit} (${verdict.reason}).`);
  }
  return bits.join(' ');
}

el.btnEnd.addEventListener('click', () => {
  // Boxing ends a bout, not a set — and there is no progression verdict to preview.
  if (mode === 'boxing' || bout) {
    if (running) { logRound(); running = false; }
    mode = 'live';
    bout = null;
    el.btnEnd.textContent = 'End set';
    el.reptarget.textContent = '/ 0';
    hideBig();
    showPicker();
    return;
  }

  const r = coach.endSet(setState);
  setState = createState();
  running = false;
  hideBig();
  lastSet = r;
  // Remember what this model actually achieved on this phone, so the picker can show it.
  if (fps > 1 && landmarkerModel) store.setSetting(`fps.${landmarkerModel}`, Math.round(fps));
  // Warm-ups are not logged, so there is nothing to correct on them.
  el.repfix.hidden = Boolean(r.warmup);
  el.restReps.textContent = String(r.record.reps);
  el.restSummary.textContent = describeSet(r, r.verdict);
  el.btnNext.textContent = r.done ? 'Finish lift' : r.warmup ? 'Next warm-up' : 'Next set';
  startRest(r.rest, r.done);
});

// A miscounted rep would otherwise be permanent, and it feeds both progression and the analytics.
el.repfix.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !lastSet) return;
  const amended = coach.amendReps(Number(b.dataset.rep));
  if (!amended) return;
  el.restReps.textContent = String(amended.reps);
  lastSet.record.reps = amended.reps;
  el.restSummary.textContent = describeSet(lastSet, lastSet.done ? amended.verdict : null);
});

el.btnSkip.addEventListener('click', goBack);

function startRest(seconds, done) {
  let left = seconds;
  el.rest.hidden = false;
  const tick = () => {
    el.restTime.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    el.restFill.style.width = `${Math.max(0, (left / seconds) * 100)}%`;
    if (left-- <= 0) {
      clearInterval(id);
      voice.speak('Rest over.');
    }
  };
  tick();
  const id = setInterval(tick, 1000);
  el.btnNext.onclick = () => {
    clearInterval(id);
    // Progression is applied only now, so any ± correction above is already accounted for.
    if (done) { coach.finishExercise(); goBack(); }
    else { refreshHud(); beginSet(); }
  };
}

// ── settings ─────────────────────────────────────────────────────────────────────────────

function buildSliders() {
  const s = coach.state;
  if (s.idle) return;
  el.setEx.textContent = s.name;
  el.sliders.innerHTML = '';
  for (const [key, value] of Object.entries(thresholds)) {
    const range = RANGES[key];
    if (!range) continue;
    const [min, max, stepSize, label] = range;
    const card = document.createElement('div');
    card.className = 'slider';
    card.innerHTML = `<div class="head"><label for="t-${key}"></label><output></output></div>
      <input type="range" id="t-${key}" min="${min}" max="${max}" step="${stepSize}" value="${value}">`;
    card.querySelector('label').textContent = label;
    const out = card.querySelector('output');
    out.textContent = value;
    const input = card.querySelector('input');
    input.addEventListener('input', () => {
      const v = Number(input.value);
      out.textContent = v;
      thresholds[key] = v;
      store.setThreshold(s.exId, key, v);
    });
    el.sliders.appendChild(card);
  }
}

el.btnSettings.addEventListener('click', () => { buildSliders(); el.settings.hidden = false; });
for (const b of [el.btnCloseSettings, el.btnCloseSettings2]) {
  b.addEventListener('click', () => { el.settings.hidden = true; });
}

// Segmented camera control. Switching mid-session tears the old stream down so the next
// Start re-opens on the chosen lens.
for (const b of el.facing.querySelectorAll('button')) {
  b.addEventListener('click', () => {
    el.facing.dataset.value = b.dataset.facing;
    for (const o of el.facing.querySelectorAll('button')) {
      o.setAttribute('aria-pressed', String(o === b));
    }
    stopCamera(stream);
    stream = null;
  });
}

// −/+ steppers: easier than a numeric keypad with chalk on your hands.
for (const b of document.querySelectorAll('[data-step]')) {
  b.addEventListener('click', () => {
    const input = $(b.dataset.for);
    const next = (Number(input.value) || 0) + Number(b.dataset.step);
    input.value = Math.min(Number(input.max), Math.max(Number(input.min), next));
    if (input === el.inLoad) syncWarmupRow();
  });
}
el.inLoad.addEventListener('input', syncWarmupRow);
el.view.addEventListener('change', () => { view = el.view.value; });
el.btnReset.addEventListener('click', () => {
  const s = coach.state;
  if (s.idle) return;
  thresholds = defaultThresholds(s.exId);
  for (const [k, v] of Object.entries(thresholds)) store.setThreshold(s.exId, k, v);
  buildSliders();
});
el.voice.addEventListener('change', () => { voice.enabled = el.voice.checked; });

window.addEventListener('pagehide', () => stopCamera(stream));

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// First run has nothing to plan from, so ask before showing an empty day.
if (planner.hasProfile()) showToday();
else showProfile();

// Exposed for poking at in the console: `trainer.store.read()` to see your log.
globalThis.trainer = { coach, store, planner, EXERCISES, get thresholds() { return thresholds; } };
