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
  type: "LineString"
  /** GeoJSON order: [lng, lat]. Everything downstream uses [lat, lng]. */
  coordinates: number[][]
}

export interface Route {
  type: "Feature"
  properties: RouteProperties
  geometry: RouteGeometry
}

export interface UserLocation {
  lat: number
  lng: number
}
