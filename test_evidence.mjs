// Self-check for the evidence layer. Run: node test_evidence.mjs
//
// These are adversarial on purpose. The thing being tested is not "does it return data" — it is
// whether the layer can be made to state a measurement nobody took. Every check below is written
// as the lie it is trying to prevent:
//
//   a fresh install claiming zero sets of everything
//   an unwatched lift claiming clean form
//   one bad set claiming to be a pattern
//   a load change claiming to be a decision
//
// Same localStorage shim + dynamic import as the other suites.

import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

const store = await import('./www/store.js');
const evidence = await import('./www/evidence.js');

const NOW = new Date('2026-08-12T18:00:00Z');
const DAY = 86400000;
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString();

const set = (exId, at, load, reps, faults = {}, faultEvents = undefined) => ({
  at, exId, set: 1, load, reps, target: reps, faults, repMs: [2000, 2100],
  ...(faultEvents === undefined ? {} : { faultEvents }),
});

const ok = [];
const check = (name, fn) => { mem.clear(); fn(); ok.push(name); };

/** Every number that reached the packet, so a check can assert none of them were invented. */
const numbersIn = (obj) => JSON.stringify(obj).match(/-?\d+(\.\d+)?/g) ?? [];

// ── SCENARIO 1 — fresh install ───────────────────────────────────────────────────────────

check('a fresh install reports no evidence, and not a single measured zero', () => {
  const t = evidence.trainingEvidence(NOW);
  assert.equal(t.status, 'no_evidence');
  assert.equal(t.facts, undefined, 'no facts object to read a zero out of');
  assert.equal(t.coverage, undefined);
  assert.deepEqual(numbersIn(t), [], 'a fresh install must not contain a number at all');
  assert.match(t.limitation, /nothing to summarise/i);

  for (const e of [evidence.liftEvidence('squat'), evidence.movementEvidence('squat'),
    evidence.progressionEvidence('squat')]) {
    assert.equal(e.status, 'no_evidence', `${e.domain} must be absent, not zero`);
    assert.ok(e.limitation, 'and must say why');
  }
});

check('a measured zero survives, because it is a real observation', () => {
  // Trained a month ago, nothing this week. The all-time count is real and must be reported; the
  // empty week is real too and is said in words rather than as six zeroed muscle groups.
  store.write({ log: [set('squat', daysAgo(30), 80, 5), set('squat', daysAgo(29), 80, 5)] });
  const t = evidence.trainingEvidence(NOW);
  assert.equal(t.status, 'ok', 'history exists, so this is a finding and not an absence');
  assert.equal(t.facts.setsAllTime, 2, 'the real count is reported');
  assert.deepEqual(t.facts.setsPerGroupThisWeek, {}, 'and no group is claimed to have been trained');
  assert.equal(t.coverage.groupsThisWeek, 0, 'a counted zero, from data that exists');
  assert.match(t.limitation, /last 7 days/);
});

check('partial history reports what was trained and stays silent on what was not', () => {
  store.write({ log: [set('squat', daysAgo(1), 80, 5), set('squat', daysAgo(1), 80, 5)] });
  const t = evidence.trainingEvidence(NOW);
  assert.deepEqual(Object.keys(t.facts.setsPerGroupThisWeek), ['Legs']);
  assert.equal(t.facts.setsPerGroupThisWeek.Chest, undefined, 'an untrained group is absent, never 0');
});

// ── SCENARIO 2 — no movement pattern data ────────────────────────────────────────────────

check('sets logged without fault tracking say nothing about form, in either direction', () => {
  // Legacy sets: no faultEvents field at all. This is the lie that matters — six clean-LOOKING
  // sets that were never watched must not read as six clean sets.
  const log = [];
  for (let i = 0; i < 6; i += 1) log.push(set('squat', daysAgo(i), 80, 5));
  store.write({ log });

  const m = evidence.movementEvidence('squat');
  assert.equal(m.status, 'no_evidence');
  assert.equal(m.facts, undefined, 'no empty pattern list to misread as "no faults"');
  assert.match(m.limitation, /per-rep fault tracking/);
  assert.doesNotMatch(JSON.stringify(m), /stable|clean|good|fine/i,
    'absence of watching is not a verdict on form');

  // But the strength trend, which needs no fault data, is still perfectly readable.
  assert.equal(evidence.liftEvidence('squat').status, 'ok');
});

