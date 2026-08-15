// The testosterone-inputs card. Every threshold in here is a claim about someone's body, so the
// ones that matter most are the refusals: not enough nights, not enough weigh-ins, and never a
// verdict on a weight direction the data cannot justify.
import assert from 'node:assert/strict';
import {
  read, sleep, weight, training, advice, usualWake, wakePattern,
  WINDOW, SLEEP_TARGET, SLEEP_LOW, MIN_NIGHTS, TRAIN_LOW, REGULAR_SPREAD_MINS,
} from './www/t_inputs.js';
import { dayKey, shiftKey } from './www/store.js';

const nights = (n, bed, wake) => {
  const d = {};
  for (let i = 0; i < n; i++) d[shiftKey(-i)] = { bed, wake };
  return d;
};

// ── sleep ────────────────────────────────────────────────────────────────────────────────
{
  // Under the logging floor, no average is reported at all.
  const thin = sleep(nights(MIN_NIGHTS - 1, '23:00', '07:00'), WINDOW, shiftKey);
  assert.equal(thin.verdict, 'unknown');
  assert.equal(thin.avg, undefined, 'no average is offered when there is not enough to average');
  assert.equal(thin.nights, MIN_NIGHTS - 1);

  // One more night crosses the floor.
  assert.equal(sleep(nights(MIN_NIGHTS, '23:00', '07:00'), WINDOW, shiftKey).verdict, 'good');

  const low = sleep(nights(14, '01:00', '06:00'), WINDOW, shiftKey);   // 5h
  assert.equal(low.avg, 5);
  assert.equal(low.verdict, 'low');

  const under = sleep(nights(14, '23:30', '06:00'), WINDOW, shiftKey); // 6.5h
  assert.equal(under.avg, 6.5);
  assert.equal(under.verdict, 'under', 'between the low mark and the target is its own state');

  // Boundaries, stated explicitly so a threshold change has to break a test. "low" means below
  // the mark, not at it — the headline says "under 6h is where it shows", and 6.0 is not under 6.
  assert.equal(sleep(nights(14, '00:06', '06:00'), WINDOW, shiftKey).verdict, 'low', 'just under the mark is low');
  assert.equal(sleep(nights(14, '00:00', '06:00'), WINDOW, shiftKey).verdict, 'under', `exactly ${SLEEP_LOW}h is not "low"`);
  assert.equal(sleep(nights(14, '00:00', '07:00'), WINDOW, shiftKey).verdict, 'good', `${SLEEP_TARGET}h clears it`);

  // Nights outside the window are not counted.
  const stale = {};
  for (let i = 0; i < 14; i++) stale[shiftKey(-40 - i)] = { bed: '23:00', wake: '07:00' };
  assert.equal(sleep(stale, WINDOW, shiftKey).verdict, 'unknown');
}

// ── weight: direction only, never a verdict ──────────────────────────────────────────────
{
  const iso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString(); };

  assert.equal(weight([], WINDOW, dayKey, shiftKey).verdict, 'unknown');
  assert.equal(weight([{ at: iso(-3), kg: 72 }], WINDOW, dayKey, shiftKey).verdict, 'unknown',
    'one weigh-in is a point, not a direction');

  const up = weight([{ at: iso(-20), kg: 72 }, { at: iso(-1), kg: 74.5 }], WINDOW, dayKey, shiftKey);
  assert.equal(up.kg, 2.5);
  assert.equal(up.verdict, 'known', 'gaining is never labelled bad — muscle and fat look identical here');

  const down = weight([{ at: iso(-20), kg: 74.5 }, { at: iso(-1), kg: 72 }], WINDOW, dayKey, shiftKey);
  assert.equal(down.kg, -2.5);
  assert.equal(down.verdict, 'known');

  // Weigh-ins older than the window are excluded from the delta.
  const old = weight(
    [{ at: iso(-90), kg: 60 }, { at: iso(-20), kg: 72 }, { at: iso(-1), kg: 73 }],
    WINDOW, dayKey, shiftKey,
  );
  assert.equal(old.kg, 1, 'the 60kg reading is outside the window and must not skew it');
  assert.equal(old.points, 2);
}

// ── training ─────────────────────────────────────────────────────────────────────────────
{
  const sessions = (n, offset = 0) =>
    Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - i - offset); return { at: d.toISOString() }; });

  assert.equal(training(sessions(TRAIN_LOW - 1), [], WINDOW, dayKey, shiftKey).verdict, 'low');
  assert.equal(training(sessions(TRAIN_LOW), [], WINDOW, dayKey, shiftKey).verdict, 'good');
  assert.equal(training([], [], WINDOW, dayKey, shiftKey).days, 0);

  // Two sets on one day is one training day, not two.
  const twice = [{ at: new Date().toISOString() }, { at: new Date().toISOString() }];
  assert.equal(training(twice, [], WINDOW, dayKey, shiftKey).days, 1);

  // Boxing counts as moving; sessions before the window do not count.
  assert.equal(training([], sessions(3), WINDOW, dayKey, shiftKey).days, 3);
  assert.equal(training(sessions(10, 40), [], WINDOW, dayKey, shiftKey).days, 0);
}

