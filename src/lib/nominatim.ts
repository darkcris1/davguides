import type { Location } from "@/commons/models/maps"

export interface PlaceResult extends Location {
  id: number
  /** Everything after the first comma of the display name. */
  detail: string
}

interface NominatimRow {
  place_id: number
  lat: string
  lon: string
  display_name: string
}

// Rough Davao City bounding box: west,north,east,south.
const DAVAO_VIEWBOX = "125.2,7.6,125.75,6.9"
const MIN_INTERVAL_MS = 1000

let lastRequestAt = 0

// Every Nominatim call waits its turn, so search and reverse lookups share one request a second.
async function waitTurn(signal: AbortSignal): Promise<void> {
  // Reserve the slot before sleeping, so callers queued in the same second don't fire together.
  const slot = Math.max(Date.now(), lastRequestAt + MIN_INTERVAL_MS)
  lastRequestAt = slot
  const wait = slot - Date.now()
  if (wait > 0) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, wait)
      signal.addEventListener("abort", () => {
        clearTimeout(timer)
        // Hand the slot back when nobody queued behind it, so dead lookups don't delay the next one.
        if (lastRequestAt === slot) lastRequestAt = slot - MIN_INTERVAL_MS
        reject(signal.reason)
      })
    })
  }
}

// Nominatim allows one request a second and no search-as-you-type, so callers search on submit only.
export async function searchPlaces(query: string, signal: AbortSignal): Promise<PlaceResult[]> {
  await waitTurn(signal)

  const params = new URLSearchParams({
    format: "jsonv2",
    q: query,
    countrycodes: "ph",
    viewbox: DAVAO_VIEWBOX,
    bounded: "1",
    limit: "8",
    "accept-language": "en",
  })
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { signal })
  if (!response.ok) throw new Error(`Place search failed (HTTP ${response.status})`)

  const rows = (await response.json()) as NominatimRow[]
  return rows
    .filter((row) => row.display_name.toLowerCase().includes("davao city"))
    .map((row) => {
      const [first, ...rest] = row.display_name.split(",")
      return {
        id: row.place_id,
        lat: Number.parseFloat(row.lat),
        lng: Number.parseFloat(row.lon),
        name: row.display_name,
        detail: rest.join(",").trim() || first.trim(),
      }
    })
}

interface NominatimReverse {
  name?: string
  display_name?: string
  error?: string
}

// Names a dropped pin; called once per drop or drag end, never while dragging.
export async function reversePlace(lat: number, lng: number, signal: AbortSignal): Promise<string | null> {
  await waitTurn(signal)
  const params = new URLSearchParams({ format: "jsonv2", lat: String(lat), lon: String(lng), zoom: "18", "accept-language": "en" })
  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, { signal })
  if (!response.ok) return null
  const row = (await response.json()) as NominatimReverse
  if (row.error || !row.display_name) return null
  return row.name ? `${row.name}, ${row.display_name.split(",").slice(1).join(",").trim()}` : row.display_name
}
