// Self-check for claim extraction and numeric validation. Run: node test_validate.mjs
//
// No key, no network, no model. Every check here is arithmetic over a fixed evidence packet, which
// is the entire reason this layer was built the way it was: the part that enforces has to be the
// part that can be proven, and a validator that needed a live model to test would be neither.

import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

const claims = await import('./www/claims.js');
const validate = await import('./www/validate.js');
const explain = await import('./www/explain.js');
const store = await import('./www/store.js');

const ok = [];
const check = (name, fn) => { fn(); ok.push(name); };
const checkAsync = async (name, fn) => { mem.clear(); await fn(); ok.push(name); };

/** The shape explain.packet() actually produces, with the real field names. */
const EV = {
  decision: {
    name: 'Back squat', decision: 'hold', reason: 'form broke down',
    from: 60, to: 60, unit: 'kg',
    sets: 3, repsHit: true, totalReps: 24, totalFaults: 9,
    faultsPerRep: 0.38, cleanLimit: 0.34, stalledSessions: 3,
  },
  form: {
    patterns: [{ signal: 'Not reaching depth', status: 'occasional', confidence: 0.33, inSets: 2, ofSets: 6, startsAroundRep: 5 }],
    setsWatched: 6,
  },
};
const INDEX = validate.provenance(EV);

const only = (text, claimed = 'observed') =>
  validate.checkClaim(claims.extract(text, claimed)[0], INDEX);

// ── provenance ───────────────────────────────────────────────────────────────────────────

check('the index is derived from the packet, not written out by hand', () => {
  const ids = INDEX.map((e) => e.id);
  assert.ok(ids.includes('decision.faultsPerRep'));
  assert.ok(ids.includes('form.patterns[0].confidence'));
  assert.ok(ids.includes('form.patterns[0].startsAroundRep'));
  assert.ok(!ids.includes('decision.repsHit'), 'a boolean is not a quantity to check against');
  assert.ok(!ids.includes('decision.unit'), 'nor is a string');
  // The one admitted derivation, so "that is N more than last time" can be said about a real move.
  assert.ok(!ids.includes('decision.△'), 'a hold did not move, so there is no difference to quote');
  assert.ok(validate.provenance({ d: { from: 60, to: 62.5 } }).some((e) => e.id === 'd.△'),
    'but a load that moved yields exactly one derived value');
});

check('a new evidence field becomes checkable without touching this module', () => {
  const idx = validate.provenance({ decision: { somethingNew: 47 } });
  assert.deepEqual(idx.map((e) => e.id), ['decision.somethingNew']);
  assert.equal(validate.checkClaim(claims.extract('47')[0], idx).status, 'supported');
});

// ── VALID ────────────────────────────────────────────────────────────────────────────────

check('an exact integer from the evidence is supported', () => {
  assert.equal(only('you hit 24 reps').status, 'supported');
  assert.equal(only('across 3 sets').status, 'supported');
  assert.equal(only('it starts around rep 5').status, 'supported');
  assert.equal(only('the load stayed at 60 kg').status, 'supported');
});

check('an exact decimal is supported at its own precision', () => {
  assert.equal(only('0.38 corrections per rep').rule, 'decimal');
  assert.equal(only('a limit of 0.34').rule, 'decimal');
});

check('a decimal may be quoted rounder, but never down to no decimals at all', () => {
  assert.equal(only('about 0.4 per rep').status, 'supported', '0.38 to one place');
  // The guard that matters: unrestricted rounding would let 0.38 be quoted as "0", which says
  // something entirely different about the same set.
  const idx = validate.provenance({ x: { faultsPerRep: 0.38 } });
  assert.equal(validate.checkClaim(claims.extract('0 per rep')[0], idx).status, 'unsupported');
  assert.equal(validate.checkClaim(claims.extract('0.4 per rep')[0], idx).status, 'supported');
});

check('a decimal may be written as the percentage it is', () => {
  assert.equal(only('38% of reps drew a correction').rule, 'percent');
  assert.equal(only('confidence around 33%').rule, 'percent', '0.33 → 33%');
  assert.equal(only('33.0% of watched sets').status, 'supported', 'one decimal place is fine too');
});

