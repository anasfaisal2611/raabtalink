const CACHE_VERSION = "raabtalink-v17";
const APP_SHELL = [
  "/app/",
  "/app/index.html",
  "/app/offline.html",
  "/app/style.css",
  "/app/app.js",
  "/app/config.js",
  "/app/outbox.js",
  "/app/manifest.json",
  "/app/icons/icon.svg",
  "/app/icons/icon-192.png",
  "/app/icons/icon-512.png",
  "/app/vendor/leaflet/leaflet.css",
  "/app/vendor/leaflet/leaflet.js",
  "/app/vendor/leaflet/MarkerCluster.css",
  "/app/vendor/leaflet/MarkerCluster.Default.css",
  "/app/vendor/leaflet/leaflet.markercluster.js",
  "/app/vendor/leaflet/images/marker-icon.png",
  "/app/vendor/leaflet/images/marker-icon-2x.png",
  "/app/vendor/leaflet/images/marker-shadow.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (request.url.includes("/ws/") || request.url.includes("/sos/") || request.url.includes("/auth/")) return;

  const pathname = new URL(request.url).pathname;
  const isUnderApp = pathname === "/app" || pathname.startsWith("/app/");
  if (!isUnderApp) return;

  const isAppShell =
    pathname.endsWith("/app.js") ||
    pathname.endsWith("/style.css") ||
    pathname.endsWith("/index.html") ||
    pathname === "/app/" ||
    pathname === "/app";

  if (isAppShell) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && request.url.startsWith(self.location.origin)) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((c) => c || caches.match("/app/offline.html"))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok && request.url.startsWith(self.location.origin)) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(request, clone));
          }
          return response;
        })
        .catch(() => cached || caches.match("/app/offline.html"));
      return cached || network;
    })
  );
});
