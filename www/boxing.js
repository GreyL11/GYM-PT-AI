// Boxing: rounds, punch detection, and the faults a camera can honestly see.
//
// This is a separate module because nothing in the lifting engine fits. That one counts reps of a
// single movement, driven by one joint angle crossing two endpoints, and progresses by adding
// weight. Boxing is a stream of different punches from both hands in no fixed order, measured in
// rounds and output. The only shared machinery is underneath: landmarks, filtering, cue throttling
// and the voice.
//
// WHAT A SINGLE CAMERA CAN AND CANNOT SEE
//
// Reliable: that a punch was thrown, by which hand, how fast it came back, whether the other hand
// stayed up. Those are large, unambiguous movements.
//
// Approximate: which punch it was. A straight thrown at the lens foreshortens to almost nothing,
// and a hook thrown away from the camera is hidden behind the torso. Every punch therefore carries
// a confidence, and the UI shows it, because a breakdown that looks precise and is not is worse
// than one that admits doubt.
//
// Impossible: power, impact, wrist alignment. Nothing camera-based gets these and nothing here
// pretends to.

import { IDX } from './exercises.js';

const DEG = 180 / Math.PI;

/**
 * Boxing measures in 3D. The lifting engine deliberately ignores world z — it is MediaPipe's
 * noisiest channel, and a side-on camera already puts a squat in the image plane, so using depth
 * there would add error for nothing.
 *
 * Boxing is the opposite case. The camera is FRONT-on, and a jab travels almost entirely towards
 * the lens: in x/y the wrist barely leaves the chin, so a 2D reach would miss the most-thrown
 * punch in the sport. The same projection makes an extended arm pointing at the camera measure as
 * a bent one, which would file every front-on straight as a hook.
 *
 * So depth is used here despite the noise, because the alternative is not seeing the punch at all.
 * Both measures are of gross, half-metre movements, which is the regime z is adequate for.
 */
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));

function angle3(a, b, c) {
  const ab = [a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0)];
  const cb = [c.x - b.x, c.y - b.y, (c.z ?? 0) - (b.z ?? 0)];
  const dot = ab[0] * cb[0] + ab[1] * cb[1] + ab[2] * cb[2];
  const mag = Math.hypot(...ab) * Math.hypot(...cb);
  if (mag < 1e-9) return 0;
  return Math.acos(Math.min(1, Math.max(-1, dot / mag))) * DEG;
}

export const STANCES = ['orthodox', 'southpaw'];

/** Which hand leads. An orthodox boxer stands left-side forward, so the left hand jabs. */
export const leadHand = (stance) => (stance === 'southpaw' ? 'right' : 'left');

export const MODES = {
  shadow: {
    label: 'Shadowboxing',
    hint: 'Phone front-on at chest height, 2–3 m away. Both hands and your head in frame.',
    // Everything is visible, so everything is checked.
    faults: ['guardDown', 'noReturn', 'overExtend', 'noRotation', 'chinUp'],
  },
  bag: {
    label: 'Heavy bag',
    hint: 'Phone front-on, off to the side of the bag so it does not cover you.',
    // The bag eats the lead hand for much of a round and blocks the shoulder line.
    faults: ['guardDown', 'noReturn', 'overExtend'],
  },
  pads: {
    label: 'Pad work',
    hint: 'Phone front-on. Frame yourself, not your partner — only one person is tracked.',
    // A partner in shot is the real hazard here; see trackingWarning().
    faults: ['guardDown', 'noReturn'],
  },
};

export const DEFAULT_BOUT = {
  mode: 'shadow',
  stance: 'orthodox',
  rounds: 3,
  workSec: 180,
  restSec: 60,
};

// ── thresholds ───────────────────────────────────────────────────────────────────────────
// All distances are divided by the boxer's own shoulder width, so they hold at any camera
// distance and for any body size. Angles are degrees.

