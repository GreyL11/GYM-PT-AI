// The PT layer: rep callouts, cue throttling, warm-ups, and deciding next session's load.
// Deliberately rules, not a model — progression is arithmetic and a coach's voice is a lookup.

import { EXERCISES, defaultThresholds } from './exercises.js';
import * as insights from './insights.js';
import * as planner from './planner.js';
import * as store from './store.js';

/** What the setup screen prefills: sets and reps from your goal, load carried forward from
 *  whatever progression last decided, falling back to a bodyweight-scaled first guess. */
export function suggest(exId) {
  const s = planner.scheme(exId);
  return {
    sets: s.sets,
    // Bodyweight lifts progress by reps, so their target is stored rather than fixed by goal.
    reps: store.getReps(exId, s.reps),
    load: store.getLoad(exId, planner.startingLoad(exId)),
    increment: planner.increment(exId),
    rest: planner.restSeconds(exId),
  };
}

/**
 * Snap a prescribed weight to something the bar can actually be loaded to.
 *
 * Raising the increment is not enough on its own: a load already off the grid — carried over from
 * before the gym's plates were set, or restored from an old backup — stays off it forever if you
 * only ever add a clean 5 kg to it. Every weight that gets written has to land on the grid, not
 * just every step between them. Deloads too, since 10% off is an arbitrary number.
 */
const loadable = (exId, kg) =>
  (EXERCISES[exId].equipment === 'barbell' ? planner.achievableLoad(kg) : kg);

const CUE_COOLDOWN_MS = 6000;      // same fault will not be repeated inside this window
const SPEECH_GAP_MS = 1200;        // never talk over yourself
const CLEAN_FAULTS_PER_REP = 0.34; // above this, the set was not clean enough to add weight
const WARMUP_MIN_LOAD = 40;        // below this the working weight IS the warm-up
const WARMUP_REST = 60;

/** Ramp to the working weight on heavy compounds. Percentages of the working set. */
export function warmupsFor(exId, load, wanted = true) {
  if (!wanted || !EXERCISES[exId].compound || load < WARMUP_MIN_LOAD) return [];
  const at = (pct) => Math.max(20, Math.round((load * pct) / 2.5) * 2.5);
  return [{ load: at(0.5), reps: 5 }, { load: at(0.75), reps: 3 }];
}