check('watched sets with nothing recurring is a finding, and reads differently from no data', () => {
  const log = [];
  for (let i = 0; i < 5; i += 1) log.push(set('squat', daysAgo(i), 80, 5, {}, []));
  store.write({ log });

  const m = evidence.movementEvidence('squat');
  assert.equal(m.status, 'ok', 'watched, and the finding is negative — not the same as unwatched');
  assert.deepEqual(m.facts.patterns, [], 'an empty list under ok is the real "nothing recurred"');
  assert.equal(m.coverage.setsWatched, 5);
  assert.match(m.limitation, /no fault recurred/);
});

// ── SCENARIO 3 — a one-off is not a pattern ──────────────────────────────────────────────

check('one bad set among many is never reported as recurring', () => {
  const log = [];
  for (let i = 0; i < 5; i += 1) log.push(set('squat', daysAgo(i + 1), 80, 5, {}, []));
  log.push(set('squat', daysAgo(0), 80, 5, { depth: 1 }, [{ rep: 4, id: 'depth' }]));
  store.write({ log });

  const p = evidence.movementEvidence('squat').facts.patterns;
  assert.equal(p.length, 1);
  assert.equal(p[0].status, 'occasional', 'once in six is occasional, not recurring');
  assert.ok(p[0].confidence < 0.5, `confidence must stay low, got ${p[0].confidence}`);
  assert.equal(p[0].inSets, 1);
  assert.equal(p[0].ofSets, 6, 'the five clean sets stay in the denominator');
});

check('below the evidence floor, a pattern is refused and the shortfall is named', () => {
  store.write({ log: [set('squat', daysAgo(1), 80, 5, { depth: 2 }, [{ rep: 3, id: 'depth' }])] });
  const m = evidence.movementEvidence('squat');
  assert.equal(m.status, 'insufficient_evidence');
  assert.equal(m.facts, undefined, 'no pattern is offered at all');
  assert.equal(m.coverage.setsWatched, 1);
  assert.equal(m.coverage.setsNeeded, 3, 'and it says how many more would answer it');
});

// ── SCENARIO 4 — a strong recurring fault carries everything ─────────────────────────────

check('a recurring fault arrives with frequency, confidence and timing', () => {
  const log = [];
  for (let i = 0; i < 6; i += 1) {
    log.push(set('squat', daysAgo(i), 80, 8, { depth: 2 },
      [{ rep: 5, id: 'depth' }, { rep: 7, id: 'depth' }]));
  }
  store.write({ log });

  const m = evidence.movementEvidence('squat');
  assert.equal(m.status, 'ok');
  const [top] = m.facts.patterns;
  assert.equal(top.signal, 'Not reaching depth', 'the human label, not the rule-table id');
  assert.equal(top.status, 'recurring');
  assert.equal(top.confidence, 1, 'exactly matching/observed, not a rounded-up score');
  assert.equal(top.inSets, 6);
  assert.equal(top.ofSets, 6);
  assert.equal(top.startsAroundRep, 5, 'and where in the set it starts');
  assert.equal(m.coverage.setsWatched, 6);
});

// ── SCENARIO 5 — storage order is not chronology ─────────────────────────────────────────

check('a shuffled log still yields a chronologically correct trend', () => {
  const rows = [
    set('bench', daysAgo(30), 60, 5),
    set('bench', daysAgo(15), 70, 5),
    set('bench', daysAgo(1), 80, 5),
  ];
  store.write({ log: [rows[2], rows[0], rows[1]] });   // deliberately out of order

  const e = evidence.liftEvidence('bench');
  assert.equal(e.status, 'ok');
  assert.ok(e.facts.changePct > 0, `a gain must not read as a loss (got ${e.facts.changePct}%)`);
  assert.ok(e.facts.overDays > 0, `elapsed days must never be negative (got ${e.facts.overDays})`);
  assert.equal(e.facts.currentLoadKg, 80, 'the current load is the newest one, not the last stored');
  assert.ok(new Date(e.period.from) < new Date(e.period.to), 'and the period runs forwards');
});

// ── SCENARIO 6/7 — the progression verdict ───────────────────────────────────────────────

