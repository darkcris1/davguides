// Flags gap legs whose straight line crosses a national road, for the tricycle highway surcharge.

import { planarFrame } from "./geo"
import type { TripPlan } from "./route-engine"

// Stops sit on the highway itself, so a crossing this close to either end is just arriving at it.
const END_MARGIN_KM = 0.04

export function crossesNationalRoad(from: [number, number], to: [number, number], roads: [number, number][][]): boolean {
  const f = planarFrame(from[0])
  const [ax, ay, bx, by] = [from[1] * f.kx, from[0] * f.ky, to[1] * f.kx, to[0] * f.ky]
  const [dx, dy] = [bx - ax, by - ay]
  const lenKm = Math.hypot(dx, dy)
  if (lenKm <= 2 * END_MARGIN_KM) return false
  const margin = END_MARGIN_KM / lenKm

  for (const road of roads) {
    for (let i = 0; i < road.length - 1; i++) {
      const [cx, cy, ex, ey] = [road[i][1] * f.kx, road[i][0] * f.ky, road[i + 1][1] * f.kx, road[i + 1][0] * f.ky]
      const [rx, ry] = [ex - cx, ey - cy]
      const denom = dx * ry - dy * rx
      if (denom === 0) continue
      const t = ((cx - ax) * ry - (cy - ay) * rx) / denom
      const u = ((cx - ax) * dy - (cy - ay) * dx) / denom
      if (t > margin && t < 1 - margin && u >= 0 && u <= 1) return true
    }
  }
  return false
}

export function withHighwayCrossings(plan: TripPlan, roads: [number, number][][]): TripPlan {
  return {
    ...plan,
    legs: plan.legs.map((leg) => (leg.mode === "jeepney" ? leg : { ...leg, crossesHighway: crossesNationalRoad(leg.from, leg.to, roads) })),
  }
}
