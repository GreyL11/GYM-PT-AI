import { createLandmarker, startCamera, stopCamera, drawSkeleton } from './pose.js';
import {
  EXERCISES, GROUPS, EQUIPMENT, INJURIES, MIN_RANGE_DEG,
  defaultThresholds, createState, step, calibrate,
} from './exercises.js';
import { createCoach, createVoice, suggest, warmupsFor } from './coach.js';
import * as insights from './insights.js';
import * as nutrition from './nutrition.js';
import * as planner from './planner.js';
import * as store from './store.js';
import * as technique from './technique.js';

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
  btnExportFile: $('btn-export-file'), btnExportCopy: $('btn-export-copy'), backupMsg: $('backup-msg'),
  restoreText: $('restore-text'), btnRestore: $('btn-restore'), restoreErr: $('restore-err'),
  setup: $('sheet-setup'), setupEx: $('setup-ex'), setupHint: $('setup-hint'), setupLast: $('setup-last'),
  howto: $('howto'), howtoBody: $('howto-body'), btnHowto: $('btn-howto'), btnHowtoSpeak: $('btn-howto-speak'),
  inSets: $('in-sets'), inReps: $('in-reps'), inLoad: $('in-load'),
  btnBack: $('btn-back'), btnStart: $('btn-start'), startErr: $('start-err'),
  btnCalibrate: $('btn-calibrate'), warmup: $('warmup'), warmupRow: $('warmup-row'),
  bigmsg: $('bigmsg'), bigTitle: $('bigmsg-title'), bigSub: $('bigmsg-sub'),
  restReps: $('rest-reps'), repfix: $('repfix'),
  rest: $('sheet-rest'), restTime: $('resttime'), restFill: $('restfill'),
  restSummary: $('rest-summary'), btnNext: $('btn-next'),
  todayGreet: $('today-greet'), trainStats: $('train-stats'), btnStartToday: $('btn-start-today'),
  eatKcal: $('eat-kcal'), mealSlots: $('meal-slots'), btnEat: $('btn-eat'), btnEatTab: $('btn-eat-tab'),
  weightNow: $('weight-now'), weightSpark: $('weight-spark'), btnLogWeight: $('btn-log-weight'),
  proteinNow: $('protein-now'), proteinFill: $('protein-fill'), inName: $('in-name'),
  coachChart: $('coach-chart'), coachDrift: $('coach-drift'), coachLine: $('coach-line'),
  coachSuggest: $('coach-suggest'), suggestText: $('suggest-text'),
  btnAcceptTarget: $('btn-accept-target'), btnResetTarget: $('btn-reset-target'),
  eat: $('sheet-eat'), eatMacros: $('eat-macros'), eatToday: $('eat-today'), eatCats: $('eat-cats'),
  eatList: $('eatlist'), btnEatBack: $('btn-eat-back'), btnEatDone: $('btn-eat-done'),
  fName: $('f-name'), fServing: $('f-serving'), fKcal: $('f-kcal'), fProtein: $('f-protein'),
  fCarbs: $('f-carbs'), fFat: $('f-fat'), foodErr: $('food-err'), btnSaveFood: $('btn-save-food'),
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

// 'framing'    — waiting for you to walk to the bar and get into position
// 'counting'   — 3, 2, 1 before the set starts
// 'live'       — actually coaching
// 'calibrating'— recording your range of motion, coaching nothing
let mode = 'live';
let scratch = createState();  // throwaway state so framing/calibration never bank reps
let calSamples = [];
let calUntil = 0;
let framedFrames = 0;

const CAL_SECONDS = 15;
const FRAMED_FRAMES_NEEDED = 15;  // ~half a second held in the start position

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

