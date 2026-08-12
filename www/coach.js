// The PT layer: rep callouts, cue throttling, and deciding next session's load.
// Deliberately rules, not a model — progression is arithmetic and a coach's voice is a lookup.
//
// You pick the lift and the numbers; this just holds you to them. DEFAULTS only prefills the
// setup screen, so an exercise with no entry still works on FALLBACK.

import { EXERCISES, defaultThresholds } from './exercises.js';
import * as planner from './planner.js';
import * as store from './store.js';

/** What the setup screen prefills: sets and reps from your goal, load carried forward from
 *  whatever progression last decided, falling back to a bodyweight-scaled first guess. */
export function suggest(exId) {
  return {
    ...planner.scheme(exId),
    load: store.getLoad(exId, planner.startingLoad(exId)),
    increment: planner.increment(exId),
    rest: planner.restSeconds(exId),
  };
}

const CUE_COOLDOWN_MS = 6000;      // same fault will not be repeated inside this window
const SPEECH_GAP_MS = 1200;        // never talk over yourself
const CLEAN_FAULTS_PER_REP = 0.34; // above this, the set was not clean enough to add weight

export function createCoach({ speak }) {
  let current = null;     // { exId, sets, reps, load, increment, rest }
  let setIdx = 0;
  let lastSpoke = 0;
  const cueAt = new Map();
  let exerciseSets = [];  // sets completed so far on the current exercise

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

  return {
    /** Start a lift with the numbers the lifter chose. */
    select(exId, { sets, reps, load } = {}) {
      const d = suggest(exId);
      current = {
        exId,
        sets: sets ?? d.sets,
        reps: reps ?? d.reps,
        load: load ?? d.load,
        increment: d.increment,
        rest: d.rest,
      };
      setIdx = 0;
      exerciseSets = [];
      // Remember the chosen load so the next visit prefills it, even without a progression bump.
      store.setLoad(exId, current.load);
      return this.state;
    },

    get state() {
      if (!current) return { idle: true };
      return {
        idle: false,
        exId: current.exId,
        name: EXERCISES[current.exId].name,
        hint: EXERCISES[current.exId].cameraHint,
        set: setIdx + 1,
        sets: current.sets,
        targetReps: current.reps,
        load: current.load,
        rest: current.rest,
        thresholds: store.getThresholds(current.exId, defaultThresholds(current.exId)),
      };
    },

    announceSet() {
      const s = this.state;
      if (s.idle) return;
      say(`${s.name}. Set ${s.set} of ${s.sets}. ${s.targetReps} reps at ${s.load} kilos.`, { force: true });
    },

    /** Feed every analysed frame through here. Returns the cue it decided to speak, if any. */
    onFrame(result) {
      if (!result.visible) {
        say('I cannot see you. Step back into frame.', { throttleKey: 'novisible' });
        return null;
      }
      if (result.repCompleted) {
        const left = current.reps - result.reps;
        say(left > 0 ? String(result.reps) : 'Last one done.', { force: true });
      }
      // One correction at a time. Stacking cues mid-rep is noise, not coaching.
      const fault = result.faults[0];
      if (fault && say(fault.cue, { throttleKey: fault.id })) return fault.cue;
      return null;
    },

    /** Called when the lifter racks it. `st` is the exercises.js state for the set just done. */
    endSet(st) {
      const faults = Object.values(st.faultCounts).reduce((a, b) => a + b, 0);
      const record = {
        at: new Date().toISOString(),
        exId: current.exId,
        set: setIdx + 1,
        reps: st.reps,
        target: current.reps,
        load: current.load,
        faults: { ...st.faultCounts },
      };
      store.appendLog(record);
      exerciseSets.push(record);

      const hit = st.reps >= current.reps;
      say(hit ? `Set done. ${st.reps} reps. Rest ${current.rest} seconds.`
              : `Set done. ${st.reps} of ${current.reps}. Rest ${current.rest} seconds.`, { force: true });

      setIdx += 1;
      if (setIdx < current.sets) return { done: false, rest: current.rest, record, faults };

      const verdict = this.progress(exerciseSets);
      return { done: true, rest: current.rest, record, faults, verdict };
    },

    /** Linear progression, gated on form. Missing reps OR a messy set holds the load. */
    progress(sets) {
      const { exId, load, increment } = current;
      const allReps = sets.every((s) => s.reps >= s.target);
      const totalReps = sets.reduce((a, s) => a + s.reps, 0);
      const totalFaults = sets.reduce((a, s) => a + Object.values(s.faults).reduce((x, y) => x + y, 0), 0);
      const rate = totalReps ? totalFaults / totalReps : 0;

      if (allReps && rate < CLEAN_FAULTS_PER_REP) {
        const next = load + increment;
        store.setLoad(exId, next);
        say(`All reps, clean. Next time ${next} kilos.`, { force: true });
        return { moved: true, from: load, to: next, reason: 'all reps clean' };
      }
      say(`Staying at ${load} kilos next time. ${!allReps ? 'You missed reps.' : 'Form broke down.'}`, { force: true });
      return { moved: false, from: load, to: load, reason: !allReps ? 'reps missed' : 'form broke down' };
    },

    /** Back to the picker without finishing the lift — no progression verdict. */
    clear() {
      current = null;
      setIdx = 0;
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
