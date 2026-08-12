// ponytail: localStorage, not IndexedDB. A year of sessions for one lifter is a few hundred KB
// and every read is synchronous. Move to IndexedDB if you ever store video clips.

const KEY = 'gym-trainer/v1';

const blank = { loads: {}, thresholds: {}, log: [] };

export function read() {
  try {
    return { ...blank, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...blank };
  }
}

export function write(patch) {
  const next = { ...read(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function getLoad(exId, fallback) {
  return read().loads[exId] ?? fallback;
}

export function setLoad(exId, kg) {
  const { loads } = read();
  write({ loads: { ...loads, [exId]: kg } });
}

/** Thresholds are per-exercise and per-body. Merged over the exercise defaults on load. */
export function getThresholds(exId, defaults) {
  return { ...defaults, ...(read().thresholds[exId] ?? {}) };
}

export function setThreshold(exId, key, value) {
  const { thresholds } = read();
  write({ thresholds: { ...thresholds, [exId]: { ...(thresholds[exId] ?? {}), [key]: value } } });
}

export function appendLog(entry) {
  const { log } = read();
  write({ log: [...log, entry].slice(-500) });
}

/** Every set logged for an exercise, oldest first. */
export function history(exId) {
  return read().log.filter((e) => e.exId === exId);
}
