"use client"

import { ArrowUpDown, LocateFixed } from "lucide-react"
import type { LocationStatus } from "@/lib/use-user-location"
import { cn, shortPlaceName } from "@/lib/utils"

interface OriginBarProps {
  /** Hand-set start, or null when the trip starts from GPS. */
  manualName: string | null
  gpsStatus: LocationStatus
  canSwap: boolean
  onUseGps: () => void
  onSwap: () => void
}

const iconButton =
  "flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--dg-navy)] hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--dg-navy)]/40"

// Shows where the trip starts, with a way back to GPS and a from/to swap.
export default function OriginBar({ manualName, gpsStatus, canSwap, onUseGps, onSwap }: OriginBarProps) {
  const label = manualName
    ? shortPlaceName(manualName)
    : gpsStatus === "ready"
      ? "Your location"
      : gpsStatus === "error"
        ? "Location off. Long-press the map to set a start."
        : "Finding your location…"
  return (
    <div className="flex h-11 items-center rounded-full bg-white/95 pl-4 shadow-md ring-1 ring-black/10 backdrop-blur md:bg-slate-50 md:shadow-none">
      <span className={cn("size-2.5 shrink-0 rounded-full ring-2 ring-white", manualName ? "bg-[var(--dg-navy)]" : "bg-[#4285F4]")} aria-hidden />
      <p className="min-w-0 flex-1 truncate px-2.5 text-sm text-slate-700">
        <span className="text-slate-500">From </span>
        <span className="font-medium text-[var(--dg-ink)]" title={manualName ?? undefined}>
          {label}
        </span>
      </p>
      {manualName && (
        <button type="button" onClick={onUseGps} aria-label="Start from my location" className={iconButton}>
          <LocateFixed className="size-5" aria-hidden />
        </button>
      )}
      <button type="button" onClick={onSwap} disabled={!canSwap} aria-label="Swap start and destination" className={iconButton}>
        <ArrowUpDown className="size-5" aria-hidden />
      </button>
    </div>
  )
}
