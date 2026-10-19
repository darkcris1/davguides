"use client"

import { BellRing, CircleCheck, Footprints, MapPin, X } from "lucide-react"
import { Signboard } from "@/components/trip-panel"
import { jeepneyColor } from "@/lib/leg-colors"
import { formatDistance } from "@/lib/geo"
import type { TripLeg } from "@/lib/route-engine"
import type { RideState } from "@/lib/use-ride"
import { shortPlaceName } from "@/lib/utils"

interface RidePanelProps {
  ride: RideState
  /** Fixes rougher than this get a weak-GPS note. */
  preciseM: number
  onEnd: () => void
}

// Off the leg's line by more than this, the rider gets a nudge back to it.
const OFF_LEG_NOTE_KM = 0.15

function jeepOrdinal(legs: TripLeg[], step: number): number {
  return legs.slice(0, step).filter((l) => l.mode === "jeepney").length
}

function stepText(legs: TripLeg[], step: number, destination: string): string {
  const leg = legs[step]
  if (leg.mode === "jeepney") return `Ride the ${leg.routeName} jeepney`
  const next = legs[step + 1]
  const verb = leg.mode === "tricycle" ? "Take a tricycle" : "Walk"
  if (next?.mode === "jeepney") return `${verb} to the ${next.routeName} stop`
  return `${verb} to ${destination}`
}

// Live step-by-step guide shown in place of the trip list while riding.
export default function RidePanel({ ride, preciseM, onEnd }: RidePanelProps) {
  const { trip, progress, accuracyM, error } = ride
  const legs = trip.legs
  const step = progress?.step ?? 0
  const leg = legs[step]
  const destination = shortPlaceName(ride.destinationName)
  const next = legs[step + 1]

  let headline = stepText(legs, step, destination)
  let detail = ""
  if (progress) {
    if (progress.arrived) headline = `You've arrived at ${destination}`
    else if (leg.mode === "jeepney" && progress.waiting) {
      headline = `Wait here for the ${leg.routeName} jeepney`
      detail = `Then ride ${formatDistance(progress.remainingKm)} and get off.`
    } else if (leg.mode === "jeepney") detail = `Get off in ${formatDistance(progress.remainingKm)}`
    else detail = `${formatDistance(progress.remainingKm)} to go`
  } else detail = "Waiting for your GPS…"

  const alert = progress?.alightSoon && !progress.arrived
  const weak = accuracyM != null && accuracyM > preciseM

  return (
    <div className="space-y-3 pb-2">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm text-slate-600">
          On the way to <span className="font-medium text-[var(--dg-ink)]">{destination}</span>
        </p>
        <button
          type="button"
          onClick={onEnd}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-slate-300 px-3 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--dg-navy)]/40"
        >
          <X className="size-4" aria-hidden />
          {progress?.arrived ? "Done" : "End ride"}
        </button>
      </div>

      {alert && (
        <p role="alert" className="flex items-center gap-2 rounded-2xl bg-[var(--dg-red)] px-4 py-3 text-base font-semibold text-white">
          <BellRing className="size-5 shrink-0" aria-hidden />
          Get off soon. Tell the driver “Para po!”
        </p>
      )}

      <div className="rounded-2xl border-2 border-[var(--dg-navy)] p-4" aria-live="polite">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[var(--dg-navy)]" aria-hidden>
            {progress?.arrived ? (
              <CircleCheck className="size-5" />
            ) : leg.mode === "jeepney" ? (
              <MapPin className="size-5" />
            ) : leg.mode === "tricycle" ? (
              <span>🛺</span>
            ) : (
              <Footprints className="size-5" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-lg font-semibold leading-snug text-[var(--dg-ink)]">{headline}</p>
            {!progress?.arrived && detail && <p className="mt-0.5 text-sm tabular-nums text-slate-700">{detail}</p>}
            {leg.mode === "jeepney" && !progress?.arrived && (
              <span className="mt-2 inline-block">
                <Signboard name={leg.routeName ?? "Jeepney"} color={jeepneyColor(jeepOrdinal(legs, step))} />
              </span>
            )}
          </div>
        </div>
      </div>

      {next && !progress?.arrived && (
        <p className="text-sm text-slate-600">
          <span className="font-medium text-slate-800">Next: </span>
          {next.mode === "jeepney" ? `ride the ${next.routeName} jeepney` : next.mode === "tricycle" ? "take a tricycle" : "walk"}
          {step + 2 >= legs.length ? ` to ${destination}` : ""}
        </p>
      )}

      {progress && !progress.arrived && progress.offLegKm > OFF_LEG_NOTE_KM && (
        <p className="text-xs text-amber-900">You&apos;re {formatDistance(progress.offLegKm)} from the route shown on the map.</p>
      )}
      {weak && <p className="text-xs text-amber-900">GPS is weak (±{Math.round(accuracyM)} m), so progress may lag.</p>}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  )
}
