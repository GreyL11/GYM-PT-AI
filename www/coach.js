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

    /** Feed every analysed frame through here. Returns the cue it decided to speak, if any. */
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
      if (fault && say(fault.cue, { throttleKey: fault.id })) return fault.cue;
      return null;
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

    /** Fix a miscount before it poisons the log, progression and the analytics. */
    amendReps(delta) {
      const last = exerciseSets.at(-1);
      if (!last) return null;
      last.reps = Math.max(0, last.reps + delta);
      store.amendLastSet({ reps: last.reps });
      return { reps: last.reps, verdict: this.preview() };
    },

    /** What progression WOULD do. Pure: no storage writes, no speech. */
    preview() {
      if (!current || !exerciseSets.length) return null;
      const { exId, load, increment, reps, bodyweight } = current;
      const allReps = exerciseSets.every((s) => s.reps >= s.target);
      const totalReps = exerciseSets.reduce((a, s) => a + s.reps, 0);
      const totalFaults = exerciseSets.reduce(
        (a, s) => a + Object.values(s.faults).reduce((x, y) => x + y, 0), 0,
      );
      const rate = totalReps ? totalFaults / totalReps : 0;

      if (allReps && rate < CLEAN_FAULTS_PER_REP) {
        // Nothing to add weight to on a push-up, so the rep target goes up instead.
        return bodyweight
          ? { moved: true, reps: true, from: reps, to: reps + 1, reason: 'all reps clean' }
          : { moved: true, from: load, to: load + increment, reason: 'all reps clean' };
      }
      if (!bodyweight && insights.shouldDeload(exId)) {
        return { moved: true, deload: true, from: load, to: insights.deloadTo(load), reason: 'stalled three sessions' };
      }
      return {
        moved: false, reps: bodyweight, from: bodyweight ? reps : load, to: bodyweight ? reps : load,
        reason: !allReps ? 'reps missed' : 'form broke down',
      };
    },

    /** Apply the verdict. Called when the lifter leaves the rest screen, after any correction. */
    finishExercise() {
      const v = this.preview();
      if (!v) return null;
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

/** Browser speech. iOS will not speak until an utterance is fired inside a user gesture,
 *  hence unlock() on the Start button. */
export function createVoice() {
  let enabled = true;
  const synth = globalThis.speechSynthesis;
  return {
    get enabled() { return enabled; },
    set enabled(v) { enabled = v; if (!v) synth?.cancel(); },
    unlock() {
      if (!synth) return;
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      synth.speak(u);
    },
    speak(text) {
      if (!enabled || !synth) return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.15;
      u.pitch = 1;
      synth.speak(u);
    },
  };
}
