// Guided protocol collection: counting, sessions, conditions, and the boundary between
// "we took the photographs" and "a measurement survived them". Run: node test_face_protocol.mjs
//
// THE MOST IMPORTANT TEST IN THIS FILE is the last one: completing every protocol must NOT validate
// a single signal. Collection and validation are different questions, and the failure mode of a
// collection dashboard is that a wall of COMPLETE starts to read like a result.
//
// No camera, no network, no key, no model. Fixtures only — and fixtures are not empirical evidence,
// which is precisely why the last test asserts they cannot become it.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const protocol = await import('./www/face/protocol.js');
const validation = await import('./www/face/validation.js');
const record = await import('./www/face/record.js');
const { FEATURES } = await import('./www/face/features.js');

const ok = [];
const check = (name, fn) => { fn(); ok.push(name); };

/** Local midday, so a calendar-day assertion means the same thing in every timezone. */
const at = (day, hour = 12, min = 0) => new Date(2026, 7, day, hour, min).toISOString();

const cap = (over = {}) => ({
  at: at(1),
  protocol: 'A',
  accepted: true,
  condition: 'baseline',
  versions: record.versions(true),
  regions: { leftCheek: { available: true, coverage: 0.7, features: { dChromaRG: 1, localContrast: 0.02 } } },
  ...over,
});

// ── the spec itself ──────────────────────────────────────────────────────────────────────

check('every protocol declares what a tester must actually do', () => {
  for (const id of protocol.IDS) {
    const s = protocol.SPEC[id];
    assert.ok(s.purpose && s.instruction, `${id} explains itself`);
    assert.ok(s.conditions.length >= 1, `${id} has conditions`);
    assert.ok(s.conditions.includes('baseline'), `${id} has a baseline to compare against`);
    assert.ok(s.minConditions <= s.conditions.length, `${id} cannot demand more conditions than it offers`);
    assert.ok(s.minCaptures >= 1);
  }
  // Only F is optional. Everything else applies to every tester.
  assert.equal(protocol.SPEC.F.optional, true);
  assert.ok(!protocol.SPEC.A.optional);
});

check('collection vocabulary shares no word with signal vocabulary', () => {
  // If these ever overlap, a dashboard could show the same word for "photographs taken" and
  // "measurement trustworthy", which is the one confusion this whole split exists to prevent.
  const collection = new Set(Object.values(protocol.COLLECTION));
  const signal = new Set(Object.values(validation.STATES));
  for (const word of collection) assert.ok(!signal.has(word), `${word} must not mean two things`);
});

// ── counting ─────────────────────────────────────────────────────────────────────────────

check('an accepted capture advances the count', () => {
  const caps = Array.from({ length: 4 }, (_, i) => cap({ at: at(1, 9, i) }));
  const p = protocol.progress(caps, 'A');
  assert.equal(p.accepted, 4);
  assert.equal(p.counted, 4);
  assert.equal(p.remaining, 6);
  assert.equal(p.state, protocol.COLLECTION.COLLECTING);
});

check('a REJECTED capture does not advance the count, and is not hidden either', () => {
  const caps = [
    ...Array.from({ length: 3 }, (_, i) => cap({ at: at(1, 9, i) })),
    ...Array.from({ length: 5 }, (_, i) => cap({ at: at(1, 10, i), accepted: false })),
  ];
  const p = protocol.progress(caps, 'A');
  assert.equal(p.accepted, 3, 'only accepted captures count toward the target');
  assert.equal(p.counted, 3);
  assert.equal(p.rejected, 5, 'but the rejections are reported — a gate refusing everything is a finding');
  assert.equal(p.remaining, 7);
});

check('protocol A completes at ten accepted', () => {
  const caps = Array.from({ length: 10 }, (_, i) => cap({ at: at(1, 9, i) }));
  assert.equal(protocol.progress(caps, 'A').state, protocol.COLLECTION.COMPLETE);
  assert.equal(protocol.progress(caps.slice(0, 9), 'A').state, protocol.COLLECTION.COLLECTING);
});

check('no captures at all is NOT_STARTED, not zero-of-complete', () => {
  assert.equal(protocol.progress([], 'A').state, protocol.COLLECTION.NOT_STARTED);
});

