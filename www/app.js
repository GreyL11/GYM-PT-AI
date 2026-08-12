import { createLandmarker, startCamera, stopCamera, drawSkeleton } from './pose.js';
import { EXERCISES, GROUPS, EQUIPMENT, INJURIES, defaultThresholds, createState, step } from './exercises.js';
import { createCoach, createVoice, suggest } from './coach.js';
import * as insights from './insights.js';
import * as planner from './planner.js';
import * as store from './store.js';

const $ = (id) => document.getElementById(id);
const el = {
  cam: $('cam'), overlay: $('overlay'),
  exname: $('exname'), setinfo: $('setinfo'), repnum: $('repnum'), reptarget: $('reptarget'),
  cue: $('cue'), status: $('status'),
  btnEnd: $('btn-end'), btnSkip: $('btn-skip'), btnSettings: $('btn-settings'),
  picker: $('sheet-picker'), groups: $('groups'), exlist: $('exlist'),
  facing: $('facing'), voice: $('voice'), btnPickerBack: $('btn-picker-back'),
  today: $('sheet-today'), todayDay: $('today-day'), todayName: $('today-name'),
  todayList: $('todaylist'), todayNote: $('today-note'),
  btnBrowse: $('btn-browse'), btnProfile: $('btn-profile'), btnProgress: $('btn-progress'),
  progress: $('sheet-progress'), progressBody: $('progress-body'),
  btnProgressBack: $('btn-progress-back'), btnProgressDone: $('btn-progress-done'),
  profile: $('sheet-profile'), inBw: $('in-bw'), inDays: $('in-days'),
  pExperience: $('p-experience'), pGoal: $('p-goal'), pEquipment: $('p-equipment'),
  pInjuries: $('p-injuries'), profileWarn: $('profile-warn'),
  btnSaveProfile: $('btn-save-profile'), btnProfileBack: $('btn-profile-back'),
  setup: $('sheet-setup'), setupEx: $('setup-ex'), setupHint: $('setup-hint'), setupLast: $('setup-last'),
  inSets: $('in-sets'), inReps: $('in-reps'), inLoad: $('in-load'),
  btnBack: $('btn-back'), btnStart: $('btn-start'), startErr: $('start-err'),
  rest: $('sheet-rest'), restTime: $('resttime'), restFill: $('restfill'),
  restSummary: $('rest-summary'), btnNext: $('btn-next'),
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

let landmarker = null;
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

// Without this the phone screens off mid-set and the camera stops. Re-acquired on resume, because
// Android drops the lock whenever the app goes to the background.
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not fatal */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && running) keepAwake();
});

// ── picker ───────────────────────────────────────────────────────────────────────────────

function renderGroups() {
  el.groups.innerHTML = '';
  for (const g of ['All', ...GROUPS]) {
    const b = document.createElement('button');
    b.textContent = g;
    b.setAttribute('aria-pressed', String(g === filter));
    b.addEventListener('click', () => { filter = g; renderGroups(); renderList(); });
    el.groups.appendChild(b);
  }
}

function renderList() {
  el.exlist.innerHTML = '';
  const items = Object.entries(EXERCISES).filter(([, ex]) => filter === 'All' || ex.group === filter);
  for (const [id, ex] of items) {
    const s = suggest(id);
    const b = document.createElement('button');
    b.innerHTML = `<span class="nm"></span><span class="meta"></span>`;
    b.querySelector('.nm').textContent = ex.name;
    b.querySelector('.meta').textContent = `${s.sets}×${s.reps} · ${s.load} kg`;
    b.addEventListener('click', () => showSetup(id));
    el.exlist.appendChild(b);
  }
}

const SHEETS = () => [el.today, el.profile, el.picker, el.setup, el.rest, el.settings, el.progress];

function show(sheet) {
  running = false;
  for (const s of SHEETS()) s.hidden = s !== sheet;
}

function showPicker() {
  pendingEx = null;
  coach.clear();
  show(el.picker);
  renderGroups();
  renderList();
}

// ── today's plan ─────────────────────────────────────────────────────────────────────────

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function showToday() {
  pendingEx = null;
  coach.clear();
  show(el.today);

  const now = new Date();
  const session = planner.today(now);
  el.todayDay.textContent = WEEKDAYS[now.getDay()];
  el.todayList.innerHTML = '';

  if (!session) {
    const next = planner.nextTrainingDay(now);
    el.todayName.textContent = 'Rest day';
    el.todayNote.textContent = next
      ? `Next up: ${next.session.name} on ${next.day}. Tap "All lifts" if you want to train anyway.`
      : 'No training days set. Check your profile.';
    return;
  }

  el.todayName.textContent = session.name;
  const done = planner.doneToday(session, now);
  for (const item of session.exercises) {
    const b = document.createElement('button');
    b.innerHTML = '<span class="nm"></span><span class="meta"></span>';
    b.querySelector('.nm').textContent = item.name;
    b.querySelector('.meta').textContent = done.has(item.exId)
      ? 'Done'
      : `${item.sets}×${item.reps} · ${item.load ? `${item.load} kg` : 'bodyweight'}`;
    if (done.has(item.exId)) b.classList.add('done');
    b.addEventListener('click', () => showSetup(item.exId, item));
    el.todayList.appendChild(b);
  }
  const notes = [];
  const left = session.exercises.length - done.size;
  notes.push(left ? `${left} of ${session.exercises.length} to go.` : 'Session complete. Good work.');

  // Anything today that you hammered less than 48h ago.
  for (const w of insights.recoveryWarnings(session, now)) {
    notes.push(`${w.group} was trained ${w.hoursAgo}h ago — still recovering.`);
  }
  // Lifts the log says you are stuck on; progression will back them off after this session.
  const stalled = session.exercises.filter((e) => insights.shouldDeload(e.exId)).map((e) => e.name);
  if (stalled.length) notes.push(`Stalled: ${stalled.join(', ')}. Dropping the weight to rebuild.`);

  el.todayNote.textContent = notes.join(' ');
}

