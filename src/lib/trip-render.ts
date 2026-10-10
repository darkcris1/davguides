// Draws a TripPlan onto Leaflet layers; only the ridden arc is solid, so direction reads at a glance.

import L from "leaflet"
import type { TripLeg, TripPlan } from "./route-engine"
import { fullPath, type RouteIndex } from "./route-index"
import { THRESHOLDS } from "./transport-config"
import { bearingDeg, formatDistance, formatDuration, haversineKm } from "./geo"
import { escapeHtml } from "./utils"
import { CONTEXT_COLOR, TRICYCLE_COLOR, WALK_COLOR, jeepneyColor } from "./leg-colors"

const ORIGIN_COLOR = "#4285F4"
const DESTINATION_COLOR = "#dc2626"

export interface RenderTripOptions {
  index: RouteIndex
  /** Draw the rest of each route's loop faintly behind the ridden arc. */
  showRouteContext?: boolean
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
    html: `<div style="min-width:22px;height:22px;padding:0 5px;border-radius:11px;background:${color};color:#fff;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);font:600 12px/18px system-ui,sans-serif;text-align:center">${escapeHtml(label)}</div>`,
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

// Arrows are spaced by distance, since vertex density varies tenfold between routes.
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
    sinceLastKm += haversineKm(aLat, aLng, bLat, bLng)
    if (sinceLastKm < everyKm) continue
    sinceLastKm = 0

    const heading = bearingDeg(aLat, aLng, bLat, bLng)
    const icon = L.divIcon({
      className: "dg-arrow",
      html: `<div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:9px solid ${color};transform:rotate(${heading}deg);filter:drop-shadow(0 1px 1px rgba(0,0,0,.35))"></div>`,
      iconSize: [10, 10],
      iconAnchor: [5, 5],
    })

    group.addLayer(L.marker([bLat, bLng], { icon, interactive: false, keyboard: false }))
  }
}

function legTooltip(leg: TripLeg): string {
  const distance = formatDistance(leg.distanceKm)
  if (leg.mode === "jeepney") {
    return `<strong>${escapeHtml(leg.routeName ?? "")}</strong><br>${distance} · ${formatDuration(leg.durationMin)}`
  }
  const walk = leg.walkMin != null ? `Walk ${formatDuration(leg.walkMin)}` : ""
  const trike = leg.showTricycleOption && leg.tricycleMin != null ? ` · or tricycle ${formatDuration(leg.tricycleMin)}` : ""
  return `<strong>${distance}</strong><br>${walk}${trike}`
}

// Draws the trip into `group` and returns the bounds it covers.
export function renderTrip(group: L.LayerGroup, trip: TripPlan, options: RenderTripOptions): L.LatLngBounds {
  group.clearLayers()

  const bounds = L.latLngBounds([])
  let jeepneyOrdinal = 0

  // Faint full loops go first so ridden arcs and markers sit on top.
  if (options.showRouteContext !== false) {
    for (const leg of trip.legs) {
      if (leg.mode !== "jeepney" || leg.routeIndex == null) continue
      const entry = options.index.entries[leg.routeIndex]
      if (!entry) continue
      group.addLayer(L.polyline(fullPath(entry), { color: CONTEXT_COLOR, weight: 3, opacity: 0.25, interactive: false }))
    }
  }

  for (const leg of trip.legs) {
    if (leg.mode === "jeepney") {
      const color = jeepneyColor(jeepneyOrdinal)
      const name = escapeHtml(leg.routeName ?? "")
      const line = L.polyline(leg.path, { color, weight: 6, opacity: 0.9 })
      line.bindTooltip(legTooltip(leg), { sticky: true })
      group.addLayer(line)
      addDirectionArrows(group, leg.path, color)

      group.addLayer(
        L.marker(leg.from, { icon: labelIcon(color, String(jeepneyOrdinal + 1)), title: `Board the ${leg.routeName}` }).bindPopup(
          `<strong>Board the ${name}</strong><br>Ride ${formatDistance(leg.distanceKm)}${
            (leg.terminalsCrossed ?? 0) > 0 ? "<br><em>Passes a terminal — you may need to re-board.</em>" : ""
          }`,
        ),
      )
      group.addLayer(
        L.marker(leg.to, { icon: dotIcon(color, 10, 3), title: `Get off the ${leg.routeName}` }).bindPopup(
          `<strong>Get off here</strong><br>${name}`,
        ),
      )

      leg.path.forEach((p) => bounds.extend(p))
      jeepneyOrdinal++
      continue
    }

    const isTricycle = leg.mode === "tricycle"
    const line = L.polyline(leg.path, {
      color: isTricycle ? TRICYCLE_COLOR : WALK_COLOR,
      weight: isTricycle ? 4 : 3,
      opacity: 0.85,
      dashArray: isTricycle ? "10 6" : "4 6",
    })
    line.bindTooltip(legTooltip(leg), { sticky: true })
    group.addLayer(line)
    leg.path.forEach((p) => bounds.extend(p))
  }

  // Transfers sit between two jeepney legs, with or without a short gap leg between them.
  for (let i = 1; i < trip.legs.length; i++) {
    const next = trip.legs[i]
    if (next.mode !== "jeepney") continue
    const gap = trip.legs[i - 1].mode === "jeepney" ? null : trip.legs[i - 1]
    const previous = gap ? trip.legs[i - 2] : trip.legs[i - 1]
    if (previous?.mode !== "jeepney") continue

    const at = gap ? gap.to : next.from
    const walk = gap ? `${formatDistance(gap.distanceKm)} to the ` : "Change to the "
    group.addLayer(
      L.marker(at, { icon: labelIcon("#0f172a", "⇄"), title: "Transfer" }).bindPopup(
        `<strong>Transfer</strong><br>${walk}${escapeHtml(next.routeName ?? "")}`,
      ),
    )
  }

  return bounds
}

// Rider and destination markers live apart from the trip so they show even without a route.
export function renderEndpoints(
  group: L.LayerGroup,
  origin: { lat: number; lng: number } | null,
  destination: { lat: number; lng: number; name?: string } | null,
): void {
  group.clearLayers()

  if (origin) {
    group.addLayer(
      L.marker([origin.lat, origin.lng], { icon: dotIcon(ORIGIN_COLOR, 12, 3), title: "You are here" }).bindPopup("You are here"),
    )
  }

  if (destination) {
    const name = destination.name ? `<br>${escapeHtml(destination.name)}` : ""
    group.addLayer(
      L.marker([destination.lat, destination.lng], { icon: pinIcon(DESTINATION_COLOR), title: "Destination" }).bindPopup(
        `<strong>Destination</strong>${name}`,
      ),
    )
  }
}