export const BOX_THRESHOLDS = {
  // Reach is measured from the hand's OWN shoulder, not from the nose.
  //
  // Nose-distance is the obvious choice and it only works for straights. A hook finishes across
  // your own chin and an uppercut finishes in front of your own face, so both stay close to the
  // nose while being fully thrown — measured that way they land at 1.05 and 0.99, below the
  // trigger a straight clears at 1.7, and two of the four punches are simply never seen.
  //
  // From the shoulder the guard sits at 0.46 and every punch type lands between 1.35 and 1.63.
  guardDist: 0.75,    // hand within this of its shoulder is back in guard
  punchDist: 1.15,    // hand beyond this has been thrown
  returnMs: 500,      // longer than this to come back is a dropped hand
  overExtend: 176,    // straightening past this risks the elbow
  chinUp: 0.45,       // nose this far above the shoulder line is a lifted chin
  rotation: 12,       // degrees the shoulders should turn on a rear straight
  guardHeight: 0.15,  // idle hand this far BELOW the shoulder line is a dropped guard
};

const HOLD_FRAMES = 4;          // a fault holds this long before it is called
const PEAK_EPS = 0.03;          // reach must grow by this to count as still extending
const STRAIGHT_ELBOW = 150;     // at peak: arm this straight means a straight punch
const UPPERCUT_RISE = 0.35;     // wrist this far above the shoulder means it came from below

export function createBoutState() {
  return {
    hands: {
      left: { phase: 'guard', outAt: 0, peak: 0, peakAt: 0, peakPose: null },
      right: { phase: 'guard', outAt: 0, peak: 0, peakAt: 0, peakPose: null },
    },
    punches: [],
    faultFrames: {},
    faultCounts: {},
    shoulderAtGuard: null,
  };
}

/** Shoulder-line angle in the image, used to see whether the body turned into a punch. */
const shoulderAngle = (w) => Math.atan2(
  w[IDX.right.shoulder].y - w[IDX.left.shoulder].y,
  w[IDX.right.shoulder].x - w[IDX.left.shoulder].x,
) * DEG;

/**
 * Name the punch from where the hand was at full extension.
 *
 * Straight-vs-bent separates jabs and crosses from hooks and uppercuts; height then separates the
 * uppercut from the hook. Confidence drops when the arm is at the boundary between two shapes,
 * which is exactly where a single viewpoint stops being trustworthy.
 */
export function classify(pose, hand, stance) {
  const { elbow, rise } = pose;
  const lead = leadHand(stance) === hand;

  if (elbow >= STRAIGHT_ELBOW) {
    // Confidence rises the straighter the arm is: a half-extended arm pointing at the lens looks
    // the same as a hook thrown across it.
    return { kind: lead ? 'jab' : 'cross', hand, confidence: Math.min(1, (elbow - 130) / 40) };
  }
  if (rise > UPPERCUT_RISE) {
    return { kind: 'uppercut', hand, confidence: Math.min(1, rise / 0.6) };
  }
  return { kind: 'hook', hand, confidence: Math.min(1, (STRAIGHT_ELBOW - elbow) / 45) };
}

export const PUNCH_LABELS = { jab: 'Jab', cross: 'Cross', hook: 'Hook', uppercut: 'Uppercut' };

const FAULT_CUES = {
  guardDown: 'Hands up. Protect your chin.',
  noReturn: 'Snap it back. The hand comes home every time.',
  overExtend: 'Stop locking the elbow out. You will hurt it.',
  noRotation: 'Turn your hip into it. Do not arm punch.',
  chinUp: 'Chin down, eyes up.',
};

/** Guard dropping and hyperextending an elbow are how people get hurt; the rest is technique. */
export const BOX_SAFETY = ['guardDown', 'overExtend'];

/**
 * Advance one frame of a round.
 *
 * @param {object} frame  { lm, w, tMs } — normalized landmarks, world landmarks, timestamp
 * @param {object} st     from createBoutState(), mutated
 * @param {object} cfg    { mode, stance, T }
 */
