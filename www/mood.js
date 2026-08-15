// The Mind sheet: talk about the day, log it, see whether anything you changed moved the number.
//
// Display wiring. Everything it computes lives in mood_insights.js and checks.js, which are pure
// and tested; this file only puts strings on screen.
//
// The chat is the interface, not the intervention. What has evidence behind it is the tracking,
// the plans, and the sleep — and now that this lives inside the trainer, "did you train" is read
// straight off the lifting log instead of being pasted in.

import * as store from './store.js';
import * as mi from './mood_insights.js';
import { CHECKS, OPTIONS, score, band, risk, DUE_DAYS, daysSince } from './checks.js';
import { talk, testKey, readSkinNote, Blocked, BLOCKED_REPLY } from './chat.js';
import { digest, RULES } from './digest.js';
import * as skin from './skin.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const PANELS = ['talk', 'day', 'skin', 'trends'];
const FACES = ['\u{1F61E}', '\u{1F615}', '\u{1F610}', '\u{1F642}', '\u{1F604}'];
const WINDOW = 30;
const TOMORROW = () => store.shiftKey(1);

let panel = 'talk';

// ── panel switching ──────────────────────────────────────────────────────────────────────

export function render() {
  for (const p of PANELS) {
    $(`mind-panel-${p}`).hidden = p !== panel;
    $(`mind-tab-${p}`).classList.toggle('on', p === panel);
  }
  if (panel === 'talk') renderTalk();
  if (panel === 'day') renderDay();
  if (panel === 'skin') renderSkin();
  if (panel === 'trends') renderTrends();
}

for (const p of PANELS) {
  $(`mind-tab-${p}`).addEventListener('click', () => { panel = p; render(); });
}

/**
 * Open the check-in with a question already typed — used by the Stats card's "Ask why".
 *
 * Deliberately does not send it. Each message costs a call and the words are the person's to
 * change, so this puts them at the start of a sentence rather than mid-conversation.
 */
export function openTalk(prefill) {
  panel = 'talk';
  render();
  const box = $('mind-input');
  box.value = prefill;
  box.style.height = 'auto';
  box.style.height = `${box.scrollHeight}px`;
  box.focus();
}

// ── talk ─────────────────────────────────────────────────────────────────────────────────

// The transcript is also the scroll container — see the #mind-scroll rule in index.html.
const log = () => $('mind-scroll');

function bubble(role, text = '') {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.textContent = text;
  log().append(el);
  log().scrollTop = log().scrollHeight;
  return el;
}

let painted = false;

function renderTalk() {
  const key = store.getSetting('geminiKey', '');
  $('mind-composer').hidden = !key;
  $('mind-setup').hidden = !!key;
  $('mind-key-check').hidden = !key;
  if (key) renderShare();

  if (painted) return;
  painted = true;
  const history = store.chat();
  if (!history.length) {
    log().innerHTML = `<p class="muted">Say anything about today. It stays on this phone.</p>`;
    return;
  }
  log().innerHTML = '';
  for (const m of history) bubble(m.role, m.content);
}

async function send(text) {
  const key = store.getSetting('geminiKey', '');
  if (!key) return;
  if (store.chat().length === 0) log().innerHTML = '';

  store.appendChat('user', text);
  bubble('user', text);

  /**
   * Your own numbers, so "why am I not gaining?" can be answered about you rather than in general.
   *
   * Rebuilt for every message rather than cached: it is local arithmetic over data already in
   * memory, and a stale brief would have the model answering about last Tuesday. Off means the
   * conversation goes up with nothing but what you typed, which is what it did before.
   */
  const facts = store.getSetting('shareData', true)
    ? { rules: RULES, data: digest() }
    : null;

  $('mind-send').disabled = true;
  const reply = bubble('assistant');
  let full = '';
  try {
    for await (const chunk of talk(key, store.recentChat(), undefined, facts)) {
      full += chunk;
      reply.textContent = full;
      $('mind-scroll').scrollTop = $('mind-scroll').scrollHeight;
    }
    store.appendChat('assistant', full);
  } catch (err) {
    if (err instanceof Blocked) {
      // Not an error state. The filter swallowed the reply, so the app answers for itself —
      // saved to history like any other turn, because it is one.
      reply.textContent = BLOCKED_REPLY;
      store.appendChat('assistant', BLOCKED_REPLY);
    } else {
      // The half-written reply is not worth keeping — a truncated turn is something the model
      // has to reason around on every future request.
      reply.remove();
      bubble('error', err.message);
    }
  } finally {
    $('mind-send').disabled = false;
    $('mind-scroll').scrollTop = $('mind-scroll').scrollHeight;
  }
}

