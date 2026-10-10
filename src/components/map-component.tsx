"use client"

import { useEffect, useEffectEvent, useRef } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import "maplibre-gl/dist/maplibre-gl.css"
import { maplibreGL } from "@maplibre/maplibre-gl-leaflet/leaflet-maplibre-gl"
import { LocateFixed, Minus, Plus } from "lucide-react"
import { renderEndpoints, renderTrip } from "@/lib/trip-render"
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
  destination: Location | null
  /** Screen space covered by floating UI, so fits and controls avoid it. */
  insets: MapInsets
  /** Live read of the insets for fits made in the same commit as a resize. */
  readInsets: () => MapInsets
  /** Bumped by the shell each time the rider taps Locate. */
  recenterKey: number
  onLocate: () => void
}

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

const controlClass =
  "flex size-11 items-center justify-center rounded-full bg-white text-[var(--dg-ink)] shadow-md ring-1 ring-black/5 transition hover:bg-slate-50 active:scale-95 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--dg-navy)]/50"

export default function MapComponent({
  trip,
  routeIndex,
  origin,
  destination,
  insets,
  readInsets,
  recenterKey,
  onLocate,
}: MapComponentProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const tripLayerRef = useRef<L.LayerGroup | null>(null)
  const endpointLayerRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, { zoomControl: false }).setView(DAVAO_CENTER, 13)
    maplibreGL({ style: MAP_STYLE_URL }).addTo(map)

    mapRef.current = map
    tripLayerRef.current = L.layerGroup().addTo(map)
    endpointLayerRef.current = L.layerGroup().addTo(map)

    // The container settles after layout, so keep Leaflet and the GL canvas in step with it.
    const resize = new ResizeObserver(() => map.invalidateSize())
    resize.observe(containerRef.current)

    return () => {
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

  useEffect(() => {
    if (endpointLayerRef.current) renderEndpoints(endpointLayerRef.current, origin, destination)
  }, [origin, destination])

  // Frame the trip, or failing that the two endpoints, whenever either changes.
  useEffect(() => {
    const map = mapRef.current
    const layer = tripLayerRef.current
    if (!map || !layer) return

    const bounds = L.latLngBounds([])
    if (trip && routeIndex) bounds.extend(renderTrip(layer, trip, { index: routeIndex }))
    else layer.clearLayers()

    if (origin) bounds.extend([origin.lat, origin.lng])
    if (destination) bounds.extend([destination.lat, destination.lng])
    if (!bounds.isValid()) return

    if (!trip && (!origin || !destination)) map.setView(bounds.getCenter(), destination ? 16 : 15, { animate: !prefersReducedMotion() })
    else fit(bounds)
  }, [trip, routeIndex, origin, destination])

  useEffect(() => {
    if (recenterKey === 0 || !origin) return
    const zoom = Math.max(mapRef.current?.getZoom() ?? 15, 15)
    if (prefersReducedMotion()) mapRef.current?.setView([origin.lat, origin.lng], zoom, { animate: false })
    else mapRef.current?.flyTo([origin.lat, origin.lng], zoom, { duration: 0.6 })
  }, [recenterKey, origin])

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
        <button type="button" aria-label="Show my location" onClick={onLocate} className={controlClass}>
          <LocateFixed className="size-5" aria-hidden />
        </button>
      </div>
    </div>
  )
}
