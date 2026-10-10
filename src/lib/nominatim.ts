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

// Nominatim allows one request a second and no search-as-you-type, so callers search on submit only.
export async function searchPlaces(query: string, signal: AbortSignal): Promise<PlaceResult[]> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now()
  if (wait > 0) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, wait)
      signal.addEventListener("abort", () => {
        clearTimeout(timer)
        reject(signal.reason)
      })
    })
  }
  lastRequestAt = Date.now()

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