$('mind-composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('mind-input').value.trim();
  if (!text || $('mind-send').disabled) return;
  $('mind-input').value = '';
  $('mind-input').style.height = 'auto';
  send(text);
});

$('mind-input').addEventListener('input', () => {
  $('mind-input').style.height = 'auto';
  $('mind-input').style.height = `${$('mind-input').scrollHeight}px`;
});

$('mind-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('mind-composer').requestSubmit();
  }
});

/**
 * Save the key, then immediately prove whether it works.
 *
 * Saving used to do nothing visible beyond swapping one panel for another, so a key that was
 * invalid, restricted or region-blocked looked exactly like a key that was fine — right up until
 * you typed a message and got an error, or read a Stats card that silently stayed on its template
 * sentence. Testing on save is the moment the answer is cheapest to give.
 */
$('mind-save-key').addEventListener('click', async () => {
  const v = $('mind-key').value.trim();
  if (!v) return;
  store.setSetting('geminiKey', v);
  $('mind-key').value = '';
  render();
  await checkKey();
});

async function checkKey() {
  const key = store.getSetting('geminiKey', '');
  const out = $('mind-key-result');
  if (!key) return;
  out.textContent = 'Checking…';
  const { ok, message } = await testKey(key);
  out.textContent = message;
  out.style.color = ok ? 'var(--eat)' : '#ff8a80';
}

$('mind-test-key').addEventListener('click', checkKey);

/**
 * Whether your logged numbers go up with the conversation.
 *
 * Everything else in this app stays on the phone, so this is the one place personal data leaves it
 * — and it should be a visible switch rather than a paragraph nobody reads. The note underneath
 * says what actually gets sent, counted from the brief itself so it cannot drift out of date as
 * fields are added.
 */
function renderShare() {
  const on = store.getSetting('shareData', true);
  $('mind-share').checked = on;
  const fields = Object.keys(digest()).length;
  $('mind-share-note').textContent = on
    ? `Sends a summary — training, sleep, weight, eating (${fields} groups) — with each message. Never camera frames or face images. No names, no chat history beyond this conversation.`
    : 'Off. Replies use only what you type here.';
}

$('mind-share').addEventListener('change', () => {
  store.setSetting('shareData', $('mind-share').checked);
  renderShare();
});

$('mind-forget-key').addEventListener('click', () => {
  store.setSetting('geminiKey', '');
  $('mind-key-result').textContent = 'Saved on this device.';
  $('mind-key-result').style.color = '';
  render();
});

// ── skin ─────────────────────────────────────────────────────────────────────────────────
// Display wiring only. Every judgement — what to do, what correlates, when to refuse to speak —
// is skin.js, which is pure and tested. Nothing here decides anything.

function saveSkin(patch) {
  const cur = store.day().skin ?? { score: null, flags: [], habits: [] };
  store.patchDay({ skin: { ...cur, ...patch } });
  renderSkin();
}

function renderSkin() {
  const today = store.day().skin ?? { score: null, flags: [], habits: [] };

  const a = skin.advice();
  $('skin-advice').textContent = a.text;
  $('skin-evidence').textContent = a.evidence;
  $('skin-referral').textContent = skin.SEE_SOMEONE;
  $('skin-today-state').textContent = today.score ? `${today.score} / 5` : 'not logged';

  chips($('skin-score'), skin.SCALE.map((n) => ({ id: String(n), label: String(n) })),
    today.score ? [String(today.score)] : [], (sel) => saveSkin({ score: Number(sel[0]) }), true);
  chips($('skin-flags'), skin.FLAGS, today.flags ?? [], (sel) => saveSkin({ flags: sel }));
  chips($('skin-habits'), skin.HABITS, today.habits ?? [], (sel) => saveSkin({ habits: sel }));

  const rows = skin.associations();
  $('skin-assoc').innerHTML = rows.length
    ? rows.map((r) => `<div class="line"><span class="k">${esc(r.label)}</span>`
        + `<span class="v">${r.diff > 0 ? '+' : ''}${r.diff}</span></div>`
        + `<p class="muted data" style="margin:2px 0 10px">`
        + `${r.lowScore} on the ${r.lowDays} lower days · ${r.highScore} on the ${r.highDays} higher</p>`).join('')
    : `<p class="muted">Not enough logged yet to compare anything honestly.</p>`;
}

