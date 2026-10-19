"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import type { UserLocation } from "@/commons/models/maps"
import { haversineKm } from "./geo"

export type LocationStatus = "pending" | "ready" | "error"
export type LocationErrorKind = "denied" | "unavailable" | "unsupported"

export interface UserLocationState {
  location: UserLocation | null
  status: LocationStatus
  /** Plain-language reason when status is "error". */
  error: string | null
  errorKind: LocationErrorKind | null
  /** Metres; null until the first fix. */
  accuracyM: number | null
  /** A requested fix is on its way, even while an older one is shown. */
  refreshing: boolean
  request: () => void
}

// Moves smaller than this keep the old object, so trips aren't replanned on GPS jitter.
const MIN_MOVE_KM = 0.02

function describeError(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED) return "Location access is off. Allow it in your browser settings, then tap Use my location."
  if (error.code === error.TIMEOUT) return "Finding your location took too long. Tap Use my location to try again."
  return "Your device couldn't get a location fix. Turn on GPS or move near a window, then tap Use my location."
}

const POSITION_OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 }
// A tap means the rider wants a new reading, such as after turning on precise location.
const FRESH_OPTIONS: PositionOptions = { ...POSITION_OPTIONS, maximumAge: 0 }

const UNSUPPORTED_ERROR = "This browser can't share your location."
const noSubscribe = () => () => {}

export function useUserLocation(): UserLocationState {
  const [location, setLocation] = useState<UserLocation | null>(null)
  const [status, setStatus] = useState<LocationStatus>("pending")
  const [error, setError] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<LocationErrorKind | null>(null)
  const [accuracyM, setAccuracyM] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const locationRef = useRef<UserLocation | null>(null)
  const supported = useSyncExternalStore(noSubscribe, () => typeof navigator.geolocation?.getCurrentPosition === "function", () => true)

  // Only sets state from the geolocation callbacks, never synchronously.
  const locate = useCallback((options: PositionOptions) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const previous = locationRef.current
        const moved = !previous || haversineKm(previous.lat, previous.lng, coords.latitude, coords.longitude) >= MIN_MOVE_KM
        if (moved) {
          locationRef.current = { lat: coords.latitude, lng: coords.longitude }
          setLocation(locationRef.current)
        }
        setAccuracyM(coords.accuracy)
        setRefreshing(false)
        setError(null)
        setErrorKind(null)
        setStatus("ready")
      },
      (err) => {
        setRefreshing(false)
        // A failed refresh keeps the last good fix, unless access was revoked.
        if (locationRef.current && err.code !== err.PERMISSION_DENIED) return
        setError(describeError(err))
        setErrorKind(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable")
        setStatus("error")
      },
      options,
    )
  }, [])

  const request = useCallback(() => {
    if (!supported) return
    if (!locationRef.current) setStatus("pending")
    setRefreshing(true)
    locate(FRESH_OPTIONS)
  }, [supported, locate])

  useEffect(() => {
    if (supported) locate(POSITION_OPTIONS)
  }, [supported, locate])

  if (!supported) return { location: null, status: "error", error: UNSUPPORTED_ERROR, errorKind: "unsupported", accuracyM: null, refreshing: false, request }
  return { location, status, error, errorKind, accuracyM, refreshing, request }
}
