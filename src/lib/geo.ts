// Pure geometry helpers; routes.ts is [lng, lat], everything else is [lat, lng].

export const EARTH_RADIUS_KM = 6371

/** Mean km per degree of latitude. */
const KM_PER_DEG_LAT = 110.574
/** Km per degree of longitude at the equator; scale by cos(lat). */
const KM_PER_DEG_LNG_EQUATOR = 111.32

export interface LatLng {
  lat: number
  lng: number
}

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

export function toDeg(rad: number): number {
  return (rad * 180) / Math.PI
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/** Great-circle distance in km. Use for anything the user will see. */
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

/** Length of a [lat, lng] polyline in km. */
export function pathKm(path: [number, number][]): number {
  let km = 0
  for (let i = 1; i < path.length; i++) km += haversineKm(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1])
  return km
}

/** Compass bearing in degrees, 0 = north, clockwise. */
export function bearingDeg(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const p1 = toRad(aLat)
  const p2 = toRad(bLat)
  const dl = toRad(bLng - aLng)
  const y = Math.sin(dl) * Math.cos(p2)
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

// Flat km frame at a reference latitude; under 0.5% error across Davao and no trig per point.
export interface PlanarFrame {
  kx: number
  ky: number
}

export function planarFrame(refLat: number): PlanarFrame {
  return {
    kx: KM_PER_DEG_LNG_EQUATOR * Math.cos(toRad(refLat)),
    ky: KM_PER_DEG_LAT,
  }
}

export interface SegmentProjection {
  /** Position along the segment, 0 at A, 1 at B. */
  t: number
  lat: number
  lng: number
  /** Perpendicular distance from the query point to the segment, in km. */
  distKm: number
}

// Projects onto the segment, not the nearest vertex, so boarding points land on the road.
export function projectPointOnSegment(
  frame: PlanarFrame,
  pLat: number,
  pLng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): SegmentProjection {
  const px = pLng * frame.kx
  const py = pLat * frame.ky
  const ax = aLng * frame.kx
  const ay = aLat * frame.ky
  const bx = bLng * frame.kx
  const by = bLat * frame.ky

  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy

  // routes.ts contains 47 zero-length segments (duplicate consecutive vertices).
  const t = l2 === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1)

  const qx = ax + t * dx
  const qy = ay + t * dy

  return {
    t,
    lat: qy / frame.ky,
    lng: qx / frame.kx,
    distKm: Math.hypot(px - qx, py - qy),
  }
}

export type BBox = [minLng: number, minLat: number, maxLng: number, maxLat: number]

export function bboxOf(coords: number[][]): BBox {
  let minLng = Number.POSITIVE_INFINITY
  let minLat = Number.POSITIVE_INFINITY
  let maxLng = Number.NEGATIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY

  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng
    if (lat < minLat) minLat = lat
    if (lng > maxLng) maxLng = lng
    if (lat > maxLat) maxLat = lat
  }

  return [minLng, minLat, maxLng, maxLat]
}

/** Whether a point falls inside a bbox grown by `padDeg` on every side. */
export function bboxContains(bbox: BBox, lng: number, lat: number, padDeg: number): boolean {
  return (
    lng >= bbox[0] - padDeg && lng <= bbox[2] + padDeg && lat >= bbox[1] - padDeg && lat <= bbox[3] + padDeg
  )
}

/** Degrees of latitude covering `km`. Used to turn a search radius into bbox padding. */
export function kmToDegLat(km: number): number {
  return km / KM_PER_DEG_LAT
}

/** Human-facing distance: "240 m" under a km, "3.6 km" above. */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`
  return `${km.toFixed(km < 10 ? 1 : 0)} km`
}

/** Human-facing duration. Always at least "1 min" so nothing reads as instant. */
export function formatDuration(min: number): string {
  const rounded = Math.max(1, Math.round(min))
  if (rounded < 60) return `${rounded} min`
  const hours = Math.floor(rounded / 60)
  const mins = rounded % 60
  return mins === 0 ? `${hours} hr` : `${hours} hr ${mins} min`
}
