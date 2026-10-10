"use client"

import { useId, useMemo, useState } from "react"
import { ChevronDown, LocateFixed, Settings2, TriangleAlert } from "lucide-react"
import { CONTEXT_COLOR, TRICYCLE_COLOR, jeepneyColor } from "@/lib/leg-colors"
import { formatDistance, formatDuration } from "@/lib/geo"
import {
  CONCESSION_DISCOUNT_PCT,
  DEFAULT_FARE,
  THRESHOLDS,
  formatPhp,
  jeepneyFarePhp,
  tricycleFarePhp,
  type FareConfig,
} from "@/lib/transport-config"
import type { TripLeg, TripPlan } from "@/lib/route-engine"
import type { LocationStatus } from "@/lib/use-user-location"
import type { Location } from "@/commons/models/maps"
import { cn, shortPlaceName } from "@/lib/utils"

export interface TripPanelProps {
  destination: Location | null
  locationStatus: LocationStatus
  locationError: string | null
  accuracyM: number | null
  onRetryLocation: () => void
  routesReady: boolean
  trips: TripPlan[]
  activeIndex: number
  onSelect: (index: number) => void
  fare: FareConfig
  onFareChange: (fare: FareConfig) => void
  onFareReset: () => void
  fareIsDefault: boolean
  /** Phone sheet is folded down to the chosen trip only. */
  collapsed: boolean
}

// Above this the fix is likely IP-based, so boarding points may be off.
const ROUGH_ACCURACY_M = 300

const MAX_ACCESS_SEARCH_KM = THRESHOLDS.CANDIDATE_RADIUS_TIERS_KM[THRESHOLDS.CANDIDATE_RADIUS_TIERS_KM.length - 1]

function legFarePhp(leg: TripLeg, fare: FareConfig): number {
  if (leg.mode === "jeepney") return jeepneyFarePhp(leg.distanceKm, fare)
  if (leg.mode === "tricycle") return tricycleFarePhp(leg.distanceKm, fare)
  return 0
}

function planFarePhp(plan: TripPlan, fare: FareConfig): number {
  return plan.legs.reduce((sum, leg) => sum + legFarePhp(leg, fare), 0)
}

function planBadge(plan: TripPlan): string {
  if (!plan.legs.some((leg) => leg.mode === "jeepney")) return plan.legs.some((l) => l.mode === "tricycle") ? "Tricycle" : "Walk"
  if (plan.transferCount === 0) return "Direct"
  return plan.transferCount === 1 ? "1 transfer" : `${plan.transferCount} transfers`
}

// The route name painted like a jeepney windshield signboard, with the leg's map colour as a stripe.
function Signboard({ name, color, size = "md" }: { name: string; color: string; size?: "sm" | "md" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[3px] border-l-[5px] bg-[var(--dg-yellow)] font-signboard font-bold uppercase leading-none tracking-wide text-[var(--dg-ink)] shadow-[inset_0_-2px_0_rgba(0,0,0,.12)]",
        size === "md" ? "px-2 py-1 text-[17px]" : "px-1.5 py-0.5 text-[14px]",
      )}
      style={{ borderLeftColor: color }}
    >
      {name}
    </span>
  )
}

function GapChip({ leg }: { leg: TripLeg }) {
  const trike = leg.mode === "tricycle"
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
        trike ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700",
      )}
    >
      <span aria-hidden>{trike ? "🛺" : "🚶"}</span>
      <span className="sr-only">{trike ? "Tricycle" : "Walk"}</span>
      {formatDistance(leg.distanceKm)}
    </span>
  )
}

function LegRow({ legs }: { legs: TripLeg[] }) {
  let ordinal = -1
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {legs.map((leg, i) => {
        if (leg.mode !== "jeepney") return <GapChip key={i} leg={leg} />
        ordinal++
        return <Signboard key={i} name={leg.routeName ?? "Jeepney"} color={jeepneyColor(ordinal)} size="sm" />
      })}
    </span>
  )
}

