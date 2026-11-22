// Brew Deck service worker: network-first for the page (so updates land on the next open), cache-first for everything else, and the cached page as an offline fallback.
const CACHE = "brew-deck-v59";
const PRECACHE = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png", "./sortable.min.js"];
// The sync library the page loads. Without it the app opens signed out, so it is kept at install as well as on first use.
// Keep this the same address as the <script> tag in index.html; if they drift apart the copy is simply made on first use instead.
const LIBRARY = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.js";
// Other sites whose files are kept for offline use: the library's CDN and Google Fonts.
const KEPT_HOSTS = /^(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)$/;

// The app's own page: the folder this worker sits in, or its index.html. Nothing else is ever kept as the page (a file such as
// the manifest opened in its own tab is a navigation too, and must not replace the offline copy of the app).
const HOME = new URL("./", self.location).pathname;
const isPage = (url) => url.origin === self.location.origin && (url.pathname === HOME || url.pathname === HOME + "index.html");

// A <script> or stylesheet from another site is requested in a mode that hides whether it loaded, and such a response cannot be
// checked or safely kept. Asking again in CORS mode gives a response that can; if the site refuses that, fall back to the plain request.
const readable = (req) => fetch(req.url, { mode: "cors", credentials: "omit" }).catch(() => fetch(req));
const keep = (cache, url) => readable(new Request(url)).then((res) => (res.ok ? cache.put(url, res) : undefined)).catch(() => {});

self.addEventListener("install", (event) => {
  // The library is fetched after the app's own files and never fails the install: an update must not depend on the CDN being reachable.
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE).then(() => keep(c, LIBRARY))).then(() => self.skipWaiting()));
});

// Only this app's own older copies are cleared: Recipe Deck lives on the same site and keeps its files and photos beside these.
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => /^brew-deck-v\d+$/.test(k) && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Never touch Supabase traffic: it must always be live.
  if (url.hostname.endsWith(".supabase.co")) return;

  if (req.mode === "navigate" || url.pathname.endsWith("/index.html")) {
    event.respondWith(
      fetch(req).then((res) => {
        // Copies are taken before the response is handed to the page; once the page starts reading it, it can no longer be copied.
        if (res.ok && isPage(url)) { const page = res.clone(), root = res.clone(); caches.open(CACHE).then((c) => { c.put("./index.html", page); c.put("./", root); }); }
        return res;
      }).catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Same-origin assets, fonts and the Supabase client library: cache-first with a background refresh.
  const sameOrigin = url.origin === location.origin, kept = KEPT_HOSTS.test(url.hostname);
  event.respondWith(
    caches.match(req).then((hit) => {
      const fresh = (kept ? readable(req) : fetch(req)).then((res) => {
        if (res.ok && (sameOrigin || kept)) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => hit);
      return hit || fresh;
    })
  );
});