export function createCoach({ speak }) {
  let current = null;     // { exId, sets, reps, load, increment, rest, bodyweight }
  let warmups = [];
  let idx = 0;            // position across warm-ups then working sets
  let lastSpoke = 0;
  const cueAt = new Map();
  let exerciseSets = [];  // working sets completed so far, feeds progression

  function say(text, { throttleKey, force = false } = {}) {
    const now = Date.now();
    if (!force) {
      if (now - lastSpoke < SPEECH_GAP_MS) return false;
      if (throttleKey && now - (cueAt.get(throttleKey) ?? -Infinity) < CUE_COOLDOWN_MS) return false;
    }
    if (throttleKey) cueAt.set(throttleKey, now);
    lastSpoke = now;
    speak(text);
    return true;
  }

  const isWarmup = () => idx < warmups.length;

  return {
    /** Start a lift with the numbers the lifter chose. */
    select(exId, { sets, reps, load, warmup = true } = {}) {
      const d = suggest(exId);
      current = {
        exId,
        sets: sets ?? d.sets,
        reps: reps ?? d.reps,
        load: load ?? d.load,
        increment: d.increment,
        rest: d.rest,
        bodyweight: (load ?? d.load) === 0,
      };
      warmups = warmupsFor(exId, current.load, warmup);
      idx = 0;
      exerciseSets = [];
      if (!current.bodyweight) store.setLoad(exId, current.load);
      else store.setReps(exId, current.reps);
      return this.state;
    },

    get state() {
      if (!current) return { idle: true };
      const w = warmups.length;
      const warm = isWarmup();
      const n = warm ? idx + 1 : idx - w + 1;
      return {
        idle: false,
        exId: current.exId,
        name: EXERCISES[current.exId].name,
        hint: EXERCISES[current.exId].cameraHint,
        warmup: warm,
        set: n,
        sets: warm ? w : current.sets,
        label: warm ? `Warm-up ${n}/${w}` : `Set ${n}/${current.sets}`,
        targetReps: warm ? warmups[idx].reps : current.reps,
        load: warm ? warmups[idx].load : current.load,
        rest: warm ? WARMUP_REST : current.rest,
        thresholds: store.getThresholds(current.exId, defaultThresholds(current.exId)),
      };
    },

    announceSet() {
      const s = this.state;
      if (s.idle) return;
      const weight = s.load ? `${s.load} kilos` : 'bodyweight';
      say(s.warmup
        ? `${s.name}. Warm-up ${s.set} of ${s.sets}. ${s.targetReps} reps at ${weight}.`
        : `${s.name}. Set ${s.set} of ${s.sets}. ${s.targetReps} reps at ${weight}.`, { force: true });
    },

    /**
     * Feed every analysed frame through here. Returns the cue to PUT ON SCREEN, if any.
     *
     * Showing and speaking are decided separately on purpose. They used to be one decision — the
     * cue was displayed only if `say()` had not been throttled — which meant a fault detected
     * inside the 1.2s after a rep number was announced was thrown away entirely, screen included.
     * Since a rep number is announced on every rep and faults happen during reps, that quietly ate
     * most of the coaching.
     *
     * step() reports a fault on exactly one frame, so a dropped cue is not retried. The screen is
     * free — it costs nothing to be sure — while the voice stays throttled, because being talked
     * over mid-rep is worse than silence.
     */
    onFrame(result) {
      if (!result.visible) {
        say('I cannot see you. Step back into frame.', { throttleKey: 'novisible' });
        return null;
      }
      if (result.repCompleted) {
        const left = this.state.targetReps - result.reps;
        say(left > 0 ? String(result.reps) : 'Last one done.', { force: true });
      }
      // One correction at a time. Stacking cues mid-rep is noise, not coaching.
      const fault = result.faults[0];
      if (!fault) return null;
      say(fault.cue, { throttleKey: fault.id });
      return fault.cue;
    },

    /**
     * Called when the lifter racks it. Warm-ups are not logged and never affect progression.
     * The progression verdict is only a PREVIEW here — nothing is written until finishExercise(),
     * so a miscounted rep can still be corrected on the rest screen.
     */
    endSet(st) {
      const s = this.state;
      const faults = Object.values(st.faultCounts).reduce((a, b) => a + b, 0);
      const slowdown = insights.fatigue(st.repMs);

      if (s.warmup) {
        idx += 1;
        say(`Warm-up done. ${this.state.warmup ? 'One more' : 'Working weight next'}.`, { force: true });
        return { done: false, warmup: true, rest: WARMUP_REST, record: { reps: st.reps }, faults: 0, slowdown };
      }

      const record = {
        at: new Date().toISOString(),
        exId: current.exId,
        set: s.set,
        reps: st.reps,
        target: current.reps,
        load: current.load,
        faults: { ...st.faultCounts },
        repMs: (st.repMs ?? []).map(Math.round),
        // Additive, backward-compatible: every set logged before this shipped simply lacks the
        // field. insights.js's pattern functions must treat that as "no data yet," never as
        // "no faults happened" — see MOVEMENT_INTELLIGENCE_DESIGN.md.
        faultEvents: [...(st.faultEvents ?? [])],
      };
      store.appendLog(record);
      exerciseSets.push(record);

      const hit = st.reps >= current.reps;
      say(hit ? `Set done. ${st.reps} reps. Rest ${current.rest} seconds.`
              : `Set done. ${st.reps} of ${current.reps}. Rest ${current.rest} seconds.`, { force: true });

      idx += 1;
      const done = idx >= warmups.length + current.sets;
      return { done, rest: current.rest, record, faults, slowdown, verdict: done ? this.preview() : null };
    },

    /**
     * Fix a miscount before it poisons the log, progression and the analytics.
     *
     * `faultEvents` is never touched here, in either direction. A downward correction can leave
     * an event referencing a rep that, per the corrected count, no longer happened — that is left
     * exactly where it was, because it is a true fact about what the camera saw, not a mistake to
     * erase. `correctedFrom` records the ORIGINAL reps count the first time this set is corrected,
     * so anything reading the record later (insights.js, devcheck.js) can tell "this was corrected"
     * from "this looks wrong" — see MOVEMENT_INTELLIGENCE_DESIGN.md's evidence-integrity addendum.
     *
     * Repeated taps (the rest screen's +/- can be pressed more than once) must not keep moving
     * `correctedFrom` — it stays pinned to the value the camera originally counted, not the last
     * intermediate one, which is why this only sets it when it is not already present.
     */
    amendReps(delta) {
      const last = exerciseSets.at(-1);
      if (!last) return null;
      if (last.correctedFrom === undefined) last.correctedFrom = last.reps;
      last.reps = Math.max(0, last.reps + delta);
      store.amendLastSet({ reps: last.reps, correctedFrom: last.correctedFrom });
      return { reps: last.reps, verdict: this.preview() };
    },

    /**
     * What progression WOULD do. Pure: no storage writes, no speech.
     *
     * Every branch now carries the numbers it branched on, in `evidence`. Purely additive — the
     * `moved`/`deload`/`reps`/`from`/`to`/`reason` shape every existing caller reads is untouched —
     * and it is what makes a decision explainable after the fact rather than merely announced:
     * "form broke down" is a conclusion, `faultsPerRep: 0.4` against `cleanLimit: 0.34` is the
     * reason for it. Nothing here is a new decision input; these are the same values the branches
     * above were already computed from, kept instead of discarded.
     */
    preview() {
      if (!current || !exerciseSets.length) return null;
      const { exId, load, increment, reps, bodyweight } = current;
      const allReps = exerciseSets.every((s) => s.reps >= s.target);
      const totalReps = exerciseSets.reduce((a, s) => a + s.reps, 0);
      const totalFaults = exerciseSets.reduce(
        (a, s) => a + Object.values(s.faults).reduce((x, y) => x + y, 0), 0,
      );
      const rate = totalReps ? totalFaults / totalReps : 0;
      const evidence = {
        sets: exerciseSets.length,
        repsHit: allReps,
        totalReps,
        totalFaults,
        faultsPerRep: Math.round(rate * 100) / 100,
        cleanLimit: CLEAN_FAULTS_PER_REP,
        stalledSessions: insights.stalledSessions(exId),
      };

      if (allReps && rate < CLEAN_FAULTS_PER_REP) {
        // Nothing to add weight to on a push-up, so the rep target goes up instead.
        return bodyweight
          ? { moved: true, reps: true, from: reps, to: reps + 1, reason: 'all reps clean', evidence }
          : { moved: true, from: load, to: loadable(exId, load + increment), reason: 'all reps clean', evidence };
      }
      if (!bodyweight && insights.shouldDeload(exId)) {
        return {
          moved: true, deload: true, from: load,
          to: loadable(exId, insights.deloadTo(load)), reason: 'stalled three sessions', evidence,
        };
      }
      return {
        moved: false, reps: bodyweight, from: bodyweight ? reps : load, to: bodyweight ? reps : load,
        reason: !allReps ? 'reps missed' : 'form broke down', evidence,
      };
    },

    /**
     * Apply the verdict. Called when the lifter leaves the rest screen, after any correction.
     *
     * Written down here rather than in preview(), for the same reason the load is: preview() runs
     * on every ± tap on the rest screen, and only this is the moment the lifter actually committed
     * to. One decision per exercise, recorded where the decision is applied.
     */
    finishExercise() {
      const v = this.preview();
      if (!v) return null;
      store.appendVerdict({
        exId: current.exId,
        decision: v.deload ? 'deload' : v.moved ? 'progress' : 'hold',
        unit: v.reps ? 'reps' : 'kg',
        from: v.from,
        to: v.to,
        reason: v.reason,
        evidence: v.evidence,
      });
      const unit = v.reps ? 'reps' : 'kilos';
      if (v.moved) {
        if (v.reps) store.setReps(current.exId, v.to);
        else store.setLoad(current.exId, v.to);
        say(v.deload
          ? `Stuck here three sessions. Dropping to ${v.to} kilos to rebuild.`
          : `All reps, clean. Next time ${v.to} ${unit}.`, { force: true });
      } else {
        say(`Staying at ${v.to} ${unit} next time. ${v.reason === 'reps missed' ? 'You missed reps.' : 'Form broke down.'}`,
          { force: true });
      }
      return v;
    },

    /** Back to the picker without finishing the lift — no progression verdict. */
    clear() {
      current = null;
      warmups = [];
      idx = 0;
      exerciseSets = [];
    },
  };
}

