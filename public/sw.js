// Network-only on purpose: routes, tiles and search all need a connection, so offline gets a plain notice.
const OFFLINE_HTML = `<!doctype html><html lang="en-PH"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline | DavGuides</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#f1f5f9;color:#0f172a;text-align:center;padding:24px}h1{color:#1e3a8a;font-size:22px;margin:0 0 8px}button{min-height:44px;margin-top:16px;padding:0 20px;border:0;border-radius:999px;background:#1e3a8a;color:#fff;font-weight:600;font-size:15px}</style></head><body><main><h1>You're offline</h1><p>DavGuides needs a connection to load jeepney routes and the map.</p><button onclick="location.reload()">Try again</button></main></body></html>`

self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) =>
  event.waitUntil(Promise.all([self.clients.claim(), self.registration.navigationPreload?.enable()])),
)

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return
  // Preload starts the request while the worker boots, so navigations don't wait on it.
  event.respondWith(
    (async () => {
      try {
        return (await event.preloadResponse) || (await fetch(event.request))
      } catch {
        return new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } })
      }
    })(),
  )
})
