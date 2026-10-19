"use client"

import { useEffect, useId, useRef } from "react"
import { Loader2, LocateFixed } from "lucide-react"
import LocationHelp from "@/components/location-help"
import { formatDistance } from "@/lib/geo"

interface PreciseLocationPromptProps {
  /** Why there is no usable fix: blocked, no signal, no browser support, or too rough. */
  reason: "denied" | "unavailable" | "unsupported" | "approximate"
  accuracyM: number | null
  checking: boolean
  requiredM: number
  onRetry: () => void
  onClose: () => void
}

// Asks for precise location before a ride, with device steps for turning it on.
export default function PreciseLocationPrompt({ reason, accuracyM, checking, requiredM, onRetry, onClose }: PreciseLocationPromptProps) {
  const titleId = useId()
  const bodyId = useId()
  const retryRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    retryRef.current?.focus()
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  const rough = accuracyM != null ? formatDistance(accuracyM / 1000) : null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:items-center" onClick={onClose}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl"
      >
        <div className="mb-2 flex size-11 items-center justify-center rounded-full bg-[var(--dg-navy)]/10 text-[var(--dg-navy)]">
          <LocateFixed className="size-5" aria-hidden />
        </div>
        <h2 id={titleId} className="font-signboard text-2xl font-bold uppercase tracking-wide text-[var(--dg-ink)]">
          {reason === "denied" ? "Turn on location to ride" : reason === "approximate" ? "Precise location needed" : "No GPS fix yet"}
        </h2>
        <p id={bodyId} className="mt-1 text-sm text-slate-700">
          {reason === "denied"
            ? "Start ride follows you along the trip and tells you when to get off. Allow location for this site, with precise location on."
            : reason === "unavailable"
              ? "Your device couldn't find where you are. Turn on GPS and go outdoors or near a window, then try again."
              : reason === "unsupported"
                ? "This browser can't share your location. Open DavGuides in Chrome or Safari to ride."
                : `Your location is only accurate to about ${rough ?? "a few km"}. Start ride needs it within ${requiredM} m to tell you when to get off. Turn on precise location, then try again.`}
        </p>

        <div className="mt-3">
          <LocationHelp defaultOpen />
        </div>

        <p role="status" aria-live="polite" className="mt-2 min-h-5 text-xs text-slate-600">
          {checking ? "Checking your location…" : ""}
        </p>

        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 flex-1 rounded-full border border-slate-300 px-4 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--dg-navy)]/40"
          >
            Not now
          </button>
          <button
            ref={retryRef}
            type="button"
            onClick={onRetry}
            disabled={checking}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-[var(--dg-navy)] px-4 text-sm font-semibold text-white hover:bg-[var(--dg-navy)]/90 disabled:opacity-70 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--dg-yellow)]"
          >
            {checking && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Try again
          </button>
        </div>
      </div>
    </div>
  )
}
