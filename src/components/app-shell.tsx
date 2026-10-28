"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import dynamic from "next/dynamic"
import Image from "next/image"
import OriginBar from "@/components/origin-bar"
import PreciseLocationPrompt from "@/components/precise-location-prompt"
import RidePanel from "@/components/ride-panel"
import SearchBox from "@/components/search-box"
import TripPanel from "@/components/trip-panel"
import type { MapInsets } from "@/components/map-component"
import { planTrips, type TripPlan } from "@/lib/route-engine"
import { isPeakHour } from "@/lib/loading-hubs"
import { reversePlace } from "@/lib/photon"
import { withRoutedGaps } from "@/lib/routed-trip"
import { DROPPED_PIN, PINNED_START, buildTripUrl, parseTripUrl } from "@/lib/trip-url"
import { useBottomSheet, type SheetSnap } from "@/lib/use-bottom-sheet"
import { THRESHOLDS, planFarePhp } from "@/lib/transport-config"
import { registerServiceWorker } from "@/lib/offline"
import { useFareConfig } from "@/lib/use-fare-config"
// Loaded early so the install prompt event isn't missed before the map chunk arrives.
import "@/lib/use-install-prompt"
import { useRecentPlaces } from "@/lib/use-recent-places"
import { useRide } from "@/lib/use-ride"
import { useRouteData } from "@/lib/use-route-data"
import { useUserLocation } from "@/lib/use-user-location"
import { useWalkPaths } from "@/lib/use-walk-paths"
import type { Location } from "@/commons/models/maps"
import { shortPlaceName } from "@/lib/utils"

// Leaflet touches window on import, so the map only loads in the browser.
const MapComponent = dynamic(() => import("@/components/map-component"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-slate-200" aria-hidden />,
})

const MOBILE_QUERY = "(max-width: 767px)"

// A minute tick is enough to catch rush hour starting or ending.
const subscribeMinute = (onChange: () => void) => {
  const timer = setInterval(onChange, 60_000)
  return () => clearInterval(timer)
}
const readPeak = () => isPeakHour(new Date(), THRESHOLDS.PEAK_HOURS_MANILA)

type ElementRef = React.RefObject<HTMLElement | null>

const subscribeMobile = (onChange: () => void) => {
  const media = window.matchMedia(MOBILE_QUERY)
  media.addEventListener("change", onChange)
  return () => media.removeEventListener("change", onChange)
}
const readMobile = () => window.matchMedia(MOBILE_QUERY).matches
const noSubscribe = () => () => {}
const readSearch = () => window.location.search
const SHARE_STATUS_MS = 3000
// Rough fixes come from Wi-Fi or "approximate" mode, too coarse to say when to get off.
const PRECISE_ACCURACY_M = 100

// Tracks how much of the map the floating header covers on phones.
function useHeaderInset(header: ElementRef, mobile: boolean) {
  const [top, setTop] = useState(0)

  useEffect(() => {
    if (!mobile) return
    const measure = () => setTop(header.current?.offsetHeight ?? 0)
    const observer = new ResizeObserver(measure)
    if (header.current) observer.observe(header.current)
    return () => observer.disconnect()
  }, [header, mobile])

  return mobile ? top : 0
}

type Point = { lat: number; lng: number }

