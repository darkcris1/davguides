"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import type { UserLocation } from "@/commons/models/maps"
import { haversineKm } from "./geo"

export type LocationStatus = "pending" | "ready" | "error"

export interface UserLocationState {
  location: UserLocation | null
  status: LocationStatus
  /** Plain-language reason when status is "error". */
  error: string | null
  /** Metres; null until the first fix. */
  accuracyM: number | null
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

const UNSUPPORTED_ERROR = "This browser can't share your location."
const noSubscribe = () => () => {}

export function useUserLocation(): UserLocationState {
  const [location, setLocation] = useState<UserLocation | null>(null)
  const [status, setStatus] = useState<LocationStatus>("pending")
  const [error, setError] = useState<string | null>(null)
  const [accuracyM, setAccuracyM] = useState<number | null>(null)
  const locationRef = useRef<UserLocation | null>(null)
  const supported = useSyncExternalStore(noSubscribe, () => typeof navigator.geolocation?.getCurrentPosition === "function", () => true)

  // Only sets state from the geolocation callbacks, never synchronously.
  const locate = useCallback(() => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const previous = locationRef.current
        const moved = !previous || haversineKm(previous.lat, previous.lng, coords.latitude, coords.longitude) >= MIN_MOVE_KM
        if (moved) {
          locationRef.current = { lat: coords.latitude, lng: coords.longitude }
          setLocation(locationRef.current)
        }
        setAccuracyM(coords.accuracy)
        setError(null)
        setStatus("ready")
      },
      (err) => {
        // A failed refresh keeps the last good fix, unless access was revoked.
        if (locationRef.current && err.code !== err.PERMISSION_DENIED) return
        setError(describeError(err))
        setStatus("error")
      },
      POSITION_OPTIONS,
    )
  }, [])

  const request = useCallback(() => {
    if (!supported) return
    if (!locationRef.current) setStatus("pending")
    locate()
  }, [supported, locate])

  useEffect(() => {
    if (supported) locate()
  }, [supported, locate])

  if (!supported) return { location: null, status: "error", error: UNSUPPORTED_ERROR, accuracyM: null, request }
  return { location, status, error, accuracyM, request }
}
