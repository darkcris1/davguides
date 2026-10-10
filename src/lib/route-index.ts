// Precomputed route geometry, cached per routes array so it survives remounts.

import type { Route } from "@/commons/models/maps"
import { THRESHOLDS } from "./transport-config"
import { bboxOf, haversineKm, planarFrame, type BBox } from "./geo"

export interface RouteIndexEntry {
  routeIndex: number
  name: string
  color: string
  /** Reference into the original routes.ts data, in [lng, lat]. Never copied. */
  coords: number[][]
  /** cum[i] = km travelled from vertex 0 to vertex i. Same length as coords. */
  cum: Float64Array
  totalKm: number
  /** Last vertex closes onto the first; vertex order is then the only record of direction. */
  isLoop: boolean
  /** Far terminus of an out-and-back ring, or null for a true circuit. */
  turnaroundArcKm: number | null
  bbox: BBox
  chunkCount: number
  /** 4 floats per chunk of CHUNK_SIZE segments: minLng, minLat, maxLng, maxLat. */
  chunkBBox: Float64Array
}

export interface TransferPoint {
  /** Arc position on the first route, km. */
  arcAKm: number
  /** Arc position on the second route, km. */
  arcBKm: number
  /** Walking gap between the two, km. */
  walkKm: number
  /** The point on the first route, [lat, lng]. */
  lat: number
  lng: number
}

export interface RouteIndex {
  entries: RouteIndexEntry[]
  /** Lazily filled by findTransferPoints. */
  transferCache: Map<string, TransferPoint[]>
}

function buildEntry(route: Route, routeIndex: number): RouteIndexEntry {
  const coords = route.geometry.coordinates
  const n = coords.length

  const cum = new Float64Array(n)
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + haversineKm(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0])
  }
  const totalKm = n > 0 ? cum[n - 1] : 0

  const seamGapKm =
    n > 1 ? haversineKm(coords[0][1], coords[0][0], coords[n - 1][1], coords[n - 1][0]) : Number.POSITIVE_INFINITY

  const chunkSize = THRESHOLDS.CHUNK_SIZE
  const chunkCount = Math.max(1, Math.ceil(Math.max(1, n - 1) / chunkSize))
  const chunkBBox = new Float64Array(chunkCount * 4)

  for (let c = 0; c < chunkCount; c++) {
    const start = c * chunkSize
    // +1 so a segment straddling the chunk boundary is fully covered by this box.
    const end = Math.min(n - 1, (c + 1) * chunkSize)
    let minLng = Number.POSITIVE_INFINITY
    let minLat = Number.POSITIVE_INFINITY
    let maxLng = Number.NEGATIVE_INFINITY
    let maxLat = Number.NEGATIVE_INFINITY
    for (let i = start; i <= end; i++) {
      const lng = coords[i][0]
      const lat = coords[i][1]
      if (lng < minLng) minLng = lng
      if (lat < minLat) minLat = lat
      if (lng > maxLng) maxLng = lng
      if (lat > maxLat) maxLat = lat
    }
    chunkBBox[c * 4] = minLng
    chunkBBox[c * 4 + 1] = minLat
    chunkBBox[c * 4 + 2] = maxLng
    chunkBBox[c * 4 + 3] = maxLat
  }

  return {
    routeIndex,
    name: route.properties.name,
    color: route.properties.color,
    coords,
    cum,
    totalKm,
    isLoop: seamGapKm <= THRESHOLDS.LOOP_CLOSE_TOLERANCE_KM,
    turnaroundArcKm: null,
    bbox: bboxOf(coords),
    chunkCount,
    chunkBBox,
  }
}

// Loose on purpose: return legs usually run on a parallel street 160-645 m away.
const RETRACE_TOLERANCE_KM = 0.4
/** Stride through the return half; ~240 m of arc, well inside the tolerance. */
const RETRACE_STRIDE = 8

// Far terminus of an out-and-back ring; null when the ring never doubles back.
function detectTurnaroundArcKm(entry: RouteIndexEntry): number | null {
  const { coords, cum } = entry
  const n = coords.length
  if (!entry.isLoop || n < 8) return null

  const frame = planarFrame(coords[0][1])
  const x = (i: number) => coords[i][0] * frame.kx
  const y = (i: number) => coords[i][1] * frame.ky

  const seamX = x(0)
  const seamY = y(0)
  let farthest = 0
  let farthestSq = 0
  for (let i = 1; i < n; i++) {
    const dx = x(i) - seamX
    const dy = y(i) - seamY
    const sq = dx * dx + dy * dy
    if (sq > farthestSq) {
      farthestSq = sq
      farthest = i
    }
  }
  if (farthest < 2 || farthest >= n - 2) return null

  const toleranceSq = RETRACE_TOLERANCE_KM * RETRACE_TOLERANCE_KM
  const samples = 24
  let retraced = 0
  let tested = 0

  for (let s = 1; s <= samples; s++) {
    const i = Math.floor((farthest * s) / (samples + 1))
    if (i <= 0 || i >= farthest) continue
    tested++

    const px = x(i)
    const py = y(i)
    for (let j = farthest + 1; j < n; j += RETRACE_STRIDE) {
      const dx = x(j) - px
      const dy = y(j) - py
      if (dx * dx + dy * dy <= toleranceSq) {
        retraced++
        break
      }
    }
  }

  if (tested === 0 || retraced / tested < 0.5) return null
  return cum[farthest]
}

