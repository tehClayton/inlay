/* Bump VERSION on every change you push. Nothing else busts the cache —
   not a hard refresh, not clearing Safari's history. This constant is the
   single lever, and forgetting it is the #1 way to convince yourself
   GitHub Pages didn't deploy. */
const VERSION = "v7";

/* "inlay-", never a bare version: millitap is served from the same origin and
   keeps its own "millitap-" caches. Each app deletes only its own old ones. */
const CACHE = `inlay-${VERSION}`;
const ASSETS = [
  "./",
  "./index.html",
  "./ui.js",
  "./theory.js",
  "./instrument.js",
  "./store.js",
  "./editor.js",
  "./fretboard.js",
  "./manifest.webmanifest",
  "./apple-touch-icon.png",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith("inlay-") && k !== CACHE)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* Cache-first. The app must launch instantly with no network — that's the
   whole point of installing it. Freshness is handled by VERSION, not by
   racing the network on every load. */
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  e.respondWith(
    caches.match(req).then(hit => {
      if (hit) return hit;
      return fetch(req)
        .then(res => {
          if (res && res.ok && new URL(req.url).origin === location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => {
          // Offline and uncached: hand back the shell so a cold launch works.
          if (req.mode === "navigate") return caches.match("./index.html");
          throw new Error("offline");
        });
    })
  );
});
