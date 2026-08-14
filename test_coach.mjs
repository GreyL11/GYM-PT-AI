// Self-check for the coaching layer: warm-up ramps, progression, rep correction.
// Run: node test_coach.mjs   (localStorage shim + dynamic import, as in the other suites)

import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

const { createCoach, warmupsFor } = await import('./www/coach.js');
const store = await import('./www/store.js');
const planner = await import('./www/planner.js');

const said = [];
const newCoach = () => { said.length = 0; return createCoach({ speak: (t) => said.push(t) }); };
const reset = () => mem.clear();
/** A finished set, as exercises.js would leave it. */
const setDone = (reps, faults = {}, faultEvents = []) => ({ reps, faultCounts: faults, repMs: [], faultEvents });

const ok = [];
const check = (name, fn) => { reset(); fn(); ok.push(name); };

check('warm-ups apply to heavy compounds only', () => {
  assert.equal(warmupsFor('curl', 60).length, 0, 'isolation needs no ramp');
  assert.equal(warmupsFor('squat', 20).length, 0, 'an empty bar is already the warm-up');
  assert.equal(warmupsFor('squat', 100, false).length, 0, 'and the lifter can switch them off');

  const w = warmupsFor('squat', 100);
  assert.equal(w.length, 2);
  assert.deepEqual(w[0], { load: 50, reps: 5 }, 'half the working weight');
  assert.deepEqual(w[1], { load: 75, reps: 3 }, 'then three-quarters');
  assert.equal(warmupsFor('squat', 47.5)[0].load % 2.5, 0, 'ramps land on loadable plates');
});

check('warm-up sets are announced, not logged, and do not touch progression', () => {
  const coach = newCoach();
  coach.select('squat', { sets: 2, reps: 5, load: 100 });

  assert.equal(coach.state.warmup, true);
  assert.equal(coach.state.label, 'Warm-up 1/2');
  assert.equal(coach.state.load, 50, 'first ramp is 50%');

  let r = coach.endSet(setDone(5));
  assert.equal(r.warmup, true);
  assert.equal(r.done, false);
  assert.equal(coach.state.load, 75, 'second ramp is 75%');

  r = coach.endSet(setDone(3));
  assert.equal(coach.state.warmup, false, 'ramps finished');
  assert.equal(coach.state.label, 'Set 1/2');
  assert.equal(coach.state.load, 100, 'working weight now');
  assert.equal(store.read().log.length, 0, 'nothing logged from warm-ups');

  coach.endSet(setDone(5));
  r = coach.endSet(setDone(5));
  assert.equal(r.done, true, 'two working sets completes the lift');
  assert.equal(store.read().log.length, 2, 'only the working sets are logged');
});

check('progression previews but does not apply until the lift is finished', () => {
  const coach = newCoach();
  coach.select('squat', { sets: 1, reps: 5, load: 100, warmup: false });
  const r = coach.endSet(setDone(5));

  assert.equal(r.verdict.to, 105, 'clean set previews +5');
  assert.equal(store.getLoad('squat', 0), 100, 'but the stored load has NOT moved yet');

  coach.finishExercise();
  assert.equal(store.getLoad('squat', 0), 105, 'committing applies it');
});

check('correcting a miscount changes the log and the verdict', () => {
  const coach = newCoach();
  coach.select('bench', { sets: 1, reps: 5, load: 60, warmup: false });
  // The camera saw 4; the lifter actually did 5.
  const r = coach.endSet(setDone(4));
  assert.equal(r.verdict.moved, false, 'a missed rep holds the weight');

  const amended = coach.amendReps(1);
  assert.equal(amended.reps, 5);
  assert.equal(amended.verdict.moved, true, 'now it is a clean set');
  assert.equal(amended.verdict.to, 62.5);
  assert.equal(store.read().log.at(-1).reps, 5, 'the logged set was corrected too');

  coach.finishExercise();
  assert.equal(store.getLoad('bench', 0), 62.5);
});

check('correction cannot drive reps below zero', () => {
  const coach = newCoach();
  coach.select('bench', { sets: 1, reps: 5, load: 60, warmup: false });
  coach.endSet(setDone(1));
  coach.amendReps(-1);
  const a = coach.amendReps(-1);
  assert.equal(a.reps, 0);
});

// ── P0.6: correctedFrom, the evidence-integrity metadata ──────────────────────────────────
// amendReps() never touches faultEvents in either direction — see MOVEMENT_INTELLIGENCE_DESIGN.md.
// It only records what the ORIGINAL confirmed rep count was, once, so anything reading the record
// later can tell "this was corrected" from "this looks wrong".

check('a downward correction records what reps ORIGINALLY were, on both the log and the return value', () => {
  const coach = newCoach();
  coach.select('squat', { sets: 1, reps: 5, load: 80, warmup: false });
  coach.endSet(setDone(5, {}, [{ rep: 2, id: 'valgus' }, { rep: 5, id: 'valgus' }]));
  coach.amendReps(-2);
  const stored = store.read().log.at(-1);
  assert.equal(stored.reps, 3);
  assert.equal(stored.correctedFrom, 5, 'the pristine original, not the delta');
  // Untouched, in both directions — this is the whole point.
  assert.deepEqual(stored.faultEvents, [{ rep: 2, id: 'valgus' }, { rep: 5, id: 'valgus' }]);
});

check('repeated corrections keep the FIRST original value, not the last intermediate one', () => {
  const coach = newCoach();
  coach.select('bench', { sets: 1, reps: 5, load: 60, warmup: false });
  coach.endSet(setDone(5));
  coach.amendReps(-1); // 5 -> 4, correctedFrom should latch to 5
  coach.amendReps(-1); // 4 -> 3, correctedFrom must NOT become 4
  coach.amendReps(1);  // 3 -> 4
  const stored = store.read().log.at(-1);
  assert.equal(stored.reps, 4);
  assert.equal(stored.correctedFrom, 5, 'the value before ANY correction, however many taps happened since');
});

