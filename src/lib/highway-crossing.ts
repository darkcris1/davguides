// Counts the national roads a gap leg's path crosses, for the tricycle highway surcharge.

import { planarFrame } from "./geo"
import type { TripPlan } from "./route-engine"

/** [road id, [lat, lng] polyline]; ways of one road share an id. */
export type NationalRoad = [number, [number, number][]]

// Stops sit on the highway itself, so a crossing this close to either end is just arriving at it.
const END_MARGIN_KM = 0.04
// A street path riding along a highway weaves across its simplified line at shallow angles; that isn't a crossing.
const MIN_CROSS_SIN = Math.sin((25 * Math.PI) / 180)

// Counts distinct national roads a [lat, lng] path crosses; a straight leg is just its two ends.
export function nationalRoadsCrossed(path: [number, number][], roads: NationalRoad[]): number {
  if (path.length < 2) return 0
  const f = planarFrame(path[0][0])
  const pts = path.map(([lat, lng]) => [lng * f.kx, lat * f.ky])
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  const totalKm = cum[cum.length - 1]
  if (totalKm <= 2 * END_MARGIN_KM) return 0
  // Only street paths weave; a straight leg crossing at a shallow angle still crosses.
  const minSin = path.length > 2 ? MIN_CROSS_SIN : 0

  const crossed = new Set<number>()
  for (const [id, road] of roads) {
    if (crossed.has(id)) continue
    roadLoop: for (let j = 0; j < road.length - 1; j++) {
      const [cx, cy, ex, ey] = [road[j][1] * f.kx, road[j][0] * f.ky, road[j + 1][1] * f.kx, road[j + 1][0] * f.ky]
      const [rx, ry] = [ex - cx, ey - cy]
      const rLen = Math.hypot(rx, ry)
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i]
        const [dx, dy] = [pts[i + 1][0] - ax, pts[i + 1][1] - ay]
        const dLen = cum[i + 1] - cum[i]
        const denom = dx * ry - dy * rx
        if (!dLen || !rLen || Math.abs(denom) <= minSin * dLen * rLen) continue
        const t = ((cx - ax) * ry - (cy - ay) * rx) / denom
        const u = ((cx - ax) * dy - (cy - ay) * dx) / denom
        const atKm = cum[i] + t * dLen
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && atKm > END_MARGIN_KM && atKm < totalKm - END_MARGIN_KM) {
          crossed.add(id)
          break roadLoop
        }
      }
    }
  }
  return crossed.size
}

export function withHighwayCrossings(plan: TripPlan, roads: NationalRoad[]): TripPlan {
  return {
    ...plan,
    legs: plan.legs.map((leg) => (leg.mode === "jeepney" ? leg : { ...leg, highwaysCrossed: nationalRoadsCrossed(leg.path, roads) })),
  }
}
