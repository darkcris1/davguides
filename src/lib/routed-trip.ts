// Swaps straight gap legs for street paths; display only, the planner's ranking stays as it was.

import { haversineKm, planarFrame, projectPointOnSegment } from "./geo"
import type { TripLeg, TripPlan } from "./route-engine"
import { rideAlongRoute, sliceArcPath, type RouteIndex, type RouteIndexEntry } from "./route-index"
import { THRESHOLDS, accessOptions, jeepneyMinutes } from "./transport-config"
import type { RoutedGaps } from "./use-walk-paths"

// A street path this close to the jeep's line is standing on its road.
const ROUTE_TOUCH_KM = 0.03

interface Touch {
  index: number
  arcKm: number
  point: [number, number]
}

// Walks path[from..to] in that order and returns the first vertex on the route, near the leg's arc.
function touchRoute(entry: RouteIndexEntry, path: [number, number][], from: number, to: number, aroundArcKm: number, windowKm: number): Touch | null {
  const frame = planarFrame(path[0][0])
  const lo = aroundArcKm - windowKm
  const hi = aroundArcKm + windowKm
  const step = from <= to ? 1 : -1
  for (let k = from; k !== to + step; k += step) {
    const [lat, lng] = path[k]
    let best: { distKm: number; arcKm: number; point: [number, number] } | null = null
    for (let i = 0; i < entry.coords.length - 1; i++) {
      // The arc window keeps the return leg on the same street from matching.
      if (entry.cum[i] > hi) break
      if (entry.cum[i + 1] < lo) continue
      const a = entry.coords[i]
      const b = entry.coords[i + 1]
      const p = projectPointOnSegment(frame, lat, lng, a[1], a[0], b[1], b[0])
      if (p.distKm > ROUTE_TOUCH_KM || (best && p.distKm >= best.distKm)) continue
      best = { distKm: p.distKm, arcKm: entry.cum[i] + p.t * (entry.cum[i + 1] - entry.cum[i]), point: [p.lat, p.lng] }
    }
    if (best) return { index: k, arcKm: best.arcKm, point: best.point }
  }
  return null
}

function pathKm(path: [number, number][]): number {
  let km = 0
  for (let i = 1; i < path.length; i++) km += haversineKm(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1])
  return km
}

// Re-cuts a jeepney leg to new board and alight arcs, or returns null if that ride would change character.
function moveRide(entry: RouteIndexEntry, leg: TripLeg, boardArcKm: number, alightArcKm: number, point: { from?: [number, number]; to?: [number, number] }): TripLeg | null {
  const ride = rideAlongRoute(entry, boardArcKm, alightArcKm)
  if (ride.distanceKm < THRESHOLDS.MIN_RIDE_KM) return null
  if (ride.terminalsCrossed !== (leg.terminalsCrossed ?? 0) || ride.reversed !== (leg.reversed ?? false)) return null
  return {
    ...leg,
    from: point.from ?? leg.from,
    to: point.to ?? leg.to,
    boardArcKm,
    alightArcKm,
    path: sliceArcPath(entry, boardArcKm, alightArcKm),
    distanceKm: ride.distanceKm,
    durationMin: jeepneyMinutes(ride.distanceKm),
  }
}

export function withRoutedGaps(trip: TripPlan, gaps: RoutedGaps, index: RouteIndex | null): TripPlan {
  if (gaps.size === 0) return trip

  const legs = trip.legs.slice()
  for (const [i, routed] of gaps) {
    const leg = legs[i]
    if (!leg || leg.mode === "jeepney") continue
    let path = routed.path
    let trimmed = false

    // A street walk that reaches the jeep's road early boards or alights where it meets it.
    const prev = legs[i - 1]
    const prevEntry = prev?.mode === "jeepney" && prev.routeIndex != null ? index?.entries[prev.routeIndex] : undefined
    if (prev && prevEntry && prev.boardArcKm != null && prev.alightArcKm != null) {
      const touch = touchRoute(prevEntry, path, path.length - 1, 0, prev.alightArcKm, routed.distanceKm)
      const moved = touch && touch.index > 0 ? moveRide(prevEntry, prev, prev.boardArcKm, touch.arcKm, { to: touch.point }) : null
      if (touch && moved) {
        legs[i - 1] = moved
        // Keep the far end, so a touch on the last vertex still leaves a two-point path.
        path = [touch.point, ...path.slice(Math.min(touch.index + 1, path.length - 1))]
        trimmed = true
      }
    }

    const next = legs[i + 1]
    const nextEntry = next?.mode === "jeepney" && next.routeIndex != null ? index?.entries[next.routeIndex] : undefined
    if (next && nextEntry && next.boardArcKm != null && next.alightArcKm != null) {
      const start = trimmed ? 1 : 0
      const touch = touchRoute(nextEntry, path, start, path.length - 1, next.boardArcKm, routed.distanceKm)
      const moved = touch && touch.index < path.length - 1 ? moveRide(nextEntry, next, touch.arcKm, next.alightArcKm, { from: touch.point }) : null
      if (touch && moved) {
        legs[i + 1] = moved
        path = [...path.slice(0, Math.max(touch.index, 1)), touch.point]
        trimmed = true
      }
    }

    const distanceKm = trimmed ? pathKm(path) : routed.distanceKm
    const options = accessOptions(distanceKm)
    legs[i] = {
      ...leg,
      from: path[0],
      to: path[path.length - 1],
      path,
      distanceKm,
      durationMin: leg.mode === "walk" ? options.walkMin : options.tricycleMin,
      walkMin: options.walkMin,
      tricycleMin: options.tricycleMin,
      showTricycleOption: leg.showTricycleOption || options.showTricycleOption,
      recommendedMode: options.recommendedMode,
    }
  }

  const deltaMin = legs.reduce((sum, l, i) => sum + l.durationMin - trip.legs[i].durationMin, 0)
  const sumKm = (mode: TripLeg["mode"]) => legs.filter((l) => l.mode === mode).reduce((s, l) => s + l.distanceKm, 0)
  return {
    ...trip,
    legs,
    totalDurationMin: trip.totalDurationMin + deltaMin,
    totalWalkKm: sumKm("walk"),
    totalTricycleKm: sumKm("tricycle"),
    totalRideKm: sumKm("jeepney"),
    maxAccessGapKm: legs.reduce((max, l) => (l.mode === "jeepney" ? max : Math.max(max, l.distanceKm)), 0),
  }
}
