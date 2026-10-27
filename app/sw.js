/* ═══════════════════════════════════════════════════════════════════════
   BeatClip Service Worker – App-Shell offline cachen (installierbare PWA)
   Audiodaten liegen in IndexedDB und werden bewusst NICHT im Cache dupliziert.
   ═══════════════════════════════════════════════════════════════════════ */
const CACHE = "beatclip-v18";   /* bei jedem Release hochziehen – bringt PWA-Nutzern den neuen Code */
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./style.css",
  "./app.js",
  "./translations.js",
  "./locales/en.json",
  "./locales/de.json",
  "./locales/fr.json",
  "./locales/es.json",
  "./vendor/lamejs.iife.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigation: Network zuerst, Fallback auf gecachten Shell (offline starten)
  if (req.mode === "navigate"){
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put("./index.html", copy));
        return res;
      }).catch(() => caches.match("./index.html"))
    );
    return;
  }
  // App-Code (JS/CSS/Locale-JSON): Netzwerk zuerst, Cache als Offline-Fallback
  if (url.pathname.endsWith(".js") || url.pathname.endsWith(".css") ||
      url.pathname.endsWith(".webmanifest") || url.pathname.endsWith(".json")){
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }
  // Statische Assets (Icons etc.): Cache zuerst, sonst Netzwerk (und nachtragen)
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok && (url.pathname.endsWith(".css") || url.pathname.endsWith(".js") ||
                     url.pathname.endsWith(".json") ||
                     url.pathname.endsWith(".png") || url.pathname.endsWith(".webmanifest"))){
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }))
  );
});
