"use client"

import { useEffect, useEffectEvent, useRef } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import "maplibre-gl/dist/maplibre-gl.css"
import { maplibreGL } from "@maplibre/maplibre-gl-leaflet/leaflet-maplibre-gl"
import { LocateFixed, Minus, Plus } from "lucide-react"
import { destinationPopupHtml, renderEndpoints, renderTrip } from "@/lib/trip-render"
import type { TripPlan } from "@/lib/route-engine"
import type { RouteIndex } from "@/lib/route-index"
import type { Location, UserLocation } from "@/commons/models/maps"

// OpenFreeMap needs no API key; the style carries its own attribution.
const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty"
const DAVAO_CENTER: [number, number] = [7.0731, 125.6128]

export interface MapInsets {
  top: number
  bottom: number
}

export interface MapComponentProps {
  trip: TripPlan | null
  routeIndex: RouteIndex | null
  origin: UserLocation | null
  /** GPS fix, which Locate flies to even when the start was set by hand. */
  gpsLocation: UserLocation | null
  destination: Location | null
  /** Screen space covered by floating UI, so fits and controls avoid it. */
  insets: MapInsets
  /** Live read of the insets for fits made in the same commit as a resize. */
  readInsets: () => MapInsets
  /** Bumped by the shell each time the rider taps Locate. */
  recenterKey: number
  /** Bumped when the map should frame the trip; pin drags don't bump it. */
  fitKey: number
  onLocate: () => void
  originIsManual: boolean
  accuracyM: number | null
  /** Shows the walk router credit while its paths are on the map. */
  showWalkCredit: boolean
  onPickDestination: (point: { lat: number; lng: number }, source: "drop" | "drag") => void
  onPickOrigin: (point: { lat: number; lng: number }) => void
  /** Moves a pin just dropped by long-press over to the start. */
  onDropAsOrigin: (point: { lat: number; lng: number }) => void
}

const LONG_PRESS_MS = 450
const LONG_PRESS_SLOP_PX = 10
const WALK_CREDIT = 'Walking paths © <a href="https://routing.openstreetmap.de/" target="_blank" rel="noopener">FOSSGIS</a> OSRM'

// Built as DOM nodes, so no outside string ever becomes HTML.
function dropPopupContent(onStart: () => void): HTMLElement {
  const box = document.createElement("div")
  box.className = "flex flex-col gap-1"
  const title = document.createElement("strong")
  title.textContent = "Destination set"
  const hint = document.createElement("span")
  hint.className = "text-xs text-slate-600"
  hint.textContent = "Drag the pin to adjust it."
  const button = document.createElement("button")
  button.type = "button"
  button.className = "mt-1 min-h-11 rounded-full border border-slate-300 px-3 text-sm font-medium text-[var(--dg-navy)]"
  button.textContent = "Start from here instead"
  button.addEventListener("click", onStart)
  box.append(title, hint, button)
  return box
}

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

const controlClass =
  "flex size-11 items-center justify-center rounded-full bg-white text-[var(--dg-ink)] shadow-md ring-1 ring-black/5 transition hover:bg-slate-50 active:scale-95 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--dg-navy)]/50"

