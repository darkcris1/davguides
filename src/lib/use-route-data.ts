"use client"

import { useEffect, useState } from "react"
import type { Route } from "@/commons/models/maps"
import { cacheLoadedAssets } from "./offline"
import type { NationalRoad } from "./highway-crossing"
import { getRouteIndex, type RouteIndex } from "./route-index"

export interface RouteData {
  routes: Route[]
  index: RouteIndex
  nationalRoads: NationalRoad[]
}

// The route file is ~800 KB, so it loads after first paint instead of in the page bundle.
export function useRouteData(): RouteData | null {
  const [data, setData] = useState<RouteData | null>(null)

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined

    // Flaky mobile data can drop the chunk, so keep retrying with backoff.
    const load = (attempt: number) => {
      Promise.all([import("./routes"), import("./national-roads")])
        .then(([{ routes }, { nationalRoads }]) => {
          if (!alive) return
          const typed = routes as Route[]
          setData({ routes: typed, index: getRouteIndex(typed), nationalRoads })
          // The route chunk may have loaded before the service worker took over.
          cacheLoadedAssets()
        })
        .catch(() => {
          if (alive) timer = setTimeout(() => load(attempt + 1), Math.min(30_000, 2_000 * 2 ** attempt))
        })
    }
    load(0)

    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [])

  return data
}