const SHEETS = () => [el.today, el.profile, el.picker, el.setup, el.rest, el.settings, el.progress, el.eat];

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
  const profile = planner.getProfile();
  el.todayDay.textContent = WEEKDAYS[now.getDay()];
  el.todayGreet.textContent = profile.name ? `Hi ${profile.name}` : 'Today';
  el.todayList.innerHTML = '';
  renderEatCards(profile);

  if (!session) {
    const next = planner.nextTrainingDay(now);
    el.todayName.textContent = 'Rest';
    el.trainStats.textContent = next ? `Next: ${next.day}` : '';
    el.btnStartToday.textContent = 'All lifts';
    el.todayNote.textContent = next
      ? `Next up: ${next.session.name} on ${next.day}. Tap "All lifts" if you want to train anyway.`
      : 'No training days set. Check your profile.';
    return;
  }

  el.todayName.textContent = session.name;
  el.btnStartToday.textContent = 'Start';
  el.trainStats.textContent = `${session.exercises.length} ex · ${session.exercises.reduce((a, e) => a + e.sets, 0)} sets`;
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

  el.eatKcal.innerHTML = '';
  el.eatKcal.append(
    node('span', null, have.kcal ? String(have.kcal) : '—'),
    node('span', 'of', ` / ${t.kcal.toLocaleString()} kcal`),
  );

  const eaten = nutrition.mealsEaten(entries);
  el.mealSlots.innerHTML = '';
  for (const m of nutrition.MEALS) {
    const row = node('div', `slot${eaten.has(m) ? ' on' : ''}`);
    row.append(node('i'), node('span', null, m));
    el.mealSlots.appendChild(row);
  }

  // No 'under' class: being short of protein at 2pm is the normal state of a day, and a greyed
  // bar reads as failed. The width already says how far along you are.
  const pct = Math.round((have.protein / t.protein) * 100);
  el.proteinNow.innerHTML = '';
  el.proteinNow.append(node('span', null, String(have.protein)), node('span', 'of', ` / ${t.protein}g`));
  el.proteinFill.style.width = `${Math.min(100, pct)}%`;
  el.proteinFill.style.background = 'var(--eat)';

  // Bodyweight: the number is the profile's, the history is what makes it mean anything.
  const trend = nutrition.weightTrend();
  el.weightNow.innerHTML = '';
  el.weightNow.append(
    node('span', null, `${trend.now ?? profile.bodyweight}`),
    node('span', 'of', ` kg${trend.change === null ? '' : ` · ${trend.change > 0 ? '+' : ''}${trend.change}`}`),
  );
  el.weightSpark.innerHTML = '';
  el.weightSpark.appendChild(sparkline(trend.points.map((p) => p.kg)));

  renderCoach(profile);
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
function renderCoach(profile) {
  const series = nutrition.dailySeries(28);
  const chart = el.coachChart;
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
  el.coachDrift.textContent = trend.change === null ? '' : `${trend.change > 0 ? '↗' : trend.change < 0 ? '↘' : '→'} ${trend.change > 0 ? '+' : ''}${trend.change} kg`;
  el.coachDrift.style.color = trend.change === null ? 'var(--on-surface-variant)' : 'var(--eat)';
  el.coachLine.textContent = nutrition.coachLine(profile, series);

  // The scale's correction to the calorie target, offered rather than applied.
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
    row.append(text, node('span', 'qty', `${Math.round(f.protein * e.qty)}g P`), drop);
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

el.btnEat.addEventListener('click', showEat);
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

// ── progress ─────────────────────────────────────────────────────────────────────────────


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

  renderEatStats(body);

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
      // Framing and calibration run the same analysis but bank nothing into the real set.
      const live = mode === 'live';
      const out = step(pendingEx ?? coach.state.exId, { lm, w, tMs, view },
        live ? setState : scratch, thresholds);

      if (mode === 'calibrating') onCalibrationFrame(out, tMs);
      else if (mode === 'framing') onFramingFrame(out);
      else if (live) {
        const cue = coach.onFrame(out);
        if (cue) { showCue(cue); buzz([70, 60, 70]); }
        el.repnum.textContent = String(out.reps);
      }

      el.status.textContent = out.visible ? `${Math.round(out.angle)}° · ${out.phase}` : 'Step back into frame';
      drawSkeleton(el.overlay.getContext('2d'), lm, {
        width: el.overlay.width, height: el.overlay.height, bad: live && out.faults.length > 0,
      });
    } else {
      el.status.textContent = 'No one in frame';
      if (mode === 'framing') big('Step back', 'I cannot see anyone');
      drawSkeleton(el.overlay.getContext('2d'), null, { width: el.overlay.width, height: el.overlay.height });
    }
  }
  requestAnimationFrame(loop);
}

// ── framing: do not start counting while the lifter walks to the bar ─────────────────────

function onFramingFrame(out) {
  if (!out.visible) {
    framedFrames = 0;
    big('Step back', 'I need to see all of you in frame');
    return;
  }
  if (out.phase !== 'start') {
    framedFrames = 0;
    big('Get set', 'Stand in the starting position');
    return;
  }
  framedFrames += 1;
  if (framedFrames < FRAMED_FRAMES_NEEDED) {
    big('Hold it', 'Got you');
    return;
  }
  countIn();
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
  framedFrames = 0;
  refreshHud();
  running = true;
  keepAwake();
  // Auto-start rather than counting reps while you are still walking to the bar.
  mode = 'framing';
  big('Get set', coach.state.hint);
  requestAnimationFrame(loop);
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
  if (!landmarker) { el.startErr.textContent = 'Loading pose model…'; landmarker = await createLandmarker(); }
  if (!stream) stream = await startCamera(el.cam, el.facing.dataset.value);
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
    requestAnimationFrame(loop);
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
el.btnPickerBack.addEventListener('click', showToday);
el.btnBrowse.addEventListener('click', showPicker);
el.btnProfile.addEventListener('click', showProfile);
el.btnProgress.addEventListener('click', showProgress);
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
  if (r.slowdown > 1.25) bits.push(`Reps slowed ${Math.round((r.slowdown - 1) * 100)}% by the end.`);
  if (verdict) {
    const unit = verdict.reps ? 'reps' : 'kg';
    bits.push(`Next time: ${verdict.to} ${unit} (${verdict.reason}).`);
  }
  return bits.join(' ');
}

el.btnEnd.addEventListener('click', () => {
  const r = coach.endSet(setState);
  setState = createState();
  running = false;
  hideBig();
  lastSet = r;
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
