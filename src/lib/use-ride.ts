"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { rideProgress, type RideProgress } from "./ride-progress"
import type { TripPlan } from "./route-engine"

export interface RideState {
  /** Frozen at start, so a replan never swaps the trip mid-ride. */
  trip: TripPlan
  destinationName: string
  position: { lat: number; lng: number } | null
  accuracyM: number | null
  progress: RideProgress | null
  error: string | null
}

const WATCH_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 }

type WakeLockSentinelLike = { release: () => Promise<void> }
type WakeLockNavigator = Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> } }

// Keeps the screen on while riding, so the get-off alert is seen; silently skipped where unsupported.
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    const nav = navigator as WakeLockNavigator
    let sentinel: WakeLockSentinelLike | null = null
    let cancelled = false
    const acquire = () => {
      if (document.visibilityState !== "visible" || !nav.wakeLock) return
      nav.wakeLock
        .request("screen")
        .then((lock) => {
          if (cancelled) lock.release().catch(() => {})
          else sentinel = lock
        })
        .catch(() => {})
    }
    // The browser drops the lock when the tab hides, so take it again on return.
    acquire()
    document.addEventListener("visibilitychange", acquire)
    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", acquire)
      sentinel?.release().catch(() => {})
    }
  }, [active])
}

const vibrate = (pattern: number | number[]) => navigator.vibrate?.(pattern)

export function useRide() {
  const [ride, setRide] = useState<RideState | null>(null)
  const lastRef = useRef<{ step: number; doneKm: number } | null>(null)
  const alertedRef = useRef<{ step: number; soon: boolean; arrived: boolean }>({ step: 0, soon: false, arrived: false })
  const trip = ride?.trip ?? null

  useEffect(() => {
    if (!trip) return
    lastRef.current = null
    alertedRef.current = { step: 0, soon: false, arrived: false }

    const id = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const position = { lat: coords.latitude, lng: coords.longitude }
        const progress = rideProgress(trip, position, lastRef.current)
        // Once arrived, stay arrived even if GPS drifts.
        const alerted = alertedRef.current
        if (alerted.arrived) progress.arrived = true
        lastRef.current = { step: progress.step, doneKm: progress.doneKm }

        if (progress.arrived && !alerted.arrived) vibrate([200, 100, 200])
        else if (progress.alightSoon && !(alerted.soon && alerted.step === progress.step)) vibrate([300, 150, 300, 150, 300])
        else if (progress.step !== alerted.step) vibrate(80)
        alertedRef.current = {
          step: progress.step,
          soon: progress.alightSoon || (alerted.soon && alerted.step === progress.step),
          arrived: progress.arrived || alerted.arrived,
        }

        setRide((current) => (current?.trip === trip ? { ...current, position, accuracyM: coords.accuracy, progress, error: null } : current))
      },
      (err) => {
        const error =
          err.code === err.PERMISSION_DENIED ? "Location access was turned off, so the ride can't follow you." : "Lost your GPS signal. The guide will catch up when it's back."
        setRide((current) => (current?.trip === trip ? { ...current, error } : current))
      },
      WATCH_OPTIONS,
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [trip])

  useWakeLock(trip != null)

  const start = useCallback((next: TripPlan, destinationName: string, position: { lat: number; lng: number } | null, accuracyM: number | null) => {
    setRide({ trip: next, destinationName, position, accuracyM, progress: position ? rideProgress(next, position, null) : null, error: null })
  }, [])
  const stop = useCallback(() => setRide(null), [])

  return { ride, start, stop }
}
