// PHQ-9 and GAD-7. Both are released for reproduction without permission, which is why they can
// sit in a file like this.
//
// These are screeners, not diagnoses. What they are actually for here: giving the rest of the app
// something to be judged against. Without a number that moves you cannot tell whether the walking
// or the sleep or the talking did anything, and you end up keeping whichever feature felt nicest.

export const OPTIONS = [
  { label: 'Not at all', value: 0 },
  { label: 'Several days', value: 1 },
  { label: 'More than half the days', value: 2 },
  { label: 'Nearly every day', value: 3 },
];

export const CHECKS = {
  phq9: {
    name: 'PHQ-9',
    about: 'Low mood, over the last two weeks.',
    // Index 8 is the self-harm item. Any non-zero answer takes over the screen — see risk().
    items: [
      'Little interest or pleasure in doing things',
      'Feeling down, depressed, or hopeless',
      'Trouble falling or staying asleep, or sleeping too much',
      'Feeling tired or having little energy',
      'Poor appetite or overeating',
      'Feeling bad about yourself — or that you are a failure, or have let yourself or your family down',
      'Trouble concentrating on things, such as reading or watching television',
      'Moving or speaking so slowly that other people could have noticed — or the opposite, being so fidgety or restless that you have been moving around a lot more than usual',
      'Thoughts that you would be better off dead, or of hurting yourself in some way',
    ],
    bands: [
      [4, 'minimal'],
      [9, 'mild'],
      [14, 'moderate'],
      [19, 'moderately severe'],
      [27, 'severe'],
    ],
  },
  gad7: {
    name: 'GAD-7',
    about: 'Anxiety, over the last two weeks.',
    items: [
      'Feeling nervous, anxious, or on edge',
      'Not being able to stop or control worrying',
      'Worrying too much about different things',
      'Trouble relaxing',
      "Being so restless that it's hard to sit still",
      'Becoming easily annoyed or irritable',
      'Feeling afraid, as if something awful might happen',
    ],
    bands: [
      [4, 'minimal'],
      [9, 'mild'],
      [14, 'moderate'],
      [21, 'severe'],
    ],
  },
};

export const score = (answers) => answers.reduce((a, b) => a + b, 0);

export const band = (kind, total) =>
  CHECKS[kind].bands.find(([ceiling]) => total <= ceiling)?.[1] ?? 'severe';

/**
 * The one answer that is not a data point.
 *
 * PHQ-9 item 9 asks about wanting to be dead or to hurt yourself. Scoring it at all outranks the
 * total — a "minimal" overall score with a non-zero item 9 is still someone saying that out loud,
 * and the app must not respond to it with a band label and a chart.
 */
export const risk = (kind, answers) => kind === 'phq9' && (answers[8] ?? 0) > 0;

/** Fortnightly. Sooner than that and you are measuring noise. */
export const DUE_DAYS = 14;

export function daysSince(iso) {
  if (!iso) return Infinity;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}
