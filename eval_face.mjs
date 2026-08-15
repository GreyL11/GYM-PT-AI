// Live empirical evaluation of the face measurement pipeline against REAL captures.
//
//   node eval_face.mjs [backup.json]
//
// NEVER part of `npm test`, and it must stay that way. Everything in the normal suite runs on
// synthetic faces and synthetic pixels and proves the arithmetic; this one needs a person, a phone,
// and a corpus, and it proves whether any of that arithmetic survives a real face. Those are
// different questions and mixing them would make the fast one slow and the slow one unrunnable.
//
// INPUT is a backup exported from the app (Settings → export), which carries the capture records
// inside `settings.faceLab`. Nothing here reads an image: re-running the pipeline over saved PNGs
// would need a PNG decoder, which would need a dependency, and the records already contain every
// number the validation engine reads. The saved PNGs exist so a human can look at what the
// pipeline saw, and so a future offline re-run is possible at all.
//
// WHEN THERE IS NOT ENOUGH DATA IT SAYS SO, LOUDLY. A harness that printed a tidy empty table would
// be indistinguishable from one reporting that everything passed.

import { readFileSync } from 'node:fs';

const validation = await import('./www/face/validation.js');
const protocol = await import('./www/face/protocol.js');
const { FEATURES } = await import('./www/face/features.js');
const recordMod = await import('./www/face/record.js');

const path = process.argv[2];

if (!path) {
  console.log(`
INSUFFICIENT DATA — no capture file given.

  node eval_face.mjs <backup.json>

Export a backup from the app once you have collected captures. Until then nothing has been measured
on a real face, no signal is validated, and no appearance intelligence may be enabled.
`.trim());
  process.exit(0);
}

let captures = [];
let notApplicable = {};
try {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  const data = parsed?.data ?? parsed;
  // Three accepted shapes, in order: a dedicated validation export, a full app backup, and a bare
  // capture array. The middle one is the Phase 3.5 path and is kept working deliberately — a corpus
  // collected before the dedicated export existed must not become unreadable because a nicer format
  // arrived afterwards.
  captures = data?.captures ?? data?.settings?.faceLab?.captures ?? [];
  notApplicable = data?.notApplicable ?? data?.settings?.faceLab?.notApplicable ?? {};
} catch (err) {
  console.error(`Could not read ${path}: ${err.message}`);
  process.exit(1);
}

if (!Array.isArray(captures) || !captures.length) {
  console.log('INSUFFICIENT DATA — the file parsed but contains no face captures.');
  process.exit(0);
}

const { records, excluded, versionGroups } = recordMod.comparable(captures);
const accepted = records.filter((r) => r.accepted);
const regions = [...new Set(records.flatMap((r) => Object.keys(r.regions ?? {})))].sort();

const line = (s = '') => console.log(s);
const pct = (n) => (typeof n === 'number' ? `${(n * 100).toFixed(1)}%` : '—');
const num = (n, dp = 4) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(dp) : '—');

line('FACE EMPIRICAL EVALUATION');
line('='.repeat(78));
line();
line(`source                ${path}`);
line(`captures in file      ${captures.length}`);
line(`comparable            ${records.length}${excluded ? `  (${excluded} set aside from ${versionGroups - 1} other pipeline version(s))` : ''}`);
line(`accepted by the gate  ${accepted.length}  (${pct(records.length ? accepted.length / records.length : 0)} acceptance rate)`);
line();

line('PIPELINE / MODEL VERSIONS');
line('-'.repeat(78));
const v = records[0]?.versions ?? {};
for (const [k, val] of Object.entries(v)) line(`  ${k.padEnd(12)} ${val ?? '(not used)'}`);
const noVeto = accepted.filter((r) => !r.versions?.segmenter).length;
if (noVeto) line(`  WARNING: ${noVeto} accepted capture(s) were measured with NO segmentation veto.`);
line();

// ── COLLECTION, which is not validation ──────────────────────────────────────────────────
// This section answers "were the photographs taken?". Nothing in it says a signal is trustworthy,
// and it is printed first precisely so that a wall of COMPLETE cannot be mistaken for a result.

line('PROTOCOL COLLECTION STATUS   (photographs taken — NOT a validation result)');
line('-'.repeat(78));
const board = protocol.dashboard(records, notApplicable);
for (const p of board) {
  const spec = protocol.SPEC[p.id];
  const count = p.state === protocol.COLLECTION.NOT_APPLICABLE ? '  n/a' : `${String(p.counted).padStart(3)}/${String(p.target).padEnd(3)}`;
  line(`  ${p.id}  ${count}  ${p.state.padEnd(15)} ${spec.label}`
    + (p.rejected ? `   ${p.rejected} rejected` : ''));
  if (p.conditionsMissing?.length && spec.minConditions > 1 && p.state !== protocol.COLLECTION.NOT_APPLICABLE) {
    line(`          conditions ${p.conditions.length}/${spec.minConditions}, not yet tried: ${p.conditionsMissing.join(', ')}`);
  }
  if (spec.distinctDays) line(`          spread over ${p.days} calendar day(s); only the first capture of each day counts`);
}
const complete = board.filter((p) => p.state === protocol.COLLECTION.COMPLETE).length;
const na = board.filter((p) => p.state === protocol.COLLECTION.NOT_APPLICABLE).length;
line(`  ${complete} complete, ${na} not applicable, ${board.length - complete - na} outstanding`);
line();