check('a recorded decision can be explained from its own numbers', () => {
  store.write({ log: [set('squat', daysAgo(1), 100, 3, { depth: 4 })] });
  store.appendVerdict({
    exId: 'squat', decision: 'hold', unit: 'kg', from: 100, to: 100, reason: 'reps missed',
    evidence: { sets: 3, repsHit: false, totalReps: 11, totalFaults: 4, faultsPerRep: 0.36, cleanLimit: 0.34, stalledSessions: 2 },
  });

  const p = evidence.progressionEvidence('squat');
  assert.equal(p.status, 'ok');
  assert.equal(p.facts.decision, 'hold');
  assert.equal(p.facts.reason, 'reps missed');
  assert.equal(p.facts.faultsPerRep, 0.36);
  assert.equal(p.facts.cleanLimit, 0.34, 'the threshold travels with the number it was compared to');
  assert.equal(p.facts.repsHit, false);
  assert.ok(p.period.at, 'and when it was decided');
});

check('a decision that was never recorded stays unavailable, and is not reconstructed', () => {
  // The load moved 60 → 80. It is tempting and completely wrong to infer "so it progressed":
  // it could have been typed by hand, or restored from a backup, or decided before verdicts existed.
  store.write({
    log: [set('bench', daysAgo(20), 60, 5), set('bench', daysAgo(1), 80, 5)],
    loads: { bench: 80 },
  });
  const p = evidence.progressionEvidence('bench');
  assert.equal(p.status, 'no_evidence');
  assert.equal(p.facts, undefined, 'no invented decision, no inferred reason');
  assert.match(p.limitation, /not recoverable|not guessed/i);

  // And the lift itself still reads fine — one absent domain does not blank the others.
  assert.equal(evidence.liftEvidence('bench').status, 'ok');
});

// ── SCENARIO 8 — confidence survives to the edge ─────────────────────────────────────────

check('low confidence reaches the packet as a number, never as a word', () => {
  const log = [];
  for (let i = 0; i < 4; i += 1) log.push(set('squat', daysAgo(i + 1), 80, 8, {}, []));
  for (let i = 0; i < 2; i += 1) {
    log.push(set('squat', daysAgo(i), 80, 8, { torso: 1 }, [{ rep: 6, id: 'torso' }]));
  }
  store.write({ log });

  const [top] = evidence.movementEvidence('squat').facts.patterns;
  assert.equal(top.confidence, 0.33, 'two of six, carried through exactly');
  assert.equal(top.status, 'occasional');
  assert.equal(`${top.inSets} of ${top.ofSets}`, '2 of 6', 'the fraction is legible without the label');
  assert.equal(typeof top.confidence, 'number', 'never "low"/"medium" — the caller decides the wording');
});

// ── contract-level checks ────────────────────────────────────────────────────────────────

check('every reader branches on status, and every non-ok result explains itself', () => {
  const cases = [
    evidence.trainingEvidence(NOW),
    evidence.liftEvidence('squat'),
    evidence.movementEvidence('squat'),
    evidence.progressionEvidence('squat'),
    evidence.liftEvidence('not-a-lift'),
    evidence.movementEvidence('not-a-lift'),
    evidence.progressionEvidence('not-a-lift'),
  ];
  for (const c of cases) {
    assert.ok(c.domain, 'every result names its domain');
    assert.ok(['ok', 'no_evidence', 'insufficient_evidence', 'unknown_exercise'].includes(c.status),
      `unexpected status ${c.status}`);
    if (c.status !== 'ok') assert.ok(c.limitation, `${c.domain}/${c.status} must say what is missing`);
  }
});

check('an exercise this app does not have is refused, not answered with an empty history', () => {
  store.write({ log: [set('squat', daysAgo(1), 80, 5)] });
  const e = evidence.liftEvidence('bicep-blaster-3000');
  assert.equal(e.status, 'unknown_exercise');
  assert.notEqual(e.status, 'no_evidence', 'saying "you have never trained it" would be a claim about the user');
  assert.match(e.limitation, /no lift called/);
});

check('one lift composes into three independently-absent domains', () => {
  const log = [];
  for (let i = 0; i < 4; i += 1) log.push(set('squat', daysAgo(i), 80, 5));  // no fault tracking
  store.write({ log });
  const all = evidence.forLift('squat');
  assert.equal(all.lift.status, 'ok', 'strength is knowable');
  assert.equal(all.movement.status, 'no_evidence', 'form is not');
  assert.equal(all.progression.status, 'no_evidence', 'nor is any decision');
});

console.log(ok.map((n) => `  ok  ${n}`).join('\n'));
console.log(`\n${ok.length} checks passed`);