export function boxStep(frame, st, cfg) {
  const { lm, w, tMs } = frame;
  const T = { ...BOX_THRESHOLDS, ...(cfg.T ?? {}) };
  const active = new Set(MODES[cfg.mode]?.faults ?? MODES.shadow.faults);

  const need = [IDX.left.shoulder, IDX.right.shoulder, 0];
  if (!w || need.some((i) => (lm[i]?.visibility ?? 0) < 0.5)) {
    st.faultFrames = {};
    return { visible: false, punch: null, count: st.punches.length, faults: [], hands: {} };
  }

  const nose = w[0];
  const sw = dist(w[IDX.left.shoulder], w[IDX.right.shoulder]) || 1e-6;
  const shoulderMidY = (w[IDX.left.shoulder].y + w[IDX.right.shoulder].y) / 2;

  const faults = [];
  const emit = (id) => {
    st.faultCounts[id] = (st.faultCounts[id] ?? 0) + 1;
    faults.push({ id, cue: FAULT_CUES[id], severity: BOX_SAFETY.includes(id) ? 'safety' : 'efficiency' });
  };

  // A CONTINUOUS fault — a guard that is down, a chin that is up — has to persist before it counts,
  // so a hand passing through does not trigger it.
  const fire = (id) => {
    if (!active.has(id)) return;
    st.faultFrames[id] = (st.faultFrames[id] ?? 0) + 1;
    if (st.faultFrames[id] === HOLD_FRAMES) emit(id);
  };
  const clear = (id) => { st.faultFrames[id] = 0; };

  // A PER-PUNCH fault is already a single event and needs no debouncing. Running these through the
  // hold counter meant four bad punches were needed to report one, which for something as
  // occasional as a hyperextended elbow is the same as never reporting it.
  const fireOnce = (id) => { if (active.has(id)) emit(id); };

  // ── per hand ─────────────────────────────────────────────────────────────────────────
  let punch = null;
  const hands = {};

  for (const side of ['left', 'right']) {
    const j = IDX[side];
    const wrist = w[j.wrist];
    const shoulder = w[j.shoulder];
    const elbowVis = lm[j.elbow]?.visibility ?? 0;
    const wristVis = lm[j.wrist]?.visibility ?? 0;

    // A hand behind a heavy bag simply is not measurable. Say nothing rather than guess.
    if (wristVis < 0.5 || elbowVis < 0.5) { hands[side] = { seen: false }; continue; }

    const reach = dist(wrist, shoulder) / sw;
    const h = st.hands[side];
    hands[side] = { seen: true, reach, inGuard: reach <= T.guardDist };

    // Where the hand is right now, in the terms classify() speaks.
    const poseNow = () => ({
      elbow: angle3(shoulder, w[j.elbow], wrist),
      rise: (shoulder.y - wrist.y) / sw,   // y grows downward, so positive means above the shoulder
      shoulders: shoulderAngle(w),
    });

    if (h.phase === 'guard') {
      if (reach > T.punchDist) {
        h.phase = 'out';
        h.outAt = tMs;
        h.peak = reach;
        h.peakAt = tMs;
        // Captured here as well as on the way out: a punch that arrives at its furthest point on
        // the very first frame past the threshold would otherwise record no pose at all, and get
        // classified from zeros — which reads as a hook, whatever it actually was.
        h.peakPose = poseNow();
        st.shoulderAtGuard ??= shoulderAngle(w);
      }
    } else if (reach > h.peak + PEAK_EPS) {
      // Still travelling OUT — and it has to be travelling, not merely still out there.
      //
      // Accepting `reach >= h.peak` re-stamped the peak on every frame a held hand stayed level,
      // so the hang time was folded into the outward phase and the return measured a single frame.
      // A hand left dangling — the exact fault noReturn exists to catch — scored a perfect return.
      h.peak = reach;
      h.peakAt = tMs;
      h.peakPose = poseNow();
    } else if (reach <= T.guardDist) {
      // Home again: that is a completed punch.
      h.phase = 'guard';
      const pose = h.peakPose ?? { elbow: 0, rise: 0, shoulders: shoulderAngle(w) };
      const c = classify(pose, side, cfg.stance);
      const returnMs = tMs - h.peakAt;
      punch = { ...c, at: tMs, outMs: Math.round(h.peakAt - h.outAt), returnMs: Math.round(returnMs), peak: h.peak };
      st.punches.push(punch);

      if (returnMs > T.returnMs) fireOnce('noReturn');
      if (pose.elbow > T.overExtend) fireOnce('overExtend');

      // A rear-hand straight is driven by the hips; the shoulders must come round with it.
      const rear = leadHand(cfg.stance) !== side;
      if (rear && c.kind === 'cross' && st.shoulderAtGuard !== null) {
        const turned = Math.abs(pose.shoulders - st.shoulderAtGuard);
        if (turned < T.rotation) fireOnce('noRotation');
      }
      st.shoulderAtGuard = null;
    }
  }

  // ── guard, checked on whichever hand is not currently punching ────────────────────────
  const idle = ['left', 'right'].filter((s) => st.hands[s].phase === 'guard' && hands[s]?.seen);
  const dropped = idle.some((s) => (w[IDX[s].wrist].y - w[IDX[s].shoulder].y) / sw > T.guardHeight);
  if (dropped) fire('guardDown'); else clear('guardDown');

  // Chin lifted: the head has come up and back, off the shoulders.
  if ((shoulderMidY - nose.y) / sw > T.chinUp) fire('chinUp'); else clear('chinUp');

  return { visible: true, punch, count: st.punches.length, faults, hands };
}