check('a ratio reads as two supported numbers, because both counts are in the evidence', () => {
  const both = claims.extract('in 2 of 6 watched sets', 'observed').map((c) => validate.checkClaim(c, INDEX));
  assert.deepEqual(both.map((c) => c.status), ['supported', 'supported']);
  assert.equal(both[0].source, 'form.patterns[0].inSets');
  assert.equal(both[1].source, 'form.patterns[0].ofSets');
});

check('the difference between the two loads may be stated', () => {
  const idx = validate.provenance({ decision: { from: 60, to: 62.5 } });
  const r = validate.checkClaim(claims.extract('2.5 kg more')[0], idx);
  assert.equal(r.status, 'supported');
  assert.equal(r.source, 'decision.△');
});

// ── INVALID ──────────────────────────────────────────────────────────────────────────────

check('a fabricated count is rejected', () => {
  assert.equal(only('across 8 sets').status, 'unsupported');
  assert.equal(only('you managed 31 reps').status, 'unsupported');
});

check('a fabricated rep position is rejected', () => {
  assert.equal(only('it starts around rep 7').status, 'unsupported');
});

check('a percentage that no evidence value rounds to is rejected', () => {
  // The spec case: 0.38 is 38%, and "about 40%" is not a rounding anyone declared.
  assert.equal(only('about 40% of your reps').status, 'unsupported');
  assert.equal(only('roughly 30% of sets').status, 'unsupported');
});

check('a wrong denominator is rejected when the number appears nowhere in the evidence', () => {
  const both = claims.extract('in 2 of 7 sets', 'observed').map((c) => validate.checkClaim(c, INDEX));
  assert.equal(both[0].status, 'supported', '2 is real');
  assert.equal(both[1].status, 'unsupported', '7 appears nowhere');
});

check('inflated confidence is rejected', () => {
  assert.equal(only('confidence of 0.9').status, 'unsupported');
  assert.equal(only('90% of your sets').status, 'unsupported');
  assert.equal(only('every one of your 6 sets').status, 'supported', 'but 6 itself is real');
});

check('an invented duration or weight is rejected', () => {
  assert.equal(only('over the last 14 days').status, 'unsupported');
  assert.equal(only('try dropping to 52.5 kg').status, 'unsupported', 'as an observation it fails');
});

check('a negative number is checked like any other', () => {
  const idx = validate.provenance({ weight: { changeKg: -1.3 } });
  assert.equal(validate.checkClaim(claims.extract('down -1.3 kg')[0], idx).status, 'supported');
  assert.equal(validate.checkClaim(claims.extract('down -2.6 kg')[0], idx).status, 'unsupported');
});

// ── recommendations are not claims ───────────────────────────────────────────────────────

check('a number in a suggestion is exempt, because a proposal reports nothing', () => {
  assert.equal(only('try 4 sets next time', 'recommendation').status, 'exempt');
  assert.equal(only('rest 90 seconds', 'recommendation').status, 'exempt');
});

check('the same number is a claim in one field and a proposal in another', () => {
  assert.equal(only('you did 8 sets', 'observed').status, 'unsupported');
  assert.equal(only('do 8 sets', 'recommendation').status, 'exempt');
});

check('prose advice is spotted by its wording, and reports are not', () => {
  assert.ok(claims.isAdvice('Try 4 sets next time.'));
  assert.ok(claims.isAdvice('You might want to rest 90 seconds.'));
  assert.ok(claims.isAdvice('Consider staying at this weight.'));
  assert.ok(!claims.isAdvice('It happened in 4 of your last 6 sets.'));
  assert.ok(!claims.isAdvice('Corrections ran at 0.38 per rep.'));
});

check('in free text, a report must hold up and an adjacent suggestion need not', () => {
  const r = validate.checkProse('Depth slipped in 2 of 6 sets. Try 4 sets next time.', INDEX);
  assert.equal(r.ok, true);
  assert.equal(r.checked.filter((c) => c.status === 'exempt').length, 1, 'the 4 is a proposal');
  assert.equal(r.checked.filter((c) => c.status === 'supported').length, 2);

  const bad = validate.checkProse('Depth slipped in 7 of 11 sets.', INDEX);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.unsupported.map((c) => c.raw), ['7', '11']);
});

// ── the structured path classifies by field, not by wording ──────────────────────────────

