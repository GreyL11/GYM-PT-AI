// How to actually perform each lift.
//
// The rest of the app assumes you already know the movement and only speaks up when you deviate
// from it. That is useless the first time you attempt a lift — being corrected mid-rep is a bad
// way to learn a movement and a worse way to learn it under load.
//
// Spoken once, the first time you ever do a lift, and on demand from the "How to" button.
// Kept short on purpose: this is a reminder at the rack, not a coaching manual.

export const TECHNIQUE = {
  squat: {
    setup: 'Bar on your upper back, feet shoulder width, toes turned slightly out.',
    execute: 'Brace your core. Push your hips back and bend your knees together until your hip crease passes your knee. Drive up through your midfoot.',
    mistakes: ['knees caving in', 'letting your chest fold forward', 'heels lifting off the floor'],
  },
  rdl: {
    setup: 'Stand tall holding the bar against your thighs, feet hip width, knees softly bent.',
    execute: 'Push your hips back and let the bar slide down your legs. Stop when your hamstrings stretch, then drive your hips forward to stand.',
    mistakes: ['bending the knees and turning it into a squat', 'letting the bar drift away from your legs'],
  },
  lunge: {
    setup: 'Stand tall, then step one leg forward about a stride length.',
    execute: 'Drop your back knee toward the floor with your torso upright. Push through your front heel to stand back up.',
    mistakes: ['leaning forward over the front leg', 'stopping short of the floor'],
  },
  bench: {
    setup: 'Lie back with your eyes under the bar, feet flat, grip just outside shoulder width.',
    execute: 'Unrack and lower the bar to your mid chest with your elbows at about forty five degrees. Press back up and lock out.',
    mistakes: ['flaring the elbows straight out to the sides', 'bouncing the bar off your chest', 'letting the wrists bend back'],
  },
  inclineBench: {
    setup: 'Bench at about thirty degrees. Eyes under the bar, feet flat, grip just outside shoulder width.',
    execute: 'Lower the bar to your upper chest with the elbows tucked, then press back up and lock out.',
    mistakes: ['setting the bench too upright, which makes it a shoulder press', 'flaring the elbows'],
  },
  declineBench: {
    setup: 'Bench declined about fifteen degrees, legs hooked in. Grip just outside shoulder width.',
    execute: 'Lower the bar to your lower chest, then press back up and lock out. The bar path is shorter than a flat bench, so do not rush it.',
    mistakes: ['bouncing it off the ribs', 'sitting up off the bench to press'],
  },
  dbBench: {
    setup: 'Lie back with a dumbbell in each hand at chest height, palms forward, feet flat.',
    execute: 'Press both dumbbells up evenly until your arms are straight, then lower under control until you feel the chest stretch.',
    mistakes: ['one arm pressing ahead of the other', 'flaring the elbows straight out to the sides'],
  },
  inclineDbPress: {
    setup: 'Bench at about thirty degrees, a dumbbell in each hand at upper chest height.',
    execute: 'Press up and slightly together, then lower under control to the upper chest with the elbows tucked.',
    mistakes: ['setting the bench too upright, which makes it a shoulder press', 'letting one arm lag'],
  },
  chestDip: {
    setup: 'Grip the bars locked out, then lean your chest forward over your hands and cross your ankles behind you.',
    execute: 'Stay leaning forward the whole way. Lower until your chest is level with your hands, then press back up.',
    mistakes: ['drifting upright, which turns it into a triceps dip', 'shrugging the shoulders up at the bottom'],
  },
  pushup: {
    setup: 'Hands under your shoulders, body in a straight line from head to heels.',
    execute: 'Lower your chest to the floor with your elbows travelling back, not out. Press up and lock the elbows.',
    mistakes: ['letting the hips sag', 'stopping short of the floor'],
  },
  deadlift: {
    setup: 'Bar over your midfoot, shins almost touching it. Hinge down and grip just outside your knees.',
    execute: 'Chest up, pull the slack out of the bar, then push the floor away. Keep the bar against your legs the whole way and finish by driving your hips through.',
    mistakes: ['letting the bar drift forward off your shins', 'hips shooting up before the bar moves'],
  },
  row: {
    setup: 'Hinge forward to about forty five degrees with the bar hanging at arms length.',
    execute: 'Pull the bar to your hip with your elbows tight to your body, then lower it under control to a full stretch.',
    mistakes: ['standing up to heave the weight', 'flaring the elbows out wide'],
  },
  latPulldown: {
    setup: 'Grip wider than your shoulders, thighs locked under the pad, torso nearly upright.',
    execute: 'Pull the bar to your upper chest by driving your elbows down. Let it rise all the way back to a full stretch.',
    mistakes: ['leaning back to pull with your bodyweight', 'cutting the stretch short at the top'],
  },
  cableRow: {
    setup: 'Sit with your feet braced, knees softly bent, torso upright and the handle at arms length.',
    execute: 'Pull the handle to your stomach with your elbows brushing your ribs, then let it travel all the way back out.',
    mistakes: ['rocking backwards and forwards to move the weight', 'cutting the stretch short at the front'],
  },
  straightArmPulldown: {
    setup: 'Stand back from a high pulley, hinge slightly, arms straight out in front and overhead.',
    execute: 'Keeping the elbows locked, sweep your arms down in an arc to your thighs, then let them rise back up.',
    mistakes: ['bending the elbows, which turns it into a pulldown', 'bobbing up and down with the torso'],
  },
  ohp: {
    setup: 'Bar resting on your front shoulders, feet hip width, glutes and abs tight.',
    execute: 'Press straight up, moving your head back slightly out of the path. Lock out with the bar over your ears.',
    mistakes: ['arching your lower back to get the weight up', 'pressing around your head instead of straight up'],
  },
  lateralRaise: {
    setup: 'Dumbbells at your sides with a slight fixed bend in the elbow. Set the phone front on for this one.',
    execute: 'Raise your arms out to the sides until they reach shoulder height, then lower them slowly.',
    mistakes: ['going above shoulder height, which hands the work to your traps', 'swinging the weight up with your body'],
  },
  frontRaise: {
    setup: 'Dumbbells in front of your thighs, palms down, slight fixed bend in the elbow. Set the phone side on for this one.',
    execute: 'Raise your arms straight out in front of you until they reach shoulder height, then lower them slowly.',
    mistakes: ['swinging the weight up with your hips', 'going above shoulder height'],
  },
  rearDeltRaise: {
    setup: 'Hinge forward to about sixty degrees with the dumbbells hanging under your chest, elbows slightly bent. Phone low and front on.',
    execute: 'Pull your arms out to the sides until they are level with your shoulders, leading with the elbows, then lower slowly.',
    mistakes: ['standing up out of the hinge to swing them', 'bending the elbows and turning it into a row'],
  },
  curl: {
    setup: 'Stand tall with the bar at arms length and your elbows pinned to your ribs.',
    execute: 'Curl the bar up without letting your elbows travel forward, then lower it all the way to a full stretch.',
    mistakes: ['swinging your body to start the rep', 'letting the elbows drift forward'],
  },
  hammerCurl: {
    setup: 'Dumbbells at your sides, palms facing in, elbows pinned to your ribs.',
    execute: 'Curl straight up keeping the palms facing each other, then lower all the way down.',
    mistakes: ['swinging your body', 'letting the elbows drift forward'],
  },
  cableLateralRaise: {
    setup: 'Stand side-on to a low pulley, handle in the far hand across your body. Phone front on.',
    execute: 'Raise your arm out to the side until it reaches shoulder height, then lower it slowly against the tension.',
    mistakes: ['going above shoulder height', 'leaning away to swing the handle up'],
  },
  cableFrontRaise: {
    setup: 'Stand facing away from a low pulley, handle in front of your thigh, elbow slightly bent. Phone side on.',
    execute: 'Raise your arm straight out in front to shoulder height, then lower it slowly.',
    mistakes: ['swinging your hips to start it', 'going above shoulder height'],
  },
  cableCurl: {
    setup: 'Stand facing a low pulley, elbows pinned to your ribs, arms straight down.',
    execute: 'Curl the handle up without letting the elbows travel forward, then lower all the way to a full stretch.',
    mistakes: ['swinging your body', 'letting the elbows drift forward'],
  },
  overheadExtension: {
    setup: 'Face away from the stack with the rope overhead, upper arms beside your ears, elbows bent.',
    execute: 'Straighten your elbows overhead without moving your upper arms, then let it stretch back behind your head.',
    mistakes: ['dropping the upper arms forward to press it', 'stopping short of the stretch'],
  },
  pushdown: {
    setup: 'Face the cable with your elbows tucked to your ribs and your upper arms vertical.',
    execute: 'Push the bar down until your elbows lock, keeping your upper arms completely still. Return to about ninety degrees.',
    mistakes: ['letting the elbows swing forward', 'leaning your bodyweight into the bar'],
  },
  skullcrusher: {
    setup: 'Lie back, press the bar up, then set your upper arms vertical.',
    execute: 'Bend only at the elbow, lowering the bar toward your forehead. Press back to lockout without moving your upper arms.',
    mistakes: ['letting the upper arms drift back, turning it into a pullover', 'stopping short of a full stretch'],
  },
  dip: {
    setup: 'Grip the bars with your arms locked out and your torso upright.',
    execute: 'Lower yourself until your upper arms are parallel to the floor, staying upright, then press back to lockout.',
    mistakes: ['leaning forward, which turns it into a chest dip', 'not going deep enough'],
  },
};

/** The spoken brief. Camera placement first, because you have to set that up before anything else. */
export function script(exId, cameraHint) {
  const t = TECHNIQUE[exId];
  if (!t) return cameraHint ?? '';
  const mistakes = t.mistakes.length
    ? ` Watch out for ${t.mistakes.slice(0, -1).join(', ')}${t.mistakes.length > 1 ? ' and ' : ''}${t.mistakes.at(-1)}.`
    : '';
  return `${cameraHint ? `${cameraHint} ` : ''}${t.setup} ${t.execute}${mistakes}`;
}

/** Same content, laid out to read rather than hear. */
export function lines(exId) {
  const t = TECHNIQUE[exId];
  if (!t) return [];
  return [
    ['Set up', t.setup],
    ['Move', t.execute],
    ['Avoid', `${t.mistakes.join('; ')}.`],
  ];
}
