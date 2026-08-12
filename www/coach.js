// The PT layer: what to lift, how much, counting it out loud, and deciding next week's load.
// Deliberately rules, not a model — progression is arithmetic and a coach's voice is a lookup.

import { EXERCISES, defaultThresholds } from './exercises.js';
import * as store from './store.js';

export const PLAN = [
  { exId: 'squat',        sets: 3, reps: 5,  startLoad: 40, increment: 5,   rest: 180 },
  { exId: 'bench',        sets: 3, reps: 5,  startLoad: 30, increment: 2.5, rest: 180 },
  { exId: 'skullcrusher', sets: 3, reps: 10, startLoad: 15, increment: 2.5, rest: 90  },
  { exId: 'pushdown',     sets: 3, reps: 12, startLoad: 20, increment: 2.5, rest: 60  },
];

const CUE_COOLDOWN_MS = 6000;   // same fault will not be repeated inside this window
const SPEECH_GAP_MS = 1200;     // never talk over yourself
const CLEAN_FAULTS_PER_REP = 0.34; // above this, the set was not clean enough to add weight

export function createCoach({ speak }) {
  let planIdx = 0;
  let setIdx = 0;
  let lastSpoke = 0;
  const cueAt = new Map();
  let exerciseSets = [];  // results of the sets done so far on the current exercise

  const item = () => PLAN[planIdx];
  const exId = () => item().exId;

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
    get state() {
      if (planIdx >= PLAN.length) return { finished: true };
      const it = item();
      return {
        exId: it.exId,
        name: EXERCISES[it.exId].name,
        hint: EXERCISES[it.exId].cameraHint,
        set: setIdx + 1,
        sets: it.sets,
        targetReps: it.reps,
        load: store.getLoad(it.exId, it.startLoad),
        rest: it.rest,
        thresholds: store.getThresholds(it.exId, defaultThresholds(it.exId)),
        finished: planIdx >= PLAN.length,
      };
    },

    announceSet() {
      const s = this.state;
      say(`${s.name}. Set ${s.set} of ${s.sets}. ${s.targetReps} reps at ${s.load} kilos.`, { force: true });
    },

    /** Feed every analysed frame through here. Returns the cue it decided to speak, if any. */
    onFrame(result) {
      if (!result.visible) {
        say('I cannot see you. Step back into frame.', { throttleKey: 'novisible' });
        return null;
      }
      if (result.repCompleted) {
        const left = item().reps - result.reps;
        say(left > 0 ? String(result.reps) : 'Last one done.', { force: true });
      }
      // One correction at a time. Stacking cues mid-rep is noise, not coaching.
      const fault = result.faults[0];
      if (fault && say(fault.cue, { throttleKey: fault.id })) return fault.cue;
      return null;
    },

    /** Called when the lifter racks it. `st` is the exercises.js state for the set just done. */
    endSet(st) {
      const it = item();
      const faults = Object.values(st.faultCounts).reduce((a, b) => a + b, 0);
      const record = {
        at: new Date().toISOString(),
        exId: it.exId,
        set: setIdx + 1,
        reps: st.reps,
        target: it.reps,
        load: store.getLoad(it.exId, it.startLoad),
        faults: { ...st.faultCounts },
      };
      store.appendLog(record);
      exerciseSets.push(record);

      const hit = st.reps >= it.reps;
      say(hit ? `Set done. ${st.reps} reps. Rest ${it.rest} seconds.`
              : `Set done. ${st.reps} of ${it.reps}. Rest ${it.rest} seconds.`, { force: true });

      setIdx += 1;
      if (setIdx < it.sets) return { done: false, rest: it.rest, record, faults };

      const verdict = this.progress(exerciseSets);
      exerciseSets = [];
      setIdx = 0;
      planIdx += 1;
      return { done: true, rest: it.rest, record, faults, verdict };
    },

    /** Linear progression, gated on form. Missing reps OR a messy set holds the load. */
    progress(sets) {
      const it = PLAN[planIdx];
      const load = store.getLoad(it.exId, it.startLoad);
      const allReps = sets.every((s) => s.reps >= s.target);
      const totalReps = sets.reduce((a, s) => a + s.reps, 0);
      const totalFaults = sets.reduce((a, s) => a + Object.values(s.faults).reduce((x, y) => x + y, 0), 0);
      const rate = totalReps ? totalFaults / totalReps : 0;

      if (allReps && rate < CLEAN_FAULTS_PER_REP) {
        const next = load + it.increment;
        store.setLoad(it.exId, next);
        say(`All reps, clean. Next time ${next} kilos.`, { force: true });
        return { moved: true, from: load, to: next, reason: 'all reps clean' };
      }
      const reason = !allReps ? 'reps missed' : 'form broke down';
      say(`Staying at ${load} kilos next time. ${!allReps ? 'You missed reps.' : 'Form broke down.'}`, { force: true });
      return { moved: false, from: load, to: load, reason };
    },

    skipExercise() {
      exerciseSets = [];
      setIdx = 0;
      planIdx += 1;
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
