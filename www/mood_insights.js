// Arithmetic over days you have already logged. No model, no network, nothing that has to be
// right about the future. Sibling of insights.js, which does the same job for lifting.
//
// The one rule this file exists to enforce: never report a comparison that rests on three data
// points. An app that says "you're happier when you train" off a couple of days is making things
// up, and it is making them up about something you are trying to make decisions with.

/** Below this many days on either side of a comparison, say nothing. */
export const MIN_SAMPLE = 4;

/**
 * 'HH:MM' → 'HH:MM', crossing midnight. Null if either end is missing.
 *
 * The legacy shape: two clock times on a day row, no dates. It handles daytime sleep correctly
 * (10:00 → 16:00 is six hours) but it cannot represent more than one sleep in a day, and the
 * modulo means a full 24 hours reads as zero. Kept because every day logged before episodes
 * shipped is stored this way, and those days are still real.
 */
export function sleepHours(bed, wake) {
  const mins = (t) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t ?? '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const b = mins(bed);
  const w = mins(wake);
  if (b === null || w === null) return null;
  return Math.round(((w - b + 1440) % 1440) / 6) / 10;
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Every sleep on a day row, longest first, as hours.
 *
 * A day holds `sleeps: [{start, end}]` — real timestamps, so a block that runs from Tuesday 22:00
 * to Wednesday 22:00 is twenty-four hours rather than the zero the clock-time version reports. A
 * block is filed under the day it ENDED, because you log a sleep after waking from it and "how did
 * I sleep for today" is a question about the sleep you just got up from.
 *
 * Falls back to the legacy `bed`/`wake` pair when there are no episodes, so old days keep reading
 * exactly as they always did. A day with episodes ignores the legacy fields entirely rather than
 * adding them in — that pair is the same sleep, written the old way.
 */
export function sleepBlocks(day) {
  const eps = (day?.sleeps ?? [])
    .map((s) => ({ start: s.start, end: s.end, hours: round1((new Date(s.end) - new Date(s.start)) / 3600000) }))
    .filter((s) => Number.isFinite(s.hours) && s.hours > 0)
    .sort((a, b) => b.hours - a.hours);
  if (eps.length) return eps;

  const legacy = sleepHours(day?.bed, day?.wake);
  return legacy === null || legacy <= 0 ? [] : [{ start: null, end: null, hours: legacy, legacy: true }];
}

/**
 * The longest block — the main sleep — and everything else.
 *
 * Split rather than summed because the two are not the same thing and the app reads them
 * differently. The sleep evidence the Testosterone card rests on (Leproult & Van Cauter, JAMA 2011)
 * is about CONSOLIDATED nightly sleep; adding a three-hour nap to a four-hour night and calling the
 * result seven hours would be reporting a number that study says nothing about. So the verdict is
 * taken from `main`, and `total` is reported beside it as what it is — time spent asleep.
 *
 * Returns nulls rather than zeros for a day with nothing logged. A day you did not record is not a
 * day you did not sleep.
 */
export function sleepSummary(day) {
  const blocks = sleepBlocks(day);
  if (!blocks.length) return { main: null, total: null, naps: 0, blocks: [] };
  return {
    main: blocks[0].hours,
    total: round1(blocks.reduce((a, b) => a + b.hours, 0)),
    naps: blocks.length - 1,
    blocks,
  };
}

const planRate = (plans) =>
  plans?.length ? plans.filter((p) => p.done).length / plans.length : null;

/**
 * Which days you trained, straight out of the lifting log.
 *
 * Lives in one app now, so this is read rather than imported — the whole reason mood moved in
 * here instead of staying a separate thing you had to paste a backup into.
 */
export const trainedDays = (log, rounds, dayKey) =>
  new Set([...(log ?? []), ...(rounds ?? [])].map((e) => e.at && dayKey(new Date(e.at))).filter(Boolean));

/**
 * The last `n` calendar days, oldest first — including days with nothing logged, so gaps in the
 * chart are visible rather than silently closed up.
 */
export function rows(days, trained, n, dayKey, shiftKey) {
  return Array.from({ length: n }, (_, i) => {
    const key = shiftKey(i - n + 1);
    const d = days[key] ?? {};
    return {
      key,
      mood: d.mood ?? null,
      // The main sleep, not the day's total — the same block the verdict is taken from, so the
      // Trends comparison and the Testosterone card cannot disagree about what "slept 7h" meant.
      hours: sleepSummary(d).main,
      plans: planRate(d.plans),
      trained: trained.has(key),
    };
  });
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Average mood on days where `predicate` holds vs days where it doesn't.
 *
 * Returns `enough: false` rather than a number when either side is too thin — the caller renders
 * the raw counts instead, which is the honest output until there is enough to say.
 */
export function split(rows, predicate) {
  const scored = rows.filter((r) => r.mood !== null);
  const on = scored.filter(predicate).map((r) => r.mood);
  const off = scored.filter((r) => !predicate(r)).map((r) => r.mood);
  if (on.length < MIN_SAMPLE || off.length < MIN_SAMPLE) {
    return { enough: false, nOn: on.length, nOff: off.length };
  }
  const a = mean(on);
  const b = mean(off);
  return { enough: true, nOn: on.length, nOff: off.length, on: a, off: b, delta: a - b };
}

/**
 * Polyline point strings for a sparkline, one per unbroken run of values.
 *
 * Separate segments rather than one line, so a week you didn't log reads as a gap instead of a
 * straight line implying you felt steady through it.
 */
export function sparkline(values, { w = 320, h = 70, min = 1, max = 5, pad = 4 } = {}) {
  const span = max - min || 1;
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  const segments = [];
  let current = [];
  values.forEach((v, i) => {
    if (v === null || v === undefined) {
      if (current.length) segments.push(current);
      current = [];
      return;
    }
    const x = pad + i * step;
    const y = pad + (h - pad * 2) * (1 - (v - min) / span);
    current.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  if (current.length) segments.push(current);
  return segments.map((s) => s.join(' '));
}

export const average = mean;