// ── advice: one line, one plan, in priority order ────────────────────────────────────────
{
  const a = (s, t, wake = '06:00') => advice({ sleep: s, training: t, weight: { verdict: 'unknown' } }, wake);

  // Bad sleep outranks low training, and names a bedtime from the user's own wake time.
  const bad = a({ verdict: 'low', avg: 5.2 }, { verdict: 'low', days: 2 });
  assert.match(bad.text, /5\.2h/);
  assert.match(bad.text, /23:00/, '06:00 wake minus the 7h target');
  assert.equal(bad.plan, 'Lights off by 23:00');

  // A merely-short night does NOT outrank training on the floor.
  const short = a({ verdict: 'under', avg: 6.4 }, { verdict: 'low', days: 2 });
  assert.equal(short.plan, 'Train');
  const shortOk = a({ verdict: 'under', avg: 6.4 }, { verdict: 'good', days: 12 });
  assert.equal(shortOk.plan, 'Lights off by 23:00');

  assert.equal(a({ verdict: 'good', avg: 7.5 }, { verdict: 'low', days: 3 }).plan, 'Train');

  // Bedtime wraps backwards over midnight rather than going negative.
  assert.equal(a({ verdict: 'low', avg: 4 }, { verdict: 'good', days: 12 }, '04:30').plan, 'Lights off by 21:30');
  assert.equal(a({ verdict: 'low', avg: 4 }, { verdict: 'good', days: 12 }, '02:00').plan, 'Lights off by 19:00');

  // No wake time logged: no invented clock time, but still an action.
  const noWake = a({ verdict: 'low', avg: 5 }, { verdict: 'good', days: 12 }, null);
  assert.doesNotMatch(noWake.text, /\d\d:\d\d/, 'never states an hour it cannot compute');
  assert.equal(noWake.plan, 'Lights off 45 minutes earlier');

  // States that need data, not action, carry no plan.
  assert.equal(a({ verdict: 'unknown', nights: 2 }, { verdict: 'good', days: 12 }).plan, null);
  assert.equal(a({ verdict: 'good', avg: 7.8 }, { verdict: 'good', days: 14 }).text, null);

  // A fresh install must not be graded on a month that never happened.
  const blank = advice({ sleep: { verdict: 'unknown', nights: 0 }, training: { verdict: 'low', days: 0 },
    weight: { verdict: 'unknown', points: 0 } }, null);
  assert.match(blank.text, /Nothing logged yet/);
  assert.doesNotMatch(blank.text, /0 training days/);
  assert.equal(blank.plan, null, 'nothing to act on until something is logged');

  // One logged session is data, so the training verdict is fair game again.
  assert.equal(advice({ sleep: { verdict: 'unknown', nights: 0 }, training: { verdict: 'low', days: 1 },
    weight: { verdict: 'unknown' } }, null).plan, 'Train');
}

// ── usualWake: median, so one early start does not move the target ───────────────────────
{
  const at = (i, wake) => ({ [shiftKey(-i)]: { wake } });
  const days = Object.assign({}, at(0, '06:00'), at(1, '06:30'), at(2, '04:00'), at(3, '06:15'), at(4, '06:00'));
  assert.equal(usualWake(days, WINDOW, shiftKey), '06:00', 'the 04:00 airport run is not the target');
  assert.equal(usualWake({}, WINDOW, shiftKey), null);
  assert.equal(usualWake(Object.assign({}, at(0, ''), at(1, 'nonsense')), WINDOW, shiftKey), null);
}

// ── composite ────────────────────────────────────────────────────────────────────────────
{
  // A fresh install must not throw on absent everything.
  const empty = read({}, dayKey, shiftKey);
  assert.equal(empty.sleep.verdict, 'unknown');
  assert.equal(empty.weight.verdict, 'unknown');
  assert.equal(empty.training.days, 0);
  assert.ok(empty.advice.text, 'a blank app still says what to do first');

  const full = read(
    { days: nights(20, '23:00', '07:00'), weights: [], log: [], rounds: [] },
    dayKey, shiftKey,
  );
  assert.equal(full.sleep.avg, 8);
  assert.equal(full.sleep.verdict, 'good');
  assert.equal(full.training.verdict, 'low');
  assert.match(full.advice.text, /training days/);
  assert.equal(full.advice.plan, 'Train');
}

