// The lifestyle inputs that move testosterone, read out of data the app already keeps.
//
// This file does NOT estimate testosterone, and nothing in the app can. There is no sensor, no
// questionnaire and no training-load model that reads a hormone — a number produced that way is
// invented. Testosterone is a morning blood draw, twice, read by a doctor.
//
// What is honest is the other direction: three things with real evidence behind them move it, and
// the app is already logging all three. So it can tell you whether you are doing them. That is a
// smaller claim than a score, and it is the only one the data supports.
//
//   Sleep     A week at 5h dropped daytime T 10-15% in healthy young men (Leproult & Van Cauter,
//             JAMA 2011). The clearest modifiable input, and the one most people are short on.
//   Body fat  Strong inverse association; adipose tissue aromatises testosterone to oestradiol,
//             and weight loss in overweight men raises it. See the caveat on weight() below.
//   Training  Acts mostly through body composition. Both ends hurt: near-nothing, and very high
//             endurance volume on a deep deficit.

import { sleepHours, trainedDays } from './mood_insights.js';

/** Four weeks: long enough to survive one bad week, short enough to still be about now. */
export const WINDOW = 28;

export const SLEEP_TARGET = 7;
export const SLEEP_LOW = 6;
/** Below this many logged nights in the window, the average is not worth reporting. */
export const MIN_NIGHTS = 10;
/** Roughly twice a week. Below it, the body-composition route is not being taken. */
export const TRAIN_LOW = 8;

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function sleep(days, n, shiftKey) {
  const hours = [];
  for (let i = -n + 1; i <= 0; i++) {
    const d = days[shiftKey(i)];
    const h = sleepHours(d?.bed, d?.wake);
    if (h !== null) hours.push(h);
  }
  if (hours.length < MIN_NIGHTS) return { verdict: 'unknown', nights: hours.length };
  const avg = Math.round(mean(hours) * 10) / 10;
  const verdict = avg < SLEEP_LOW ? 'low' : avg < SLEEP_TARGET ? 'under' : 'good';
  return { verdict, nights: hours.length, avg };
}

/**
 * Weight movement over the window — direction only, deliberately unjudged.
 *
 * The evidence is about body fat, and the app does not know your body fat. Gaining muscle and
 * gaining fat are the same number here and point opposite ways, so calling a direction "bad"
 * would be a guess dressed as a reading.
 */
export function weight(weights, n, dayKey, shiftKey) {
  const cutoff = shiftKey(-n + 1);
  const inWindow = (weights ?? [])
    .filter((w) => w.at && dayKey(new Date(w.at)) >= cutoff)
    .sort((a, b) => a.at.localeCompare(b.at));
  if (inWindow.length < 2) return { verdict: 'unknown', points: inWindow.length };
  const kg = Math.round((inWindow.at(-1).kg - inWindow[0].kg) * 10) / 10;
  return { verdict: 'known', points: inWindow.length, kg };
}

export function training(log, rounds, n, dayKey, shiftKey) {
  const trained = trainedDays(log, rounds, dayKey);
  const cutoff = shiftKey(-n + 1);
  const days = [...trained].filter((d) => d >= cutoff).length;
  return { verdict: days < TRAIN_LOW ? 'low' : 'good', days };
}

/**
 * The one thing worth changing, or null when nothing stands out.
 *
 * Deliberately returns a single line. A list of five things to fix is a list nobody acts on, and
 * the inputs are not equal — sleep is both the best evidenced and the most commonly short.
 */
export function headline(r) {
  // A fresh install has no training days, no nights and no weigh-ins. Reading that back as "0
  // training days" is a judgement drawn from absent data, which is the one thing the rest of this
  // app refuses to do. Silence about the inputs, and say what would make them readable.
  if (r.sleep.verdict === 'unknown' && r.weight.verdict === 'unknown' && r.training.days === 0) {
    return 'Nothing logged yet. Log sleep on the Mind tab and finish a session, and this starts telling you something.';
  }
  if (r.sleep.verdict === 'low') {
    return `Averaging ${r.sleep.avg}h. Sleep is the input with the clearest effect, and under 6h is where it shows.`;
  }
  if (r.training.verdict === 'low') {
    return `${r.training.days} training days in ${WINDOW}. The route here is body composition, and that needs more than this.`;
  }
  if (r.sleep.verdict === 'under') {
    return `Averaging ${r.sleep.avg}h. Nothing alarming, but ${SLEEP_TARGET}h is where the evidence sits.`;
  }
  if (r.sleep.verdict === 'unknown') {
    return `Only ${r.sleep.nights} nights logged in ${WINDOW}. Log sleep on the Mind tab and this becomes worth reading.`;
  }
  return null;
}

export function read({ days, weights, log, rounds }, dayKey, shiftKey, n = WINDOW) {
  const r = {
    sleep: sleep(days ?? {}, n, shiftKey),
    weight: weight(weights, n, dayKey, shiftKey),
    training: training(log, rounds, n, dayKey, shiftKey),
  };
  return { ...r, headline: headline(r) };
}
