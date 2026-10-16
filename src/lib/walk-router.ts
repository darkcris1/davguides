// Street-following walk paths from the FOSSGIS OSRM foot router: free, keyless, fair use only.

import { haversineKm } from "./geo"

export interface WalkPath {
  /** [lat, lng] */
  path: [number, number][]
  distanceKm: number
}

const ROUTER_URL = "https://routing.openstreetmap.de/routed-foot/route/v1/driving"
const MIN_INTERVAL_MS = 1000
const TIMEOUT_MS = 6000
// Shorter gaps look fine as a straight line and aren't worth a request.
const MIN_GAP_KM = 0.06
// A path this much longer than the crow flies has likely snapped to the wrong road.
const MAX_DETOUR_RATIO = 3

interface OsrmResponse {
  code: string
  routes?: { distance: number; geometry: { coordinates: [number, number][] } }[]
}

const cache = new Map<string, WalkPath | null>()
let lastRequestAt = 0

const keyOf = (from: [number, number], to: [number, number]) => [...from, ...to].map((n) => n.toFixed(5)).join(",")

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener("abort", () => {
      clearTimeout(timer)
      reject(signal.reason)
    })
  })
}

// Returns null when the router fails or the gap is tiny, so callers keep the straight line.
export async function fetchWalkPath(from: [number, number], to: [number, number], signal: AbortSignal): Promise<WalkPath | null> {
  const crowKm = haversineKm(from[0], from[1], to[0], to[1])
  if (crowKm < MIN_GAP_KM) return null

  const key = keyOf(from, to)
  if (cache.has(key)) return cache.get(key) ?? null

  const slot = Math.max(Date.now(), lastRequestAt + MIN_INTERVAL_MS)
  lastRequestAt = slot
  try {
    if (slot > Date.now()) await sleep(slot - Date.now(), signal)
  } catch (error) {
    // Hand the slot back when nobody queued behind it.
    if (lastRequestAt === slot) lastRequestAt = slot - MIN_INTERVAL_MS
    throw error
  }

  // Built by hand because AbortSignal.any is missing on older phones.
  const controller = new AbortController()
  const abort = () => controller.abort()
  const timer = setTimeout(abort, TIMEOUT_MS)
  signal.addEventListener("abort", abort)
  const url = `${ROUTER_URL}/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`

  let result: WalkPath | null = null
  try {
    const response = await fetch(url, { signal: controller.signal })
    // Rate limits and server errors aren't cached, so a later look retries.
    if (!response.ok) return null
    const body = (await response.json()) as OsrmResponse
    const route = body.code === "Ok" ? body.routes?.[0] : undefined
    const distanceKm = (route?.distance ?? 0) / 1000
    if (route && route.geometry.coordinates.length >= 2 && distanceKm <= crowKm * MAX_DETOUR_RATIO) {
      // OSRM snaps the ends to the street, so stitch the real endpoints back on.
      const path: [number, number][] = [from, ...route.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]), to]
      result = { path, distanceKm: Math.max(distanceKm, crowKm) }
    }
  } catch (error) {
    if (signal.aborted) throw error
    // Network blips aren't cached, so the next look at this trip retries.
    return null
  } finally {
    clearTimeout(timer)
    signal.removeEventListener("abort", abort)
  }

  cache.set(key, result)
  return result
}
