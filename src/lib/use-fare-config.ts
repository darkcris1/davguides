"use client"

import { useCallback, useEffect, useState } from "react"
import { DEFAULT_FARE, type FareConfig } from "./transport-config"

const STORAGE_KEY = "davguides.fare"

function sanitize(raw: unknown): FareConfig {
  if (!raw || typeof raw !== "object") return DEFAULT_FARE
  const input = raw as Partial<Record<keyof FareConfig, unknown>>
  const merged = { ...DEFAULT_FARE }

  for (const key of Object.keys(DEFAULT_FARE) as (keyof FareConfig)[]) {
    const value = Number(input[key])
    if (Number.isFinite(value) && value >= 0) merged[key] = value
  }

  // A zero base distance or rounding step would make every fare nonsense.
  if (merged.jeepneyBaseKm <= 0) merged.jeepneyBaseKm = DEFAULT_FARE.jeepneyBaseKm
  if (merged.roundToPhp <= 0) merged.roundToPhp = DEFAULT_FARE.roundToPhp

  return merged
}

/**
 * The rider's fare settings, persisted locally.
 *
 * Fares are display-only — they never reach the trip optimizer — so editing them
 * re-prices the existing plans instead of triggering a new search.
 */
export function useFareConfig() {
  const [fare, setFareState] = useState<FareConfig>(DEFAULT_FARE)

  // Read on mount rather than in the initializer, so the server and the first
  // client render agree.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored) setFareState(sanitize(JSON.parse(stored)))
    } catch {
      // Corrupt or unavailable storage just means defaults.
    }
  }, [])

  const setFare = useCallback((next: FareConfig | ((previous: FareConfig) => FareConfig)) => {
    setFareState((previous) => {
      const resolved = sanitize(typeof next === "function" ? next(previous) : next)
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(resolved))
      } catch {
        // Non-fatal: the setting just will not survive a reload.
      }
      return resolved
    })
  }, [])

  const reset = useCallback(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Ignored, same reason as above.
    }
    setFareState(DEFAULT_FARE)
  }, [])

  const isDefault = (Object.keys(DEFAULT_FARE) as (keyof FareConfig)[]).every(
    (key) => fare[key] === DEFAULT_FARE[key],
  )

  return { fare, setFare, reset, isDefault }
}
