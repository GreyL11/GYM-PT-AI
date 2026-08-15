// Pure reminder-scheduling logic — no Capacitor import, no Date.now(), no device. Everything a
// test can check about "when should this fire" and "which id is this" lives here, so it can be
// checked without a phone. notify.js is the thin layer that hands these numbers to the actual
// LocalNotifications plugin; it owns nothing this file could get wrong.

/** User-facing hydration reminder preferences. Reminder settings, not medical advice — the window
 *  and interval are about not annoying anyone, not a hydration prescription. */
export const DEFAULT_HYDRATION_PREFS = { enabled: false, startHour: 9, endHour: 21, intervalHours: 2 };

/**
 * Which hours of the day a hydration reminder should fire at, given the user's own window and
 * interval. Disabled, a zero/negative interval, or an empty window all produce nothing — there is
 * no default schedule to fall back on once the user has said no.
 */
export function hydrationHours(prefs) {
  if (!prefs?.enabled || !(prefs.intervalHours > 0) || prefs.endHour <= prefs.startHour) return [];
  const hours = [];
  for (let h = prefs.startHour; h < prefs.endHour; h += prefs.intervalHours) hours.push(h);
  return hours;
}

/**
 * A stable small-int id from a string key, so the same logical reminder always maps to the same
 * notification id — scheduling it again replaces it rather than duplicating it. Capacitor ids are
 * 32-bit; kept positive and non-zero.
 */
export function idFor(key) {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
  return (h % 2147483646) + 1;
}

export const hydrationId = (hour) => idFor(`hydration:${hour}`);
export const postponeId = (actionId) => idFor(`postpone:${actionId}`);