function LegDetail({ leg, color, alternatives, fare }: { leg: TripLeg; color: string; alternatives: string[]; fare: FareConfig }) {
  return (
    <li className="relative flex gap-3 pb-3 last:pb-0">
      <span className="mt-1 size-3 shrink-0 rounded-full ring-2 ring-white" style={{ backgroundColor: color }} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug text-slate-900">{leg.instruction}</p>

        {leg.mode === "jeepney" ? (
          <p className="mt-0.5 text-xs text-slate-600">
            {formatDistance(leg.distanceKm)} · {formatDuration(leg.durationMin)} · {formatPhp(legFarePhp(leg, fare))}
            {(leg.terminalsCrossed ?? 0) > 0 && " · passes a terminal"}
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-slate-600">
            <span className={leg.recommendedMode === "walk" ? "font-semibold text-slate-800" : undefined}>
              Walk {formatDuration(leg.walkMin ?? leg.durationMin)}
            </span>
            {leg.showTricycleOption && leg.tricycleMin != null && (
              <>
                {" · "}
                <span className={leg.recommendedMode === "tricycle" ? "font-semibold text-amber-800" : undefined}>
                  tricycle {formatDuration(leg.tricycleMin)} (~{formatPhp(tricycleFarePhp(leg.distanceKm, fare))})
                </span>
              </>
            )}
          </p>
        )}

        {alternatives.length > 0 && <p className="mt-0.5 text-xs text-slate-600">Also goes there: {alternatives.join(", ")}</p>}
      </div>
    </li>
  )
}

function TripDetails({ trip, fare, total }: { trip: TripPlan; fare: FareConfig; total: number }) {
  let ordinal = -1
  return (
    <div className="border-t border-slate-200 px-3 pb-3 pt-3">
      <ol className="relative before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-0.5 before:bg-slate-200">
        {trip.legs.map((leg, i) => {
          if (leg.mode === "jeepney") ordinal++
          const color =
            leg.mode === "jeepney" ? jeepneyColor(ordinal) : leg.mode === "tricycle" ? TRICYCLE_COLOR : CONTEXT_COLOR
          return (
            <LegDetail
              key={i}
              leg={leg}
              color={color}
              alternatives={leg.mode === "jeepney" ? trip.alternativeRouteNames[ordinal] ?? [] : []}
              fare={fare}
            />
          )
        })}
      </ol>

      <p className="mt-3 text-xs text-slate-600">
        Ride {formatDistance(trip.totalRideKm)}
        {trip.totalWalkKm > 0 && ` · walk ${formatDistance(trip.totalWalkKm)}`}
        {trip.totalTricycleKm > 0 && ` · tricycle ${formatDistance(trip.totalTricycleKm)}`}
        {` · ${formatPhp(total)} estimated`}
      </p>

      {(trip.needsTricycleFirstMile || trip.needsTricycleLastMile || trip.needsTricycleTransfer) && (
        <p className="mt-2 flex gap-1.5 text-xs text-amber-900">
          <span aria-hidden>🛺</span>
          <span>
            {trip.needsTricycleFirstMile
              ? `The nearest jeepney stop is ${formatDistance(trip.legs[0].distanceKm)} away. A tricycle is easier than walking it.`
              : "One gap on this trip is far enough that a tricycle is easier than walking."}
          </span>
        </p>
      )}

      {trip.warnings.map((warning) => (
        <p key={warning} className="mt-2 flex gap-1.5 text-xs text-slate-700">
          <TriangleAlert className="mt-px size-3.5 shrink-0 text-amber-600" aria-hidden />
          <span>{warning}</span>
        </p>
      ))}
    </div>
  )
}

function FareField({
  label,
  value,
  step,
  suffix,
  positive,
  onCommit,
}: {
  label: string
  value: number
  step: number
  suffix: string
  positive?: boolean
  onCommit: (value: number) => void
}) {
  const [text, setText] = useState(String(value))
  const [syncedValue, setSyncedValue] = useState(value)
  const id = useId()

  // Follow outside changes such as Reset, but leave a half-typed value alone.
  if (syncedValue !== value) {
    setSyncedValue(value)
    if (Number(text) !== value || text === "") setText(String(value))
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-sm text-slate-700">
        {label}
      </label>
      <span className="flex items-center gap-1.5">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step={step}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            const next = Number(e.target.value)
            if (e.target.value !== "" && Number.isFinite(next) && (positive ? next > 0 : next >= 0)) onCommit(next)
          }}
          onBlur={() => setText(String(value))}
          className="h-11 w-24 rounded-md border border-slate-300 bg-white px-2 text-right text-sm tabular-nums focus-visible:border-[var(--dg-navy)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--dg-navy)]/25"
        />
        <span className="w-6 text-sm text-slate-600">{suffix}</span>
      </span>
    </div>
  )
}

