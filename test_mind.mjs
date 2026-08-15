// The arithmetic behind every number the Mind sheet shows, plus the one screener rule that is not
// a data point. If this is wrong the app lies confidently, which is worse than showing nothing.
import assert from 'node:assert/strict';
import {
  sleepHours, sleepBlocks, sleepSummary, trainedDays, rows, split, sparkline, MIN_SAMPLE,
} from './www/mood_insights.js';
import { score, band, risk } from './www/checks.js';
import { drainSSE, trimToUserStart, toContents } from './www/chat.js';
import { dayKey, shiftKey } from './www/store.js';

// ── sleep ────────────────────────────────────────────────────────────────────────────────
assert.equal(sleepHours('23:00', '07:00'), 8);      // crosses midnight
assert.equal(sleepHours('01:30', '09:00'), 7.5);    // same side of midnight
assert.equal(sleepHours('22:45', '06:15'), 7.5);
assert.equal(sleepHours('', '07:00'), null);
assert.equal(sleepHours('nonsense', '07:00'), null);

// ── sleep as blocks: naps, odd hours, and the 24h case the clock version got wrong ────────
{
  const at = (day, h, m = 0) => new Date(2026, 7, day, h, m).toISOString();

  // A day you did not log is not a day you did not sleep.
  assert.deepEqual(sleepSummary({}), { main: null, total: null, naps: 0, blocks: [] });
  assert.deepEqual(sleepSummary(undefined).main, null);

  // Old days keep reading exactly as they always did.
  const legacy = sleepSummary({ bed: '23:00', wake: '07:00' });
  assert.equal(legacy.main, 8);
  assert.equal(legacy.total, 8);
  assert.equal(legacy.naps, 0);
  assert.equal(legacy.blocks[0].legacy, true);

  // A night plus an afternoon nap. Reported apart, because they are not the same thing: the
  // verdict rests on evidence about consolidated sleep, and 4 + 3 is not that seven hours.
  const split2 = sleepSummary({ sleeps: [
    { start: at(11, 2), end: at(11, 6) },      // 4h night
    { start: at(11, 14), end: at(11, 17) },    // 3h nap
  ] });
  assert.equal(split2.main, 4, 'the longest block is the main sleep');
  assert.equal(split2.total, 7);
  assert.equal(split2.naps, 1);
  assert.equal(split2.blocks.length, 2);
  assert.equal(split2.blocks[0].hours, 4, 'longest first');

  // Sleeping through the day is just a block like any other.
  assert.equal(sleepSummary({ sleeps: [{ start: at(11, 10), end: at(11, 16, 30) }] }).main, 6.5);

  // The case the clock-time version reported as zero.
  assert.equal(sleepHours('22:00', '22:00'), 0, 'the old shape genuinely cannot see this');
  assert.equal(sleepSummary({ sleeps: [{ start: at(11, 22), end: at(12, 22) }] }).main, 24);

  // Episodes win outright — the legacy pair is the same sleep written the old way, not an extra one.
  const both = sleepSummary({ bed: '23:00', wake: '07:00', sleeps: [{ start: at(11, 1), end: at(11, 6) }] });
  assert.equal(both.total, 5, 'the old fields are not added on top');

  // Junk does not become a number.
  assert.deepEqual(sleepBlocks({ sleeps: [{ start: 'nope', end: 'also nope' }] }), []);
  assert.deepEqual(sleepBlocks({ sleeps: [{ start: at(11, 6), end: at(11, 2) }] }), [], 'backwards is not negative sleep');
}

// ── training days come from the lifting log, not an import ───────────────────────────────
{
  const log = [
    { at: '2026-08-10T09:00:00Z', exId: 'squat' },
    { at: '2026-08-10T09:20:00Z', exId: 'bench' }, // same day, one entry
    { at: '2026-08-12T18:00:00Z', exId: 'row' },
  ];
  const rounds = [{ at: '2026-08-13T07:00:00Z', round: 1 }]; // boxing counts as moving
  const set = trainedDays(log, rounds, dayKey);
  assert.equal(set.size, 3);
  assert.ok(set.has('2026-08-12'));
  assert.ok(set.has('2026-08-13'), 'boxing rounds count');
  assert.equal(trainedDays(undefined, undefined, dayKey).size, 0, 'a fresh install has no log');
}

// ── windowing ────────────────────────────────────────────────────────────────────────────
{
  const days = {
    [dayKey()]: { mood: 4, bed: '23:00', wake: '07:00', plans: [{ done: true }, { done: false }] },
    [shiftKey(-1)]: { mood: 2, plans: [] },
  };
  const out = rows(days, new Set([shiftKey(-1)]), 3, dayKey, shiftKey);

  assert.equal(out.length, 3);
  assert.equal(out.at(-1).key, dayKey(), 'oldest first, today last');
  assert.equal(out.at(-1).mood, 4);
  assert.equal(out.at(-1).hours, 8);
  assert.equal(out.at(-1).plans, 0.5);
  assert.equal(out.at(-1).trained, false);
  assert.equal(out.at(-2).trained, true);
  assert.equal(out.at(-2).plans, null, 'a day with no plans is not a day you failed');
  assert.equal(out[0].mood, null, 'unlogged days are present as gaps');
}

