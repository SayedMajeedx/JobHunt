// Service worker: makes JobHunt installable and lets it open without a connection.
// App files come from the network when online and from the cache when offline; /api and Supabase calls
// always go to the network (the app keeps its own offline copy of your data).
const VERSION = "jobhunt-v3";
const SHELL = [
  "/", "/index.html", "/style.css", "/app.js", "/backend.js", "/analyzer.js", "/manifest.webmanifest",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/favicon-48.png",
];
const CDN = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    if (url.pathname.startsWith("/api/")) return; // live data only
    // app files: always the latest version when online, the saved copy when offline
    e.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const key = req.mode === "navigate" ? "/index.html" : req;
        try {
          const res = await fetch(req, { cache: "no-cache" });
          if (res.ok) cache.put(key, res.clone());
          return res;
        } catch {
          return (await cache.match(key)) || Response.error();
        }
      }),
    );
    return;
  }

  if (CDN.includes(url.hostname)) {
    // libraries and fonts are versioned: cache first
    e.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res.ok || res.type === "opaque") cache.put(req, res.clone());
        return res;
      }),
    );
  }
});
