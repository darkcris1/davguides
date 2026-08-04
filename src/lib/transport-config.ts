/**
 * Every tunable number in the trip planner, in one place.
 *
 * Two groups, deliberately kept apart:
 *  - THRESHOLDS feed the optimizer. Changing them changes which routes are suggested.
 *  - FareConfig is display-only. A wrong fare table can never produce a wrong route.
 */

export const THRESHOLDS = {
  // --- speeds -------------------------------------------------------------
  /** Urban walking with crossings. */
  WALK_SPEED_KMH: 4.5,
  /** Davao urban jeepney including stops. */
  JEEP_SPEED_KMH: 18,
  /** Short barangay tricycle hop. */
  TRICYCLE_SPEED_KMH: 15,

  // --- tricycle -----------------------------------------------------------
  /** Above this gap, show the tricycle option alongside walking. */
  TRICYCLE_SHOW_KM: 0.3,
  /** Above this gap, recommend the tricycle. The user's 500 m rule. */
  TRICYCLE_TRIGGER_KM: 0.5,
  /** Hailing and haggling. */
  TRICYCLE_WAIT_MIN: 3,
  /** Keeps a plan from winning only because it assumed a long walk. */
  LONG_WALK_PENALTY_MIN_PER_KM: 6,

  // --- candidate search ---------------------------------------------------
  /**
   * Progressive relaxation. Solve at each radius in turn and stop as soon as
   * MIN_ACCEPTABLE_RESULTS plans exist, so nearby trips never pay for far ones.
   */
  CANDIDATE_RADIUS_TIERS_KM: [0.5, 0.8, 1.5, 2.5],
  /** Above this, an access leg must be flagged as needing a tricycle. */
  MAX_ACCESS_WALK_KM: 1.2,
  /** Transfer gap ceiling. The 0.5-0.8 km band is allowed but tricycle-flagged. */
  MAX_TRANSFER_WALK_KM: 0.8,
  /**
   * Candidates are deduped by separation along the route's arc, never by
   * geographic proximity: the outbound and return legs of these loops often run
   * within 40 m of each other, so geographic dedupe would merge the two
   * directions and defeat the whole point. Raising this past ~1.5 km risks
   * reintroducing that bug.
   */
  CANDIDATE_ARC_SEPARATION_KM: 0.4,
  MAX_CANDIDATES_PER_SIDE: 8,

  // --- rides --------------------------------------------------------------
  /** Shorter than this, walking beats waiting for a jeep. */
  MIN_RIDE_KM: 0.4,
  /** Longest route in the dataset is Calinan at ~59 km. */
  MAX_RIDE_KM: 45,

  // --- loop seam ----------------------------------------------------------
  /** First and last vertex within this distance means the route is a closed ring. */
  LOOP_CLOSE_TOLERANCE_KM: 0.02,
  /**
   * Cost of riding across a terminal — either end of an out-and-back ring. You sit
   * through the layover and are usually put off and made to re-board. Charged per
   * terminal crossed, so the long way round a loop stops looking free.
   */
  TERMINAL_LAYOVER_PENALTY_MIN: 8,
  /** Reject rides that circle most of a loop to get somewhere. */
  MAX_RIDE_ARC_FRACTION: 0.75,

  // --- waits --------------------------------------------------------------
  BOARD_WAIT_MIN: 4,
  /** Higher than BOARD_WAIT_MIN so a direct ride beats an equal-length transfer. */
  TRANSFER_WAIT_MIN: 5,

  // --- transfers ----------------------------------------------------------
  /** Only search for transfers when the best direct trip is this slow, or absent. */
  TRANSFER_SEARCH_TRIGGER_MIN: 25,
  /**
   * ...and only if it is this much worse than the theoretical best (straight-line
   * distance at jeepney speed). Without the relative test, every trip over ~4 km
   * trips the absolute one and pays for a transfer search it never uses.
   */
  TRANSFER_SEARCH_SLACK: 1.5,
  /** Board-side x alight-side routes considered, so at most 36 pairs. */
  MAX_TRANSFER_ROUTE_FANOUT: 6,
  MAX_TRANSFER_POINTS_PER_PAIR: 8,
  /** 2 = at most one transfer. 1280 of 1292 route pairs already meet within 150 m. */
  MAX_LEGS: 2,

  // --- results ------------------------------------------------------------
  MAX_RESULTS: 5,
  MIN_ACCEPTABLE_RESULTS: 3,
  /**
   * A plan only counts toward MIN_ACCEPTABLE_RESULTS if its total ride is within
   * this multiple of the straight-line distance. Without it, three long detours
   * found at a tight radius stop the search before it ever tries the wider radius
   * where the obvious short route becomes reachable.
   */
  ACCEPTABLE_DETOUR_RATIO: 2,
  /** Plans whose legs ride nearly the same arcs are collapsed into one. */
  DUPLICATE_PLAN_ARC_TOLERANCE_KM: 0.3,

  // --- spatial index ------------------------------------------------------
  /** ~330 m cells. Yields 463 occupied cells over the 33k vertices. */
  GRID_CELL_DEG: 0.003,
  /** Vertices per bounding-box chunk, for early rejection on long routes. */
  CHUNK_SIZE: 64,

  // --- rendering ----------------------------------------------------------
  /** Physical arrow spacing, so a 107-vertex and a 1423-vertex route look alike. */
  ARROW_SPACING_KM: 0.8,
}