export function buildRouteIndex(routes: Route[]): RouteIndex {
  const entries = routes.map((route, i) => buildEntry(route, i))
  for (const entry of entries) {
    entry.turnaroundArcKm = detectTurnaroundArcKm(entry)
  }
  return { entries, transferCache: new Map() }
}

const indexCache = new WeakMap<Route[], RouteIndex>()

export function getRouteIndex(routes: Route[]): RouteIndex {
  let index = indexCache.get(routes)
  if (!index) {
    index = buildRouteIndex(routes)
    indexCache.set(routes, index)
  }
  return index
}

export interface Ride {
  distanceKm: number
  /** Terminals crossed en route, each a layover and usually a re-board. */
  terminalsCrossed: number
  /** True when travelling against the stored vertex order of a two-way corridor. */
  reversed: boolean
}

// Rings only ride forward (wrapping costs a terminal); open corridors run both ways.
export function rideAlongRoute(entry: RouteIndexEntry, fromKm: number, toKm: number): Ride {
  if (!entry.isLoop) {
    // Two-way corridor: either direction is real service, no terminal involved.
    return {
      distanceKm: Math.abs(toKm - fromKm),
      terminalsCrossed: 0,
      reversed: toKm < fromKm,
    }
  }

  const turnaround = entry.turnaroundArcKm
  const crosses = (a: number, b: number) => (turnaround != null && turnaround > a && turnaround < b ? 1 : 0)

  if (toKm >= fromKm) {
    return { distanceKm: toKm - fromKm, terminalsCrossed: crosses(fromKm, toKm), reversed: false }
  }

  // Wrapping the seam: ride to the end of the ring, then on from the start.
  return {
    distanceKm: entry.totalKm - fromKm + toKm,
    terminalsCrossed: 1 + crosses(fromKm, entry.totalKm) + crosses(0, toKm),
    reversed: false,
  }
}

/** Index of the segment containing `arcKm`, via binary search on `cum`. */
function segmentIndexAtArc(entry: RouteIndexEntry, arcKm: number): number {
  const { cum } = entry
  const last = cum.length - 1
  if (arcKm <= 0) return 0
  if (arcKm >= entry.totalKm) return Math.max(0, last - 1)

  let lo = 0
  let hi = last
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (cum[mid] <= arcKm) lo = mid
    else hi = mid
  }
  return lo
}

/** Interpolated [lat, lng] at a given arc position. */
export function pointAtArcKm(entry: RouteIndexEntry, arcKm: number): [number, number] {
  const { coords, cum } = entry
  if (coords.length === 0) return [0, 0]
  if (coords.length === 1) return [coords[0][1], coords[0][0]]

  const i = segmentIndexAtArc(entry, arcKm)
  const segLen = cum[i + 1] - cum[i]
  const t = segLen > 0 ? (arcKm - cum[i]) / segLen : 0
  const a = coords[i]
  const b = coords[i + 1]
  return [a[1] + (b[1] - a[1]) * t, a[0] + (b[0] - a[0]) * t]
}

/** A single forward slice, no wrapping. Endpoints are interpolated exactly. */
function sliceForward(entry: RouteIndexEntry, fromKm: number, toKm: number): [number, number][] {
  const { coords, cum } = entry
  if (coords.length < 2 || toKm <= fromKm) {
    return [pointAtArcKm(entry, fromKm), pointAtArcKm(entry, toKm)]
  }

  const path: [number, number][] = [pointAtArcKm(entry, fromKm)]
  const startSeg = segmentIndexAtArc(entry, fromKm)
  const endSeg = segmentIndexAtArc(entry, toKm)

  for (let i = startSeg + 1; i <= endSeg; i++) {
    if (cum[i] > fromKm && cum[i] < toKm) path.push([coords[i][1], coords[i][0]])
  }

  path.push(pointAtArcKm(entry, toKm))
  return path
}

/** The ridden arc only, as [lat, lng] pairs, not the whole ring. */
export function sliceArcPath(entry: RouteIndexEntry, fromKm: number, toKm: number): [number, number][] {
  if (toKm >= fromKm) return sliceForward(entry, fromKm, toKm)

  // Corridor ridden against stored order: reverse so arrows point the travel way.
  if (!entry.isLoop) return sliceForward(entry, toKm, fromKm).reverse()

  // Wraps the seam: ride to the end of the ring, then continue from the start.
  const head = sliceForward(entry, fromKm, entry.totalKm)
  const tail = sliceForward(entry, 0, toKm)
  return head.concat(tail)
}

/** Full route ring as [lat, lng], for drawing faint context behind the ridden arc. */
export function fullPath(entry: RouteIndexEntry): [number, number][] {
  return entry.coords.map((c) => [c[1], c[0]] as [number, number])
}