/** Single- or multi-select chip row. Single-select is used for the 1–5 score. */
function chips(container, items, selected, onChange, single = false) {
  container.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.value = it.id;
    b.textContent = it.label;
    b.setAttribute('aria-pressed', String(selected.includes(it.id)));
    if (it.why) b.title = it.why;
    b.addEventListener('click', () => {
      const next = single
        ? [it.id]
        : selected.includes(it.id) ? selected.filter((x) => x !== it.id) : [...selected, it.id];
      onChange(next);
    });
    container.append(b);
  }
}

/**
 * Read a sentence into an entry.
 *
 * Shown, never silently saved: a mis-parsed score would sit in the log forever skewing every
 * comparison built on it, and the person is right there to catch it. Falls back to the chips on
 * any failure — no key, no signal, or a reply that did not make sense.
 */
$('skin-read').addEventListener('click', async () => {
  const text = $('skin-note').value.trim();
  if (!text) return;
  const key = store.getSetting('geminiKey', '');
  const btn = $('skin-read');
  if (!key) { btn.textContent = 'Needs a key — or just tap a number'; return; }

  btn.disabled = true;
  btn.textContent = 'Reading…';
  const parsed = await readSkinNote(key, text);
  btn.disabled = false;
  btn.textContent = 'Read that';
  if (!parsed) { btn.textContent = 'Could not read that — tap a number instead'; return; }

  saveSkin({ score: parsed.score, flags: parsed.flags });
  $('skin-note').value = '';
});

// ── day ──────────────────────────────────────────────────────────────────────────────────

function renderPlans(el, key, removable) {
  const { plans } = store.day(key);
  el.innerHTML = plans.length
    ? plans
        .map(
          (p, i) => `<li class="${p.done ? 'done' : ''}">
            <input type="checkbox" data-i="${i}" ${p.done ? 'checked' : ''} aria-label="${esc(p.text)}">
            <span>${esc(p.text)}</span>
            ${removable ? `<button data-del="${i}" type="button">Drop</button>` : ''}
          </li>`,
        )
        .join('')
    : `<li><span class="muted">Nothing planned.</span></li>`;

  el.querySelectorAll('input[type="checkbox"]').forEach((box) =>
    box.addEventListener('change', () => {
      const next = store.day(key).plans.map((p, i) =>
        i === Number(box.dataset.i) ? { ...p, done: box.checked } : p);
      store.patchDay({ plans: next }, key);
      renderPlans(el, key, removable);
    }),
  );
  el.querySelectorAll('button[data-del]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const next = store.day(key).plans.filter((_, i) => i !== Number(btn.dataset.del));
      store.patchDay({ plans: next }, key);
      renderPlans(el, key, removable);
    }),
  );
}

function renderDay() {
  const d = store.day();

  $('mind-moods').innerHTML = FACES.map(
    (f, i) => `<button type="button" data-mood="${i + 1}" class="${d.mood === i + 1 ? 'on' : ''}" aria-pressed="${d.mood === i + 1}" aria-label="${i + 1} of 5">${f}</button>`,
  ).join('');
  $('mind-moods').querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      store.patchDay({ mood: Number(b.dataset.mood) });
      renderDay();
    }),
  );

  renderSleeps();

  renderPlans($('mind-plans-today'), store.dayKey(), false);
  renderPlans($('mind-plans-tomorrow'), TOMORROW(), true);

  const since = daysSince(store.lastCheck('phq9')?.at);
  $('mind-due').hidden = since < DUE_DAYS;
  $('mind-due-text').textContent =
    since === Infinity
      ? 'Nine questions, two minutes. This is the number everything else gets judged against.'
      : `Last one was ${since} days ago.`;
}

// ── sleep ────────────────────────────────────────────────────────────────────────────────
//
// A list of blocks rather than one Asleep/Awake pair, because a pair can only hold one sleep a day
// and cannot say WHICH day it belongs to — logged at 3pm after a night shift, the old fields landed
// on whichever day the app happened to be opened. A block carries real timestamps and is filed
// under the day it ended, so a nap and a night can both exist and neither has to be rounded into a
// story about "last night".
//
// `datetime-local` rather than a picker library: it is native, it already understands dates and
// times together, and it costs nothing.

