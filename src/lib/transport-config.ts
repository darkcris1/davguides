// Every planner tunable; THRESHOLDS feed the optimizer, FareConfig is display-only.

import type { TripLeg, TripPlan } from "@/lib/route-engine"

export const THRESHOLDS = {
  /** Urban walking with crossings. */
  WALK_SPEED_KMH: 4.5,
  /** Davao urban jeepney including stops. */
  JEEP_SPEED_KMH: 18,
  /** Short barangay tricycle hop. */
  TRICYCLE_SPEED_KMH: 15,

  /** Above this gap, show the tricycle option alongside walking. */
  TRICYCLE_SHOW_KM: 0.3,
  /** Above this gap, recommend the tricycle. The user's 500 m rule. */
  TRICYCLE_TRIGGER_KM: 0.5,
  /** Hailing and haggling. */
  TRICYCLE_WAIT_MIN: 3,
  /** Trips up to this straight-line length also get a door-to-door tricycle plan. */
  TRICYCLE_DIRECT_MAX_KM: 3,
  /** Keeps a plan from winning only because it assumed a long walk. */
  LONG_WALK_PENALTY_MIN_PER_KM: 6,

  /** Solve at each radius in turn and stop once enough plans exist. */
  CANDIDATE_RADIUS_TIERS_KM: [0.5, 0.8, 1.5, 2.5],
  /** Above this, an access leg must be flagged as needing a tricycle. */
  MAX_ACCESS_WALK_KM: 1.2,
  /** Transfer gap ceiling. The 0.5-0.8 km band is allowed but tricycle-flagged. */
  MAX_TRANSFER_WALK_KM: 0.8,
  /** Arc-based dedupe keeps both directions of a loop; past ~1.5 km it merges them. */
  CANDIDATE_ARC_SEPARATION_KM: 0.4,
  MAX_CANDIDATES_PER_SIDE: 8,

  /** Shorter than this, walking beats waiting for a jeep. */
  MIN_RIDE_KM: 0.4,
  /** Longest route in the dataset is Calinan at ~59 km. */
  MAX_RIDE_KM: 45,

  /** First and last vertex within this distance means the route is a closed ring. */
  LOOP_CLOSE_TOLERANCE_KM: 0.02,
  /** Layover cost per terminal crossed, so the long way round a loop isn't free. */
  TERMINAL_LAYOVER_PENALTY_MIN: 8,
  /** Riding a one-way-mapped route against its drawn direction. */
  REVERSED_RIDE_PENALTY_MIN: 2,
  /** Route drawn with too few points to trust its path or length. */
  COARSE_ROUTE_PENALTY_MIN: 2,

  /** Rush-hour windows, Davao time, when outbound jeeps fill up at their loading hub. */
  PEAK_HOURS_MANILA: [[5, 8], [17, 20]] as [number, number][],
  /** Expected wait for a seat when transferring onto a jeep well past its hub at rush hour. */
  FULL_JEEP_PENALTY_MIN: 15,
  /** Boarding this far past the hub still counts as boarding at the hub. */
  HUB_BOARDING_FREE_KM: 0.5,
  /** A route must pass this close to a hub for the hub to apply to it. */
  HUB_MATCH_KM: 0.5,
  /** A loop turnaround this far past its hub moves onto the hub. */
  HUB_TURNAROUND_SNAP_KM: 1.5,

  /** Typical wait for a route that rarely passes, replacing the normal boarding wait. */
  INFREQUENT_WAIT_MIN: 15,
  /** Plans costing this much more than the best are dropped as noise. */
  MAX_EXTRA_COST_MIN: 20,
  /** A tricycle-access plan must beat the best walkable plan by this much to be shown. */
  TRICYCLE_DETOUR_MIN_SAVING_MIN: 10,
  /** Reject rides that circle most of a loop to get somewhere. */
  MAX_RIDE_ARC_FRACTION: 0.75,

  BOARD_WAIT_MIN: 4,
  /** Higher than BOARD_WAIT_MIN so a direct ride beats an equal-length transfer. */
  TRANSFER_WAIT_MIN: 5,

  /** Only search for transfers when the best direct trip is this slow, or absent. */
  TRANSFER_SEARCH_TRIGGER_MIN: 25,
  /** ...and only when this much slower than the straight-line best at jeep speed. */
  TRANSFER_SEARCH_SLACK: 1.5,
  /** Board-side x alight-side routes considered, so at most 36 pairs. */
  MAX_TRANSFER_ROUTE_FANOUT: 6,
  MAX_TRANSFER_POINTS_PER_PAIR: 8,
  /** 2 = at most one transfer. 1280 of 1292 route pairs already meet within 150 m. */
  MAX_LEGS: 2,

  MAX_RESULTS: 5,
  MIN_ACCEPTABLE_RESULTS: 3,
  /** Only plans riding within this multiple of straight-line distance count toward stopping. */
  ACCEPTABLE_DETOUR_RATIO: 2,
  /** Plans whose legs ride nearly the same arcs are collapsed into one. */
  DUPLICATE_PLAN_ARC_TOLERANCE_KM: 0.3,

  /** Vertices per bounding-box chunk, for early rejection on long routes. */
  CHUNK_SIZE: 64,

  /** Physical arrow spacing, so a 107-vertex and a 1423-vertex route look alike. */
  ARROW_SPACING_KM: 0.8,
}

