"use client"

import { useCallback, useSyncExternalStore } from "react"
import { DEFAULT_FARE, FARE_SETTINGS_ENABLED, type FareConfig } from "./transport-config"

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
  if (merged.tricycleBaseKm <= 0) merged.tricycleBaseKm = DEFAULT_FARE.tricycleBaseKm
  if (merged.roundToPhp <= 0) merged.roundToPhp = DEFAULT_FARE.roundToPhp
  merged.discountPct = Math.min(100, merged.discountPct)

  return merged
}

const listeners = new Set<() => void>()
let current: FareConfig | null = null

function load(): FareConfig {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    const fare = stored ? sanitize(JSON.parse(stored)) : DEFAULT_FARE
    return FARE_SETTINGS_ENABLED ? fare : { ...DEFAULT_FARE, discountPct: fare.discountPct }
  } catch {
    // Corrupt or blocked storage just means defaults.
    return DEFAULT_FARE
  }
}

function getSnapshot(): FareConfig {
  current ??= load()
  return current
}

function getServerSnapshot(): FareConfig {
  return DEFAULT_FARE
}

function subscribe(listener: () => void) {
  // Edits made in another tab show up here too.
  const onStorage = (event: StorageEvent) => {
    // A null key means another tab cleared storage.
    if (event.key !== STORAGE_KEY && event.key !== null) return
    current = load()
    listener()
  }
  listeners.add(listener)
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

// Custom rates stored before fare editing was hidden, so a discount toggle doesn't wipe them.
function savedRates(): Partial<FareConfig> {
  try {
    const rates = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<FareConfig>
    delete rates.discountPct
    return rates
  } catch {
    return {}
  }
}

function write(next: FareConfig) {
  current = next
  try {
    // Store only overrides, so future default fares still reach the rider.
    const changed = Object.fromEntries(Object.entries(next).filter(([key, value]) => DEFAULT_FARE[key as keyof FareConfig] !== value))
    const overrides = FARE_SETTINGS_ENABLED ? changed : { ...savedRates(), ...changed }
    if (Object.keys(overrides).length === 0) window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
  } catch {
    // Non-fatal: the setting won't survive a reload.
  }
  listeners.forEach((listener) => listener())
}

// Fares are display-only, so editing them re-prices plans without a new search.
export function useFareConfig() {
  const fare = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const setFare = useCallback((next: FareConfig | ((previous: FareConfig) => FareConfig)) => {
    write(sanitize(typeof next === "function" ? next(getSnapshot()) : next))
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