/** `Date` → the string a datetime-local input wants, in LOCAL time, not UTC. */
const localInput = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const clockOf = (iso) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function renderSleeps() {
  const d = store.day();
  const s = mi.sleepSummary(d);
  const list = $('mind-sleeps');
  list.innerHTML = '';

  for (const b of s.blocks) {
    const li = document.createElement('li');
    const when = b.legacy
      ? `${d.bed}–${d.wake}`
      : `${clockOf(b.start)}–${clockOf(b.end)}`;
    li.innerHTML = `<span>${esc(when)} · ${b.hours}h</span>`;
    if (!b.legacy) {
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = '×';
      del.addEventListener('click', () => {
        store.removeSleep(store.dayKey(), b.start);
        renderDay();
      });
      li.append(del);
    }
    list.append(li);
  }

  // Main and total, kept apart on screen for the same reason they are kept apart in the arithmetic:
  // they answer different questions, and only the first one has the sleep evidence behind it.
  $('mind-slept').textContent = s.main === null ? ''
    : s.naps
      ? `Main sleep ${s.main}h · ${s.total}h in total across ${s.blocks.length} blocks`
      : `${s.main} hours`;

  // Prefill a plausible block: ended now, started eight hours ago. Most of the time that is two
  // corrections, not four fields typed from nothing.
  const now = new Date();
  if (!$('mind-sleep-end').value) $('mind-sleep-end').value = localInput(now);
  if (!$('mind-sleep-start').value) $('mind-sleep-start').value = localInput(new Date(now - 8 * 3600000));
}

$('mind-add-sleep').addEventListener('click', () => {
  const startRaw = $('mind-sleep-start').value;
  const endRaw = $('mind-sleep-end').value;
  const err = $('mind-sleep-err');
  const fail = (msg) => { err.hidden = false; err.textContent = msg; };
  err.hidden = true;

  const start = new Date(startRaw);
  const end = new Date(endRaw);
  if (!startRaw || !endRaw || Number.isNaN(+start) || Number.isNaN(+end)) return fail('Both ends are needed.');
  // Refused rather than silently swapped: if these are the wrong way round, one of them is a
  // mistyped date, and guessing which would file the sleep under a day it did not happen on.
  if (+end <= +start) return fail('The waking time has to be after the falling-asleep time.');
  const hours = (end - start) / 3600000;
  if (hours > 24) return fail('Longer than a day — check the dates.');

  const key = store.addSleep(start.toISOString(), end.toISOString());
  $('mind-sleep-start').value = '';
  $('mind-sleep-end').value = '';
  // Filed under the day it ended, which is not always today — say so rather than let it look lost.
  if (key !== store.dayKey()) fail(`Logged under ${key}, the day you woke up.`);
  renderDay();
});

$('mind-add-plan').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('mind-plan-text').value.trim();
  if (!text) return;
  const key = TOMORROW();
  store.patchDay({ plans: [...store.day(key).plans, { text, done: false }] }, key);
  $('mind-plan-text').value = '';
  renderDay();
});

// ── trends ───────────────────────────────────────────────────────────────────────────────

function statLine(label, result) {
  if (!result.enough) {
    return `<div class="line"><span class="k">${label}</span><span class="v flat">${result.nOn}/${result.nOff} days</span></div>`;
  }
  const sign = result.delta >= 0 ? '+' : '−';
  return `<div class="line"><span class="k">${label}</span>
    <span class="v ${result.delta > 0 ? 'up' : 'flat'}">${sign}${Math.abs(result.delta).toFixed(1)}</span></div>`;
}

