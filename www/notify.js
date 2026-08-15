// Local device reminders — the only Capacitor-touching part of the reminder layer. Everything
// about WHEN and WHICH id lives in reminders.js and is unit-tested without this file; this file's
// only job is to hand those numbers to the LocalNotifications plugin and never let a plugin
// failure (no permission, running in a browser tab, no native runtime) become an app error.
//
// This app ships no bundler — www/ is loaded as plain ES modules, in the browser during dev and
// inside the Capacitor WebView on device (see serve.mjs). So this deliberately does NOT
// `import '@capacitor/local-notifications'`: that package's own JS bundle expects to be wired to
// a `@capacitor/core` instance via a bundler, and loading a second, disconnected core here would
// register the plugin against a dead-end web fallback instead of the real native bridge — quietly
// breaking reminders on an actual device while looking fine in a browser tab. The native Android
// runtime already injects a fully-wired `window.Capacitor.Plugins.LocalNotifications` for every
// plugin listed in capacitor.plugins.json (see `npx cap sync`) before any page script runs, which
// is the correct, documented way to reach a Capacitor plugin with no bundler at all. In a plain
// browser tab that global simply does not exist, which is exactly the "no native runtime" case
// every function below already has to degrade gracefully for.
//
// No backend, no push service — every notification here is scheduled on-device and fires with the
// app closed. Nothing in this file decides WHETHER to remind about something; health.js/app.js
// call in only after a real user action (postponed) or a real preference (hydration reminders on).

import * as reminders from './reminders.js';
import * as store from './store.js';

const HYDRATION_PREFS_KEY = 'hydrationReminders';
// The hour list actually scheduled last time, so a re-sync on app start with unchanged prefs is a
// no-op instead of a cancel/reschedule — app restart must not touch, let alone duplicate, reminders
// that are still correct.
const HYDRATION_SCHEDULED_KEY = 'hydrationScheduledHours';

export const getHydrationPrefs = () => store.getSetting(HYDRATION_PREFS_KEY, reminders.DEFAULT_HYDRATION_PREFS);
export const setHydrationPrefs = (prefs) => store.setSetting(HYDRATION_PREFS_KEY, prefs);

/** `null` outside a real Capacitor native runtime — a plain browser tab, this project's own dev
 *  preview included, has no such bridge and every caller below treats that as "nothing to do". */
const plugin = () => globalThis.Capacitor?.Plugins?.LocalNotifications ?? null;

/** Never throws — a scheduling call that can't reach the plugin (web preview, denied permission,
 *  no native runtime) must degrade to "nothing happened", not an error the caller has to handle. */
async function safe(fn, fallback = false) {
  try { return await fn(); } catch { return fallback; }
}

async function hasPermission() {
  const ln = plugin();
  if (!ln) return false;
  return safe(async () => {
    const cur = await ln.checkPermissions();
    if (cur.display === 'granted') return true;
    const req = await ln.requestPermissions();
    return req.display === 'granted';
  });
}

export async function cancelReminder(id) {
  const ln = plugin();
  if (!ln) return null;
  return safe(() => ln.cancel({ notifications: [{ id }] }), null) ?? null;
}

/**
 * Bring the scheduled hydration reminders in line with the user's own preferences. Cancels
 * whatever was scheduled before (by id, from the persisted list — never "cancel everything",
 * which would also blow away a live postponed-action reminder) and schedules the new set, one
 * repeating daily notification per hour slot so there is nothing to re-fire or re-schedule until
 * the preferences themselves change.
 */
export async function syncHydrationReminders(prefs = getHydrationPrefs()) {
  const already = store.getSetting(HYDRATION_SCHEDULED_KEY, []);
  const wanted = reminders.hydrationHours(prefs);
  if (already.length === wanted.length && already.every((h, i) => h === wanted[i])) return true; // no-op: unchanged

  for (const h of already) await cancelReminder(reminders.hydrationId(h));
  if (!wanted.length) { setHydrationPrefs(prefs); store.setSetting(HYDRATION_SCHEDULED_KEY, []); return true; }

  if (!(await hasPermission())) return false; // permission (or plugin) unavailable: schedule nothing
  const ln = plugin();
  const ok = await safe(() => ln.schedule({
    notifications: wanted.map((h) => ({
      id: reminders.hydrationId(h),
      title: 'Hydration',
      body: 'A good moment to drink some water.',
      schedule: { on: { hour: h, minute: 0 }, allowWhileIdle: true },
    })),
  }));
  if (ok === false) return false;
  store.setSetting(HYDRATION_SCHEDULED_KEY, wanted);
  return true;
}

/** Called once at app start so a fresh install/launch honors whatever was last configured. */
export function initReminders() {
  const prefs = getHydrationPrefs();
  if (prefs.enabled) syncHydrationReminders(prefs);
}

/**
 * Schedule exactly one reminder for a postponed action, replacing any reminder already pending for
 * it. Failure here must never mark the action complete or postponed again — this is called AFTER
 * health.recordOutcome() already succeeded, purely best-effort.
 */
export async function schedulePostponeReminder(action, delayMs) {
  const id = reminders.postponeId(action.id);
  await cancelReminder(id);
  if (!(await hasPermission())) return false;
  const ln = plugin();
  return safe(() => ln.schedule({
    notifications: [{
      id,
      title: 'Still there',
      body: action.title,
      schedule: { at: new Date(Date.now() + delayMs) },
    }],
  }));
}

export const cancelPostponeReminder = (actionId) => cancelReminder(reminders.postponeId(actionId));

/**
 * The single hook app.js calls after every action outcome. Postponing schedules the one reminder
 * for it; every other outcome (completed, skipped, cancelled, started) cancels whatever was
 * pending — completing cancels its own reminder, and skipping must not leave a stale one behind
 * either, per the no-spam rules.
 */
export async function onOutcome(action, event, delayMs) {
  if (event === 'postponed') return schedulePostponeReminder(action, delayMs);
  return cancelPostponeReminder(action.id);
}

export const getPendingReminders = () => {
  const ln = plugin();
  return ln ? safe(() => ln.getPending(), { notifications: [] }) : Promise.resolve({ notifications: [] });
};