check('a structured answer is judged field by field', () => {
  const good = validate.checkAnswer({
    observed: ['Depth slipped in 2 of your 6 watched sets, starting around rep 5.'],
    meaning: 'Corrections ran at 0.38 per rep, above the 0.34 limit for adding weight.',
    suggestion: 'Hold this weight for 2 more sessions and see if it settles.',
  }, INDEX);
  assert.equal(good.ok, true);
  assert.equal(good.feedback, null);

  const bad = validate.checkAnswer({
    observed: ['Depth slipped in 4 of your 6 watched sets.'],
    meaning: 'That is about 70% of the time.',
    suggestion: 'Try 3 sets.',
  }, INDEX);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.unsupported.map((c) => c.raw), ['4', '70%']);
  assert.match(bad.feedback, /not in the evidence/);
  assert.doesNotMatch(bad.feedback, /2|0\.33/, 'feedback names the wrong numbers, never supplies right ones');
});

check('a number smuggled into the observed field is caught even if it sounds like advice', () => {
  // The hole the structured path closes: prose classification would exempt this sentence on the
  // word "try", and the field label does not care how it is phrased.
  const r = validate.checkAnswer({ observed: ['You tried 11 sets.'], meaning: '' }, INDEX);
  assert.equal(r.ok, false, 'the field says observation, so it is checked as one');
});

// ── extraction edges ─────────────────────────────────────────────────────────────────────

check('extraction reads precision, sign and percent from how it was written', () => {
  const [a] = claims.extract('0.30');
  assert.equal(a.decimals, 2);
  const [b] = claims.extract('45%');
  assert.equal(b.kind, 'percentage');
  const [c] = claims.extract('-1.3 kg');
  assert.equal(c.value, -1.3);
  assert.equal(claims.extract('no numbers at all').length, 0);
});

check('a value appearing twice in the evidence is supported once and reported once', () => {
  const idx = validate.provenance({ a: { n: 6 }, b: { m: 6 } });
  const r = validate.checkClaim(claims.extract('6 sets')[0], idx);
  assert.equal(r.status, 'supported');
  assert.equal(r.source, 'a.n', 'the first match is cited; both would have been valid');
});

check('KNOWN HOLE: a number is checked for existing, not for meaning anything', () => {
  // Asserted so the limit is visible in the suite and not only in a document. If either of these
  // ever starts failing, the guarantee got stronger and the report should say so.

  // 6 is in the evidence as a set count. Called "6 kg" it is nonsense, and this layer accepts it,
  // because rejecting it means parsing the sentence.
  assert.equal(only('you lifted 6 kg').status, 'supported');

  // Worse, and the one to remember: a WRONG denominator that happens to collide with an unrelated
  // field passes. 9 is real — it is the total fault count — so "2 of 9 sets" reads as arithmetic
  // and is in fact a fabricated ratio. Value-level provenance cannot see the difference.
  const both = claims.extract('in 2 of 9 sets', 'observed').map((c) => validate.checkClaim(c, INDEX));
  assert.deepEqual(both.map((c) => c.status), ['supported', 'supported']);
  assert.equal(both[1].source, 'decision.totalFaults', 'cited from a field that has nothing to do with it');
});

// ── the retry-and-fall-back policy ───────────────────────────────────────────────────────

const fakeAsk = (answers) => {
  const seen = [];
  const fn = async (ev, feedback) => {
    seen.push({ ev, feedback });
    return answers[seen.length - 1] ?? null;
  };
  fn.seen = seen;
  return fn;
};

/** A stored HOLD verdict for the squat, matching what coach.finishExercise() writes. */
const seedVerdict = () => store.appendVerdict({
  exId: 'squat', decision: 'hold', unit: 'kg', from: 60, to: 60, reason: 'form broke down',
  evidence: { sets: 3, repsHit: true, totalReps: 24, totalFaults: 9, faultsPerRep: 0.38, cleanLimit: 0.34, stalledSessions: 3 },
});

await checkAsync('with no recorded decision, nothing is asked and nothing is invented', async () => {
  const ask = fakeAsk([{ observed: ['Held at 60 kg.'], meaning: '' }]);
  const r = await explain.explainDecision('squat', ask);
  assert.equal(r.status, 'no_evidence');
  assert.equal(r.attempts, 0);
  assert.equal(ask.seen.length, 0, 'the model is never even called — no key spent on a non-question');
  assert.equal(r.plain, null);
});

