// Where a rider is along a frozen trip: which leg, how far to its end, and when to get off.

import { haversineKm, pathKm, planarFrame, projectPointOnSegment, type LatLng } from "./geo"
import type { TripPlan } from "./route-engine"

/** Within this of a leg's end, the leg counts as done. */
export const ARRIVE_KM = 0.04
/** Warn the rider this far before their drop-off. */
export const ALIGHT_WARNING_KM = 0.25
/** This far past a later leg's start, on its line, the rider has skipped ahead. */
const SKIP_AHEAD_KM = 0.1
/** Closer than this to a leg's line counts as being on it. */
const ON_LEG_KM = 0.03
/** Still within this of the boarding point means the rider is waiting, not riding. */
const WAITING_KM = 0.05

export interface RideProgress {
  step: number
  /** Distance left along the current leg's line, km. */
  remainingKm: number
  /** Straight-line gap from the rider to the current leg's line, km. */
  offLegKm: number
  /** On a jeepney leg, still at the stop. */
  waiting: boolean
  alightSoon: boolean
  arrived: boolean
}

// Snaps the rider onto the line and measures what is left of it from there.
function alongPath(path: [number, number][], pos: LatLng): { remainingKm: number; offKm: number; totalKm: number } {
  const totalKm = pathKm(path)
  if (path.length < 2) {
    const off = path[0] ? haversineKm(pos.lat, pos.lng, path[0][0], path[0][1]) : 0
    return { remainingKm: off, offKm: off, totalKm }
  }
  const frame = planarFrame(pos.lat)
  let best = { offKm: Number.POSITIVE_INFINITY, doneKm: 0 }
  let doneKm = 0
  for (let i = 0; i < path.length - 1; i++) {
    const [aLat, aLng] = path[i]
    const [bLat, bLng] = path[i + 1]
    const segKm = haversineKm(aLat, aLng, bLat, bLng)
    const p = projectPointOnSegment(frame, pos.lat, pos.lng, aLat, aLng, bLat, bLng)
    if (p.distKm < best.offKm) best = { offKm: p.distKm, doneKm: doneKm + p.t * segKm }
    doneKm += segKm
  }
  return { remainingKm: Math.max(0, totalKm - best.doneKm), offKm: best.offKm, totalKm }
}

export function rideProgress(trip: TripPlan, pos: LatLng, previousStep: number): RideProgress {
  let step = Math.min(previousStep, trip.legs.length - 1)

  // Boarding early or walking past a stop shouldn't leave the guide stuck on an old leg.
  for (let j = trip.legs.length - 1; j > step; j--) {
    const ahead = alongPath(trip.legs[j].path, pos)
    if (ahead.offKm <= ON_LEG_KM && ahead.totalKm - ahead.remainingKm >= SKIP_AHEAD_KM) {
      step = j
      break
    }
  }

  let at = alongPath(trip.legs[step].path, pos)
  while (at.remainingKm <= ARRIVE_KM && step < trip.legs.length - 1) {
    step++
    at = alongPath(trip.legs[step].path, pos)
  }

  const leg = trip.legs[step]
  const last = step === trip.legs.length - 1
  const jeep = leg.mode === "jeepney"
  const waiting = jeep && at.totalKm - at.remainingKm <= WAITING_KM
  return {
    step,
    remainingKm: at.remainingKm,
    offLegKm: at.offKm,
    waiting,
    // A short leg shouldn't say "get off" while the rider is still at the stop.
    alightSoon: jeep && !waiting && at.remainingKm <= ALIGHT_WARNING_KM,
    arrived: last && at.remainingKm <= ARRIVE_KM,
  }
}
