// Where a rider is along a frozen trip: which leg, how far to its end, and when to get off.

import { haversineKm, planarFrame, projectPointOnSegment, type LatLng } from "./geo"
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
/** Progress may slip back this much on GPS noise, and jump ahead this much between fixes. */
const BACKTRACK_KM = 0.1
const MAX_JUMP_KM = 1.5
/** A match inside the progress window wins over a closer one elsewhere on the leg. */
const WINDOW_MATCH_KM = 0.1

export interface RideProgress {
  step: number
  /** Distance done along the current leg's line, km; feeds the next fix. */
  doneKm: number
  /** Distance left along the current leg's line, km. */
  remainingKm: number
  /** Straight-line gap from the rider to the current leg's line, km. */
  offLegKm: number
  /** On a jeepney leg, still at the stop. */
  waiting: boolean
  alightSoon: boolean
  arrived: boolean
}

// Legs are frozen for the ride, so their cumulative lengths are worked out once.
const cumCache = new WeakMap<[number, number][], Float64Array>()
function cumOf(path: [number, number][]): Float64Array {
  let cum = cumCache.get(path)
  if (!cum) {
    cum = new Float64Array(path.length)
    for (let i = 1; i < path.length; i++) cum[i] = cum[i - 1] + haversineKm(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1])
    cumCache.set(path, cum)
  }
  return cum
}

interface Along {
  doneKm: number
  remainingKm: number
  offKm: number
  totalKm: number
}

// Snaps the rider onto the line near their last progress, so an out-and-back road can't skip them ahead.
function alongPath(path: [number, number][], pos: LatLng, nearKm: number | null): Along {
  const cum = cumOf(path)
  const totalKm = cum[cum.length - 1] ?? 0
  if (path.length < 2) {
    const off = path[0] ? haversineKm(pos.lat, pos.lng, path[0][0], path[0][1]) : 0
    return { doneKm: 0, remainingKm: off, offKm: off, totalKm }
  }
  const frame = planarFrame(pos.lat)
  const lo = nearKm == null ? Number.NEGATIVE_INFINITY : nearKm - BACKTRACK_KM
  const hi = nearKm == null ? Number.POSITIVE_INFINITY : nearKm + MAX_JUMP_KM
  let best = { offKm: Number.POSITIVE_INFINITY, doneKm: 0 }
  let inWindow = { offKm: Number.POSITIVE_INFINITY, doneKm: 0 }
  for (let i = 0; i < path.length - 1; i++) {
    const [aLat, aLng] = path[i]
    const [bLat, bLng] = path[i + 1]
    const p = projectPointOnSegment(frame, pos.lat, pos.lng, aLat, aLng, bLat, bLng)
    const doneKm = cum[i] + p.t * (cum[i + 1] - cum[i])
    if (p.distKm < best.offKm) best = { offKm: p.distKm, doneKm }
    if (cum[i + 1] >= lo && cum[i] <= hi && p.distKm < inWindow.offKm) inWindow = { offKm: p.distKm, doneKm }
  }
  const pick = inWindow.offKm <= WINDOW_MATCH_KM ? inWindow : best
  return { doneKm: pick.doneKm, remainingKm: Math.max(0, totalKm - pick.doneKm), offKm: pick.offKm, totalKm }
}

export function rideProgress(trip: TripPlan, pos: LatLng, previous: { step: number; doneKm: number } | null): RideProgress {
  let step = Math.min(previous?.step ?? 0, trip.legs.length - 1)
  const startStep = step

  // Boarding early or walking past a stop shouldn't leave the guide stuck on an old leg.
  for (let j = trip.legs.length - 1; j > step; j--) {
    const ahead = alongPath(trip.legs[j].path, pos, 0)
    if (ahead.offKm <= ON_LEG_KM && ahead.totalKm - ahead.remainingKm >= SKIP_AHEAD_KM) {
      step = j
      break
    }
  }

  // A new leg starts near its beginning; the same leg carries on from the last fix.
  const near = (s: number) => (s === startStep && previous ? previous.doneKm : 0)
  let at = alongPath(trip.legs[step].path, pos, near(step))
  while (at.remainingKm <= ARRIVE_KM && step < trip.legs.length - 1) {
    step++
    at = alongPath(trip.legs[step].path, pos, near(step))
  }

  const leg = trip.legs[step]
  const last = step === trip.legs.length - 1
  const jeep = leg.mode === "jeepney"
  // Once moving on this leg, noise near the stop shouldn't flip back to "wait here".
  const leftStop = step === startStep && previous != null && previous.doneKm > WAITING_KM
  const waiting = jeep && !leftStop && at.doneKm <= WAITING_KM
  return {
    step,
    doneKm: at.doneKm,
    remainingKm: at.remainingKm,
    offLegKm: at.offKm,
    waiting,
    // A short leg shouldn't say "get off" while the rider is still at the stop.
    alightSoon: jeep && !waiting && at.remainingKm <= ALIGHT_WARNING_KM,
    arrived: last && at.remainingKm <= ARRIVE_KM,
  }
}