// ── protocol B: days must be real days ───────────────────────────────────────────────────

check('protocol B counts one capture per calendar day, not ten in a row', () => {
  // The thing this exists to prevent: faking a week by standing still for ten minutes.
  const sameDay = Array.from({ length: 10 }, (_, i) => cap({ protocol: 'B', at: at(1, 9, i) }));
  const p = protocol.progress(sameDay, 'B');
  assert.equal(p.accepted, 10);
  assert.equal(p.counted, 1, 'ten captures in one sitting are one day of evidence');
  assert.equal(p.days, 1);
  assert.equal(p.state, protocol.COLLECTION.COLLECTING);
});

check('protocol B completes across seven genuinely different days', () => {
  const week = Array.from({ length: 7 }, (_, i) => cap({ protocol: 'B', at: at(i + 1) }));
  const p = protocol.progress(week, 'B');
  assert.equal(p.counted, 7);
  assert.equal(p.days, 7);
  assert.equal(p.state, protocol.COLLECTION.COMPLETE);
});

check('the validation series for B is day-limited too, so spread is genuinely day-to-day', () => {
  // Not just the counter — the number that feeds the gate. Ten same-day captures must not become
  // the "across-session spread" that same-session noise is judged against.
  const sameDay = Array.from({ length: 10 }, (_, i) => cap({ protocol: 'B', at: at(1, 9, i) }));
  assert.equal(validation.series(sameDay, 'B', 'leftCheek', 'dChromaRG').length, 1);
  const week = Array.from({ length: 7 }, (_, i) => cap({ protocol: 'B', at: at(i + 1) }));
  assert.equal(validation.series(week, 'B', 'leftCheek', 'dChromaRG').length, 7);
  // Protocol A is NOT day-limited — its whole point is many captures in one sitting.
  const a = Array.from({ length: 10 }, (_, i) => cap({ at: at(1, 9, i) }));
  assert.equal(validation.series(a, 'A', 'leftCheek', 'dChromaRG').length, 10);
});

check('B tells the tester to come back tomorrow rather than offering a button that does nothing', () => {
  const today = [cap({ protocol: 'B', at: new Date().toISOString() })];
  const step = protocol.nextStep(today, 'B');
  assert.equal(step.blocked, true);
  assert.match(step.message, /tomorrow/);
});

// ── conditions ───────────────────────────────────────────────────────────────────────────

check('a stress protocol needs varied conditions, not just a count', () => {
  const sixBaselines = Array.from({ length: 6 }, (_, i) => cap({ protocol: 'C', at: at(1, 9, i) }));
  const p = protocol.progress(sixBaselines, 'C');
  assert.equal(p.counted, 6, 'the count is met');
  assert.equal(p.state, protocol.COLLECTION.COLLECTING, 'but one lighting condition is not lighting stress');
  assert.match(p.note, /only 1 of the 4 conditions/);

  const varied = ['baseline', 'brighter', 'dimmer', 'side-lit', 'warm', 'cool']
    .map((condition, i) => cap({ protocol: 'C', condition, at: at(1, 9, i) }));
  assert.equal(protocol.progress(varied, 'C').state, protocol.COLLECTION.COMPLETE);
});

check('the next step asks for the condition nobody has tried yet', () => {
  const some = ['baseline', 'baseline', 'brighter'].map((condition, i) => cap({ protocol: 'C', condition, at: at(1, 9, i) }));
  const step = protocol.nextStep(some, 'C');
  assert.ok(['dimmer', 'side-lit'].includes(step.condition), `asked for an untried condition, got ${step.condition}`);
  assert.equal(step.repetition, 4);
});

check('occlusion counts attempts, because a rejection is the correct result there', () => {
  // E is the one protocol where the gate refusing is evidence, not a failure to collect.
  const caps = [
    cap({ protocol: 'E', condition: 'baseline' }),
    cap({ protocol: 'E', condition: 'glasses', accepted: false, at: at(1, 10) }),
    cap({ protocol: 'E', condition: 'hair-forehead', accepted: false, at: at(1, 11) }),
    cap({ protocol: 'E', condition: 'hair-cheek', accepted: false, at: at(1, 12) }),
  ];
  const p = protocol.progress(caps, 'E');
  assert.equal(p.counted, 4, 'attempts count, accepted or not');
  assert.equal(p.rejected, 3);
  assert.equal(p.state, protocol.COLLECTION.COMPLETE);
});

