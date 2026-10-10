"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import Image from "next/image"
import SearchBox from "@/components/search-box"
import TripPanel from "@/components/trip-panel"
import type { MapInsets } from "@/components/map-component"
import { planTrips } from "@/lib/route-engine"
import { useFareConfig } from "@/lib/use-fare-config"
import { useRouteData } from "@/lib/use-route-data"
import { useUserLocation } from "@/lib/use-user-location"
import type { Location } from "@/commons/models/maps"
import { cn, shortPlaceName } from "@/lib/utils"

// Leaflet touches window on import, so the map only loads in the browser.
const MapComponent = dynamic(() => import("@/components/map-component"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-slate-200" aria-hidden />,
})

const MOBILE_QUERY = "(max-width: 767px)"
const SWIPE_PX = 30

// Tracks how much of the map the floating header and sheet cover on phones.
function useMobileInsets(header: React.RefObject<HTMLElement | null>, sheet: React.RefObject<HTMLElement | null>) {
  const [insets, setInsets] = useState<MapInsets>({ top: 0, bottom: 0 })

  // Reads layout now, so a fit in the same commit as a sheet resize sees the new height.
  const readInsets = useCallback((): MapInsets => {
    if (!window.matchMedia(MOBILE_QUERY).matches) return { top: 0, bottom: 0 }
    return { top: header.current?.offsetHeight ?? 0, bottom: sheet.current?.offsetHeight ?? 0 }
  }, [header, sheet])

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY)
    const measure = () => setInsets(readInsets())
    const observer = new ResizeObserver(measure)
    if (header.current) observer.observe(header.current)
    if (sheet.current) observer.observe(sheet.current)
    media.addEventListener("change", measure)
    measure()
    return () => {
      observer.disconnect()
      media.removeEventListener("change", measure)
    }
  }, [header, sheet, readInsets])

  return { insets, readInsets }
}

export default function AppShell() {
  const [destination, setDestination] = useState<Location | null>(null)
  const [recenterKey, setRecenterKey] = useState(0)
  const [collapsed, setCollapsed] = useState(true)
  const location = useUserLocation()
  const routeData = useRouteData()
  const { fare, setFare, reset: resetFare, isDefault: fareIsDefault } = useFareConfig()

  const headerRef = useRef<HTMLElement>(null)
  const sheetRef = useRef<HTMLElement>(null)
  const swipeStartRef = useRef<number | null>(null)
  const { insets, readInsets } = useMobileInsets(headerRef, sheetRef)

  const trips = useMemo(() => {
    if (!routeData || !destination || !location.location) return []
    return planTrips(routeData.routes, location.location, destination)
  }, [routeData, destination, location.location])

  // Reset the pick during render when the plans change, so the map never draws a stale index.
  const [activeIndex, setActiveIndex] = useState(0)
  const [plannedTrips, setPlannedTrips] = useState(trips)
  if (plannedTrips !== trips) {
    setPlannedTrips(trips)
    setActiveIndex(0)
  }

  const selectDestination = (next: Location | null) => {
    setDestination(next)
    setCollapsed(true)
  }

  const locate = () => {
    location.request()
    setRecenterKey((k) => k + 1)
  }

  const canExpand = trips.length > 0
  const routesReady = routeData != null

  const plannerStatus = !destination
    ? ""
    : location.status === "error"
      ? "Your location is needed."
      : location.status === "pending"
        ? "Getting your location…"
        : !routesReady
          ? "Loading jeepney routes…"
          : trips.length === 0
            ? "No jeepney goes there."
            : `${trips.length === 1 ? "1 trip" : `${trips.length} trips`} found to ${shortPlaceName(destination.name)}.`

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-slate-100 md:flex">
      <aside className="contents md:relative md:z-20 md:flex md:h-full md:w-[400px] md:shrink-0 md:flex-col md:border-r md:border-slate-200 md:bg-white">
        <header
          ref={headerRef}
          className="pointer-events-none fixed inset-x-0 top-0 z-30 px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] md:pointer-events-auto md:static md:px-5 md:pb-4 md:pt-5"
        >
          <h1 className="sr-only">DavGuides: find which jeepney to ride in Davao City</h1>
          <div className="pointer-events-auto flex items-start gap-2 md:flex-col md:gap-4">
            <div className="flex shrink-0 items-center gap-3">
              <Image src="/logo-mark.svg" alt="" width={48} height={48} priority className="size-12 rounded-[14px] shadow-lg md:size-10 md:shadow-none" />
              <span className="hidden font-signboard text-[32px] font-bold leading-none tracking-wide md:block" aria-hidden>
                <span className="text-[var(--dg-navy)]">DAV</span>
                <span className="text-[var(--dg-ink)]">GUIDES</span>
              </span>
            </div>
            <div className="min-w-0 flex-1 md:w-full">
              <SearchBox onSelect={selectDestination} />
            </div>
          </div>
        </header>

        <section
          ref={sheetRef}
          aria-label="Trip planner"
          className={cn(
            "fixed inset-x-0 bottom-0 z-20 flex flex-col rounded-t-3xl bg-white shadow-[0_-8px_30px_rgba(15,23,42,.18)] md:static md:min-h-0 md:flex-1 md:rounded-none md:shadow-none",
            collapsed ? "max-h-[45dvh]" : "max-h-[78dvh]",
            "md:max-h-none",
          )}
        >
          <div
            className="flex shrink-0 justify-center pt-2 md:hidden"
            onPointerDown={(e) => (swipeStartRef.current = e.clientY)}
            onPointerUp={(e) => {
              const start = swipeStartRef.current
              swipeStartRef.current = null
              if (start == null || !canExpand) return
              if (e.clientY - start < -SWIPE_PX) setCollapsed(false)
              else if (e.clientY - start > SWIPE_PX) setCollapsed(true)
            }}
          >
            {canExpand ? (
              <button
                type="button"
                aria-expanded={!collapsed}
                onClick={() => setCollapsed((c) => !c)}
                className="flex min-h-11 w-full touch-none flex-col items-center gap-1 pb-1 text-xs font-medium text-slate-600"
              >
                <span className="h-1.5 w-10 rounded-full bg-slate-300" aria-hidden />
                {collapsed ? `See ${trips.length === 1 ? "trip details" : `all ${trips.length} options`}` : "Show the map"}
              </button>
            ) : (
              <span className="mb-1 h-1.5 w-10 rounded-full bg-slate-300" aria-hidden />
            )}
          </div>

          <p role="status" className="sr-only">
            {plannerStatus}
          </p>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 md:px-5 md:pt-0">
            <TripPanel
              destination={destination}
              locationStatus={location.status}
              locationError={location.error}
              accuracyM={location.accuracyM}
              onRetryLocation={locate}
              routesReady={routesReady}
              trips={trips}
              activeIndex={activeIndex}
              onSelect={setActiveIndex}
              fare={fare}
              onFareChange={setFare}
              onFareReset={resetFare}
              fareIsDefault={fareIsDefault}
              collapsed={collapsed}
            />
          </div>
        </section>
      </aside>

      <div className="h-full w-full md:min-w-0 md:flex-1">
        <MapComponent
          trip={trips[activeIndex] ?? null}
          routeIndex={routeData?.index ?? null}
          origin={location.location}
          destination={destination}
          insets={insets}
          readInsets={readInsets}
          recenterKey={recenterKey}
          onLocate={locate}
        />
      </div>
    </main>
  )
}