export type Thresholds = typeof THRESHOLDS

// Routes that pass rarely, such as provincial jeeps that mostly skip city riders.
export const INFREQUENT_ROUTES: ReadonlySet<string> = new Set(["Panabo to Davao City"])

export function resolveThresholds(overrides?: Partial<Thresholds>): Thresholds {
  return overrides ? { ...THRESHOLDS, ...overrides } : THRESHOLDS
}

export type AccessMode = "walk" | "tricycle"

export function walkMinutes(distKm: number, t: Thresholds = THRESHOLDS): number {
  return (distKm / t.WALK_SPEED_KMH) * 60
}

export function tricycleMinutes(distKm: number, t: Thresholds = THRESHOLDS): number {
  return (distKm / t.TRICYCLE_SPEED_KMH) * 60 + t.TRICYCLE_WAIT_MIN
}

export function jeepneyMinutes(distKm: number, t: Thresholds = THRESHOLDS): number {
  return (distKm / t.JEEP_SPEED_KMH) * 60
}

export interface AccessOptions {
  distKm: number
  walkMin: number
  tricycleMin: number
  /** Whether the panel should offer the tricycle alongside walking. */
  showTricycleOption: boolean
  recommendedMode: AccessMode
}

export function accessOptions(distKm: number, t: Thresholds = THRESHOLDS): AccessOptions {
  return {
    distKm,
    walkMin: walkMinutes(distKm, t),
    tricycleMin: tricycleMinutes(distKm, t),
    showTricycleOption: distKm > t.TRICYCLE_SHOW_KM,
    recommendedMode: distKm > t.TRICYCLE_TRIGGER_KM ? "tricycle" : "walk",
  }
}

export function accessMode(distKm: number, t: Thresholds = THRESHOLDS): AccessMode {
  return distKm > t.TRICYCLE_TRIGGER_KM ? "tricycle" : "walk"
}

// Tricycle-aware access cost, so the optimizer never picks a long walk only because walking looked cheap.
export function accessCostMin(distKm: number, t: Thresholds = THRESHOLDS): number {
  const walk = walkMinutes(distKm, t)
  if (distKm <= t.TRICYCLE_TRIGGER_KM) return walk

  const trike = tricycleMinutes(distKm, t)
  const excess = distKm - t.TRICYCLE_TRIGGER_KM
  return Math.min(walk, trike) + t.LONG_WALK_PENALTY_MIN_PER_KM * excess
}

