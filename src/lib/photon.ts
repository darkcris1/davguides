// Komoot's public Photon geocoder: keyless and built for search-as-you-type, so Nominatim's 1/s budget stays free.

import type { PlaceResult } from "./nominatim"
import { reversePlace as nominatimReverse } from "./nominatim"

interface PhotonFeature {
  geometry: { coordinates: [number, number] }
  properties: {
    osm_type?: string
    osm_id?: number
    name?: string
    housenumber?: string
    street?: string
    locality?: string
    district?: string
    city?: string
    state?: string
    country?: string
  }
}

// west,south,east,north, matching the Nominatim viewbox.
const DAVAO_BBOX = "125.2,6.9,125.75,7.6"
const DAVAO_CENTER = { lat: "7.07", lon: "125.61" }

const cache = new Map<string, PlaceResult[]>()

// Builds a Nominatim-style "name, street, area, city" label so both sources read alike.
function label(p: PhotonFeature["properties"]): string {
  const street = p.street ? [p.housenumber, p.street].filter(Boolean).join(" ") : undefined
  const parts = [p.name, street, p.locality, p.district, p.city, p.state, p.country].filter((s): s is string => !!s)
  return parts.filter((s, i) => parts.indexOf(s) === i).join(", ")
}

function toPlace(feature: PhotonFeature): PlaceResult {
  const [lng, lat] = feature.geometry.coordinates
  const name = label(feature.properties)
  const [first, ...rest] = name.split(",")
  return {
    id: `photon-${feature.properties.osm_type ?? ""}${feature.properties.osm_id ?? `${lat},${lng}`}`,
    lat,
    lng,
    name,
    detail: rest.join(",").trim() || first.trim(),
  }
}

// Places in Davao City matching a partial query, nearest the city centre first.
export async function suggestPlaces(query: string, signal: AbortSignal): Promise<PlaceResult[]> {
  const key = query.trim().toLowerCase()
  const cached = cache.get(key)
  if (cached) return cached

  const params = new URLSearchParams({ q: query, limit: "8", lang: "en", bbox: DAVAO_BBOX, ...DAVAO_CENTER })
  const response = await fetch(`https://photon.komoot.io/api/?${params}`, { signal })
  if (!response.ok) throw new Error(`Place search failed (HTTP ${response.status})`)

  const body = (await response.json()) as { features?: PhotonFeature[] }
  const places = (body.features ?? []).filter((f) => f.properties.city === "Davao City" && f.properties.name).map(toPlace)
  cache.set(key, places)
  return places
}

// Names a dropped pin via Photon, falling back to Nominatim when Photon fails.
export async function reversePlace(lat: number, lng: number, signal: AbortSignal): Promise<string | null> {
  try {
    const params = new URLSearchParams({ lat: String(lat), lon: String(lng), lang: "en", limit: "1" })
    const response = await fetch(`https://photon.komoot.io/reverse?${params}`, { signal })
    if (response.ok) {
      const body = (await response.json()) as { features?: PhotonFeature[] }
      const feature = body.features?.[0]
      if (feature?.properties.name) return label(feature.properties)
    }
  } catch (error) {
    if (signal.aborted) throw error
  }
  return nominatimReverse(lat, lng, signal)
}
