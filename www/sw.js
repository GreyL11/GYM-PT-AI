// Offline at the gym. App shell is precached; the MediaPipe wasm and the ~10 MB model are
// cached on first successful online run, so run the app once on wifi before you rely on it.

const CACHE = 'gym-trainer-v1';
// Every module app.js imports. Missing one only bites on a cold offline start — the fetch handler
// below caches whatever it successfully fetches — but "only bites at the gym with no signal" is
// exactly the case this file exists for.
const SHELL = [
  './', 'index.html', 'manifest.json', 'icon.svg',
  'app.js', 'pose.js', 'coach.js', 'exercises.js', 'store.js',
  'insights.js', 'planner.js', 'nutrition.js', 'technique.js', 'filter.js',
  'boxing.js', 'devcheck.js',
  'mood.js', 'mood_insights.js', 'checks.js', 'chat.js', 't_inputs.js', 'skin.js',
  'face/geometry.js', 'face/quality.js', 'face/model.js', 'face/checkin.js', 'digest.js',
  'evidence.js', 'claims.js', 'validate.js', 'explain.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const put = (req, res) => {
  const copy = res.clone();
  caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
  return res;
};

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isVendor = url.pathname.includes('/vendor/');

  // App files: network first, so an edit shows up on reload instead of being masked by the cache.
  // Cache is the offline fallback only.
  if (sameOrigin && !isVendor) {
    e.respondWith(
      fetch(e.request).then((res) => put(e.request, res)).catch(() => caches.match(e.request)),
    );
    return;
  }

  // The MediaPipe wasm and the model never change and must not be refetched at the gym.
  e.respondWith(
    caches.match(e.request).then((hit) => hit ?? fetch(e.request).then((res) => put(e.request, res))),
  );
});