/**
 * Browser speech, defensively.
 *
 * Three separate things silence speechSynthesis on Android, and the obvious implementation trips
 * all of them:
 *
 *   1. cancel() immediately followed by speak() in the same tick drops the utterance outright on
 *      Chrome and Android WebView. So cancel only when something is actually speaking, and let the
 *      new utterance start on the next turn of the loop.
 *   2. getVoices() is populated asynchronously and is empty on the first call. Speaking before it
 *      fills can produce nothing at all, so an explicit voice is chosen once they arrive.
 *   3. A device with no TTS engine has speechSynthesis and accepts speak() while making no sound,
 *      ever, silently. `working` reports what actually happened — an utterance that reaches
 *      onstart proves audio, and nothing reaching onstart after several tries proves the opposite.
 *      Silence the lifter cannot explain is worse than no voice at all.
 *
 * iOS additionally refuses to speak until an utterance is fired inside a user gesture, hence
 * unlock() on the Start button.
 */
export function createVoice() {
  let enabled = true;
  let voice = null;
  let attempts = 0;
  let started = 0;
  const synth = globalThis.speechSynthesis;

  const pickVoice = () => {
    const all = synth?.getVoices?.() ?? [];
    if (!all.length) return;
    // Prefer the device's own language, then anything English, then whatever exists.
    const lang = (globalThis.navigator?.language ?? 'en').toLowerCase();
    voice = all.find((v) => v.lang?.toLowerCase() === lang)
      ?? all.find((v) => v.lang?.toLowerCase().startsWith(lang.slice(0, 2)))
      ?? all.find((v) => v.lang?.toLowerCase().startsWith('en'))
      ?? all[0];
  };

  if (synth) {
    pickVoice();
    synth.addEventListener?.('voiceschanged', pickVoice);
  }

  return {
    get enabled() { return enabled; },
    set enabled(v) { enabled = v; if (!v) synth?.cancel(); },

    /** true = audio confirmed, false = tried and nothing ever started, null = not yet known. */
    get working() {
      if (!synth) return false;
      if (started > 0) return true;
      return attempts >= 3 ? false : null;
    },

    unlock() {
      if (!synth) return;
      pickVoice();
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      synth.speak(u);
    },

    speak(text) {
      if (!enabled || !synth) return;
      // Only interrupt something that is actually mid-sentence; a bare cancel() before every
      // utterance is what swallows them.
      if (synth.speaking || synth.pending) synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.rate = 1.15;
      u.pitch = 1;
      u.onstart = () => { started += 1; };
      attempts += 1;
      // Next tick, so the cancel above has landed before this is queued.
      setTimeout(() => synth.speak(u), 0);
    },
  };
}
