"use client"

import { useCallback, useEffect, useRef, useState } from "react"
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
  if (error.code === error.PERMISSION_DENIED) return "Location access is off. Allow it in your browser settings, then tap Locate."
  if (error.code === error.TIMEOUT) return "Finding your location took too long. Tap Locate to try again."
  return "Your device couldn't get a location fix. Turn on GPS or move near a window, then tap Locate."
}

export function useUserLocation(): UserLocationState {
  const [location, setLocation] = useState<UserLocation | null>(null)
  const [status, setStatus] = useState<LocationStatus>("pending")
  const [error, setError] = useState<string | null>(null)
  const [accuracyM, setAccuracyM] = useState<number | null>(null)
  const locationRef = useRef<UserLocation | null>(null)

  const request = useCallback(() => {
    if (!navigator.geolocation) {
      setStatus("error")
      setError("This browser can't share your location.")
      return
    }
    if (!locationRef.current) setStatus("pending")

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
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    )
  }, [])

  useEffect(() => {
    request()
  }, [request])

  return { location, status, error, accuracyM, request }
}
