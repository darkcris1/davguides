// Offline: the page, its chunks (route data included), visited map tiles and looked-up walk paths are cached.
const SHELL_CACHE = "dg-shell-v1"
const TILE_CACHE = "dg-tiles-v1"
const WALK_CACHE = "dg-walk-v1"
const MAX_SHELL = 150
// Vector tiles run ~20-60 KB, so this stays near 50 MB and clear of storage eviction.
const MAX_TILES = 1500
const MAX_WALKS = 300
const TILE_HOST = "tiles.openfreemap.org"
const WALK_HOST = "routing.openstreetmap.de"
const CACHES = [SHELL_CACHE, TILE_CACHE, WALK_CACHE]

const OFFLINE_HTML = `<!doctype html><html lang="en-PH"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline | DavGuides</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#f1f5f9;color:#0f172a;text-align:center;padding:24px}h1{color:#1e3a8a;font-size:22px;margin:0 0 8px}button{min-height:44px;margin-top:16px;padding:0 20px;border:0;border-radius:999px;background:#1e3a8a;color:#fff;font-weight:600;font-size:15px}</style></head><body><main><h1>You're offline</h1><p>Open DavGuides once with a connection so it can work offline.</p><button onclick="location.reload()">Try again</button></main></body></html>`

self.addEventListener("install", () => self.skipWaiting())

self.addEventListener("activate", (event) =>
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      self.registration.navigationPreload?.enable(),
      caches.keys().then((keys) => Promise.all(keys.filter((key) => !CACHES.includes(key)).map((key) => caches.delete(key)))),
    ]),
  ),
)

// Drops the oldest entries; Cache API keys come back in insertion order.
async function trim(name, max) {
  const cache = await caches.open(name)
  const keys = await cache.keys()
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((key) => cache.delete(key)))
}

// Counted per cache; the first put after each worker start trims too, since restarts reset the count.
const puts = {}
async function store(name, key, response, max) {
  if (!response.ok) return
  const cache = await caches.open(name)
  await cache.put(key, response)
  puts[name] = (puts[name] ?? 0) + 1
  if (puts[name] % 50 === 1) await trim(name, max)
}

async function cacheFirst(event, name, max) {
  const cached = await caches.match(event.request)
  if (cached) return cached
  const response = await fetch(event.request)
  event.waitUntil(store(name, event.request, response.clone(), max))
  return response
}

async function networkFirst(event, name, max, key = event.request) {
  try {
    const response = (await event.preloadResponse) || (await fetch(event.request))
    event.waitUntil(store(name, key, response.clone(), max))
    return response
  } catch (error) {
    const cached = await caches.match(key)
    if (cached) return cached
    throw error
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return
  const url = new URL(request.url)

  if (request.mode === "navigate") {
    // One copy of the page serves every shared-trip query string; other paths keep their own entry.
    event.respondWith(
      networkFirst(event, SHELL_CACHE, MAX_SHELL, url.pathname === "/" ? "/" : request).catch(
        () => new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
      ),
    )
    return
  }

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/_next/static/")) event.respondWith(cacheFirst(event, SHELL_CACHE, MAX_SHELL))
    else if (!url.pathname.startsWith("/_vercel/") && !url.searchParams.has("_rsc")) event.respondWith(networkFirst(event, SHELL_CACHE, MAX_SHELL))
    return
  }

  if (url.hostname === TILE_HOST) {
    // Tiles, glyphs and sprites sit under versioned paths; the style and tile index can change.
    if (/\.(pbf|png|webp|mvt)$/.test(url.pathname)) event.respondWith(cacheFirst(event, TILE_CACHE, MAX_TILES))
    else event.respondWith(networkFirst(event, TILE_CACHE, MAX_TILES))
    return
  }

  // Walk paths for trips already looked at stay street-shaped offline; new ones fall back to straight lines.
  if (url.hostname === WALK_HOST) event.respondWith(networkFirst(event, WALK_CACHE, MAX_WALKS))
})

// Files the page loaded before this worker took control never passed through it.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "cache-urls") return
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.all(
        event.data.urls.map(async (url) => {
          if (await cache.match(url)) return
          await cache.add(url).catch(() => {})
        }),
      ),
    ),
  )
})
