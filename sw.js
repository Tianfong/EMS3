"use strict";
/* ============================================================
   FDB NPI Command Center — service worker (PWA offline support)

   Caches the full app shell on install; every same-origin GET is
   served cache-first with a background revalidate (stale-while-
   revalidate), so the dashboard opens instantly and keeps working
   on the shop floor without a network. Bump VERSION to invalidate.
   ============================================================ */
const VERSION = "fdb-npi-v2";
const SHELL = [
  "./", "./index.html", "./styles.css", "./data.js", "./charts.js", "./app.js",
  "./app.html", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png",
  "./og-image.svg", "./404.html",
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;   // never touch cross-origin (fonts, MES API)

  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => {
      const net = fetch(e.request).then(res => {
        if (res && res.ok) caches.open(VERSION).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => hit || (e.request.mode === "navigate" ? caches.match("./index.html") : undefined));
      return hit || net;
    })
  );
});