check('an upward correction is recorded the same way — correction is not assumed to mean "downward"', () => {
  const coach = newCoach();
  coach.select('squat', { sets: 1, reps: 5, load: 80, warmup: false });
  coach.endSet(setDone(3));
  coach.amendReps(2);
  const stored = store.read().log.at(-1);
  assert.equal(stored.reps, 5);
  assert.equal(stored.correctedFrom, 3);
});

check('an uncorrected set never gets a correctedFrom field at all', () => {
  const coach = newCoach();
  coach.select('squat', { sets: 1, reps: 5, load: 80, warmup: false });
  coach.endSet(setDone(5));
  const stored = store.read().log.at(-1);
  assert.equal('correctedFrom' in stored, false, 'absent, not null — nothing here was ever amended');
});

check('bodyweight lifts progress on reps, since there is no weight to add', () => {
  const coach = newCoach();
  coach.select('pushup', { sets: 2, reps: 10, load: 0 });
  assert.equal(coach.state.warmup, false, 'no ramp for a bodyweight lift');

  coach.endSet(setDone(10));
  const r = coach.endSet(setDone(10));
  assert.equal(r.verdict.reps, true, 'the verdict is about reps, not kilos');
  assert.equal(r.verdict.from, 10);
  assert.equal(r.verdict.to, 11);

  coach.finishExercise();
  assert.equal(store.getReps('pushup', 0), 11, 'next session asks for one more');
  assert.equal(store.getLoad('pushup', 0), 0, 'and the weight stays at bodyweight');
});

check('a messy set holds the weight even when every rep was hit', () => {
  const coach = newCoach();
  coach.select('squat', { sets: 1, reps: 5, load: 100, warmup: false });
  const r = coach.endSet(setDone(5, { depth: 3, torso: 2 }));
  assert.equal(r.verdict.moved, false);
  assert.equal(r.verdict.reason, 'form broke down');
  coach.finishExercise();
  assert.equal(store.getLoad('squat', 0), 100);
});

check('progression only ever lands on weights the bar can be loaded to', () => {
  // A gym with no 1.25 kg plates: every barbell weight is a multiple of 5 above the 20 kg bar.
  planner.setProfile({ plates: [25, 20, 15, 10, 5, 2.5] });

  // A load carried over from before those plates were set is already off the grid. Adding a clean
  // increment to it would keep it off the grid forever, so the result has to be snapped, not just
  // the step.
  const coach = newCoach();
  coach.select('bench', { sets: 1, reps: 5, load: 47.5, warmup: false });
  coach.endSet(setDone(5));
  const v = coach.preview();
  assert.ok(v.moved, 'clean set should add weight');
  assert.equal((v.to - 20) % 5, 0, `${v.to} kg cannot be loaded on this bar`);
  assert.ok(v.to > 47.5, 'and it still goes up');

  planner.setProfile({ plates: planner.DEFAULT_PROFILE.plates });
});

check('three sessions stuck triggers the deload through the coach', () => {
  const at = (d) => new Date(Date.now() - d * 86400000).toISOString();
  mem.set('gym-trainer/v1', JSON.stringify({
    loads: { bench: 70 }, thresholds: {}, reps: {}, profile: null,
    log: [
      { at: at(14), exId: 'bench', reps: 3, target: 5, load: 70, faults: {} },
      { at: at(7), exId: 'bench', reps: 3, target: 5, load: 70, faults: {} },
    ],
  }));
  const coach = newCoach();
  coach.select('bench', { sets: 1, reps: 5, load: 70, warmup: false });
  const r = coach.endSet(setDone(3));
  assert.equal(r.verdict.deload, true, 'third stuck session');
  assert.equal(r.verdict.to, 62.5, '10% off, rounded');
  coach.finishExercise();
  assert.equal(store.getLoad('bench', 0), 62.5);
});

check('the coach says the weight out loud, and says bodyweight when there is none', () => {
  const coach = newCoach();
  coach.select('squat', { sets: 1, reps: 5, load: 100, warmup: false });
  coach.announceSet();
  assert.match(said.at(-1), /100 kilos/);

  const c2 = newCoach();
  c2.select('pushup', { sets: 1, reps: 10, load: 0 });
  c2.announceSet();
  assert.match(said.at(-1), /bodyweight/);
});

check('the stored record carries faultEvents through, not just the flat count', () => {
  const coach = newCoach();
  coach.select('squat', { sets: 1, reps: 5, load: 100, warmup: false });
  coach.endSet(setDone(5, { torso: 2 }, [{ rep: 3, id: 'torso' }, { rep: 4, id: 'torso' }]));
  const stored = store.read().log.at(-1);
  assert.deepEqual(stored.faultEvents, [{ rep: 3, id: 'torso' }, { rep: 4, id: 'torso' }]);
  // And the existing flat count — every OTHER consumer's input — is completely unaffected.
  assert.deepEqual(stored.faults, { torso: 2 });
});

check('a legacy-shaped set with no faultEvents field logs cleanly, not a crash', () => {
  const coach = newCoach();
  coach.select('bench', { sets: 1, reps: 5, load: 60, warmup: false });
  // Exactly what exercises.js produced before this field existed — no faultEvents key at all.
  coach.endSet({ reps: 5, faultCounts: {}, repMs: [] });
  const stored = store.read().log.at(-1);
  assert.deepEqual(stored.faultEvents, [], 'missing input becomes an empty array, never undefined or a throw');
});

console.log(ok.map((n) => `  ok  ${n}`).join('\n'));
console.log(`\n${ok.length} checks passed`);
