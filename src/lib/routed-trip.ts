// Swaps straight gap legs for street paths; display only, the planner's ranking stays as it was.

import type { TripLeg, TripPlan } from "./route-engine"
import { accessOptions } from "./transport-config"
import type { RoutedGaps } from "./use-walk-paths"

export function withRoutedGaps(trip: TripPlan, gaps: RoutedGaps): TripPlan {
  if (gaps.size === 0) return trip

  let deltaMin = 0
  const legs = trip.legs.map((leg, i): TripLeg => {
    const routed = gaps.get(i)
    if (!routed || leg.mode === "jeepney") return leg
    const options = accessOptions(routed.distanceKm)
    const durationMin = leg.mode === "walk" ? options.walkMin : options.tricycleMin
    deltaMin += durationMin - leg.durationMin
    return {
      ...leg,
      path: routed.path,
      distanceKm: routed.distanceKm,
      durationMin,
      walkMin: options.walkMin,
      tricycleMin: options.tricycleMin,
      showTricycleOption: leg.showTricycleOption || options.showTricycleOption,
      recommendedMode: options.recommendedMode,
    }
  })

  const sumKm = (mode: TripLeg["mode"]) => legs.filter((l) => l.mode === mode).reduce((s, l) => s + l.distanceKm, 0)
  return {
    ...trip,
    legs,
    totalDurationMin: trip.totalDurationMin + deltaMin,
    totalWalkKm: sumKm("walk"),
    totalTricycleKm: sumKm("tricycle"),
    maxAccessGapKm: legs.reduce((max, l) => (l.mode === "jeepney" ? max : Math.max(max, l.distanceKm)), 0),
  }
}
