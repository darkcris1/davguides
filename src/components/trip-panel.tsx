"use client"

import { useMemo, useState } from "react"
import { ChevronDown, Settings2, TriangleAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LEG_PALETTE } from "@/lib/trip-render"
import { formatDistance, formatDuration } from "@/lib/geo"
import {
  DEFAULT_FARE,
  formatPhp,
  jeepneyFarePhp,
  tricycleFarePhp,
  type FareConfig,
} from "@/lib/transport-config"
import type { TripLeg, TripPlan } from "@/lib/route-engine"

export interface TripPanelProps {
  trips: TripPlan[]
  activeIndex: number
  onSelect: (index: number) => void
  fare: FareConfig
  onFareChange: (fare: FareConfig) => void
  onFareReset: () => void
  fareIsDefault: boolean
  destinationName?: string
  /** True while we have a destination but no geolocation yet. */
  awaitingLocation?: boolean
}

const MODE_ICON: Record<TripLeg["mode"], string> = {
  walk: "🚶",
  tricycle: "🛺",
  jeepney: "🚙",
}

function legFarePhp(leg: TripLeg, fare: FareConfig): number {
  if (leg.mode === "jeepney") return jeepneyFarePhp(leg.distanceKm, fare)
  if (leg.mode === "tricycle") return tricycleFarePhp(leg.distanceKm, fare)
  return 0
}

function planFarePhp(plan: TripPlan, fare: FareConfig): number {
  return plan.legs.reduce((sum, leg) => sum + legFarePhp(leg, fare), 0)
}

function jeepneyCount(plan: TripPlan): number {
  return plan.legs.filter((l) => l.mode === "jeepney").length
}