function FareSettings({ fare, onFareChange, onFareReset, fareIsDefault }: Pick<TripPanelProps, "fare" | "onFareChange" | "onFareReset" | "fareIsDefault">) {
  const [open, setOpen] = useState(false)
  const regionId = useId()
  const set = (key: keyof FareConfig) => (value: number) => onFareChange({ ...fare, [key]: value })

  return (
    <div className="border-t border-slate-200 pt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center gap-2 rounded-md px-1 text-sm text-slate-700 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--dg-navy)]/40"
      >
        <Settings2 className="size-4" aria-hidden />
        Fare settings
        <ChevronDown className={cn("ml-auto size-4 transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      <div id={regionId} hidden={!open} className="space-y-2 px-1 pb-2 pt-1">
        <FareField label="Jeepney base fare" value={fare.jeepneyBasePhp} step={0.5} suffix="₱" onCommit={set("jeepneyBasePhp")} />
        <FareField label="Base fare covers" value={fare.jeepneyBaseKm} step={0.5} suffix="km" positive onCommit={set("jeepneyBaseKm")} />
        <FareField label="Each extra km" value={fare.jeepneyPerKmPhp} step={0.1} suffix="₱" onCommit={set("jeepneyPerKmPhp")} />
        <FareField label="Tricycle base" value={fare.tricycleBasePhp} step={1} suffix="₱" onCommit={set("tricycleBasePhp")} />
        <FareField label="Tricycle per km" value={fare.tricyclePerKmPhp} step={1} suffix="₱" onCommit={set("tricyclePerKmPhp")} />
        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-slate-600">Defaults follow the LTFRB fare from 28 Sept 2026. Estimates only.</p>
          <button
            type="button"
            onClick={onFareReset}
            disabled={fareIsDefault}
            className="min-h-11 shrink-0 rounded-md px-3 text-sm font-medium text-[var(--dg-navy)] hover:bg-slate-100 disabled:text-slate-400 disabled:hover:bg-transparent"
          >
            Reset to {formatPhp(DEFAULT_FARE.jeepneyBasePhp)} + {formatPhp(DEFAULT_FARE.jeepneyPerKmPhp)}/km
          </button>
        </div>
      </div>
    </div>
  )
}

function DiscountToggle({ fare, onFareChange }: Pick<TripPanelProps, "fare" | "onFareChange">) {
  const on = fare.discountPct > 0
  const labelId = useId()
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
      <span id={labelId} className="text-sm text-slate-800">
        Student, senior or PWD
        <span className="block text-xs text-slate-600">{CONCESSION_DISCOUNT_PCT}% off jeepney and tricycle fares</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={labelId}
        onClick={() => onFareChange({ ...fare, discountPct: on ? 0 : CONCESSION_DISCOUNT_PCT })}
        className="group inline-flex h-11 w-14 shrink-0 items-center justify-center rounded-full focus-visible:outline-none"
      >
        <span
          className={cn(
            "inline-flex h-7 w-12 items-center rounded-full transition-colors group-focus-visible:ring-[3px] group-focus-visible:ring-[var(--dg-navy)]/40",
            on ? "bg-[var(--dg-navy)]" : "bg-slate-300",
          )}
          aria-hidden
        >
          <span className={cn("ml-1 size-5 rounded-full bg-white shadow transition-transform", on && "translate-x-5")} />
        </span>
      </button>
    </div>
  )
}

function Notice({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h2 className="font-signboard text-2xl font-bold uppercase leading-none tracking-wide text-[var(--dg-ink)]">{title}</h2>
      <div className="text-sm leading-relaxed text-slate-700">{children}</div>
      {action}
    </div>
  )
}

export default function TripPanel(props: TripPanelProps) {
  const { destination, locationStatus, locationError, accuracyM, onRetryLocation, routesReady, trips, activeIndex, onSelect, fare, collapsed } = props
  const fares = useMemo(() => trips.map((trip) => planFarePhp(trip, fare)), [trips, fare])
  const fastest = trips.length > 0 ? Math.min(...trips.map((t) => t.totalDurationMin)) : 0
  const place = destination ? shortPlaceName(destination.name) : ""

  const retry = (
    <button
      type="button"
      onClick={onRetryLocation}
      className="mt-1 inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--dg-navy)] px-4 text-sm font-medium text-white hover:bg-[var(--dg-navy)]/90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--dg-navy)]/40"
    >
      <LocateFixed className="size-4" aria-hidden />
      Use my location
    </button>
  )

  if (!destination) {
    return (
      <Notice title="Where are you headed?">
        <p>Search any place in Davao City. You&apos;ll see which jeepney to ride from where you are, where to get on and off, and the fare.</p>
      </Notice>
    )
  }

  if (locationStatus === "error") {
    return (
      <Notice title="Your location is needed" action={retry}>
        <p>Routes start from where you are. {locationError}</p>
      </Notice>
    )
  }

  if (locationStatus === "pending" || !routesReady) {
    return (
      <Notice title="Finding your route">
        <p>{locationStatus === "pending" ? "Getting your location…" : "Loading jeepney routes…"}</p>
      </Notice>
    )
  }

  if (trips.length === 0) {
    return (
      <Notice title="No jeepney goes there">
        <p>
          No route in the data connects your location to <strong className="font-semibold">{place}</strong>, even with a {formatDistance(MAX_ACCESS_SEARCH_KM)} trip to the
          nearest stop and one transfer.
        </p>
      </Notice>
    )
  }

  const rough = accuracyM != null && accuracyM > ROUGH_ACCURACY_M

  return (
    <div className="space-y-3">
      <div className={cn(collapsed && "max-md:sr-only")}>
        <p className="text-xs font-medium uppercase tracking-wider text-slate-600">Ways to get to</p>
        <h2 className="truncate text-lg font-semibold text-[var(--dg-ink)]" title={destination.name}>
          {place}
        </h2>
        {rough && (
          <p className="mt-1 flex gap-1.5 text-xs text-amber-900">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            Your location is approximate (±{formatDistance(accuracyM / 1000)}), so boarding points may be off.
          </p>
        )}
      </div>

      <ul className="space-y-2" aria-label="Trip options">
        {trips.map((trip, index) => {
          const isActive = index === activeIndex
          return (
            <li
              key={trip.id}
              className={cn(
                "overflow-hidden rounded-xl border bg-white transition-colors",
                isActive ? "border-[var(--dg-navy)] shadow-[0_0_0_1px_var(--dg-navy)]" : "border-slate-200",
                collapsed && !isActive && "max-md:hidden",
              )}
            >
              <button
                type="button"
                aria-pressed={isActive}
                onClick={() => onSelect(index)}
                className="block w-full p-3 text-left hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none"
              >
                <span className="flex items-baseline gap-2">
                  <span className="text-xl font-semibold tabular-nums text-[var(--dg-ink)]">{formatDuration(trip.totalDurationMin)}</span>
                  <span className="text-base tabular-nums text-slate-700">
                    {formatPhp(fares[index])}
                    {fare.discountPct > 0 && <span className="ml-1 text-xs font-medium text-[var(--dg-navy)]">
                        <span aria-hidden>−{fare.discountPct}%</span>
                        <span className="sr-only">with {fare.discountPct}% discount</span>
                      </span>}
                  </span>
                  <span className="ml-auto flex gap-1.5">
                    {trips.length > 1 && trip.totalDurationMin === fastest && (
                      <span className="rounded-full bg-[var(--dg-navy)] px-2 py-0.5 text-xs font-medium text-white">Fastest</span>
                    )}
                    <span className="rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-700">{planBadge(trip)}</span>
                  </span>
                </span>
                <span className="mt-2 block">
                  <LegRow legs={trip.legs} />
                </span>
              </button>

              {isActive && (
                <div className={cn(collapsed && "max-md:hidden")}>
                  <TripDetails trip={trip} fare={fare} total={fares[index]} />
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <div className={cn("space-y-2", collapsed && "max-md:hidden")}>
        <DiscountToggle fare={fare} onFareChange={props.onFareChange} />
        <FareSettings {...props} />
      </div>
    </div>
  )
}
