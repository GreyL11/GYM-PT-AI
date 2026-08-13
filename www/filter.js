// Landmark smoothing and glitch rejection, applied before anything reads a joint position.
//
// Until now only the rep-counting angle was smoothed, and every fault check — torso lean, elbow
// flare, bar drift, symmetry — read raw landmarks. So the noisiest signals in the system were the
// ones deciding whether to correct you, while the cleanest one only counted reps.
//
// A fixed EMA cannot win here: heavy enough to kill jitter while you hold the bottom of a squat is
// heavy enough to lag the top of a fast one, and lag on the primary angle costs reps. The One Euro
// filter varies its cutoff with speed — smooth when slow, responsive when fast — which is exactly
// the shape of a rep.
//
// Casiez, Roussel & Vogel (2012), "1€ Filter". The whole thing is two low-passes and a derivative.

const smoothing = (cutoffHz, dt) => {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dt);
};

class OneEuro {
  constructor({ minCutoff, beta, dCutoff }) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = null;   // last filtered value
    this.dx = 0;     // last filtered derivative
  }

  filter(value, dt) {
    if (this.x === null) { this.x = value; return value; }
    const dx = (value - this.x) / dt;
    this.dx += smoothing(this.dCutoff, dt) * (dx - this.dx);
    // Faster movement raises the cutoff, which cuts lag exactly when lag would be felt.
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += smoothing(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

// Tuned at 30fps against two synthetic signals: a held position with tracker jitter, and a rep's
// worth of travel (0.6 of the frame in half a second).
//
// minCutoff sets how steady a held position is; beta sets how much the cutoff opens up with speed.
// Measured sweep of beta at fixed minCutoff — how far a fast ramp got, and how much rest jitter
// survived:
//
//   0.03 → 0.459   31%      0.2 → 0.501   31%
//   0.1  → 0.481   31%      0.4 → 0.523   31%
//
// Rest jitter is untouched by beta, which is the whole point of the filter: the cutoff only opens
// when the landmark is actually moving. So beta buys back lag for free, and 0.4 is taken on that
// basis rather than the paper's conservative default.
const DEFAULTS = { minCutoff: 1.2, beta: 0.4, dCutoff: 1.0 };

/**
 * Beyond this, a landmark did not move — the tracker glitched.
 *
 * Expressed as units per second so it scales with frame rate rather than assuming 30fps.
 * Normalized coordinates span the frame, so 3.0 means "crossing the whole frame in a third of a
 * second", which no elbow does. World landmarks are metres, so 4 m/s is a sprinter's hand speed.
 */
const MAX_SPEED = { normalized: 3.0, world: 4.0 };

const DEFAULT_DT = 1 / 30;
const MAX_DT = 0.25;        // a long stall should not be treated as one enormous smooth step
const MAX_REJECT_RUN = 3;   // after this many, believe the tracker and resync

/**
 * Smooths a whole 33-landmark array in place-ish (returns new objects, never mutates the input).
 *
 * @param {'normalized'|'world'} space  picks the glitch threshold; the maths is identical
 */
export function createLandmarkFilter(space = 'normalized', opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const axes = new Map();      // "12.x" → OneEuro
  const lastRaw = new Map();   // index → last ACCEPTED raw reading, for the glitch check
  const lastOut = new Map();   // index → last emitted point, held when a frame is rejected
  const rejectRun = new Map(); // index → consecutive rejections, so a real relocation gets through
  let lastT = null;
  let rejected = 0;

  const axis = (key) => {
    let f = axes.get(key);
    if (!f) { f = new OneEuro(cfg); axes.set(key, f); }
    return f;
  };

  return {
    get rejected() { return rejected; },

    reset() {
      axes.clear(); lastRaw.clear(); lastOut.clear(); rejectRun.clear();
      lastT = null; rejected = 0;
    },

    /**
     * @param {Array} landmarks  MediaPipe landmark array
     * @param {number} tMs       frame timestamp
     */
    apply(landmarks, tMs) {
      if (!landmarks) return landmarks;
      const dt = lastT === null ? DEFAULT_DT : Math.min(MAX_DT, Math.max(1e-3, (tMs - lastT) / 1000));
      lastT = tMs;
      const maxJump = MAX_SPEED[space] * dt;

      return landmarks.map((p, i) => {
        const prev = lastRaw.get(i);
        const run = rejectRun.get(i) ?? 0;

        // Compare RAW against RAW. Measuring the new reading against the previous *filtered* one
        // conflates a tracker glitch with the filter's own lag: during a fast rep the filter
        // trails the truth, that gap grows past the threshold, and every remaining frame of the
        // rep gets rejected — the filter freezes exactly when the lifter is moving.
        const jumped = prev && Math.hypot(p.x - prev.x, p.y - prev.y) > maxJump;

        // One frame of nonsense is a glitch; three in a row is the limb genuinely being somewhere
        // else, and refusing to follow it forever would be worse than the glitch.
        if (jumped && run < MAX_REJECT_RUN) {
          rejected += 1;
          rejectRun.set(i, run + 1);
          const held = lastOut.get(i);
          return held ? { ...held, visibility: p.visibility } : p;
        }

        rejectRun.set(i, 0);
        lastRaw.set(i, p);
        const out = {
          ...p,
          x: axis(`${i}.x`).filter(p.x, dt),
          y: axis(`${i}.y`).filter(p.y, dt),
          z: p.z === undefined ? undefined : axis(`${i}.z`).filter(p.z, dt),
        };
        lastOut.set(i, out);
        return out;
      });
    },
  };
}