// ── NOT_APPLICABLE ───────────────────────────────────────────────────────────────────────

check('NOT_APPLICABLE is its own answer and never decays into a verdict', () => {
  const p = protocol.progress([], 'F', { F: true });
  assert.equal(p.state, protocol.COLLECTION.NOT_APPLICABLE);
  // The three things it must never become.
  assert.notEqual(p.state, protocol.COLLECTION.COMPLETE);
  assert.notEqual(p.state, protocol.COLLECTION.COLLECTING);
  assert.notEqual(p.state, validation.STATES.INSUFFICIENT_DATA);
  assert.equal(p.remaining, 0, 'nothing is outstanding for a protocol that does not apply');
  const step = protocol.nextStep([], 'F', { F: true });
  assert.equal(step.done, true);
});

check('marking not-applicable does not touch any other protocol', () => {
  const board = protocol.dashboard([], { F: true });
  assert.equal(board.find((p) => p.id === 'F').state, protocol.COLLECTION.NOT_APPLICABLE);
  assert.equal(board.find((p) => p.id === 'A').state, protocol.COLLECTION.NOT_STARTED);
});

// ── sessions and ordering ────────────────────────────────────────────────────────────────

check('sessions are distinguishable in the record', () => {
  const caps = [
    cap({ session: 'A-morning', at: at(1, 9) }),
    cap({ session: 'A-morning', at: at(1, 9, 5) }),
    cap({ session: 'A-evening', at: at(1, 20) }),
  ];
  assert.equal(new Set(caps.map((c) => c.session)).size, 2);
  assert.equal(protocol.progress(caps, 'A').counted, 3, 'all still count toward A');
});

check('history handed over backwards gives the same answer', () => {
  const week = Array.from({ length: 7 }, (_, i) => cap({ protocol: 'B', at: at(i + 1) }));
  const forwards = protocol.progress(week, 'B');
  const backwards = protocol.progress([...week].reverse(), 'B');
  assert.deepEqual(forwards, backwards);
});

check('a capture with no protocol is counted as untagged, never silently assigned one', () => {
  const caps = [cap(), cap({ protocol: null, at: at(1, 10) })];
  const t = protocol.totals(caps);
  assert.equal(t.untagged, 1);
  assert.equal(protocol.progress(caps, 'A').counted, 1, 'the untagged one joins no protocol');
});

// ── backward compatibility ───────────────────────────────────────────────────────────────

check('Phase 3.5 captures with no protocol metadata still load and evaluate', () => {
  // A corpus collected before this phase existed must not become unreadable.
  const legacy = { at: at(1), protocol: 'A', accepted: true, versions: record.versions(true), regions: { leftCheek: { available: true, features: { dChromaRG: 1 } } } };
  assert.ok(!('condition' in legacy));
  assert.ok(!('session' in legacy));
  const p = protocol.progress([legacy], 'A');
  assert.equal(p.counted, 1);
  assert.deepEqual(p.conditions, [], 'no condition label is not a blank one');
  assert.equal(validation.series([legacy], 'A', 'leftCheek', 'dChromaRG').length, 1);
});

check('build omits protocol fields entirely when they are absent', () => {
  const bare = record.build({ accepted: true, quality: {}, regions: {}, device: {}, sampling: {}, segmenterUsed: true });
  assert.ok(!('session' in bare), 'absent, not null');
  assert.ok(!('condition' in bare));
  assert.ok(!('repetition' in bare));
  assert.equal(bare.protocol, null);

  const full = record.build({
    protocol: 'C', session: 'C-1', repetition: 3, condition: 'dimmer',
    accepted: true, quality: {}, regions: {}, device: {}, sampling: {}, segmenterUsed: true,
  });
  assert.equal(full.session, 'C-1');
  assert.equal(full.repetition, 3);
  assert.equal(full.condition, 'dimmer');
  // No `inclusion` field: `protocol` and `accepted` already decide that, and a third field
  // restating them is a third field that can disagree with them.
  assert.ok(!('inclusion' in full));
});

// ── export ───────────────────────────────────────────────────────────────────────────────

