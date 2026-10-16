// Trip endpoints live in the query string so a planned trip can be shared or reloaded.

import type { Location } from "@/commons/models/maps"

export interface TripUrlState {
  from: Location | null
  to: Location | null
  /** Id of the trip card the rider picked, so a shared link opens the same option. */
  tripId?: string | null
}

export const DROPPED_PIN = "Dropped pin"
export const PINNED_START = "Pinned start"

const DAVAO_BOUNDS = { minLat: 6.9, maxLat: 7.6, minLng: 125.2, maxLng: 125.75 }

function parsePoint(value: string | null, name: string | null, fallback: string): Location | null {
  if (!value) return null
  const [lat, lng] = value.split(",").map(Number)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const b = DAVAO_BOUNDS
  if (lat < b.minLat || lat > b.maxLat || lng < b.minLng || lng > b.maxLng) return null
  return { lat, lng, name: name?.slice(0, 200) || fallback }
}

export function parseTripUrl(search: string): TripUrlState {
  const params = new URLSearchParams(search)
  return {
    from: parsePoint(params.get("from"), params.get("from_name"), PINNED_START),
    to: parsePoint(params.get("to"), params.get("to_name"), DROPPED_PIN),
    tripId: params.get("trip")?.slice(0, 300) || null,
  }
}

const formatPoint = (p: Location) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`

export function buildTripUrl(base: string, { from, to, tripId }: TripUrlState): string {
  const url = new URL(base)
  for (const key of ["from", "from_name", "to", "to_name", "trip"]) url.searchParams.delete(key)
  if (to) {
    url.searchParams.set("to", formatPoint(to))
    url.searchParams.set("to_name", to.name)
  }
  if (from) {
    url.searchParams.set("from", formatPoint(from))
    url.searchParams.set("from_name", from.name)
  }
  if (to && tripId) url.searchParams.set("trip", tripId)
  return url.toString()
}