function renderTrends() {
  const { log: lifts, rounds } = store.read();
  const trained = mi.trainedDays(lifts, rounds, store.dayKey);
  const rows = mi.rows(store.days(), trained, WINDOW, store.dayKey, store.shiftKey);
  const scored = rows.filter((r) => r.mood !== null);

  if (scored.length < 3) {
    $('mind-trends').innerHTML = `<div class="card"><span class="cardlabel">Not yet</span>
      <p class="muted">Log your mood for a few days and this fills in. Comparisons need at least
      ${mi.MIN_SAMPLE} days on each side before they mean anything, so give it a couple of weeks.</p></div>`;
    return;
  }

  const segments = mi.sparkline(rows.map((r) => r.mood));
  const avg = mi.average(scored.map((r) => r.mood));
  const planned = rows.filter((r) => r.plans !== null);
  const slept = rows.filter((r) => r.hours !== null);

  $('mind-trends').innerHTML = `
    <div class="card">
      <div class="line">
        <span class="cardlabel" style="color:var(--train)">Mood · ${WINDOW} days</span>
        <span class="cardlabel">${avg.toFixed(1)} avg</span>
      </div>
      <svg class="moodspark" viewBox="0 0 320 70" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1="35" x2="320" y2="35"></line>
        ${segments.map((p) => `<polyline points="${p}"></polyline>`).join('')}
      </svg>
      <p class="muted data">${scored.length} of ${WINDOW} days logged</p>
    </div>

    <div class="card">
      <span class="cardlabel" style="color:var(--train)">What moves it</span>
      ${statLine('Days you trained', mi.split(rows, (r) => r.trained))}
      ${statLine('Slept 7h+', mi.split(slept, (r) => r.hours >= 7))}
      ${statLine('Did what you planned', mi.split(planned, (r) => r.plans >= 0.5))}
      <p class="muted">Difference in average mood, out of 5. Grey means not enough days on one
        side to say anything yet. This is a difference in averages over your own days, not a
        cause — a bad week makes you skip the gym as easily as skipping the gym makes a bad week.</p>
    </div>

    ${renderCheckHistory()}
  `;
}

function renderCheckHistory() {
  const all = store.checks();
  if (!all.length) return '';
  const lines = all
    .slice(-8)
    .reverse()
    .map((c) => {
      const when = new Date(c.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      // A bare "8" means nothing without the ceiling it is out of.
      const max = CHECKS[c.kind].bands.at(-1)[0];
      return `<div class="line"><span class="k">${when} · ${CHECKS[c.kind].name}</span>
        <span class="v">${c.score}/${max} <span class="k">${band(c.kind, c.score)}</span></span></div>`;
    })
    .join('');
  return `<div class="card"><span class="cardlabel" style="color:var(--train)">Fortnightly checks</span>
    ${lines}
    <p class="muted">A screener, not a diagnosis. What it is for is telling you whether anything
      you changed actually moved — and when to stop treating this as an app problem.</p></div>`;
}

// ── questionnaire ────────────────────────────────────────────────────────────────────────

let current = null; // {kind, answers}

function openCheck(kind) {
  current = { kind, answers: Array(CHECKS[kind].items.length).fill(null) };
  $('mind-check-name').textContent = CHECKS[kind].name;
  $('mind-check-about').textContent =
    `${CHECKS[kind].about} Over the last two weeks, how often have you been bothered by:`;
  $('mind-risk').hidden = true;
  renderQuestions();
  $('mind-check').hidden = false;
}

function renderQuestions() {
  const { kind, answers } = current;
  $('mind-questions').innerHTML = CHECKS[kind].items
    .map(
      (item, q) => `<div class="q">
        <p>${q + 1}. ${esc(item)}</p>
        <div class="opts">
          ${OPTIONS.map(
            (o) => `<button type="button" data-q="${q}" data-v="${o.value}" class="${answers[q] === o.value ? 'on' : ''}" aria-pressed="${answers[q] === o.value}">${o.label}</button>`,
          ).join('')}
        </div>
      </div>`,
    )
    .join('');

  $('mind-questions').querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      current.answers[Number(b.dataset.q)] = Number(b.dataset.v);
      // Surfaced the moment it is answered, not held back until the score is tallied.
      $('mind-risk').hidden = !risk(current.kind, current.answers);
      renderQuestions();
      if (!$('mind-risk').hidden) $('mind-risk').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }),
  );
  $('mind-check-save').disabled = answers.some((a) => a === null);
}

$('mind-start-check').addEventListener('click', () => openCheck('phq9'));
$('mind-check-cancel').addEventListener('click', () => { $('mind-check').hidden = true; });

$('mind-check-save').addEventListener('click', () => {
  const { kind, answers } = current;
  store.appendCheck({ kind, answers, score: score(answers) });
  $('mind-check').hidden = true;
  renderDay();
});