function LegChip({ leg, ordinal }: { leg: TripLeg; ordinal: number }) {
  const color = leg.mode === "jeepney" ? LEG_PALETTE[ordinal % LEG_PALETTE.length] : undefined
  const tone =
    leg.mode === "tricycle" ? "bg-amber-50 text-amber-900 border-amber-200" : "bg-gray-50 text-gray-700 border-gray-200"

  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] ${
        leg.mode === "jeepney" ? "bg-white" : tone
      }`}
      style={leg.mode === "jeepney" ? { borderColor: color, color } : undefined}
    >
      <span aria-hidden>{MODE_ICON[leg.mode]}</span>
      <span className="font-medium">{leg.mode === "jeepney" ? leg.routeName : formatDistance(leg.distanceKm)}</span>
      {leg.mode === "jeepney" && <span className="opacity-70">{formatDistance(leg.distanceKm)}</span>}
    </span>
  )
}

function LegDetail({
  leg,
  ordinal,
  alternatives,
  fare,
}: {
  leg: TripLeg
  ordinal: number
  alternatives: string[]
  fare: FareConfig
}) {
  const color = leg.mode === "jeepney" ? LEG_PALETTE[ordinal % LEG_PALETTE.length] : "#94a3b8"
  const cost = legFarePhp(leg, fare)

  return (
    <li className="flex gap-2">
      <span
        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: leg.mode === "tricycle" ? "#d97706" : color }}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] leading-snug text-gray-800">
          {leg.instruction}
          {leg.mode === "jeepney" && <span className="text-gray-500"> · {formatDistance(leg.distanceKm)}</span>}
        </p>

        {leg.mode === "jeepney" ? (
          <p className="text-[10px] text-gray-500">
            {formatDuration(leg.durationMin)} · {formatPhp(cost)}
            {(leg.terminalsCrossed ?? 0) > 0 && " · passes a terminal"}
          </p>
        ) : (
          <p className="text-[10px] text-gray-500">
            {/* Both options, always — the rider decides whether the walk is worth it. */}
            <span className={leg.recommendedMode === "walk" ? "font-semibold text-gray-700" : undefined}>
              Walk {formatDuration(leg.walkMin ?? leg.durationMin)}
            </span>
            {leg.showTricycleOption && leg.tricycleMin != null && (
              <>
                {" · "}
                <span className={leg.recommendedMode === "tricycle" ? "font-semibold text-amber-700" : undefined}>
                  tricycle {formatDuration(leg.tricycleMin)} (~{formatPhp(tricycleFarePhp(leg.distanceKm, fare))})
                </span>
              </>
            )}
          </p>
        )}

        {alternatives.length > 0 && (
          <p className="text-[10px] text-gray-500">or take: {alternatives.join(", ")}</p>
        )}
      </div>
    </li>
  )
}

function FareSettings({
  fare,
  onFareChange,
  onFareReset,
  fareIsDefault,
}: Pick<TripPanelProps, "fare" | "onFareChange" | "onFareReset" | "fareIsDefault">) {
  const [open, setOpen] = useState(false)

  const field = (label: string, key: keyof FareConfig, step: number, suffix?: string) => (
    <label className="flex items-center justify-between gap-2 text-[11px] text-gray-600">
      <span>{label}</span>
      <span className="flex items-center gap-1">
        <Input
          type="number"
          min={0}
          step={step}
          value={fare[key]}
          onChange={(e) => onFareChange({ ...fare, [key]: Number(e.target.value) })}
          className="h-7 w-20 text-right text-[11px]"
        />
        {suffix && <span className="w-6 text-gray-400">{suffix}</span>}
      </span>
    </label>
  )

  return (
    <div className="mt-2 border-t pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 text-[11px] text-gray-600 hover:text-gray-900"
      >
        <Settings2 className="h-3 w-3" />
        Fare settings
        <ChevronDown className={`ml-auto h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="mt-2 space-y-1.5">
          {field("Jeepney base fare", "jeepneyBasePhp", 0.5, "₱")}
          {field("Base covers", "jeepneyBaseKm", 0.5, "km")}
          {field("Per extra km", "jeepneyPerKmPhp", 0.1, "₱")}
          {field("Tricycle base", "tricycleBasePhp", 1, "₱")}
          {field("Tricycle per km", "tricyclePerKmPhp", 1, "₱")}
          <div className="flex items-center justify-between pt-1">
            <p className="text-[10px] text-gray-400">Estimates only — fares are set by the LTFRB and change.</p>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 px-2 text-[10px]"
              onClick={onFareReset}
              disabled={fareIsDefault}
            >
              Reset to {formatPhp(DEFAULT_FARE.jeepneyBasePhp)}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function TripPanel({
  trips,
  activeIndex,
  onSelect,
  fare,
  onFareChange,
  onFareReset,
  fareIsDefault,
  destinationName,
  awaitingLocation,
}: TripPanelProps) {
  const fares = useMemo(() => trips.map((trip) => planFarePhp(trip, fare)), [trips, fare])
  const fastestMinutes = trips.length > 0 ? Math.min(...trips.map((t) => t.totalDurationMin)) : 0

  if (awaitingLocation) {
    return (
      <div className="max-w-xs rounded-md bg-white p-3 shadow-md">
        <p className="text-xs text-gray-600">
          Waiting for your location. Allow location access to see which jeepney to ride.
        </p>
      </div>
    )
  }

  if (trips.length === 0) {
    return (
      <div className="max-w-xs rounded-md bg-white p-3 shadow-md">
        <h3 className="mb-1 text-sm font-medium">No jeepney route found</h3>
        <p className="text-xs text-gray-600">
          Nothing in the route data connects your location to {destinationName ? "that place" : "your destination"},
          even allowing a 2.5 km ride to the nearest stop and one transfer.
        </p>
      </div>
    )
  }

  return (
    <div className="max-h-[60vh] w-[19rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md bg-white p-3 shadow-md">
      <h3 className="mb-2 text-sm font-medium">How to get there</h3>

      <ul className="space-y-2">
        {trips.map((trip, index) => {
          const isActive = index === activeIndex
          const jeeps = jeepneyCount(trip)
          let jeepneyOrdinal = -1

          return (
            <li key={trip.id}>
              <button
                type="button"
                onClick={() => onSelect(index)}
                className={`w-full rounded-md border p-2 text-left transition-colors ${
                  isActive ? "border-gray-400 bg-gray-50" : "border-gray-200 hover:bg-gray-50"
                }`}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-semibold">~{formatDuration(trip.totalDurationMin)}</span>
                  <span className="text-sm text-gray-600">{formatPhp(fares[index])}</span>
                  {jeeps > 1 && <span className="text-[10px] text-gray-500">({jeeps} jeeps)</span>}
                  <Badge variant="outline" className="ml-auto h-5 py-0 text-[10px]">
                    {trip.transferCount === 0 ? "Direct" : `${trip.transferCount} transfer`}
                  </Badge>
                  {trip.totalDurationMin === fastestMinutes && (
                    <Badge className="h-5 py-0 text-[10px]">Fastest</Badge>
                  )}
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {trip.legs.map((leg, i) => {
                    if (leg.mode === "jeepney") jeepneyOrdinal++
                    return <LegChip key={i} leg={leg} ordinal={jeepneyOrdinal} />
                  })}
                </div>

                {isActive && (
                  <>
                    <ul className="mt-2 space-y-1.5 border-t pt-2">
                      {(() => {
                        let ordinal = -1
                        return trip.legs.map((leg, i) => {
                          if (leg.mode === "jeepney") ordinal++
                          return (
                            <LegDetail
                              key={i}
                              leg={leg}
                              ordinal={ordinal}
                              alternatives={leg.mode === "jeepney" ? trip.alternativeRouteNames[ordinal] ?? [] : []}
                              fare={fare}
                            />
                          )
                        })
                      })()}
                    </ul>

                    <p className="mt-2 text-[10px] text-gray-500">
                      Ride {formatDistance(trip.totalRideKm)}
                      {trip.totalWalkKm > 0 && ` · walk ${formatDistance(trip.totalWalkKm)}`}
                      {trip.totalTricycleKm > 0 && ` · tricycle ${formatDistance(trip.totalTricycleKm)}`}
                      {` · ${formatPhp(fares[index])} est.`}
                    </p>

                    {(trip.needsTricycleFirstMile || trip.needsTricycleLastMile || trip.needsTricycleTransfer) && (
                      <p className="mt-1 flex gap-1 text-[10px] text-amber-800">
                        <span aria-hidden>🛺</span>
                        <span>
                          {trip.needsTricycleFirstMile
                            ? `The nearest jeepney stop is ${formatDistance(trip.legs[0].distanceKm)} away — a tricycle is easier than walking it.`
                            : "One gap on this trip is far enough that a tricycle is easier than walking."}
                        </span>
                      </p>
                    )}

                    {trip.warnings.map((warning) => (
                      <p key={warning} className="mt-1 flex gap-1 text-[10px] text-gray-500">
                        <TriangleAlert className="mt-px h-3 w-3 shrink-0" />
                        <span>{warning}</span>
                      </p>
                    ))}
                  </>
                )}
              </button>
            </li>
          )
        })}
      </ul>

      <FareSettings
        fare={fare}
        onFareChange={onFareChange}
        onFareReset={onFareReset}
        fareIsDefault={fareIsDefault}
      />
    </div>
  )
}
