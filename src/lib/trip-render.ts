/**
 * Draws a TripPlan onto a Leaflet map.
 *
 * Only the ridden arc of each route is drawn solid; the rest of the loop is faint
 * context. That is what actually communicates direction — a fully drawn ring tells
 * the rider nothing about which way the jeep goes.
 */

import L from "leaflet"
import type { TripLeg, TripPlan } from "./route-engine"
import { fullPath, type RouteIndex } from "./route-index"
import { THRESHOLDS } from "./transport-config"
import { bearingDeg, formatDistance, formatDuration, haversineKm } from "./geo"

/**
 * Per-leg colours, independent of routes.ts.
 *
 * The dataset reuses just 8 hex values across 53 routes — Toril, Calinan and
 * Bangkal are all #ff0000 — so route colour cannot distinguish one leg from
 * the next.
 */
export const LEG_PALETTE = ["#2563eb", "#db2777", "#16a34a", "#ea580c"] as const

const WALK_COLOR = "#64748b"
const TRICYCLE_COLOR = "#d97706"
const CONTEXT_COLOR = "#94a3b8"

export interface RenderTripOptions {
  index: RouteIndex
  /** Draw the rest of each route's loop faintly behind the ridden arc. */
  showRouteContext?: boolean
  fitBounds?: boolean
  origin?: { lat: number; lng: number }
  destination?: { lat: number; lng: number; name?: string }
}

function dotIcon(color: string, size: number, ring = 3): L.DivIcon {
  const outer = size + ring * 2
  return L.divIcon({
    className: "dg-marker",
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:${ring}px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    iconSize: [outer, outer],
    iconAnchor: [outer / 2, outer / 2],
  })
}

function labelIcon(color: string, label: string): L.DivIcon {
  return L.divIcon({
    className: "dg-marker",
    html: `<div style="min-width:22px;height:22px;padding:0 5px;border-radius:11px;background:${color};color:#fff;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);font:600 12px/18px system-ui,sans-serif;text-align:center">${label}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })
}

function pinIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "dg-marker",
    html: `<div style="width:16px;height:16px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 22],
  })
}

/**
 * Direction arrows spaced by actual distance, not by vertex count.
 *
 * Vertex density varies more than tenfold across this dataset (107 to 1423
 * vertices), so spacing arrows every Nth vertex puts them metres apart on one
 * route and kilometres apart on another.
 */
export function addDirectionArrows(
  group: L.LayerGroup,
  path: [number, number][],
  color: string,
  everyKm: number = THRESHOLDS.ARROW_SPACING_KM,
): void {
  if (path.length < 2) return

  let sinceLastKm = everyKm / 2
  for (let i = 1; i < path.length; i++) {
    const [aLat, aLng] = path[i - 1]
    const [bLat, bLng] = path[i]
    const segKm = haversineKm(aLat, aLng, bLat, bLng)
    sinceLastKm += segKm
    if (sinceLastKm < everyKm) continue
    sinceLastKm = 0

    // True compass bearing. Taking atan2(dLat, dLng) directly would both swap the
    // axes and ignore that a degree of longitude is shorter than one of latitude.
    const heading = bearingDeg(aLat, aLng, bLat, bLng)

    const icon = L.divIcon({
      className: "dg-arrow",
      html: `<div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:9px solid ${color};transform:rotate(${heading}deg);filter:drop-shadow(0 1px 1px rgba(0,0,0,.35))"></div>`,
      iconSize: [10, 10],
      iconAnchor: [5, 5],
    })

    group.addLayer(L.marker([bLat, bLng], { icon, interactive: false }))
  }
}

function legTooltip(leg: TripLeg): string {
  const distance = formatDistance(leg.distanceKm)
  if (leg.mode === "jeepney") {
    return `<strong>${leg.routeName}</strong><br>${distance} · ${formatDuration(leg.durationMin)}`
  }
  const walk = leg.walkMin != null ? `Walk ${formatDuration(leg.walkMin)}` : ""
  const trike = leg.showTricycleOption && leg.tricycleMin != null ? ` · or tricycle ${formatDuration(leg.tricycleMin)}` : ""
  return `<strong>${distance}</strong><br>${walk}${trike}`
}