await checkAsync('a validated answer comes back on the first attempt', async () => {
  seedVerdict();
  const ask = fakeAsk([{
    observed: ['Every rep was there across 3 sets.'],
    meaning: 'Corrections ran at 0.38 per rep, above the 0.34 limit, so the load held.',
    suggestion: 'Stay here and watch the depth.',
  }]);
  const r = await explain.explainDecision('squat', ask);
  assert.equal(r.status, 'ok');
  assert.equal(r.attempts, 1);
  assert.ok(r.answer.observed.length);
});

await checkAsync('an unsupported number triggers exactly one retry, with the same evidence', async () => {
  seedVerdict();
  const ask = fakeAsk([
    { observed: ['Depth slipped in 11 of your sets.'], meaning: '' },
    { observed: ['Every rep was there across 3 sets.'], meaning: 'Corrections ran at 0.38 per rep.' },
  ]);
  const r = await explain.explainDecision('squat', ask);
  assert.equal(r.status, 'ok');
  assert.equal(r.attempts, 2);
  assert.equal(ask.seen.length, 2);
  assert.deepEqual(ask.seen[0].ev, ask.seen[1].ev, 'the retry gets the SAME packet — never fresh evidence');
  assert.equal(ask.seen[0].feedback, null);
  assert.match(ask.seen[1].feedback, /11/, 'and is told which number was wrong');
  assert.doesNotMatch(ask.seen[1].feedback, /use 3 instead|should be/i, 'but never handed a replacement');
});

await checkAsync('two bad answers are discarded entirely — the user never sees either', async () => {
  seedVerdict();
  const ask = fakeAsk([
    { observed: ['Depth slipped in 11 sets.'], meaning: '' },
    { observed: ['Depth slipped in 7 sets.'], meaning: '' },
  ]);
  const r = await explain.explainDecision('squat', ask);
  assert.equal(r.status, 'unverified');
  assert.equal(r.attempts, 2);
  assert.equal(r.answer, undefined, 'no partial answer, no stripped clause, nothing to render');
  assert.ok(r.plain, 'the deterministic explanation stands in');
  assert.match(r.plain, /0\.38/, 'and it carries the real numbers');
});

await checkAsync('it never loops past two attempts however bad the answers are', async () => {
  seedVerdict();
  const ask = fakeAsk(Array.from({ length: 10 }, () => ({ observed: ['99 sets.'], meaning: '' })));
  const r = await explain.explainDecision('squat', ask);
  assert.equal(ask.seen.length, 2, 'a paid call per attempt is the user\'s money — two and stop');
  assert.equal(r.status, 'unverified');
});

await checkAsync('a failed call falls back rather than showing an error', async () => {
  seedVerdict();
  const r = await explain.explainDecision('squat', fakeAsk([null]));
  assert.equal(r.status, 'unavailable');
  assert.ok(r.plain);
});

await checkAsync('the deterministic explanation is correct on its own, with no model at all', async () => {
  seedVerdict();
  const text = explain.plainly('squat');
  assert.match(text, /Staying at 60 kg/);
  assert.match(text, /0\.38 per rep/);
  assert.match(text, /0\.34/);
  // And every number it states survives its own validator — the fallback is held to the same bar.
  const r = validate.checkProse(text, validate.provenance(explain.packet('squat')));
  assert.equal(r.ok, true, `fallback stated an unsupported number: ${JSON.stringify(r.unsupported)}`);
});

await checkAsync('the packet is narrow: one lift, no history, no profile, no dates', async () => {
  seedVerdict();
  const p = explain.packet('squat');
  const json = JSON.stringify(p);
  assert.ok(p.decision, 'the decision');
  assert.equal(json.includes('bodyweight'), false);
  assert.equal(json.includes('kcal'), false);
  assert.equal(json.includes('sleep'), false);
  assert.doesNotMatch(json, /\d{4}-\d{2}-\d{2}/, 'no timestamp, so no date claims to police');
});

await checkAsync('an unwatched lift sends the limitation, not silence', async () => {
  seedVerdict();
  const p = explain.packet('squat');
  assert.equal(p.form, null, 'no fault tracking on any set here');
  assert.match(p.formEvidence, /per-rep fault tracking/,
    'the model is told the silence means unwatched, not clean');
});

console.log(ok.map((n) => `  ok  ${n}`).join('\n'));
console.log(`\n${ok.length} checks passed`);
