// Brew Deck service worker: network-first for the page (so updates land on the next open), cache-first for everything else, and the cached page as an offline fallback.
const CACHE = "brew-deck-v1";
const PRECACHE = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Never touch Supabase traffic: it must always be live.
  if (url.hostname.endsWith(".supabase.co")) return;

  if (req.mode === "navigate" || url.pathname.endsWith("/index.html")) {
    event.respondWith(
      fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => { c.put("./index.html", copy); c.put("./", res.clone()); }); return res; })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Same-origin assets, fonts and the Supabase client library: cache-first with a background refresh.
  event.respondWith(
    caches.match(req).then((hit) => {
      const fresh = fetch(req).then((res) => { if (res.ok && (url.origin === location.origin || /fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/.test(url.hostname))) caches.open(CACHE).then((c) => c.put(req, res.clone())); return res; }).catch(() => hit);
      return hit || fresh;
    })
  );
});
