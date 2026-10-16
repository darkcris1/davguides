"use client"

import { useEffect, useState } from "react"
import type { TripPlan } from "./route-engine"
import { fetchWalkPath, type WalkPath } from "./walk-router"

export type RoutedGaps = ReadonlyMap<number, WalkPath>

const EMPTY: RoutedGaps = new Map()

// Fetches street paths for the active trip's walk and tricycle legs, one at a time.
export function useWalkPaths(trip: TripPlan | null): RoutedGaps {
  const [state, setState] = useState<{ trip: TripPlan | null; gaps: RoutedGaps }>({ trip: null, gaps: EMPTY })

  useEffect(() => {
    if (!trip) return
    const controller = new AbortController()

    const run = async () => {
      const gaps = new Map<number, WalkPath>()
      for (const [i, leg] of trip.legs.entries()) {
        if (leg.mode === "jeepney") continue
        const routed = await fetchWalkPath(leg.from, leg.to, controller.signal)
        if (!routed) continue
        gaps.set(i, routed)
        setState({ trip, gaps: new Map(gaps) })
      }
    }
    run().catch(() => {})

    return () => controller.abort()
  }, [trip])

  return state.trip === trip ? state.gaps : EMPTY
}
