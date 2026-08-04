"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { Locate, ZoomIn, ZoomOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import TripPanel from "@/components/trip-panel"
import { getRouteIndex } from "@/lib/route-index"
import { planTrips } from "@/lib/route-engine"
import { renderTrip } from "@/lib/trip-render"
import { useFareConfig } from "@/lib/use-fare-config"
import type { MapComponentProps, UserLocation } from "@/commons/models/maps"

const DAVAO_CENTER: [number, number] = [7.0507, 125.593]

export default function MapComponent({ selectedLocation, routes }: MapComponentProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const tripLayerRef = useRef<L.LayerGroup | null>(null)

  const [userLocation, setUserLocation] = useState<UserLocation | null>(null)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  const { fare, setFare, reset: resetFare, isDefault: fareIsDefault } = useFareConfig()

  // Built once per routes array and cached module-side, so this survives remounts.
  const routeIndex = useMemo(() => getRouteIndex(routes), [routes])

  // Derived, not stored in state: the old code kept search results in state and
  // rendered them imperatively, which left the selected route unable to change.
  const trips = useMemo(() => {
    if (!selectedLocation || !userLocation) return []
    return planTrips(routes, userLocation, selectedLocation)
  }, [routes, userLocation, selectedLocation])

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationError("This browser cannot report your location.")
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocationError(null)
        setUserLocation({ lat: position.coords.latitude, lng: position.coords.longitude })
      },
      (error) => {
        setLocationError(error.message)
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    )
  }, [])

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    const map = L.map(mapContainerRef.current, { zoomControl: false }).setView(DAVAO_CENTER, 13)

    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map)

    mapRef.current = map
    tripLayerRef.current = L.layerGroup().addTo(map)
    requestLocation()

    return () => {
      map.remove()
      mapRef.current = null
      tripLayerRef.current = null
    }
  }, [requestLocation])

  // Centre on the rider until there is a trip to frame.
  useEffect(() => {
    if (!mapRef.current || !userLocation || trips.length > 0) return
    mapRef.current.setView([userLocation.lat, userLocation.lng], 15)
  }, [userLocation, trips.length])

  useEffect(() => {
    setActiveIndex(0)
  }, [trips])

  useEffect(() => {
    const map = mapRef.current
    const layer = tripLayerRef.current
    if (!map || !layer) return

    const trip = trips[activeIndex]
    if (!trip) {
      layer.clearLayers()
      return
    }

    renderTrip(map, layer, trip, {
      index: routeIndex,
      origin: userLocation ?? undefined,
      destination: selectedLocation
        ? { lat: selectedLocation.lat, lng: selectedLocation.lng, name: selectedLocation.name }
        : undefined,
    })
  }, [trips, activeIndex, routeIndex, userLocation, selectedLocation])

  return (
    <div className="relative h-full w-full">
      <div ref={mapContainerRef} className="z-0 h-full w-full" />

      <div className="absolute bottom-4 right-4 z-10 flex flex-col gap-2">
        <Button variant="secondary" size="icon" onClick={() => mapRef.current?.zoomIn()} className="shadow-md">
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="icon" onClick={() => mapRef.current?.zoomOut()} className="shadow-md">
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="icon" onClick={requestLocation} className="shadow-md">
          <Locate className="h-4 w-4" />
        </Button>
      </div>

      {locationError && !userLocation && (
        <div className="absolute left-4 top-20 z-10 max-w-xs rounded-md bg-white p-3 text-xs shadow-md">
          <p className="font-medium">Cannot find your location</p>
          <p className="mt-1 text-gray-600">{locationError}</p>
          <Button variant="secondary" size="sm" className="mt-2 h-7 text-xs" onClick={requestLocation}>
            Try again
          </Button>
        </div>
      )}

      {selectedLocation && (
        <div className="absolute bottom-4 left-4 z-10">
          <TripPanel
            trips={trips}
            activeIndex={activeIndex}
            onSelect={setActiveIndex}
            fare={fare}
            onFareChange={setFare}
            onFareReset={resetFare}
            fareIsDefault={fareIsDefault}
            destinationName={selectedLocation.name}
            awaitingLocation={!userLocation && !locationError}
          />
        </div>
      )}
    </div>
  )
}
