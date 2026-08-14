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

const clock = (mins) =>
  `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

const toMins = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * The wake time you actually keep, as the median of the ones logged.
 *
 * Median rather than mean so one 04:00 airport run doesn't drag the whole target earlier.
 */
export function usualWake(days, n, shiftKey) {
  const mins = [];
  for (let i = -n + 1; i <= 0; i++) {
    const m = toMins(days[shiftKey(i)]?.wake);
    if (m !== null) mins.push(m);
  }
  if (!mins.length) return null;
  mins.sort((a, b) => a - b);
  return clock(mins[Math.floor(mins.length / 2)]);
}

/**
 * The one thing worth doing next, as text plus a plan you can hand to the Mind tab.
 *
 * Naming the shortfall is not advice — "your sleep is the problem" leaves you holding it. Where
 * the data allows, this states the actual move: your own median wake time minus the target gives
 * a bedtime, which is a thing you can do tonight rather than a thing to feel bad about.
 *
 * Deliberately one line and one plan. A list of five is a list nobody acts on, and the inputs are
 * not equal — sleep is both the best evidenced and the most commonly short.
 */
export function advice(r, wake = null) {
  // A fresh install has no training days, no nights and no weigh-ins. Reading that back as "0
  // training days" is a judgement drawn from absent data, which is the one thing the rest of this
  // app refuses to do. Silence about the inputs, and say what would make them readable.
  if (r.sleep.verdict === 'unknown' && r.weight.verdict === 'unknown' && r.training.days === 0) {
    return { text: 'Nothing logged yet. Log sleep on the Mind tab and finish a session, and this starts telling you something.', plan: null };
  }

  const bedtime = () => {
    const w = toMins(wake);
    return w === null ? null : clock((w - SLEEP_TARGET * 60 + 1440) % 1440);
  };

  if (r.sleep.verdict === 'low' || r.sleep.verdict === 'under') {
    const worst = r.sleep.verdict === 'low';
    // Training being on the floor outranks a merely-short night, but not a genuinely bad one.
    if (!worst && r.training.verdict === 'low') return trainAdvice(r);
    const bed = bedtime();
    if (bed) {
      return {
        text: worst
          ? `Averaging ${r.sleep.avg}h, waking at ${wake}. Lights off by ${bed} is the single change with the clearest effect.`
          : `Averaging ${r.sleep.avg}h, waking at ${wake}. Lights off by ${bed} gets you to ${SLEEP_TARGET}h.`,
        plan: `Lights off by ${bed}`,
      };
    }
    // No wake time logged, so no bedtime can be computed — name a shift instead of a clock time.
    return {
      text: `Averaging ${r.sleep.avg}h. ${worst ? 'Sleep is the input with the clearest effect.' : `${SLEEP_TARGET}h is where the evidence sits.`} Log a wake time and this can name the hour.`,
      plan: 'Lights off 45 minutes earlier',
    };
  }

  if (r.training.verdict === 'low') return trainAdvice(r);

  if (r.sleep.verdict === 'unknown') {
    return { text: `Only ${r.sleep.nights} nights logged in ${WINDOW}. Log sleep on the Mind tab and this becomes worth reading.`, plan: null };
  }
  return { text: null, plan: null };
}

const trainAdvice = (r) => ({
  text: `${r.training.days} training days in ${WINDOW}. Twice a week is the floor — put the next one in tomorrow's plan.`,
  plan: 'Train',
});

export function read({ days, weights, log, rounds }, dayKey, shiftKey, n = WINDOW) {
  const d = days ?? {};
  const r = {
    sleep: sleep(d, n, shiftKey),
    weight: weight(weights, n, dayKey, shiftKey),
    training: training(log, rounds, n, dayKey, shiftKey),
  };
  return { ...r, advice: advice(r, usualWake(d, n, shiftKey)) };
}
