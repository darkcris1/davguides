"use client"

const SHELL_FILES = ["/", "/manifest.webmanifest", "/logo-mark.svg", "/icon.svg"]
// The offline street graph is only for the installed app; browser visitors walk with OSRM.
const APP_FILES = ["/walk-graph.bin"]

export const isInstalledApp = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

// Map tiles fill the default 250-entry timing buffer fast, which would hide later chunks from cacheLoadedAssets.
if (typeof window !== "undefined") performance.setResourceTimingBufferSize?.(2000)

const enabled = () => typeof navigator !== "undefined" && "serviceWorker" in navigator && process.env.NODE_ENV === "production"

export function registerServiceWorker() {
  if (!enabled()) return
  navigator.serviceWorker.register("/sw.js").then(cacheLoadedAssets).catch(() => {})
}

// Sends the worker every chunk this page already fetched, so the next visit opens offline.
export function cacheLoadedAssets() {
  if (!enabled()) return
  const chunks = performance
    .getEntriesByType("resource")
    .map((entry) => new URL(entry.name))
    .filter((url) => url.origin === location.origin && url.pathname.startsWith("/_next/static/"))
    .map((url) => url.pathname)
  navigator.serviceWorker.ready
    .then((registration) => registration.active?.postMessage({ type: "cache-urls", urls: [...SHELL_FILES, ...(isInstalledApp() ? APP_FILES : []), ...chunks] }))
    .catch(() => {})
}