// ── irregular sleep: the card must stop naming an hour it cannot know ─────────────────────
{
  /** `n` days of a main sleep of `hours`, waking at a time drawn from `wakeHours` in rotation. */
  const shifts = (n, hours, wakeHours) => {
    const d = {};
    for (let i = 0; i < n; i++) {
      const key = shiftKey(-i);
      const [y, m, day] = key.split('-').map(Number);
      const end = new Date(y, m - 1, day, wakeHours[i % wakeHours.length], 0);
      const start = new Date(end - hours * 3600000);
      d[key] = { sleeps: [{ start: start.toISOString(), end: end.toISOString() }] };
    }
    return d;
  };

  // A steady sleeper: the median is a real habit, and a bedtime computed from it is actionable.
  // 5.5h, so the sleep branch is reached — a merely-short night is outranked by no training at all.
  const steady = shifts(14, 5.5, [7, 7, 8, 7]);
  const sp = wakePattern(steady, WINDOW, shiftKey);
  assert.equal(sp.regular, true);
  assert.equal(sp.median, '07:00');
  assert.ok(sp.spreadMins <= REGULAR_SPREAD_MINS);
  assert.equal(usualWake(steady, WINDOW, shiftKey), '07:00');
  assert.match(read({ days: steady, weights: [], log: [], rounds: [] }, dayKey, shiftKey).advice.text,
    /Lights off by/, 'a real routine gets a real bedtime');

  // Clock times are circular: waking at 23:00 and 01:00 is two hours apart, not twenty-two.
  // Without that, one late night alone would flip a regular sleeper to irregular.
  const midnight = wakePattern(shifts(14, 7, [23, 0, 1, 0]), WINDOW, shiftKey);
  assert.equal(midnight.regular, true, `spread across midnight was ${midnight.spreadHours}h`);
  assert.equal(midnight.spreadHours, 2);

  // A rotating shift. The median of these is an hour no morning ever looked like, so the card
  // must not prescribe a bedtime from it.
  const rotating = shifts(14, 5.5, [6, 13, 21, 9]);
  const rp = wakePattern(rotating, WINDOW, shiftKey);
  assert.equal(rp.regular, false);
  assert.ok(rp.spreadHours > 3, `expected a wide spread, got ${rp.spreadHours}h`);
  assert.equal(usualWake(rotating, WINDOW, shiftKey), null, 'there is no usual wake time to report');

  const r = read({ days: rotating, weights: [], log: [], rounds: [] }, dayKey, shiftKey);
  assert.equal(r.sleep.verdict, 'low', '5.5h is short however it is scheduled');
  assert.doesNotMatch(r.advice.text, /Lights off by \d/, 'no invented bedtime');
  assert.match(r.advice.text, /wake time moves/);
  assert.match(r.advice.plan, new RegExp(`${SLEEP_TARGET}h`), 'the target becomes a length, not an hour');
}

// ── naps are counted, but never into the verdict ──────────────────────────────────────────
{
  const withNaps = {};
  for (let i = 0; i < 14; i++) {
    const key = shiftKey(-i);
    const [y, m, day] = key.split('-').map(Number);
    const night = { start: new Date(y, m - 1, day, 1).toISOString(), end: new Date(y, m - 1, day, 6).toISOString() };
    const nap = { start: new Date(y, m - 1, day, 14).toISOString(), end: new Date(y, m - 1, day, 17).toISOString() };
    withNaps[key] = { sleeps: [night, nap] };
  }

  const s = sleep(withNaps, WINDOW, shiftKey);
  // 5h night + 3h nap. Summed it would be 8h and "good" — a verdict drawn from evidence about
  // consolidated sleep, applied to something that is not consolidated sleep.
  assert.equal(s.avg, 5, 'the verdict reads the main block');
  assert.equal(s.verdict, 'low');
  assert.equal(s.totalAvg, 8, 'and the total is still reported, as the different thing it is');
  assert.equal(s.napDays, 14);

  // With no naps there is no second figure — the same number twice reads as if it means more.
  const plain = sleep((() => {
    const d = {};
    for (let i = 0; i < 14; i++) {
      const key = shiftKey(-i);
      const [y, m, day] = key.split('-').map(Number);
      d[key] = { sleeps: [{ start: new Date(y, m - 1, day, 1).toISOString(), end: new Date(y, m - 1, day, 8).toISOString() }] };
    }
    return d;
  })(), WINDOW, shiftKey);
  assert.equal(plain.avg, 7);
  assert.equal(plain.totalAvg, undefined);
}

console.log('t_inputs ok');
