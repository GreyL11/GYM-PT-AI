// Arithmetic over days you have already logged. No model, no network, nothing that has to be
// right about the future. Sibling of insights.js, which does the same job for lifting.
//
// The one rule this file exists to enforce: never report a comparison that rests on three data
// points. An app that says "you're happier when you train" off a couple of days is making things
// up, and it is making them up about something you are trying to make decisions with.

/** Below this many days on either side of a comparison, say nothing. */
export const MIN_SAMPLE = 4;

/** 'HH:MM' → 'HH:MM', crossing midnight. Null if either end is missing. */
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
      hours: sleepHours(d.bed, d.wake),
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