export function renderTrip(
  map: L.Map,
  group: L.LayerGroup,
  trip: TripPlan,
  options: RenderTripOptions,
): void {
  group.clearLayers()

  const bounds = L.latLngBounds([])
  let jeepneyOrdinal = 0

  // Faint full loops first, so ridden arcs and markers draw on top of them.
  if (options.showRouteContext !== false) {
    for (const leg of trip.legs) {
      if (leg.mode !== "jeepney" || leg.routeIndex == null) continue
      const entry = options.index.entries[leg.routeIndex]
      if (!entry) continue
      group.addLayer(
        L.polyline(fullPath(entry), {
          color: CONTEXT_COLOR,
          weight: 3,
          opacity: 0.25,
          interactive: false,
        }),
      )
    }
  }

  for (const leg of trip.legs) {
    if (leg.mode === "jeepney") {
      const color = LEG_PALETTE[jeepneyOrdinal % LEG_PALETTE.length]
      const line = L.polyline(leg.path, { color, weight: 6, opacity: 0.9 })
      line.bindTooltip(legTooltip(leg), { sticky: true })
      group.addLayer(line)
      addDirectionArrows(group, leg.path, color)

      group.addLayer(
        L.marker(leg.from, { icon: labelIcon(color, String(jeepneyOrdinal + 1)) }).bindPopup(
          `<strong>Board the ${leg.routeName}</strong><br>Ride ${formatDistance(leg.distanceKm)}${
            (leg.terminalsCrossed ?? 0) > 0 ? "<br><em>Passes a terminal — you may need to re-board.</em>" : ""
          }`,
        ),
      )
      group.addLayer(
        L.marker(leg.to, { icon: dotIcon(color, 10, 3) }).bindPopup(
          `<strong>Get off here</strong><br>${leg.routeName}`,
        ),
      )

      leg.path.forEach((p) => bounds.extend(p))
      jeepneyOrdinal++
      continue
    }

    const isTricycle = leg.mode === "tricycle"
    const color = isTricycle ? TRICYCLE_COLOR : WALK_COLOR
    const line = L.polyline(leg.path, {
      color,
      weight: isTricycle ? 4 : 3,
      opacity: 0.85,
      dashArray: isTricycle ? "10 6" : "4 6",
    })
    line.bindTooltip(legTooltip(leg), { sticky: true })
    group.addLayer(line)
    leg.path.forEach((p) => bounds.extend(p))
  }

  // Transfer markers sit between two jeepney legs.
  for (let i = 1; i < trip.legs.length - 1; i++) {
    const previous = trip.legs[i - 1]
    const next = trip.legs[i + 1]
    if (previous.mode !== "jeepney" || next.mode !== "jeepney") continue
    group.addLayer(
      L.marker(trip.legs[i].to, { icon: labelIcon("#0f172a", "⇄") }).bindPopup(
        `<strong>Transfer</strong><br>${formatDistance(trip.legs[i].distanceKm)} to the ${next.routeName}`,
      ),
    )
  }

  if (options.origin) {
    const point: [number, number] = [options.origin.lat, options.origin.lng]
    group.addLayer(L.marker(point, { icon: dotIcon("#4285F4", 12, 3) }).bindPopup("You are here"))
    bounds.extend(point)
  }

  if (options.destination) {
    const point: [number, number] = [options.destination.lat, options.destination.lng]
    group.addLayer(
      L.marker(point, { icon: pinIcon("#dc2626") }).bindPopup(
        `<strong>Destination</strong>${options.destination.name ? `<br>${options.destination.name}` : ""}`,
      ),
    )
    bounds.extend(point)
  }

  if (options.fitBounds !== false && bounds.isValid()) {
    map.fitBounds(bounds.pad(0.12))
  }
}
