"use client"

import { useCallback, useEffect, useRef, useState } from "react"
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
  merged.discountPct = Math.min(100, merged.discountPct)

  return merged
}

// Fares are display-only, so editing them re-prices plans without a new search.
export function useFareConfig() {
  const [fare, setFareState] = useState<FareConfig>(DEFAULT_FARE)
  // Only persist after the rider edits, so a fresh visit never writes defaults.
  const dirtyRef = useRef(false)

  // Read on mount so the server and first client render agree.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored) setFareState(sanitize(JSON.parse(stored)))
    } catch {
      // Corrupt or blocked storage just means defaults.
    }
  }, [])

  useEffect(() => {
    if (!dirtyRef.current) return
    try {
      // Store only overrides, so future default fares still reach the rider.
      const overrides = Object.fromEntries(Object.entries(fare).filter(([key, value]) => DEFAULT_FARE[key as keyof FareConfig] !== value))
      if (Object.keys(overrides).length === 0) window.localStorage.removeItem(STORAGE_KEY)
      else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
    } catch {
      // Non-fatal: the setting won't survive a reload.
    }
  }, [fare])

  const setFare = useCallback((next: FareConfig | ((previous: FareConfig) => FareConfig)) => {
    dirtyRef.current = true
    setFareState((previous) => sanitize(typeof next === "function" ? next(previous) : next))
  }, [])

  // Resets the fare table but keeps the rider's discount choice.
  const reset = useCallback(() => {
    setFare((previous) => ({ ...DEFAULT_FARE, discountPct: previous.discountPct }))
  }, [setFare])

  const isDefault = (Object.keys(DEFAULT_FARE) as (keyof FareConfig)[]).every(
    (key) => key === "discountPct" || fare[key] === DEFAULT_FARE[key],
  )

  return { fare, setFare, reset, isDefault }
}