// ── the round clock ──────────────────────────────────────────────────────────────────────

export function createBout(bout = DEFAULT_BOUT) {
  return { ...DEFAULT_BOUT, ...bout, round: 1, phase: 'work', startedAt: null };
}

/**
 * Where the bout is now, from wall-clock time rather than a counted-down variable — a timer that
 * is throttled while the app is backgrounded still tells the truth when you look at it.
 */
export function boutAt(b, nowMs) {
  // `== null`, not `!b.startedAt`: a start time of zero is a valid epoch, and treating it as
  // "not started yet" pins the bout at round one forever.
  if (b.startedAt == null) return { round: 1, phase: 'work', left: b.workSec, done: false };
  const cycle = b.workSec + b.restSec;
  const elapsed = Math.max(0, (nowMs - b.startedAt) / 1000);
  const total = b.rounds * cycle - b.restSec;   // no rest after the final bell
  if (elapsed >= total) return { round: b.rounds, phase: 'done', left: 0, done: true };

  const round = Math.min(b.rounds, Math.floor(elapsed / cycle) + 1);
  const into = elapsed - (round - 1) * cycle;
  return into < b.workSec
    ? { round, phase: 'work', left: Math.ceil(b.workSec - into), done: false }
    : { round, phase: 'rest', left: Math.ceil(cycle - into), done: false };
}

/** Punch rate, the number that actually tracks conditioning across a bout. */
export function roundStats(punches, workSec) {
  const byKind = {};
  let confident = 0;
  for (const p of punches) {
    byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
    if (p.confidence >= 0.6) confident += 1;
  }
  const returns = punches.map((p) => p.returnMs).filter((n) => n > 0).sort((a, b) => a - b);
  return {
    count: punches.length,
    perMinute: workSec ? Math.round((punches.length / workSec) * 60) : 0,
    byKind,
    // How much of the breakdown to believe.
    certainty: punches.length ? confident / punches.length : 0,
    medianReturnMs: returns.length ? returns[Math.floor(returns.length / 2)] : null,
  };
}

/** Pad work is the one mode where the camera may lock onto the wrong human. */
export const trackingWarning = (mode) => (mode === 'pads'
  ? 'Only one person is tracked. If your partner is fully in frame the app may follow them instead.'
  : null);