export default function MapComponent({
  trip,
  routeIndex,
  origin,
  gpsLocation,
  destination,
  insets,
  readInsets,
  recenterKey,
  fitKey,
  onLocate,
  originIsManual,
  accuracyM,
  showWalkCredit,
  onPickDestination,
  onPickOrigin,
  onDropAsOrigin,
}: MapComponentProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const tripLayerRef = useRef<L.LayerGroup | null>(null)
  const endpointLayerRef = useRef<L.LayerGroup | null>(null)

  const dropAt = useEffectEvent((latlng: L.LatLng) => {
    const map = mapRef.current
    if (!map) return
    const point = { lat: latlng.lat, lng: latlng.lng }
    onPickDestination(point, "drop")
    const popup = L.popup({
      className: "dg-drop-popup",
      offset: [0, -40],
      autoPanPaddingTopLeft: [16, readInsets().top + 16],
      autoPanPaddingBottomRight: [16, readInsets().bottom + 16],
    })
    popup.setLatLng(latlng).setContent(
      dropPopupContent(() => {
        map.closePopup(popup)
        onDropAsOrigin(point)
      }),
    )
    popup.openOn(map)
  })

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, { zoomControl: false }).setView(DAVAO_CENTER, 13)
    maplibreGL({ style: MAP_STYLE_URL }).addTo(map)

    // On phones the credits show at load, then fold behind an info button once the rider touches the map.
    const attribution = map.attributionControl.getContainer()
    attribution?.classList.add("dg-attrib", "dg-attrib-open")
    const creditsButton = L.DomUtil.create("button", "dg-attrib-toggle")
    creditsButton.type = "button"
    creditsButton.textContent = "i"
    creditsButton.setAttribute("aria-label", "Map credits")
    creditsButton.setAttribute("aria-expanded", "true")
    const setCredits = (open: boolean) => {
      attribution?.classList.toggle("dg-attrib-open", open)
      creditsButton.setAttribute("aria-expanded", String(open))
    }
    L.DomEvent.disableClickPropagation(creditsButton)
    L.DomEvent.on(creditsButton, "click", () => setCredits(!attribution?.classList.contains("dg-attrib-open")))
    const CreditsControl = L.Control.extend({ onAdd: () => creditsButton })
    new CreditsControl({ position: "bottomright" }).addTo(map)
    map.on("movestart", () => setCredits(false))

    mapRef.current = map
    tripLayerRef.current = L.layerGroup().addTo(map)
    endpointLayerRef.current = L.layerGroup().addTo(map)

    // The container settles after layout, so keep Leaflet and the GL canvas in step with it.
    const container = containerRef.current
    const resize = new ResizeObserver(() => map.invalidateSize())
    resize.observe(container)

    // Long-press drops a destination, like Google Maps; mouse users right-click instead.
    const pointers = new Set<number>()
    let timer: ReturnType<typeof setTimeout> | undefined
    let start: { x: number; y: number } | null = null
    let lastPointerType = "mouse"
    let swallowClick = false
    const cancel = () => {
      clearTimeout(timer)
      start = null
    }
    const onDown = (event: PointerEvent) => {
      lastPointerType = event.pointerType
      swallowClick = false
      pointers.add(event.pointerId)
      cancel()
      if (pointers.size > 1 || event.pointerType === "mouse") return
      if ((event.target as HTMLElement).closest(".leaflet-control")) return
      setCredits(false)
      if ((event.target as HTMLElement).closest(".leaflet-marker-icon, .leaflet-popup")) return
      start = { x: event.clientX, y: event.clientY }
      const point = map.mouseEventToLatLng(event)
      timer = setTimeout(() => {
        start = null
        swallowClick = true
        navigator.vibrate?.(12)
        dropAt(point)
      }, LONG_PRESS_MS)
    }
    const onMove = (event: PointerEvent) => {
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_SLOP_PX) cancel()
    }
    const onUp = (event: PointerEvent) => {
      pointers.delete(event.pointerId)
      cancel()
    }
    // The lifted finger still sends a click, which would close the drop popup straight away.
    const onClick = (event: MouseEvent) => {
      if (!swallowClick) return
      swallowClick = false
      event.stopPropagation()
      event.preventDefault()
    }
    container.addEventListener("click", onClick, true)
    container.addEventListener("pointerdown", onDown)
    container.addEventListener("pointermove", onMove)
    container.addEventListener("pointerup", onUp)
    container.addEventListener("pointercancel", onUp)
    map.on("movestart zoomstart", cancel)
    map.on("contextmenu", (event: L.LeafletMouseEvent) => {
      // Touch browsers fire contextmenu on long-press too; the timer already handles that.
      if (lastPointerType === "mouse") dropAt(event.latlng)
    })

    return () => {
      cancel()
      container.removeEventListener("click", onClick, true)
      container.removeEventListener("pointerdown", onDown)
      container.removeEventListener("pointermove", onMove)
      container.removeEventListener("pointerup", onUp)
      container.removeEventListener("pointercancel", onUp)
      resize.disconnect()
      map.remove()
      mapRef.current = null
      tripLayerRef.current = null
      endpointLayerRef.current = null
    }
  }, [])

  const fit = useEffectEvent((bounds: L.LatLngBounds) => {
    const { top, bottom } = readInsets()
    mapRef.current?.fitBounds(bounds, {
      animate: !prefersReducedMotion(),
      paddingTopLeft: [24, top + 24],
      paddingBottomRight: [24, bottom + 24],
      maxZoom: 17,
    })
  })

  const moveOrigin = useEffectEvent((latlng: L.LatLng) => onPickOrigin({ lat: latlng.lat, lng: latlng.lng }))
  const moveDestination = useEffectEvent((latlng: L.LatLng) => {
    // A drop popup left open would otherwise act on the old spot.
    mapRef.current?.closePopup()
    onPickDestination({ lat: latlng.lat, lng: latlng.lng }, "drag")
  })
  const readEnds = useEffectEvent(() => ({ origin, destination }))
  const destinationMarkerRef = useRef<L.Marker | null>(null)

  // Rebuilt only when a pin really moves, so a late place name never yanks a marker mid-drag.
  const [oLat, oLng, dLat, dLng] = [origin?.lat, origin?.lng, destination?.lat, destination?.lng]
  useEffect(() => {
    const map = mapRef.current
    if (!map || !endpointLayerRef.current) return
    const ends = readEnds()
    destinationMarkerRef.current = renderEndpoints(endpointLayerRef.current, ends.origin, ends.destination, {
      map,
      originIsManual,
      accuracyM,
      onMoveOrigin: moveOrigin,
      onMoveDestination: moveDestination,
    })
  }, [oLat, oLng, dLat, dLng, originIsManual, accuracyM])

  const destinationName = destination?.name
  useEffect(() => {
    destinationMarkerRef.current?.setPopupContent(destinationPopupHtml(destinationName))
  }, [destinationName])

  useEffect(() => {
    const control = mapRef.current?.attributionControl
    if (!control || !showWalkCredit) return
    control.addAttribution(WALK_CREDIT)
    return () => {
      control.removeAttribution(WALK_CREDIT)
    }
  }, [showWalkCredit])

  const fitPendingRef = useRef(true)
  const lastFitKeyRef = useRef(fitKey)
  const hadOriginRef = useRef(false)

  // Draws the trip; frames it only when the shell asks, so pin drags keep the rider's view.
  useEffect(() => {
    const map = mapRef.current
    const layer = tripLayerRef.current
    if (!map || !layer) return

    if (lastFitKeyRef.current !== fitKey) {
      lastFitKeyRef.current = fitKey
      fitPendingRef.current = true
    }
    // The first GPS fix is worth framing too.
    if (origin && !hadOriginRef.current) fitPendingRef.current = true
    hadOriginRef.current = origin != null

    const bounds = L.latLngBounds([])
    if (trip && routeIndex) bounds.extend(renderTrip(layer, trip, { index: routeIndex }))
    else layer.clearLayers()

    if (!fitPendingRef.current) return
    if (origin) bounds.extend([origin.lat, origin.lng])
    if (destination) bounds.extend([destination.lat, destination.lng])
    if (!bounds.isValid()) return

    if (!trip && (!origin || !destination)) map.setView(bounds.getCenter(), destination ? 16 : 15, { animate: !prefersReducedMotion() })
    else fit(bounds)
    // Keep waiting for the trip when both ends are known but plans aren't ready yet.
    fitPendingRef.current = !trip && origin != null && destination != null && !routeIndex
  }, [trip, routeIndex, origin, destination, fitKey])

  useEffect(() => {
    if (recenterKey === 0 || !gpsLocation) return
    const zoom = Math.max(mapRef.current?.getZoom() ?? 15, 15)
    if (prefersReducedMotion()) mapRef.current?.setView([gpsLocation.lat, gpsLocation.lng], zoom, { animate: false })
    else mapRef.current?.flyTo([gpsLocation.lat, gpsLocation.lng], zoom, { duration: 0.6 })
  }, [recenterKey, gpsLocation])

  // Leaflet's own bottom controls (attribution) ride above the sheet.
  useEffect(() => {
    containerRef.current?.style.setProperty("--map-inset-bottom", `${insets.bottom}px`)
  }, [insets.bottom])

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="dg-map z-0 h-full w-full" />

      <div
        className="absolute right-3 top-[var(--controls-top)] z-10 flex flex-col gap-2 md:bottom-6 md:right-6 md:top-auto"
        style={{ "--controls-top": `${insets.top + 12}px` } as React.CSSProperties}
      >
        <button type="button" aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()} className={`${controlClass} max-md:hidden`}>
          <Plus className="size-5" aria-hidden />
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()} className={`${controlClass} max-md:hidden`}>
          <Minus className="size-5" aria-hidden />
        </button>
        <button type="button" aria-label="Use my location" onClick={onLocate} className={controlClass}>
          <LocateFixed className="size-5" aria-hidden />
        </button>
      </div>
    </div>
  )
}
