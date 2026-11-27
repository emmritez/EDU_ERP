// EDU_ERP/mobile-pwa/sw.js
// Service Worker for Offline Caching of EDU_ERP Mobile PWA

const EDU_CACHE_NAME = "edu-erp-mobile-v2";
const EDU_CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "../shared/sync-engine.js",
  "../shared/merged-features.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(EDU_CACHE_NAME).then((cache) => {
      return cache.addAll(EDU_CORE_ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== EDU_CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.protocol === "chrome-extension:") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && response.type === "basic") {
            const copy = response.clone();
            caches.open(EDU_CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});