// ── progress ─────────────────────────────────────────────────────────────────────────────

const node = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

function line(k, v, cls) {
  const row = node('div', 'line');
  row.append(node('span', 'k', k), node('span', `v ${cls ?? ''}`.trim(), v));
  return row;
}

function showProgress() {
  show(el.progress);
  const s = insights.summary();
  const body = el.progressBody;
  body.innerHTML = '';

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
    card.append(node('h2', null, lift.name));
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

// ── profile ──────────────────────────────────────────────────────────────────────────────

const LABELS = {
  barbell: 'Barbell', dumbbell: 'Dumbbell', cable: 'Cable machine', bodyweight: 'Bodyweight',
  shoulder: 'Shoulder', elbow: 'Elbow', lowerBack: 'Lower back', knee: 'Knee',
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
  wireChips(el.pEquipment, EQUIPMENT, [...draft.equipment], (v) => { draft.equipment = v; checkProfile(); });
  wireChips(el.pInjuries, INJURIES, [...draft.injuries], (v) => { draft.injuries = v; checkProfile(); });
  checkProfile();
}

/** Equipment and injuries can between them leave a muscle group with nothing to train. */
function checkProfile() {
  const usable = planner.available(draft);
  const empty = GROUPS.filter((g) => !usable.some((id) => EXERCISES[id].group === g));
  el.profileWarn.textContent = !usable.length
    ? 'That leaves no exercises at all. Add some equipment.'
    : empty.length ? `Nothing left for: ${empty.join(', ')}. Those days will be shorter.` : '';
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

  show(el.setup);
}

// ── HUD ──────────────────────────────────────────────────────────────────────────────────

function refreshHud() {
  const s = coach.state;
  if (s.idle) return;
  el.exname.textContent = s.name;
  el.setinfo.textContent = `Set ${s.set}/${s.sets} · ${s.targetReps} reps · ${s.load} kg`;
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

function beginSet() {
  for (const s of SHEETS()) s.hidden = true;
  setState = createState();
  refreshHud();
  running = true;
  keepAwake();
  coach.announceSet();
  requestAnimationFrame(loop);
}

// ── buttons ──────────────────────────────────────────────────────────────────────────────

el.btnStart.addEventListener('click', async () => {
  el.btnStart.disabled = true;
  el.startErr.textContent = '';
  try {
    voice.enabled = el.voice.checked;
    voice.unlock(); // must happen inside the gesture or iOS stays silent all session
    if (!landmarker) { el.startErr.textContent = 'Loading pose model…'; landmarker = await createLandmarker(); }
    if (!stream) stream = await startCamera(el.cam, el.facing.dataset.value);
    el.startErr.textContent = '';
    coach.select(pendingEx, {
      sets: Number(el.inSets.value) || undefined,
      reps: Number(el.inReps.value) || undefined,
      load: Number(el.inLoad.value),
    });
    beginSet();
  } catch (err) {
    el.startErr.textContent = `${err.name}: ${err.message}`;
  } finally {
    el.btnStart.disabled = false;
  }
});

const goBack = () => (cameFromToday ? showToday() : showPicker());

el.btnBack.addEventListener('click', goBack);
el.btnPickerBack.addEventListener('click', showToday);
el.btnBrowse.addEventListener('click', showPicker);
el.btnProfile.addEventListener('click', showProfile);
el.btnProgress.addEventListener('click', showProgress);
el.btnProgressBack.addEventListener('click', showToday);
el.btnProgressDone.addEventListener('click', showToday);
el.btnProfileBack.addEventListener('click', () => (planner.hasProfile() ? showToday() : null));

el.btnSaveProfile.addEventListener('click', () => {
  planner.setProfile({
    ...draft,
    bodyweight: Number(el.inBw.value) || draft.bodyweight,
    daysPerWeek: Number(el.inDays.value) || draft.daysPerWeek,
  });
  showToday();
});

el.btnEnd.addEventListener('click', () => {
  const r = coach.endSet(setState);
  setState = createState();
  running = false;
  const bits = [`${r.record.reps} reps · ${r.faults} corrections.`];
  if (r.slowdown > 1.25) bits.push(`Reps slowed ${Math.round((r.slowdown - 1) * 100)}% by the end.`);
  if (r.verdict) bits.push(`Next time: ${r.verdict.to} kg (${r.verdict.reason}).`);
  el.restSummary.textContent = bits.join(' ');
  el.btnNext.textContent = r.done ? 'Pick next lift' : 'Next set';
  startRest(r.rest, r.done);
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
    if (done) goBack();
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
  });
}
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
