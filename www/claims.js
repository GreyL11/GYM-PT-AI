// Pulling the checkable parts out of an answer. Pure — no DOM, no network, no provider.
//
// This finds NUMBERS, and only numbers, because a number is the one kind of claim a machine can
// check without understanding the sentence around it. "Your depth held up better this week" is
// unverifiable by any means short of another judgement; "in 4 of your last 6 sets" is arithmetic.
// Everything this module does is in service of that narrow, checkable class — see the limitations
// in CLAIM_VALIDATION_REPORT.md for the much larger class it cannot touch.
//
// WHY NOT PARSE MEANING. The obvious next step — work out what each number REFERS to, so "6 kg"
// can be rejected when the 6 in evidence was a set count — needs to understand the sentence, and
// anything that understands the sentence is a second model marking the first one's homework. The
// line drawn here is deliberate: extraction is mechanical, and where mechanism runs out this
// module stops rather than guessing.

/** Numbers as a person writes them: 60, 62.5, -1.3, 38%, 0.34. */
const NUMBER = /(-?\d+(?:\.\d+)?)(\s*%)?/g;

/** Enough either side to see what the number was doing, for a human reading a failure report. */
const CONTEXT = 40;

/**
 * Phrases that make a sentence a suggestion rather than a report.
 *
 * The distinction is real and it matters: "try 3 sets next time" invents nothing — 3 is a
 * prescription, and demanding it appear in the evidence would reject correct advice. "It happened
 * in 3 sets" is a measurement and must be traceable.
 *
 * This is a word list, which means it is a heuristic, which means it is wrong sometimes. It errs
 * toward treating a sentence as a REPORT (the stricter reading) by requiring the cue to appear —
 * silence is not taken as permission. The structured path in validate.js does not rely on this at
 * all: there, advice arrives in its own field and the classification is exact.
 */
const ADVICE_CUES = [
  'try', 'aim', 'consider', 'next time', 'next session', 'suggest', 'recommend',
  'could ', 'you might', 'worth ', 'go for', 'stick to', 'stay at', 'drop to', 'build up',
  'rest ', 'wait ', 'start with', 'work up', 'should ',
];

/**
 * Split on sentence enders, keeping enough to attribute a number to the sentence it sat in.
 *
 * A full stop only ends a sentence when whitespace or the end of the text follows it. Without that
 * lookahead the decimal point in "0.38" is a sentence boundary, which splits the number in half and
 * turns one true claim into two fabricated ones — "0" and "38", neither of which is in the evidence.
 * Found by making the app's own deterministic fallback text pass through this validator.
 */
export function sentences(text) {
  const out = [];
  let start = 0;
  const re = /([.!?]+(?=\s|$)|\n+)\s*/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ text: text.slice(start, m.index + m[0].length), start });
    start = m.index + m[0].length;
  }
  if (start < text.length) out.push({ text: text.slice(start), start });
  return out.filter((s) => s.text.trim());
}

/** Does this sentence read as a recommendation rather than a report of what happened? */
export const isAdvice = (sentence) => {
  const s = sentence.toLowerCase();
  return ADVICE_CUES.some((cue) => s.includes(cue));
};

/**
 * Every number in a piece of text, with what it looked like and where it sat.
 *
 * `kind` is how it was WRITTEN, not what it means: `percentage` for a trailing %, `number`
 * otherwise. The evidence side decides what may legitimately produce each.
 *
 * @param text     the answer, or one field of it
 * @param claimed  what class of statement this text is. 'observed' and 'inference' must be
 *                 traceable to evidence; 'recommendation' is exempt, because a suggested number
 *                 is a proposal and not a claim about anything that happened.
 */
export function extract(text, claimed = 'inference') {
  const out = [];
  for (const m of String(text ?? '').matchAll(NUMBER)) {
    const value = Number(m[1]);
    if (!Number.isFinite(value)) continue;
    const at = m.index;
    out.push({
      raw: m[0].trim(),
      value,
      kind: m[2] ? 'percentage' : 'number',
      // How many digits were written after the point, which is the precision the claim itself
      // asserts and therefore the precision it is fair to check it at.
      decimals: (m[1].split('.')[1] ?? '').length,
      at,
      context: String(text).slice(Math.max(0, at - CONTEXT), at + m[0].length + CONTEXT).trim(),
      claimed,
    });
  }
  return out;
}

/**
 * Every number in a free-text answer, classified a sentence at a time.
 *
 * Used for the conversational path, where there is no structure to read the class off. A number
 * inside an advice sentence is marked `recommendation` and exempted; everything else has to hold up.
 */
export function extractProse(text) {
  return sentences(text).flatMap((s) =>
    extract(s.text, isAdvice(s.text) ? 'recommendation' : 'inference')
      .map((c) => ({ ...c, at: s.start + c.at, sentence: s.text.trim() })));
}