export default function AppShell() {
  const [destination, setDestination] = useState<Location | null>(null)
  const [originOverride, setOriginOverride] = useState<Location | null>(null)
  const [recenterKey, setRecenterKey] = useState(0)
  const [fitKey, setFitKey] = useState(0)
  const [dropPinKey, setDropPinKey] = useState(0)
  const [snap, setSnap] = useState<SheetSnap>("peek")
  const [shareStatus, setShareStatus] = useState("")
  const location = useUserLocation()
  const routeData = useRouteData()
  const { fare, setFare, reset: resetFare, isDefault: fareIsDefault } = useFareConfig()
  const { recent, remember } = useRecentPlaces()
  const mobile = useSyncExternalStore(subscribeMobile, readMobile, () => false)

  const headerRef = useRef<HTMLElement>(null)
  const sheetRef = useRef<HTMLElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const previousDestinationRef = useRef<Location | null>(null)
  const lookupRef = useRef<{ origin?: AbortController; destination?: AbortController }>({})
  const shareTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const peak = useSyncExternalStore(subscribeMinute, readPeak, () => false)

  useEffect(registerServiceWorker, [])

  // A shared link fills in the trip once, during render, so there is no flash of the empty state.
  const search = useSyncExternalStore(noSubscribe, readSearch, () => null)
  const [urlApplied, setUrlApplied] = useState(false)
  const [pendingTripId, setPendingTripId] = useState<string | null>(null)
  // Runs on the first client render only, so links the app writes itself are never re-applied.
  if (!urlApplied && search !== null) {
    setUrlApplied(true)
    const fromUrl = parseTripUrl(search)
    if (fromUrl.to && fromUrl.tripId) setPendingTripId(fromUrl.tripId)
    if (fromUrl.to) setDestination(fromUrl.to)
    if (fromUrl.from) setOriginOverride(fromUrl.from)
  }

  const origin: Point | null = originOverride ?? location.location
  const originIsManual = originOverride != null

  // Keyed on coordinates, so naming a dropped pin doesn't replan or reset the chosen trip.
  const [oLat, oLng, dLat, dLng] = [origin?.lat, origin?.lng, destination?.lat, destination?.lng]
  const trips = useMemo(() => {
    if (!routeData || oLat == null || oLng == null || dLat == null || dLng == null) return []
    const plans = planTrips(routeData.routes, { lat: oLat, lng: oLng }, { lat: dLat, lng: dLng }, { peak })
    // Cheapest first at default fares, so fare edits don't reshuffle; ties keep the planner's time order.
    return plans
      .map((plan) => ({ plan, fare: planFarePhp(plan) }))
      .sort((a, b) => a.fare - b.fare)
      .map(({ plan }) => plan)
  }, [routeData, oLat, oLng, dLat, dLng, peak])

  // Reset the pick during render when the plans change, so the map never draws a stale index.
  const [activeIndex, setActiveIndex] = useState(0)
  const [plannedTrips, setPlannedTrips] = useState(trips)
  if (plannedTrips !== trips) {
    setPlannedTrips(trips)
    // A shared link names its trip; once plans exist, pick it if it is still offered.
    const shared = pendingTripId ? trips.findIndex((t) => t.id === pendingTripId) : -1
    setActiveIndex(Math.max(0, shared))
    if (trips.length > 0) setPendingTripId(null)
  }

  const canExpand = trips.length > 0
  // Without trips there is nothing to expand, but the chosen snap waits for them.
  const sheetSnap: SheetSnap = canExpand ? snap : "peek"

  const activeTrip = trips[activeIndex] ?? null
  const walkPaths = useWalkPaths(activeTrip)
  const routeIndex = routeData?.index ?? null
  const routedTrip = useMemo(() => (activeTrip ? withRoutedGaps(activeTrip, walkPaths, routeIndex) : null), [activeTrip, walkPaths, routeIndex])
  // Badge from planner times, since only the active card gets street-path times.
  const fastestId = trips.length > 1 ? trips.reduce((best, t) => (t.totalDurationMin < best.totalDurationMin ? t : best)).id : null
  const shownTrips = useMemo(() => trips.map((trip, i) => (i === activeIndex && routedTrip ? routedTrip : trip)), [trips, activeIndex, routedTrip])

  const { ride, start: beginRide, stop: endRide } = useRide()
  // The trip tapped on, kept while waiting for a precise fix so a replan can't swap it.
  const [ridePrompt, setRidePrompt] = useState<{ trip: TripPlan; destinationName: string } | null>(null)
  const preciseFix = location.status === "ready" && location.location != null && location.accuracyM != null && location.accuracyM <= PRECISE_ACCURACY_M
  const startRideNow = (trip: TripPlan, destinationName: string) => {
    setRidePrompt(null)
    beginRide(trip, destinationName, location.location, location.accuracyM)
    setSnap("half")
  }
  // A ride needs a precise fix; otherwise ask for one and start as soon as it arrives.
  const startRide = () => {
    if (!routedTrip || !destination) return
    if (preciseFix) startRideNow(routedTrip, destination.name)
    else {
      setRidePrompt({ trip: routedTrip, destinationName: destination.name })
      location.request()
    }
  }
  if (ridePrompt && preciseFix && !ride) startRideNow(ridePrompt.trip, ridePrompt.destinationName)

  const { visiblePx, readVisible } = useBottomSheet({
    enabled: mobile,
    expandable: canExpand,
    snap: sheetSnap,
    onSnapChange: setSnap,
    sheetRef,
    handleRef,
    contentRef,
    scrollRef,
    headerRef,
  })
  const top = useHeaderInset(headerRef, mobile)
  const insets: MapInsets = { top, bottom: visiblePx }
  const readInsets = (): MapInsets => ({ top: readMobile() ? (headerRef.current?.offsetHeight ?? 0) : 0, bottom: readVisible() })

  const activeTripId = trips.length > 0 ? (trips[activeIndex]?.id ?? null) : pendingTripId

  // Keeps the address bar in step, so reloading or sharing reopens the same trip.
  useEffect(() => {
    if (!urlApplied && !destination && !originOverride) return
    const url = buildTripUrl(window.location.href, { from: originOverride, to: destination, tripId: activeTripId })
    window.history.replaceState(window.history.state, "", url)
  }, [destination, originOverride, urlApplied, activeTripId])

  useEffect(() => () => clearTimeout(shareTimerRef.current), [])

  const bumpFit = () => setFitKey((k) => k + 1)

  // Names a hand-placed point once the lookup returns, unless the rider has moved it again.
  const lookUpName = (point: Location, target: "origin" | "destination") => {
    lookupRef.current[target]?.abort()
    const controller = new AbortController()
    lookupRef.current[target] = controller
    reversePlace(point.lat, point.lng, controller.signal)
      .then((name) => {
        if (!name || controller.signal.aborted) return
        const named = (current: Location | null) => (current === point ? { ...point, name } : current)
        if (target === "origin") setOriginOverride(named)
        else setDestination(named)
      })
      .catch(() => {})
  }

  const selectDestination = (next: Location | null) => {
    lookupRef.current.destination?.abort()
    setPendingTripId(null)
    setDestination(next)
    if (next) {
      remember(next)
      setSnap("half")
    } else setSnap("peek")
    bumpFit()
  }

  const pickDestination = (point: Point, source: "drop" | "drag") => {
    const next = { ...point, name: DROPPED_PIN }
    // Only a fresh drop can be undone by "Start from here instead".
    if (source === "drop") previousDestinationRef.current = destination
    setPendingTripId(null)
    setDestination(next)
    setSnap("peek")
    lookUpName(next, "destination")
  }

  const pickOrigin = (point: Point) => {
    const next = { ...point, name: PINNED_START }
    setOriginOverride(next)
    lookUpName(next, "origin")
  }

  const dropAsOrigin = (point: Point) => {
    // Undo the drop only if it is still the destination; the popup's closure may be stale, so check the latest.
    setDestination((current) => (current?.lat === point.lat && current.lng === point.lng ? previousDestinationRef.current : current))
    pickOrigin(point)
  }

  const useGps = () => {
    lookupRef.current.origin?.abort()
    setOriginOverride(null)
    location.request()
    bumpFit()
  }

  const canSwap = origin != null && destination != null
  const swap = () => {
    if (!origin || !destination) return
    const from: Location = originOverride ?? { ...origin, name: "Your location" }
    lookupRef.current.origin?.abort()
    lookupRef.current.destination?.abort()
    setPendingTripId(null)
    setOriginOverride(destination)
    setDestination(from)
    // Lookups were cut short above, so ask again for ends still waiting on a name.
    if (destination.name === DROPPED_PIN) lookUpName(destination, "origin")
    if (from.name === PINNED_START || from.name === DROPPED_PIN) lookUpName(from, "destination")
    bumpFit()
  }

  const selectTrip = (index: number) => {
    setActiveIndex(index)
    bumpFit()
  }

  const locate = () => {
    location.request()
    setRecenterKey((k) => k + 1)
  }

  const share = async () => {
    if (!destination) return
    const url = buildTripUrl(window.location.href, { from: originOverride, to: destination, tripId: activeTripId })
    const title = `Jeepney to ${shortPlaceName(destination.name)}`
    let status = ""
    try {
      if (navigator.share) {
        await navigator.share({ title, text: `${title} · DavGuides`, url })
      } else {
        await navigator.clipboard.writeText(url)
        status = "Link copied"
      }
    } catch (error) {
      // Closing the share sheet isn't a failure.
      if ((error as DOMException)?.name !== "AbortError") status = "Couldn't share. Copy the address bar instead."
    }
    setShareStatus(status)
    clearTimeout(shareTimerRef.current)
    if (status) shareTimerRef.current = setTimeout(() => setShareStatus(""), SHARE_STATUS_MS)
  }

  const closeRidePrompt = useCallback(() => setRidePrompt(null), [])

  const routesReady = routeData != null
  const gpsStatus = originIsManual ? "ready" : location.status

  const plannerStatus = !destination
    ? ""
    : gpsStatus === "error"
      ? "Your location is needed."
      : gpsStatus === "pending"
        ? "Getting your location…"
        : !routesReady
          ? "Loading jeepney routes…"
          : trips.length === 0
            ? "No jeepney goes there."
            : `${trips.length === 1 ? "1 trip" : `${trips.length} trips`} found to ${shortPlaceName(destination.name)}.`

  const cycleSnap = (direction: 1 | -1) => {
    const order: SheetSnap[] = ["peek", "half", "full"]
    const next = order[Math.min(order.length - 1, Math.max(0, order.indexOf(sheetSnap) + direction))]
    setSnap(next)
  }

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
              <Image src="/logo-mark.svg" alt="" width={48} height={48} preload className="size-12 rounded-[14px] shadow-lg md:size-10 md:shadow-none" />
              <span className="hidden font-signboard text-[32px] font-bold leading-none tracking-wide md:block" aria-hidden>
                <span className="text-[var(--dg-navy)]">DAV</span>
                <span className="text-[var(--dg-ink)]">GUIDES</span>
              </span>
            </div>
            <div className="min-w-0 flex-1 space-y-2 md:w-full">
              <SearchBox value={destination} onSelect={selectDestination} recent={recent} onDropPin={() => setDropPinKey((k) => k + 1)} />
              {(destination || originIsManual) && (
                <OriginBar
                  manualName={originOverride?.name ?? null}
                  gpsStatus={location.status}
                  canSwap={canSwap}
                  onUseGps={useGps}
                  onSwap={swap}
                />
              )}
            </div>
          </div>
        </header>

        <section
          ref={sheetRef}
          aria-label="Trip planner"
          className="dg-sheet fixed inset-x-0 bottom-0 z-20 flex max-h-[92dvh] flex-col rounded-t-3xl bg-white shadow-[0_-8px_30px_rgba(15,23,42,.18)] after:absolute after:inset-x-0 after:top-full after:h-[50dvh] after:bg-white md:static md:max-h-none md:min-h-0 md:flex-1 md:rounded-none md:shadow-none md:after:hidden"
        >
          <div ref={handleRef} className="flex shrink-0 touch-none justify-center pt-2 md:hidden">
            {canExpand ? (
              <button
                type="button"
                aria-expanded={sheetSnap !== "peek"}
                onClick={() => setSnap(sheetSnap === "peek" ? "half" : "peek")}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp") {
                    e.preventDefault()
                    cycleSnap(1)
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault()
                    cycleSnap(-1)
                  }
                }}
                className="flex min-h-11 w-full flex-col items-center gap-1 pb-1 text-xs font-medium text-slate-600"
              >
                <span className="h-1.5 w-10 rounded-full bg-slate-300" aria-hidden />
                {sheetSnap === "peek" ? `See ${trips.length === 1 ? "trip details" : `all ${trips.length} options`}` : "Show the map"}
              </button>
            ) : (
              <span className="mb-1 h-1.5 w-10 rounded-full bg-slate-300" aria-hidden />
            )}
          </div>

          <p role="status" className="sr-only">
            {plannerStatus}
          </p>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 md:px-5 md:pt-0">
            <div ref={contentRef}>
              {ride ? (
                <RidePanel ride={ride} preciseM={PRECISE_ACCURACY_M} onEnd={endRide} />
              ) : (
                <TripPanel
                  destination={destination}
                  locationStatus={location.status}
                  locationError={location.error}
                  accuracyM={location.accuracyM}
                  onRetryLocation={locate}
                  routesReady={routesReady}
                  trips={shownTrips}
                  activeIndex={activeIndex}
                  onSelect={selectTrip}
                  fare={fare}
                  onFareChange={setFare}
                  onFareReset={resetFare}
                  fareIsDefault={fareIsDefault}
                  collapsed={sheetSnap === "peek"}
                  originIsManual={originIsManual}
                  fastestId={fastestId}
                  onShare={share}
                  onStartRide={startRide}
                  shareStatus={shareStatus}
                />
              )}
            </div>
          </div>
        </section>
      </aside>

      <div className="h-full w-full md:min-w-0 md:flex-1">
        <MapComponent
          trip={ride?.trip ?? routedTrip}
          routeIndex={routeData?.index ?? null}
          origin={ride?.position ?? origin}
          gpsLocation={ride?.position ?? location.location}
          destination={destination}
          insets={insets}
          readInsets={readInsets}
          recenterKey={recenterKey}
          fitKey={fitKey}
          dropPinKey={dropPinKey}
          onLocate={locate}
          originIsManual={ride ? false : originIsManual}
          accuracyM={ride ? ride.accuracyM : location.accuracyM}
          follow={ride != null}
          showWalkCredit={walkPaths.size > 0}
          onPickDestination={pickDestination}
          onPickOrigin={pickOrigin}
          onDropAsOrigin={dropAsOrigin}
        />
      </div>
      {ridePrompt && !ride && (
        <PreciseLocationPrompt
          reason={location.status === "error" ? (location.errorKind ?? "unavailable") : "approximate"}
          accuracyM={location.accuracyM}
          checking={location.status === "pending" || location.refreshing}
          requiredM={PRECISE_ACCURACY_M}
          onRetry={location.request}
          onClose={closeRidePrompt}
        />
      )}
    </main>
  )
}
