// Define proper types

// import { ArrowMarker, Location, MapComponentProps, NearestPointInfo, Route, RouteGeometry, RouteProperties, UserLocation } from "@/commons/models/maps"

export interface Location {
  lat: number
  lng: number
  name: string
}

export interface RouteProperties {
  name: string
  color: string
}

export interface RouteGeometry {
  type: string
  coordinates: number[][]
}

export interface Route {
  type: string
  properties: RouteProperties
  geometry: RouteGeometry
  distance?: number
}

export interface MapComponentProps {
  selectedLocation: Location | null
  routes: Route[]
}

export interface NearestPointInfo {
  point: [number, number]
  distance: number
}

export interface UserLocation {
  lat: number
  lng: number
}

export interface ArrowMarker {
  marker: L.Marker
  position: number
}
