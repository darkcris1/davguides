"use client"

import { useEffect, useRef, useState } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { ZoomIn, ZoomOut, Locate } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { InfoIcon } from "lucide-react"

// Fix Leaflet icon issues
const fixLeafletIcon = () => {
  delete (L.Icon.Default.prototype as any)._getIconUrl
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
  })
}

// Define proper types
interface Location {
  lat: number
  lng: number
  name: string
}

interface RouteProperties {
  name: string
  color: string
}

interface RouteGeometry {
  type: string
  coordinates: number[][]
}

interface Route {
  type: string
  properties: RouteProperties
  geometry: RouteGeometry
  distance?: number
}

interface MapComponentProps {
  selectedLocation: Location | null
  routes: Route[]
}

interface NearestPointInfo {
  point: [number, number]
  distance: number
}

interface UserLocation {
  lat: number
  lng: number
}

interface ArrowMarker {
  marker: L.Marker
  position: number
}

export default function MapComponent({ selectedLocation, routes }: MapComponentProps) {
  const mapRef = useRef<L.Map | null>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const routeLayersRef = useRef<L.Layer[]>([])
  const animationLayersRef = useRef<L.Layer[]>([])
  const animationIntervalsRef = useRef<NodeJS.Timeout[]>([])
  const nearestPointMarkerRef = useRef<L.Marker | null>(null)
  const [recommendedRoutes, setRecommendedRoutes] = useState<Route[]>([])
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null)
  const userMarkerRef = useRef<L.Marker | null>(null)
  const [activeRouteIndex, setActiveRouteIndex] = useState<number>(0)
  const [nearestPointInfo, setNearestPointInfo] = useState<NearestPointInfo | null>(null)

  useEffect(() => {
    fixLeafletIcon()

    if (!mapContainerRef.current) return

    // Initialize map if it doesn't exist
    if (!mapRef.current) {
      const map = L.map(mapContainerRef.current).setView([7.0507, 125.593], 13)

      // Use CARTO Voyager tile layer
      L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map)

      mapRef.current = map

      // Try to get user's location on initial load
      getUserLocation()
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }

      // Clear any ongoing animations
      animationIntervalsRef.current.forEach((interval) => {
        clearTimeout(interval)
      })
      animationIntervalsRef.current = []
    }
  }, [])

  const getUserLocation = (): void => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position: GeolocationPosition) => {
          const { latitude, longitude } = position.coords
          setUserLocation({ lat: latitude, lng: longitude })

          if (mapRef.current) {
            // Remove previous user marker if exists
            if (userMarkerRef.current) {
              mapRef.current.removeLayer(userMarkerRef.current)
            }

            // Create a custom icon for user location
            const userIcon = L.divIcon({
              className: "user-location-marker",
              html: `<div style="background-color: #4285F4; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 3px rgba(0,0,0,0.3);"></div>`,
              iconSize: [22, 22],
              iconAnchor: [11, 11],
            })

            // Add new user marker
            userMarkerRef.current = L.marker([latitude, longitude], { icon: userIcon })
              .addTo(mapRef.current)
              .bindPopup("Your location")
              .openPopup()

            // If no location is selected, center on user location
            if (!selectedLocation) {
              mapRef.current.setView([latitude, longitude], 15)
            }

            // If we have an active route, update the nearest point marker
            if (recommendedRoutes.length > 0) {
              updateNearestPointMarker(recommendedRoutes[activeRouteIndex])
            }
          }
        },
        (error: GeolocationPositionError) => {
          console.error("Error getting location:", error)
        },
      )
    }
  }

  const updateRoutes = (): void => {
    if (!mapRef.current || !selectedLocation || !userLocation) return
  
    // Clear previous
    routeLayersRef.current.forEach((layer) => {
      mapRef.current?.removeLayer(layer)
    })
    routeLayersRef.current = []
  
    animationLayersRef.current.forEach((layer) => {
      mapRef.current?.removeLayer(layer)
    })
    animationLayersRef.current = []
  
    animationIntervalsRef.current.forEach((interval) => {
      clearTimeout(interval)
    })
    animationIntervalsRef.current = []
  
    // Recalculate using user's location
    const routesWithDistance: Route[] = routes.map((route) => {
      const minDistance = findMinDistanceToRoute(route)
      return { ...route, distance: minDistance }
    }).filter(route => route.distance !== Number.POSITIVE_INFINITY) // keep only valid
  
    // Sort routes by nearest boarding point
    const sortedRoutes = routesWithDistance.sort((a, b) => (a.distance || 0) - (b.distance || 0))
  
    const topRoutes = sortedRoutes.slice(0, 3)
    setRecommendedRoutes(topRoutes)
    setActiveRouteIndex(0)
  
    if (topRoutes.length > 0) {
      renderRoute(topRoutes[0])
    }
  }

  const renderRoute = (route: Route): void => {
    if (!mapRef.current) return

    // Clear previous routes
    routeLayersRef.current.forEach((layer) => {
      mapRef.current?.removeLayer(layer)
    })
    routeLayersRef.current = []

    // Clear animation layers
    animationLayersRef.current.forEach((layer) => {
      mapRef.current?.removeLayer(layer)
    })
    animationLayersRef.current = []

    // Clear animation intervals
    animationIntervalsRef.current.forEach((interval) => {
      clearTimeout(interval)
    })
    animationIntervalsRef.current = []

    // Add the route to the map
    const routeLayer = L.geoJSON(route as GeoJSON.Feature, {
      style: () => ({
        color: route.properties.color,
        weight: 7,
        opacity: 0.9,
      }),
      onEachFeature: (feature: GeoJSON.Feature, layer: L.Layer) => {
        const popupContent = `<b>${route.properties.name}</b><br>Distance to destination: ${(route.distance || 0).toFixed(2)} km`
        if (layer instanceof L.Path) {
          layer.bindPopup(popupContent)
          layer.openPopup()
        }
      },
    }).addTo(mapRef.current)

    routeLayersRef.current.push(routeLayer)

    // Create route animation
    createRouteAnimation(route)

    // Update nearest point marker if user location is available
    if (userLocation) {
      updateNearestPointMarker(route)
    }
  }

  const createRouteAnimation = (route: Route): void => {
    if (!mapRef.current) return

    const coordinates = route.geometry.coordinates

    // Add CSS for arrow animation
    const styleId = "arrow-animation-style"
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style")
      style.id = styleId
      style.innerHTML = `
        @keyframes fadeInOut {
          0% { opacity: 0; }
          50% { opacity: 1; }
          100% { opacity: 0; }
        }
      `
      document.head.appendChild(style)
    }

    // Create arrow markers at intervals along the route
    const arrowCount = Math.min(Math.floor(coordinates.length / 15), 15) // Limit number of arrows
    const step = Math.max(Math.floor(coordinates.length / arrowCount), 1)

    // Create arrow markers but don't add them to the map yet
    const arrowMarkers: ArrowMarker[] = []
    for (let i = 0; i < coordinates.length - step; i += step) {
      const start = coordinates[i]
      const end = coordinates[i + step]

      // Calculate angle for arrow direction
      const angle = calculateAngle(start[1], start[0], end[1], end[0])

      const arrowIcon = L.divIcon({
        className: "route-arrow",
        html: `<div style="
          transform: rotate(${angle}deg);
          width: 0; 
          height: 0; 
          border-left: 6px solid transparent;
          border-right: 6px solid transparent;
          border-bottom: 12px solid ${route.properties.color};
          opacity: 0;
        "></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      })

      const arrowMarker = L.marker([start[1], start[0]], { icon: arrowIcon })
      arrowMarkers.push({
        marker: arrowMarker,
        position: i,
      })
    }

    // Create animation that shows arrows in sequence
    let currentArrowIndex = 0
    const totalArrows = arrowMarkers.length
    const visibleArrows = 3 // Number of arrows visible at once

    // Function to update visible arrows
    const updateArrows = (): void => {
      // Remove all current arrows from map
      animationLayersRef.current.forEach((layer) => {
        mapRef.current?.removeLayer(layer)
      })
      animationLayersRef.current = []

      // Add the next set of visible arrows
      for (let i = 0; i < visibleArrows; i++) {
        const arrowIndex = (currentArrowIndex + i) % totalArrows
        const arrow = arrowMarkers[arrowIndex]
        if (mapRef.current) {
          arrow.marker.addTo(mapRef.current)
          animationLayersRef.current.push(arrow.marker)

          // Add fade in/out animation
          const arrowElement = arrow.marker.getElement()
          if (arrowElement) {
            const arrowDiv = arrowElement.querySelector("div") as HTMLElement
            if (arrowDiv) {
              arrowDiv.style.animation = "fadeInOut 1.5s infinite"
              arrowDiv.style.animationDelay = `${i * 0.2}s` // Stagger the animations
            }
          }
        }
      }

      // Move to next position
      currentArrowIndex = (currentArrowIndex + 1) % totalArrows
    }

    // Start the animation
    updateArrows()
    const animationInterval = setInterval(updateArrows, 300)
    animationIntervalsRef.current.push(animationInterval)
  }

  const calculateAngle = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const dLng = lng2 - lng1
    const y = Math.sin(dLng) * Math.cos(lat2)
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
    const angle = (Math.atan2(y, x) * 180) / Math.PI
    return angle
  }

  const updateNearestPointMarker = (route: Route): void => {
    if (!mapRef.current || !userLocation) return

    // Find nearest point on the route to the user
    const nearestPoint = findNearestPointOnRoute(userLocation, route)
    setNearestPointInfo(nearestPoint)

    // Remove previous marker if exists
    if (nearestPointMarkerRef.current) {
      mapRef.current.removeLayer(nearestPointMarkerRef.current)
    }

    // Create a custom icon for the nearest point
    const nearestPointIcon = L.divIcon({
      className: "nearest-point-marker",
      html: `<div style="
        width: 18px; 
        height: 18px; 
        background-color: ${route.properties.color}; 
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 0 5px rgba(0,0,0,0.5);
        animation: pulse 1.5s infinite alternate;
      "></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    })

    // Add marker for nearest point
    nearestPointMarkerRef.current = L.marker([nearestPoint.point[0], nearestPoint.point[1]], {
      icon: nearestPointIcon,
    })
      .addTo(mapRef.current)
      .bindPopup(
        `<b>Nearest Jeepney Stop</b><br>Go here to ride the ${route.properties.name} jeepney.<br>Distance: ${nearestPoint.distance.toFixed(2)} km from your location.`,
      )

    // Automatically open the popup
    nearestPointMarkerRef.current.openPopup()
  }

  const findNearestPointOnRoute = (point: UserLocation, route: Route): NearestPointInfo => {
    const coordinates = route.geometry.coordinates
    let minDistance = Number.POSITIVE_INFINITY
    let nearestPoint: [number, number] = [0, 0]

    coordinates.forEach((coord: number[]) => {
      const distance = calculateDistance(
        point.lat,
        point.lng,
        coord[1], // lat
        coord[0], // lng
      )

      if (distance < minDistance) {
        minDistance = distance
        nearestPoint = [coord[1], coord[0]] // [lat, lng]
      }
    })

    return { point: nearestPoint, distance: minDistance }
  }

  useEffect(() => {
    if (!mapRef.current || !selectedLocation) return

    // Clear previous search marker
    mapRef.current.eachLayer((layer) => {
      if (layer instanceof L.Marker && layer !== userMarkerRef.current && layer !== nearestPointMarkerRef.current) {
        mapRef.current?.removeLayer(layer)
      }
    })

    // Add base tile layer back if it was removed
    let hasBaseTileLayer = false
    mapRef.current.eachLayer((layer) => {
      if (layer instanceof L.TileLayer) {
        hasBaseTileLayer = true
      }
    })

    if (!hasBaseTileLayer) {
      L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(mapRef.current)
    }

    // Add marker for selected location
    const marker = L.marker([selectedLocation.lat, selectedLocation.lng])
      .addTo(mapRef.current)
      .bindPopup(selectedLocation.name)
      .openPopup()

    // Pan to selected location
    mapRef.current.setView([selectedLocation.lat, selectedLocation.lng], 15)

    // Update routes based on new selected location
    updateRoutes()
  }, [selectedLocation])

  // Update nearest point when user location changes
  useEffect(() => {
    if (userLocation && selectedLocation) {
      updateRoutes()
    }
  }, [userLocation])

  // Update displayed route when active route index changes
  useEffect(() => {
    if (recommendedRoutes.length > 0 && activeRouteIndex >= 0 && activeRouteIndex < recommendedRoutes.length) {
      renderRoute(recommendedRoutes[activeRouteIndex])
    }
  }, [activeRouteIndex])

  const findMinDistanceToRoute = (route: Route): number => {
    if (!userLocation || !selectedLocation) return Number.POSITIVE_INFINITY;
  
    let minDistance = Number.POSITIVE_INFINITY;
    const coordinates = route.geometry.coordinates;
  
    for (let i = 0; i < coordinates.length - 1; i++) {
      const current = coordinates[i];
      const next = coordinates[i + 1];
  
      // Check if this segment moves closer to the destination.
      const distToDestCurrent = calculateDistance(
        current[1], current[0],
        selectedLocation.lat, selectedLocation.lng
      );
  
      const distToDestNext = calculateDistance(
        next[1], next[0],
        selectedLocation.lat, selectedLocation.lng
      );
  
      if (distToDestNext < distToDestCurrent) {
        // Segment moves toward the destination, so consider distance to user.
        const distToUser = calculateDistance(
          userLocation.lat, userLocation.lng,
          current[1], current[0]
        );
  
        if (distToUser < minDistance) {
          minDistance = distToUser;
        }
      }
    }
  
    return minDistance;
  };
  

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371 // Radius of the earth in km
    const dLat = deg2rad(lat2 - lat1)
    const dLon = deg2rad(lon2 - lon1)
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    const d = R * c // Distance in km
    return d
  }

  const deg2rad = (deg: number): number => {
    return deg * (Math.PI / 180)
  }

  const handleZoomIn = (): void => {
    if (mapRef.current) {
      mapRef.current.zoomIn()
    }
  }

  const handleZoomOut = (): void => {
    if (mapRef.current) {
      mapRef.current.zoomOut()
    }
  }

  const handleLocate = (): void => {
    getUserLocation()
  }

  const handleRouteClick = (index: number): void => {
    setActiveRouteIndex(index)
  }

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainerRef} className="w-full h-full z-0" />

      {userLocation && nearestPointInfo && (
        <div className="absolute top-4 left-4 transform z-10 w-full max-w-md px-4 mt-16">
          <Alert className="bg-white border-primary shadow-lg">
            <InfoIcon className="h-4 w-4 text-primary" />
            <AlertTitle>How to use this jeepney route</AlertTitle>
            <AlertDescription className="text-xs mt-1">
              Go to the marked point on the map ({nearestPointInfo.distance.toFixed(2)} km from your location) to ride
              the jeepney. The animated arrows show the direction of travel.
            </AlertDescription>
          </Alert>
        </div>
      )}

      <div className="absolute bottom-4 right-4 z-10 flex flex-col gap-2">
        <Button variant="secondary" size="icon" onClick={handleZoomIn} className="shadow-md">
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="icon" onClick={handleZoomOut} className="shadow-md">
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="icon" onClick={handleLocate} className="shadow-md">
          <Locate className="h-4 w-4" />
        </Button>
      </div>

      {recommendedRoutes.length > 0 && (
        <div className="absolute bottom-4 left-4 z-10 bg-white p-3 rounded-md shadow-md max-w-xs">
          <h3 className="font-medium text-sm mb-2">Routes Near Destination:</h3>
          <ul className="text-xs space-y-2">
            {recommendedRoutes.map((route, index) => (
              <li
                key={index}
                className={`flex items-center gap-2 p-2 rounded-md cursor-pointer ${activeRouteIndex === index ? "bg-gray-100" : "hover:bg-gray-50"}`}
                onClick={() => handleRouteClick(index)}
              >
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: route.properties.color }} />
                <span className="flex-1">{route.properties.name}</span>
                <span className="text-gray-500">{(route.distance || 0).toFixed(2)} km</span>
                {index === 0 && (
                  <Badge variant="outline" className="ml-1 text-[10px] py-0 h-5">
                    Closest
                  </Badge>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs mt-3 text-gray-600">Routes are sorted by distance to your search location.</p>
        </div>
      )}
    </div>
  )
}