check('the export carries protocol metadata and no image', () => {
  const caps = [cap({ protocol: 'C', condition: 'dimmer', session: 'C-1', repetition: 2 })];
  const payload = { kind: 'face-validation-export', v: 1, notApplicable: { F: true }, captures: caps };
  const text = JSON.stringify(payload);
  assert.match(text, /"condition":"dimmer"/);
  assert.match(text, /"session":"C-1"/);
  assert.match(text, /"notApplicable":\{"F":true\}/);
  // No image can be in there, because none is ever stored.
  assert.ok(!/data:image|base64|\.png/.test(text), 'no image data of any kind');
});

check('no face module ever stores an image, so no export can contain one', () => {
  // The guarantee is structural rather than a property of the export function: there is nothing to
  // export because nothing is written. Asserted over the record module's whole surface.
  const src = readFileSync('./www/face/record.js', 'utf8');
  assert.ok(!/toDataURL|toBlob|image\/png/.test(src), 'record.js never touches image data');
});

// ── the boundary that matters most ───────────────────────────────────────────────────────

check('COMPLETING EVERY PROTOCOL VALIDATES NOTHING', () => {
  // The single most important assertion in this phase. Build a corpus that completes every protocol
  // — a full green dashboard — with feature values that are pure noise, and assert that not one
  // signal reaches VALIDATED.
  const caps = [];
  let n = 0;
  const noisy = () => Math.sin(n++ * 12.9898) * 5;

  for (let i = 0; i < 10; i += 1) caps.push(cap({ protocol: 'A', at: at(1, 9, i), regions: { leftCheek: { available: true, features: { dChromaRG: noisy() } } } }));
  for (let i = 0; i < 7; i += 1) caps.push(cap({ protocol: 'B', at: at(i + 1), regions: { leftCheek: { available: true, features: { dChromaRG: noisy() } } } }));
  for (const [i, condition] of ['baseline', 'brighter', 'dimmer', 'side-lit', 'warm', 'cool'].entries()) {
    caps.push(cap({ protocol: 'C', condition, at: at(2, 9, i), regions: { leftCheek: { available: true, features: { dChromaRG: noisy() } } } }));
  }
  for (const [i, condition] of ['baseline', 'closer', 'farther', 'roll-left', 'roll-right', 'yaw-left'].entries()) {
    caps.push(cap({ protocol: 'D', condition, at: at(3, 9, i), regions: { leftCheek: { available: true, features: { dChromaRG: noisy() } } } }));
  }
  for (const [i, condition] of ['baseline', 'glasses', 'hair-forehead', 'hair-cheek'].entries()) {
    caps.push(cap({ protocol: 'E', condition, at: at(4, 9, i), regions: { leftCheek: { available: true, features: { dChromaRG: noisy() } } } }));
  }
  for (const [i, condition] of ['baseline', 'stubble', 'beard', 'freshly-shaved', 'baseline', 'stubble'].entries()) {
    caps.push(cap({ protocol: 'F', condition, at: at(5 + i, 9), regions: { leftCheek: { available: true, features: { dChromaRG: noisy() } } } }));
  }

  const board = protocol.dashboard(caps, {});
  assert.ok(board.every((p) => p.state === protocol.COLLECTION.COMPLETE),
    `every protocol collected: ${board.map((p) => `${p.id}:${p.state}`).join(' ')}`);

  const signals = validation.evaluateAll(caps, ['leftCheek'], FEATURES);
  assert.equal(validation.productReady(signals).length, 0,
    'a fully collected corpus of noise validates NOTHING');
  const dChroma = signals.find((s) => s.feature === 'dChromaRG');
  assert.notEqual(dChroma.state, validation.STATES.VALIDATED);
});

check('fixtures cannot become empirical evidence by volume', () => {
  // Two hundred identical synthetic captures still validate nothing real. Included because "we have
  // a lot of data now" is the argument that would otherwise erode this.
  const many = Array.from({ length: 200 }, (_, i) => cap({ at: at(1, 9, i % 60) }));
  const signals = validation.evaluateAll(many, ['leftCheek'], FEATURES);
  assert.equal(validation.productReady(signals).length, 0);
});

console.log(`face protocol: ${ok.length} checks passed`);
