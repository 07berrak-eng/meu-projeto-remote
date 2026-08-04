// Service worker mínimo da PWA Atlas (cliente).
// Objetivo: tornar a app instalável e funcionar como app. NUNCA interceta /api nem Socket.io.
const CACHE = "atlas-pwa-v4";
const ATIVOS = [
  "/cliente.html",
  "/estilos.css",
  "/cliente.js",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ATIVOS)).then(() => self.skipWaiting()).catch(() => {})
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Só GET da mesma origem; nunca a API/Socket.io (têm de ir sempre à rede).
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api")) return;

  // Navegação: network-first (mantém atualizado), com fallback offline para a página do cliente.
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/cliente.html")));
    return;
  }

  // Estáticos: network-first (garante que atualizações após deploy aparecem),
  // com fallback à cache quando offline.
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req))
  );
});
