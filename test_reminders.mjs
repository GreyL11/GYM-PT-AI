// Pure reminder-scheduling logic — no Capacitor, no device, no Date.now(). Run: node test_reminders.mjs
//
// notify.js (the file that actually calls @capacitor/local-notifications) is deliberately not
// imported here — it has nothing left to get wrong once this file is right, and it cannot be
// exercised in Node without a native runtime anyway. See notify.js's own doc comment.

import assert from 'node:assert/strict';
import * as reminders from './www/reminders.js';

const ok = [];
const check = (name, fn) => { fn(); ok.push(name); };

check('disabled preferences schedule nothing', () => {
  assert.deepEqual(reminders.hydrationHours({ ...reminders.DEFAULT_HYDRATION_PREFS, enabled: false }), []);
});

check('an empty or inverted window schedules nothing', () => {
  assert.deepEqual(reminders.hydrationHours({ enabled: true, startHour: 12, endHour: 12, intervalHours: 2 }), []);
  assert.deepEqual(reminders.hydrationHours({ enabled: true, startHour: 20, endHour: 9, intervalHours: 2 }), []);
});

check('a non-positive interval schedules nothing rather than looping forever', () => {
  assert.deepEqual(reminders.hydrationHours({ enabled: true, startHour: 9, endHour: 21, intervalHours: 0 }), []);
  assert.deepEqual(reminders.hydrationHours({ enabled: true, startHour: 9, endHour: 21, intervalHours: -1 }), []);
});

check('the window and interval produce exactly the expected hour slots, no duplicates', () => {
  const hours = reminders.hydrationHours({ enabled: true, startHour: 9, endHour: 21, intervalHours: 2 });
  assert.deepEqual(hours, [9, 11, 13, 15, 17, 19]);
  assert.equal(new Set(hours).size, hours.length, 'no duplicate hour slots');
});

check('every scheduled hour stays inside [startHour, endHour) — never past the window', () => {
  const p = { enabled: true, startHour: 9, endHour: 21, intervalHours: 4 };
  for (const h of reminders.hydrationHours(p)) {
    assert.ok(h >= p.startHour && h < p.endHour, `${h} must be inside [${p.startHour},${p.endHour})`);
  }
});

check('idFor is deterministic — the same key always maps to the same id, so rescheduling replaces', () => {
  assert.equal(reminders.idFor('hydration:9'), reminders.idFor('hydration:9'));
  assert.equal(reminders.hydrationId(9), reminders.hydrationId(9));
});

check('different hydration hours get different ids — no accidental collision within a normal day', () => {
  const ids = [9, 11, 13, 15, 17, 19].map(reminders.hydrationId);
  assert.equal(new Set(ids).size, ids.length);
});

check('a hydration id and a postpone id for the same-looking key never collide', () => {
  assert.notEqual(reminders.hydrationId(9), reminders.postponeId('9'));
});

check('ids are always positive, non-zero 32-bit-safe integers', () => {
  for (const key of ['hydration:9', 'postpone:skin:routine', '', 'x'.repeat(200)]) {
    const id = reminders.idFor(key);
    assert.ok(Number.isInteger(id) && id > 0 && id < 2147483647, `${key} -> ${id}`);
  }
});

console.log(`reminders: ${ok.length} checks passed`);