export interface FareConfig {
  /** Base fare covering the first `jeepneyBaseKm`. Editable in the UI. */
  jeepneyBasePhp: number
  jeepneyBaseKm: number
  /** Charged per whole km past the base distance. */
  jeepneyPerKmPhp: number
  /** Base fare covering the first `tricycleBaseKm`. */
  tricycleBasePhp: number
  tricycleBaseKm: number
  /** Charged per whole km past the base distance. */
  tricyclePerKmPhp: number
  /** Added for each national highway the tricycle crosses. */
  tricycleHighwayPhp: number
  /** Fares are rounded up to a multiple of this. */
  roundToPhp: number
  /** Student, senior or PWD discount; 0 when off. */
  discountPct: number
}

// RA 11314 (students), RA 9994 (seniors) and RA 7277 (PWD) all mandate 20% off.
export const CONCESSION_DISCOUNT_PCT = 20

// LTFRB traditional jeepney fare from 28 Sept 2026: ₱14 for the first 4 km, ₱2 per km after.
// Davao MTH Board Resolution No. 01-2020 tricycle fare: ₱10 for the first 4 km, ₱1 per km after.
export const DEFAULT_FARE: FareConfig = {
  jeepneyBasePhp: 14,
  jeepneyBaseKm: 4,
  jeepneyPerKmPhp: 2,
  tricycleBasePhp: 10,
  tricycleBaseKm: 4,
  tricyclePerKmPhp: 1,
  tricycleHighwayPhp: 10,
  roundToPhp: 0.25,
  discountPct: 0,
}

// Fare editing is hidden for now; custom rates saved earlier are ignored until it returns.
export const FARE_SETTINGS_ENABLED = false

function roundUpTo(value: number, step: number): number {
  if (!step || step <= 0) return value
  // Guard against float dust turning 36.50 into 36.75.
  return Math.ceil((value - 1e-9) / step) * step
}

// The discount comes off the full fare, then rounds up to the nearest coin (₱14 becomes ₱11.25).
function applyDiscount(fullPhp: number, f: FareConfig): number {
  if (f.discountPct <= 0) return fullPhp
  return roundUpTo(fullPhp * (1 - f.discountPct / 100), f.roundToPhp)
}

// Base fare, then a charge per whole extra km band, as conductors collect it.
export function jeepneyFarePhp(rideKm: number, f: FareConfig = DEFAULT_FARE): number {
  const excessKm = Math.max(0, Math.ceil(rideKm - f.jeepneyBaseKm))
  return applyDiscount(roundUpTo(f.jeepneyBasePhp + excessKm * f.jeepneyPerKmPhp, f.roundToPhp), f)
}

// Regulated per-passenger fare; drivers often ask more for a special trip, so label it an estimate.
export function tricycleFarePhp(distKm: number, f: FareConfig = DEFAULT_FARE, highwaysCrossed = 0): number {
  const excessKm = Math.max(0, Math.ceil(distKm - f.tricycleBaseKm))
  const highway = highwaysCrossed * f.tricycleHighwayPhp
  return applyDiscount(roundUpTo(f.tricycleBasePhp + excessKm * f.tricyclePerKmPhp + highway, f.roundToPhp), f)
}

export function legFarePhp(leg: TripLeg, f: FareConfig = DEFAULT_FARE): number {
  if (leg.mode === "jeepney") return jeepneyFarePhp(leg.distanceKm, f)
  if (leg.mode === "tricycle") return tricycleFarePhp(leg.distanceKm, f, leg.highwaysCrossed)
  return 0
}

export function planFarePhp(plan: TripPlan, f: FareConfig = DEFAULT_FARE): number {
  return plan.legs.reduce((sum, leg) => sum + legFarePhp(leg, f), 0)
}

export function formatPhp(amount: number): string {
  const whole = Math.abs(amount - Math.round(amount)) < 0.01
  return `₱${whole ? Math.round(amount) : amount.toFixed(2)}`
}
