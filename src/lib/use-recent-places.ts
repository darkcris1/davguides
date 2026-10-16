"use client"

import { useCallback, useSyncExternalStore } from "react"
import type { Location } from "@/commons/models/maps"
import { haversineKm } from "./geo"

const STORAGE_KEY = "davguides.recent"
const MAX_RECENT = 5
// Picks this close together count as the same place.
const SAME_PLACE_KM = 0.05

const EMPTY: Location[] = []
const listeners = new Set<() => void>()
let current: Location[] | null = null

function isLocation(value: unknown): value is Location {
  const v = value as Location
  return !!v && typeof v.name === "string" && Number.isFinite(v.lat) && Number.isFinite(v.lng)
}

function load(): Location[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")
    return Array.isArray(parsed) ? parsed.filter(isLocation).slice(0, MAX_RECENT) : EMPTY
  } catch {
    return EMPTY
  }
}

function getSnapshot(): Location[] {
  current ??= load()
  return current
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
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

function write(next: Location[]) {
  current = next
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Non-fatal: recents just won't survive a reload.
  }
  listeners.forEach((listener) => listener())
}

export function useRecentPlaces() {
  const recent = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY)

  const remember = useCallback((place: Location) => {
    const others = getSnapshot().filter((p) => haversineKm(p.lat, p.lng, place.lat, place.lng) > SAME_PLACE_KM)
    write([{ lat: place.lat, lng: place.lng, name: place.name }, ...others].slice(0, MAX_RECENT))
  }, [])

  return { recent, remember }
}
