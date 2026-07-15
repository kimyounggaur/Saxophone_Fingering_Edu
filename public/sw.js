const CACHE_VERSION = "saxhands-v2-20260715";
const APP_ROOT = new URL("./", self.registration.scope);
const appUrl = (path = "") => new URL(path, APP_ROOT).toString();
const SHELL = [appUrl(), appUrl("manifest.webmanifest"), appUrl("offline.html"), appUrl("icon-192.png")];

async function precacheAppShell() {
  const cache = await caches.open(CACHE_VERSION);
  await cache.addAll(SHELL);

  const pageResponse = await fetch(appUrl(), { cache: "reload" });
  if (!pageResponse.ok) return;
  await cache.put(appUrl(), pageResponse.clone());
  const html = await pageResponse.text();
  const discovered = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => new URL(match[1], APP_ROOT))
    .filter((url) => url.origin === APP_ROOT.origin)
    .map((url) => url.toString());
  await Promise.all(
    [...new Set(discovered)].map(async (url) => {
      try {
        const response = await fetch(url, { cache: "reload" });
        if (response.ok) await cache.put(url, response);
      } catch {
        // An optional metadata asset must not fail the core shell install.
      }
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheAppShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(async () => (await caches.match(event.request)) || (await caches.match(appUrl())) || (await caches.match(appUrl("offline.html")))),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
    }),
  );
});