// ── comparisons ──────────────────────────────────────────────────────────────────────────
{
  // Three on each side is not enough to claim anything.
  const thin = [
    ...Array(3).fill({ mood: 5, trained: true }),
    ...Array(3).fill({ mood: 2, trained: false }),
  ];
  assert.equal(split(thin, (r) => r.trained).enough, false);

  const enough = [
    ...Array(MIN_SAMPLE).fill({ mood: 4, trained: true }),
    ...Array(MIN_SAMPLE).fill({ mood: 2, trained: false }),
  ];
  const s = split(enough, (r) => r.trained);
  assert.equal(s.enough, true);
  assert.equal(s.delta, 2);

  // Unlogged moods never count toward the sample.
  const withGaps = [...enough, ...Array(20).fill({ mood: null, trained: true })];
  assert.equal(split(withGaps, (r) => r.trained).nOn, MIN_SAMPLE);
}

// ── sparkline ────────────────────────────────────────────────────────────────────────────
{
  // A gap breaks the line rather than drawing through it.
  const segs = sparkline([1, 2, null, 4, 5]);
  assert.equal(segs.length, 2);

  // Domain is pinned to 1..5, so the best day sits at the top and the worst at the bottom.
  const [line] = sparkline([5, 1], { w: 100, h: 100, pad: 0 });
  const [top, bottom] = line.split(' ').map((p) => Number(p.split(',')[1]));
  assert.equal(top, 0);
  assert.equal(bottom, 100);

  assert.deepEqual(sparkline([]), []);
  assert.deepEqual(sparkline([null, null]), []);
}

// ── screeners ────────────────────────────────────────────────────────────────────────────
{
  assert.equal(score([1, 2, 3]), 6);
  assert.equal(band('phq9', 0), 'minimal');
  assert.equal(band('phq9', 14), 'moderate');
  assert.equal(band('phq9', 27), 'severe');
  assert.equal(band('gad7', 21), 'severe');

  // Item 9 outranks the total: a "minimal" score that answered it is still a disclosure.
  assert.equal(risk('phq9', [0, 0, 0, 0, 0, 0, 0, 0, 1]), true);
  assert.equal(risk('phq9', [3, 3, 3, 3, 3, 3, 3, 3, 0]), false);
  assert.equal(risk('phq9', []), false, 'unanswered is not a disclosure');
  assert.equal(risk('gad7', [3, 3, 3, 3, 3, 3, 3]), false, 'GAD-7 has no item 9');
}

// ── streaming ────────────────────────────────────────────────────────────────────────────
{
  const delta = (t) =>
    `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: t }] } }] })}\n\n`;
  const textOf = (evs) =>
    evs.flatMap((e) => e.candidates?.[0]?.content?.parts ?? []).map((p) => p.text).join('');

  // A chunk that ends mid-JSON must not be parsed — it comes back as the remainder.
  const whole = delta('hello') + delta('there');
  for (let cut = 1; cut < whole.length; cut++) {
    const a = drainSSE(whole.slice(0, cut));
    const b = drainSSE(a.rest + whole.slice(cut));
    assert.equal(textOf([...a.events, ...b.events]), 'hellothere', `split at ${cut}`);
  }

  // Errors and blocks pass through so the caller can act on them.
  assert.equal(drainSSE('data: {"error":{"message":"nope"}}\n\n').events[0].error.message, 'nope');
  assert.equal(
    drainSSE('data: {"promptFeedback":{"blockReason":"SAFETY"}}\n\n').events[0].promptFeedback.blockReason,
    'SAFETY',
  );

  // Comment/keep-alive lines carry no data field and must not blow up the parser.
  assert.equal(textOf(drainSSE(': keep-alive\n\n' + delta('ok')).events), 'ok');
}

// ── history shape ────────────────────────────────────────────────────────────────────────
{
  // Slicing the last N messages can strand an assistant turn at the front; the API rejects that.
  const sliced = [
    { role: 'assistant', content: 'orphan' },
    { role: 'user', content: 'real start' },
    { role: 'assistant', content: 'reply' },
  ];
  assert.deepEqual(trimToUserStart(sliced), sliced.slice(1));
  assert.deepEqual(trimToUserStart([{ role: 'assistant', content: 'only' }]), []);
  assert.deepEqual(trimToUserStart([]), []);

  // ...and the surviving turns come out in Gemini's vocabulary, opening on a user turn.
  assert.deepEqual(toContents(sliced), [
    { role: 'user', parts: [{ text: 'real start' }] },
    { role: 'model', parts: [{ text: 'reply' }] },
  ]);
}

console.log('mind ok');