export type Thresholds = typeof THRESHOLDS

export function resolveThresholds(overrides?: Partial<Thresholds>): Thresholds {
  return overrides ? { ...THRESHOLDS, ...overrides } : THRESHOLDS
}

// ---------------------------------------------------------------------------
// Access gaps: walking or a tricycle to reach / leave a jeepney
// ---------------------------------------------------------------------------

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

/**
 * Single-valued cost the optimizer minimizes over.
 *
 * Tricycle awareness has to live *inside* the cost, not be bolted on afterwards.
 * Otherwise the planner keeps choosing a 1.1 km walk because walking looked cheap,
 * and the UI then suggests a tricycle for a plan that was only picked on the
 * assumption you would walk it.
 */
export function accessCostMin(distKm: number, t: Thresholds = THRESHOLDS): number {
  const walk = walkMinutes(distKm, t)
  if (distKm <= t.TRICYCLE_TRIGGER_KM) return walk

  const trike = tricycleMinutes(distKm, t)
  const excess = distKm - t.TRICYCLE_TRIGGER_KM
  return Math.min(walk, trike) + t.LONG_WALK_PENALTY_MIN_PER_KM * excess
}

// ---------------------------------------------------------------------------
// Fares — display only, never part of the optimizer
// ---------------------------------------------------------------------------

export interface FareConfig {
  /** Base fare covering the first `jeepneyBaseKm`. Editable in the UI. */
  jeepneyBasePhp: number
  jeepneyBaseKm: number
  /** Charged per whole km past the base distance. */
  jeepneyPerKmPhp: number
  tricycleBasePhp: number
  tricyclePerKmPhp: number
  /** Fares are rounded up to a multiple of this. */
  roundToPhp: number
}

export const DEFAULT_FARE: FareConfig = {
  jeepneyBasePhp: 13,
  jeepneyBaseKm: 4,
  jeepneyPerKmPhp: 1.8,
  tricycleBasePhp: 20,
  tricyclePerKmPhp: 10,
  roundToPhp: 0.25,
}

function roundUpTo(value: number, step: number): number {
  if (!step || step <= 0) return value
  // Guard against float dust turning 36.50 into 36.75.
  return Math.ceil((value - 1e-9) / step) * step
}

/**
 * Base fare for the first few km, then a per-km increment. A flat base alone
 * badly undercounts the long routes (Calinan is 59 km end to end).
 *
 * The excess is ceil'd because conductors charge per whole km band, which is
 * also what a rider actually hands over.
 */
export function jeepneyFarePhp(rideKm: number, f: FareConfig = DEFAULT_FARE): number {
  const excessKm = Math.max(0, Math.ceil(rideKm - f.jeepneyBaseKm))
  return roundUpTo(f.jeepneyBasePhp + excessKm * f.jeepneyPerKmPhp, f.roundToPhp)
}

/** Tricycle pricing is informal — always label this an estimate. */
export function tricycleFarePhp(distKm: number, f: FareConfig = DEFAULT_FARE): number {
  return roundUpTo(f.tricycleBasePhp + Math.max(0, distKm) * f.tricyclePerKmPhp, f.roundToPhp)
}

export function formatPhp(amount: number): string {
  const whole = Math.abs(amount - Math.round(amount)) < 0.01
  return `₱${whole ? Math.round(amount) : amount.toFixed(2)}`
}