// Per-protocol readings, in the vocabulary each protocol actually supports. These are statements
// about the CORPUS, not about any signal — a protocol cannot pass validation, only supply evidence.
line('PROTOCOL READINGS');
line('-'.repeat(78));
for (const p of board) {
  const spec = protocol.SPEC[p.id];
  const verdict = p.state === protocol.COLLECTION.NOT_APPLICABLE ? 'NOT_APPLICABLE'
    : p.state === protocol.COLLECTION.COMPLETE ? 'EVIDENCE COMPLETE'
      : 'INSUFFICIENT DATA';
  line(`  ${spec.label.padEnd(40)} ${verdict}`);
}
line();
line('  Note: an "EVIDENCE COMPLETE" protocol has supplied its captures. Whether any signal');
line('  survived them is decided only by the Phase 3.5 gates, in the section below.');
line();

line('REGION AVAILABILITY  (over accepted captures)');
line('-'.repeat(78));
for (const name of regions) {
  const seen = accepted.filter((r) => r.regions?.[name]);
  const avail = seen.filter((r) => r.regions[name].available);
  const cov = avail.map((r) => r.regions[name].coverage).filter((n) => typeof n === 'number');
  const meanCov = cov.length ? cov.reduce((a, b) => a + b, 0) / cov.length : null;
  const reasons = {};
  for (const r of seen.filter((x) => !x.regions[name].available)) {
    const why = r.regions[name].reason ?? 'unknown';
    reasons[why] = (reasons[why] ?? 0) + 1;
  }
  const top = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0];
  line(`  ${name.padEnd(16)} ${pct(seen.length ? avail.length / seen.length : 0).padStart(7)}  mean coverage ${pct(meanCov).padStart(7)}`
    + (top ? `   most lost to: ${top[0]} (${top[1]})` : ''));
}
line();

line('SIGNAL VALIDATION');
line('-'.repeat(78));
const signals = validation.evaluateAll(records, regions, FEATURES);
const counts = validation.summarise(signals);
for (const [state, n] of Object.entries(counts)) line(`  ${state.padEnd(22)} ${n}`);
line();

const byState = (s) => signals.filter((x) => x.state === s);

line('  signal                          state                 noise/  light/  geom/   hair/  falseChg');
line('                                                        spread  noise   noise   noise');
line('  ' + '-'.repeat(76));
for (const s of signals.sort((a, b) => a.region.localeCompare(b.region) || a.feature.localeCompare(b.feature))) {
  const m = s.metrics;
  line(`  ${`${s.region}.${s.feature}`.padEnd(31)} ${s.state.padEnd(21)} `
    + `${num(m.noiseRatio, 2).padStart(6)}  ${num(m.lightingRatio, 2).padStart(6)}  `
    + `${num(m.geometryRatio, 2).padStart(6)}  ${num(m.facialHairRatio, 2).padStart(6)}  ${pct(m.falseChangeRate).padStart(8)}`);
}
line();
line('  noise/spread and light/noise are GATED (limits 0.5 and 2.0).');
line('  geom/noise and hair/noise are REPORTED ONLY — the Phase 3.5 gates were fixed before any');
line('  capture existed and adding a gate now, knowing what the corpus holds, would be moving the');
line('  goalposts. Read them, then decide on the record whether they should ever gate.');
line();

const occ = validation.occlusionBehaviour(records);
if (occ.length) {
  line('OCCLUSION BEHAVIOUR  (protocol E asks a different question: does the pipeline REFUSE?)');
  line('-'.repeat(78));
  for (const o of occ) {
    line(`  ${o.condition.padEnd(16)} ${o.region.padEnd(16)} ${o.verdict.padEnd(28)}`
      + `base ${pct(o.baselineAvailability)} → occluded ${pct(o.occludedAvailability)}`
      + (o.rejectedOutright ? `, ${o.rejectedOutright} rejected outright` : ''));
  }
  line();
  line('  refused_by_gate and excluded_correctly are both correct outcomes.');
  line('  measured_through_occlusion is the failure: the veto did not work.');
  line();
}

for (const [label, state] of [
  ['PASSED — may become product intelligence', validation.STATES.VALIDATED],
  ['UNSTABLE — delete or disable these', validation.STATES.UNSTABLE],
  ['INSUFFICIENT DATA', validation.STATES.INSUFFICIENT_DATA],
  ['STILL COLLECTING', validation.STATES.COLLECTING_DATA],
]) {
  const set = byState(state);
  line(`${label}: ${set.length ? '' : 'none'}`);
  for (const s of set) line(`  ${s.region}.${s.feature} — ${s.reason}`);
  line();
}

const ready = validation.productReady(signals);
line('='.repeat(78));
if (!ready.length) {
  line('VERDICT: no signal has satisfied the validation gates.');
  line('         No appearance intelligence may be enabled. This is the expected result until the');
  line('         protocols above are complete on real captures.');
} else {
  line(`VERDICT: ${ready.length} signal(s) satisfied every gate on real captures:`);
  for (const s of ready) line(`         ${s.region}.${s.feature} — ${s.reason}`);
}
line('='.repeat(78));
