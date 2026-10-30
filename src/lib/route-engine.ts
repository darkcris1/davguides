/**
 * Trip planning over the jeepney route set.
 *
 * The whole design turns on one fact about the data: 52 of the 53 routes are
 * closed rings, with the outbound and return legs stored as one continuous
 * LineString. So the only record of travel direction is vertex order, and any
 * approach that picks a single nearest vertex for the rider and a single nearest
 * vertex for the destination throws that information away — which is exactly how
 * you end up recommending a jeep that drives the other way.
 *
 * Instead: enumerate every plausible boarding point and every plausible alighting
 * point, keep only the pairs a jeepney could actually serve (alight arc after
 * board arc), and minimize total door-to-door time.
 */

import type { Route } from "@/commons/models/maps"
import {
  bboxContains,
  haversineKm,
  kmToDegLat,
  planarFrame,
  projectPointOnSegment,
  type LatLng,
} from "./geo"
import {
  accessCostMin,
  accessMode,
  accessOptions,
  jeepneyMinutes,
  resolveThresholds,
  tricycleMinutes,
  INFREQUENT_ROUTES,
  walkMinutes,
  type AccessMode,
  type Thresholds,
} from "./transport-config"
import {
  getRouteIndex,
  hubBoarding,
  pointAtArcKm,
  rideAlongRoute,
  sliceArcPath,
  type Ride,
  type RouteIndex,
  type RouteIndexEntry,
  type TransferPoint,
} from "./route-index"

export type { TransferPoint }

/** Gaps shorter than this are noise, not a leg worth showing. */
const NEGLIGIBLE_GAP_KM = 0.02

/** Below this vertex count a non-loop route's geometry is too coarse to trust. */
const COARSE_VERTEX_COUNT = 60

export interface AccessPoint {
  routeIndex: number
  /** Segment the projection landed on. */
  segIndex: number
  /** Arc position along the route, km from vertex 0. */
  arcKm: number
  lat: number
  lng: number
  /** Straight-line gap from the query point, km. */
  walkKm: number
}

export type LegMode = "walk" | "tricycle" | "jeepney"

export interface TripLeg {
  mode: LegMode
  routeName?: string
  routeColor?: string
  routeIndex?: number
  distanceKm: number
  durationMin: number
  /** [lat, lng] */
  from: [number, number]
  /** [lat, lng] */
  to: [number, number]
  /** Ridden arc for jeepney legs; the two endpoints for walk and tricycle legs. */
  path: [number, number][]
  boardArcKm?: number
  alightArcKm?: number
  /** Terminals the ride passes through, where you may be made to re-board. */
  terminalsCrossed?: number
  /** Riding a two-way corridor against its stored direction. */
  reversed?: boolean
  /** Wait beyond the usual one, for a rare route or a full jeep at rush hour. */
  extraWaitMin?: number
  /** Gap legs carry both estimates so the panel can offer the choice. */
  walkMin?: number
  tricycleMin?: number
  showTricycleOption?: boolean
  recommendedMode?: AccessMode
  /** Gap leg crosses a national road, which adds the tricycle highway surcharge. */
  crossesHighway?: boolean
  instruction: string
}

export interface TripPlan {
  id: string
  legs: TripLeg[]
  transferCount: number
  totalDurationMin: number
  totalWalkKm: number
  totalTricycleKm: number
  totalRideKm: number
  needsTricycleFirstMile: boolean
  needsTricycleLastMile: boolean
  needsTricycleTransfer: boolean
  /**
   * Longest walk-or-tricycle gap in the plan, km. This — not the search radius —
   * is what tells the rider whether the jeepney network reaches them.
   */
  maxAccessGapKm: number
  /** Which relaxation tier produced this plan, km. Diagnostic only. */
  searchRadiusKm: number
  /** Per jeepney leg: other routes that would serve the same stretch. */
  alternativeRouteNames: string[][]
  warnings: string[]
}

export interface PlanTripsOptions {
  maxResults?: number
  allowTransfers?: boolean
  thresholds?: Partial<Thresholds>
  /** Rush hour moves transfers to where jeeps load. */
  peak?: boolean
}

// ---------------------------------------------------------------------------
// Access points
// ---------------------------------------------------------------------------

interface RawCandidate {
  segIndex: number
  arcKm: number
  lat: number
  lng: number
  distKm: number
}

/**
 * Every distinct place along each route where a rider at (lat, lng) could get on
 * or off, within `radiusKm`.
 *
 * Candidates are deduped by separation along the route's *arc*, never by how close
 * they are on the ground. On these loops the outbound and return legs frequently
 * run within 40 m of each other — Toril retraces 65% of its own path — so
 * geographic dedupe would collapse the two directions into one and undo the fix.
 */
export function findAccessPoints(
  index: RouteIndex,
  lat: number,
  lng: number,
  radiusKm: number,
  thresholds?: Partial<Thresholds>,
): Map<number, AccessPoint[]> {
  const t = resolveThresholds(thresholds)
  const frame = planarFrame(lat)
  // Latitude degrees are the smaller unit at this latitude, so padding with the
  // longitude equivalent would under-cover; use the larger of the two.
  const padDeg = Math.max(kmToDegLat(radiusKm), radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180)))

  const result = new Map<number, AccessPoint[]>()

  for (const entry of index.entries) {
    if (!bboxContains(entry.bbox, lng, lat, padDeg)) continue

    const raw: RawCandidate[] = []
    const { coords, cum, chunkCount, chunkBBox } = entry
    const chunkSize = t.CHUNK_SIZE

    for (let c = 0; c < chunkCount; c++) {
      const b = c * 4
      if (
        lng < chunkBBox[b] - padDeg ||
        lng > chunkBBox[b + 2] + padDeg ||
        lat < chunkBBox[b + 1] - padDeg ||
        lat > chunkBBox[b + 3] + padDeg
      ) {
        continue
      }

      const start = c * chunkSize
      const end = Math.min(coords.length - 2, (c + 1) * chunkSize - 1)
      for (let i = start; i <= end; i++) {
        const a = coords[i]
        const bb = coords[i + 1]
        const proj = projectPointOnSegment(frame, lat, lng, a[1], a[0], bb[1], bb[0])
        if (proj.distKm > radiusKm) continue

        raw.push({
          segIndex: i,
          arcKm: cum[i] + proj.t * (cum[i + 1] - cum[i]),
          lat: proj.lat,
          lng: proj.lng,
          distKm: proj.distKm,
        })
      }
    }

    if (raw.length === 0) continue

    raw.sort((x, y) => x.arcKm - y.arcKm)

    // Collapse contiguous runs along the arc into one candidate each. Downtown
    // this takes thousands of raw hits down to a couple per route per side.
    const grouped: RawCandidate[] = []
    let current = raw[0]
    for (let i = 1; i < raw.length; i++) {
      const next = raw[i]
      if (next.arcKm - current.arcKm > t.CANDIDATE_ARC_SEPARATION_KM) {
        grouped.push(current)
        current = next
      } else if (next.distKm < current.distKm) {
        current = next
      }
    }
    grouped.push(current)

    let points: AccessPoint[] = grouped.map((g) => ({
      routeIndex: entry.routeIndex,
      segIndex: g.segIndex,
      arcKm: g.arcKm,
      lat: g.lat,
      lng: g.lng,
      // Re-measure on the sphere so displayed distances are exact, not planar.
      walkKm: haversineKm(lat, lng, g.lat, g.lng),
    }))

    if (points.length > t.MAX_CANDIDATES_PER_SIDE) {
      points = points
        .slice()
        .sort((x, y) => x.walkKm - y.walkKm)
        .slice(0, t.MAX_CANDIDATES_PER_SIDE)
        .sort((x, y) => x.arcKm - y.arcKm)
    }

    result.set(entry.routeIndex, points)
  }

  return result
}

// ---------------------------------------------------------------------------
// Transfer points
// ---------------------------------------------------------------------------

/** Arc steps when scanning for transfers, in vertices. ~120 m and ~60 m here. */
const TRANSFER_STRIDE_A = 4
const TRANSFER_STRIDE_B = 2

/**
 * Where a rider can step off route A and onto route B.
 *
 * Hashes route B's vertices into buckets the size of the walking tolerance, then
 * sweeps route A looking only in the 9 buckets around each point. Comparing every
 * vertex of A against every vertex of B instead would be 640k distance
 * calculations for a single pair of 800-vertex routes.
 *
 * Both routes are strided, and distances are compared in a local planar frame
 * without trigonometry — the arc dedupe below collapses anything finer than 400 m
 * anyway, so scanning every vertex would only burn time.
 *
 * Emits one transfer point per shared neighbourhood rather than a single global
 * minimum: downtown route pairs run together for kilometres, and which meeting
 * point is best depends on where the rider boarded and where they are going.
 */
export function findTransferPoints(
  index: RouteIndex,
  aRouteIndex: number,
  bRouteIndex: number,
  maxWalkKm: number,
  thresholds?: Partial<Thresholds>,
): TransferPoint[] {
  const t = resolveThresholds(thresholds)
  const key = `${aRouteIndex}_${bRouteIndex}_${maxWalkKm}`
  const cached = index.transferCache.get(key)
  if (cached) return cached

  const entryA = index.entries[aRouteIndex]
  const entryB = index.entries[bRouteIndex]
  const raw: TransferPoint[] = []

  // Cheap rejection: routes whose bounding boxes never come within a walk.
  const padDeg = kmToDegLat(maxWalkKm) * 1.5
  const separated =
    entryA.bbox[0] - padDeg > entryB.bbox[2] ||
    entryA.bbox[2] + padDeg < entryB.bbox[0] ||
    entryA.bbox[1] - padDeg > entryB.bbox[3] ||
    entryA.bbox[3] + padDeg < entryB.bbox[1]
  if (separated) {
    index.transferCache.set(key, [])
    return []
  }

  const frame = planarFrame((entryA.bbox[1] + entryA.bbox[3]) / 2)
  const bucketKm = Math.max(maxWalkKm, 0.1)
  const bucketOf = (lng: number, lat: number) =>
    `${Math.floor((lat * frame.ky) / bucketKm)}:${Math.floor((lng * frame.kx) / bucketKm)}`

  const bBuckets = new Map<string, number[]>()
  for (let i = 0; i < entryB.coords.length; i += TRANSFER_STRIDE_B) {
    const bucket = bucketOf(entryB.coords[i][0], entryB.coords[i][1])
    const list = bBuckets.get(bucket)
    if (list) list.push(i)
    else bBuckets.set(bucket, [i])
  }

  const maxSq = maxWalkKm * maxWalkKm
  // One candidate per contiguous stretch where the two routes run together.
  let run: TransferPoint | null = null
  let lastMatchArc = Number.NEGATIVE_INFINITY

  for (let ia = 0; ia < entryA.coords.length; ia += TRANSFER_STRIDE_A) {
    const aLng = entryA.coords[ia][0]
    const aLat = entryA.coords[ia][1]
    const ax = aLng * frame.kx
    const ay = aLat * frame.ky
    const by = Math.floor(ay / bucketKm)
    const bx = Math.floor(ax / bucketKm)

    let bestSq = maxSq
    let bestIb = -1
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = bBuckets.get(`${by + dy}:${bx + dx}`)
        if (!list) continue
        for (const ib of list) {
          const ddx = entryB.coords[ib][0] * frame.kx - ax
          const ddy = entryB.coords[ib][1] * frame.ky - ay
          const sq = ddx * ddx + ddy * ddy
          if (sq < bestSq) {
            bestSq = sq
            bestIb = ib
          }
        }
      }
    }

    const arcA = entryA.cum[ia]
    if (bestIb < 0) continue

    // Re-measure the walk on the sphere: this number reaches the rider.
    const walkKm = haversineKm(aLat, aLng, entryB.coords[bestIb][1], entryB.coords[bestIb][0])
    const candidate: TransferPoint = {
      arcAKm: arcA,
      arcBKm: entryB.cum[bestIb],
      walkKm,
      lat: aLat,
      lng: aLng,
    }

    if (run && arcA - lastMatchArc <= t.CANDIDATE_ARC_SEPARATION_KM) {
      if (walkKm < run.walkKm) run = candidate
    } else {
      if (run) raw.push(run)
      run = candidate
    }
    lastMatchArc = arcA
  }
  if (run) raw.push(run)

  raw.sort((x, y) => x.arcAKm - y.arcAKm)

  const deduped: TransferPoint[] = []
  for (const point of raw) {
    const prev = deduped[deduped.length - 1]
    if (prev && point.arcAKm - prev.arcAKm <= t.CANDIDATE_ARC_SEPARATION_KM) {
      if (point.walkKm < prev.walkKm) deduped[deduped.length - 1] = point
      continue
    }
    deduped.push(point)
  }

  const capped: TransferPoint[] =
    deduped.length > t.MAX_TRANSFER_POINTS_PER_PAIR
      ? deduped
          .slice()
          .sort((x, y) => x.walkKm - y.walkKm)
          .slice(0, t.MAX_TRANSFER_POINTS_PER_PAIR)
          .sort((x, y) => x.arcAKm - y.arcAKm)
      : deduped

  // Shared stretches keep only their shortest-walk point, which can skip the hub where B loads.
  for (const hub of entryB.hubs) {
    const [hubLat, hubLng] = pointAtArcKm(entryB, hub.arcKm)
    let best: TransferPoint | null = null
    for (let ia = 0; ia < entryA.coords.length; ia++) {
      const walkKm = haversineKm(hubLat, hubLng, entryA.coords[ia][1], entryA.coords[ia][0])
      if (walkKm <= maxWalkKm && (!best || walkKm < best.walkKm)) {
        best = { arcAKm: entryA.cum[ia], arcBKm: hub.arcKm, walkKm, lat: entryA.coords[ia][1], lng: entryA.coords[ia][0] }
      }
    }
    if (best) capped.push(best)
  }

  index.transferCache.set(key, capped)
  return capped
}

// ---------------------------------------------------------------------------
// Leg construction
// ---------------------------------------------------------------------------

function gapLeg(
  from: [number, number],
  to: [number, number],
  distKm: number,
  destinationLabel: string,
  t: Thresholds,
): TripLeg {
  const options = accessOptions(distKm, t)
  const mode = accessMode(distKm, t)
  const durationMin = mode === "walk" ? walkMinutes(distKm, t) : tricycleMinutes(distKm, t)
  const verb = mode === "walk" ? "Walk" : "Take a tricycle"

  return {
    mode,
    distanceKm: distKm,
    durationMin,
    from,
    to,
    path: [from, to],
    walkMin: options.walkMin,
    tricycleMin: options.tricycleMin,
    showTricycleOption: options.showTricycleOption,
    recommendedMode: options.recommendedMode,
    instruction: `${verb} to ${destinationLabel}`,
  }
}

function jeepneyLeg(
  entry: RouteIndexEntry,
  boardArcKm: number,
  alightArcKm: number,
  ride: Ride,
  baseWaitMin: number,
  t: Thresholds,
): TripLeg {
  const from = pointAtArcKm(entry, boardArcKm)
  const to = pointAtArcKm(entry, alightArcKm)

  return {
    mode: "jeepney",
    routeName: entry.name,
    routeColor: entry.color,
    routeIndex: entry.routeIndex,
    distanceKm: ride.distanceKm,
    durationMin: jeepneyMinutes(ride.distanceKm, t),
    from,
    to,
    path: sliceArcPath(entry, boardArcKm, alightArcKm),
    boardArcKm,
    alightArcKm,
    terminalsCrossed: ride.terminalsCrossed,
    reversed: ride.reversed,
    extraWaitMin: infrequentWaitMin(entry, baseWaitMin, t) || undefined,
    instruction: `Ride the ${entry.name} jeepney`,
  }
}

function isCoarse(entry: RouteIndexEntry): boolean {
  return !entry.isLoop && entry.coords.length < COARSE_VERTEX_COUNT
}

function finalizePlan(
  legs: TripLeg[],
  searchRadiusKm: number,
  t: Thresholds,
  warnings: string[],
): TripPlan {
  const jeepneyLegs = legs.filter((l) => l.mode === "jeepney")
  const transferCount = Math.max(0, jeepneyLegs.length - 1)

  const legMinutes = legs.reduce((sum, l) => sum + l.durationMin, 0)
  const extraWait = jeepneyLegs.reduce((sum, l) => sum + (l.extraWaitMin ?? 0), 0)
  const waitMinutes =
    jeepneyLegs.length > 0 ? t.BOARD_WAIT_MIN + transferCount * t.TRANSFER_WAIT_MIN + extraWait : 0

  const gapLegs = legs.filter((l) => l.mode === "walk" || l.mode === "tricycle")
  const lastGapIsAlight = legs.length > 1 && legs[legs.length - 1].mode !== "jeepney"

  return {
    id: legs.map((l) => (l.mode === "jeepney" ? l.routeName : l.mode)).join(">"),
    legs,
    transferCount,
    totalDurationMin: legMinutes + waitMinutes,
    totalWalkKm: gapLegs.filter((l) => l.mode === "walk").reduce((s, l) => s + l.distanceKm, 0),
    totalTricycleKm: gapLegs.filter((l) => l.mode === "tricycle").reduce((s, l) => s + l.distanceKm, 0),
    totalRideKm: jeepneyLegs.reduce((s, l) => s + l.distanceKm, 0),
    needsTricycleFirstMile: legs[0]?.mode === "tricycle",
    needsTricycleLastMile: lastGapIsAlight && legs[legs.length - 1].mode === "tricycle",
    needsTricycleTransfer: legs.slice(1, -1).some((l) => l.mode === "tricycle"),
    maxAccessGapKm: gapLegs.reduce((max, l) => Math.max(max, l.distanceKm), 0),
    searchRadiusKm,
    alternativeRouteNames: jeepneyLegs.map(() => []),
    warnings,
  }
}

// ---------------------------------------------------------------------------
// Solvers
// ---------------------------------------------------------------------------

interface ScoredPlan {
  plan: TripPlan
  cost: number
}

function rideIsUsable(entry: RouteIndexEntry, ride: Ride, t: Thresholds): boolean {
  if (!Number.isFinite(ride.distanceKm)) return false
  if (ride.distanceKm < t.MIN_RIDE_KM || ride.distanceKm > t.MAX_RIDE_KM) return false
  // Circling most of a loop to reach somewhere is never the real answer.
  if (entry.isLoop && ride.distanceKm > entry.totalKm * t.MAX_RIDE_ARC_FRACTION) return false
  return true
}

const rareRouteWarning = (name: string) => `${name} jeeps pass rarely; expect a long wait.`

/** Extra minutes waiting for a route that rarely passes. */
function infrequentWaitMin(entry: RouteIndexEntry, baseWaitMin: number, t: Thresholds): number {
  return INFREQUENT_ROUTES.has(entry.name) ? Math.max(0, t.INFREQUENT_WAIT_MIN - baseWaitMin) : 0
}

/** Ride time plus layovers, data-doubt penalties and any rare-route wait. */
function rideCostMin(entry: RouteIndexEntry, ride: Ride, baseWaitMin: number, t: Thresholds): number {
  // Uncertain geometry or direction loses ties to a well-mapped route on the same street.
  const doubt = (ride.reversed ? t.REVERSED_RIDE_PENALTY_MIN : 0) + (isCoarse(entry) ? t.COARSE_ROUTE_PENALTY_MIN : 0)
  return jeepneyMinutes(ride.distanceKm, t) + ride.terminalsCrossed * t.TERMINAL_LAYOVER_PENALTY_MIN + doubt + infrequentWaitMin(entry, baseWaitMin, t)
}

function solveDirect(
  index: RouteIndex,
  origin: LatLng,
  destination: LatLng,
  boards: Map<number, AccessPoint[]>,
  alights: Map<number, AccessPoint[]>,
  radiusKm: number,
  t: Thresholds,
): ScoredPlan[] {
  const out: ScoredPlan[] = []

  for (const [routeIndex, boardPoints] of boards) {
    const alightPoints = alights.get(routeIndex)
    if (!alightPoints) continue

    const entry = index.entries[routeIndex]
    let best: { cost: number; board: AccessPoint; alight: AccessPoint; ride: Ride } | null = null

    for (const board of boardPoints) {
      for (const alight of alightPoints) {
        const ride = rideAlongRoute(entry, board.arcKm, alight.arcKm)
        if (!rideIsUsable(entry, ride, t)) continue

        const cost =
          accessCostMin(board.walkKm, t) +
          rideCostMin(entry, ride, t.BOARD_WAIT_MIN, t) +
          accessCostMin(alight.walkKm, t) +
          t.BOARD_WAIT_MIN

        if (!best || cost < best.cost) best = { cost, board, alight, ride }
      }
    }

    if (!best) continue

    const legs: TripLeg[] = []
    const originPoint: [number, number] = [origin.lat, origin.lng]
    const boardPoint: [number, number] = [best.board.lat, best.board.lng]
    const alightPoint: [number, number] = [best.alight.lat, best.alight.lng]
    const destinationPoint: [number, number] = [destination.lat, destination.lng]

    if (best.board.walkKm > NEGLIGIBLE_GAP_KM) {
      legs.push(gapLeg(originPoint, boardPoint, best.board.walkKm, `board the ${entry.name} jeepney`, t))
    }
    legs.push(jeepneyLeg(entry, best.board.arcKm, best.alight.arcKm, best.ride, t.BOARD_WAIT_MIN, t))
    if (best.alight.walkKm > NEGLIGIBLE_GAP_KM) {
      legs.push(gapLeg(alightPoint, destinationPoint, best.alight.walkKm, "your destination", t))
    }

    const warnings: string[] = []
    if (best.ride.terminalsCrossed > 0) {
      warnings.push(
        `Rides through the ${entry.name} terminal — you may be asked to get off and re-board there.`,
      )
    }
    if (best.ride.reversed) {
      warnings.push(`${entry.name} is mapped in the opposite direction; confirm the jeep is heading your way.`)
    }
    if (isCoarse(entry)) warnings.push(`${entry.name} route data is coarse; the boarding point is approximate.`)
    if (best.board.walkKm > t.MAX_ACCESS_WALK_KM) warnings.push("The nearest boarding point is a long way off.")
    if (INFREQUENT_ROUTES.has(entry.name)) warnings.push(rareRouteWarning(entry.name))

    out.push({ plan: finalizePlan(legs, radiusKm, t, warnings), cost: best.cost })
  }

  return out
}

/** The N routes with the shortest access gap, as a starting set for transfers. */
function topRoutes(points: Map<number, AccessPoint[]>, limit: number): number[] {
  return [...points.entries()]
    .map(([routeIndex, list]) => ({
      routeIndex,
      best: list.reduce((min, p) => Math.min(min, p.walkKm), Number.POSITIVE_INFINITY),
    }))
    .sort((a, b) => a.best - b.best)
    .slice(0, limit)
    .map((r) => r.routeIndex)
}

function solveTransfers(
  index: RouteIndex,
  origin: LatLng,
  destination: LatLng,
  boards: Map<number, AccessPoint[]>,
  alights: Map<number, AccessPoint[]>,
  radiusKm: number,
  t: Thresholds,
  peak: boolean,
): ScoredPlan[] {
  const out: ScoredPlan[] = []
  const boardRoutes = topRoutes(boards, t.MAX_TRANSFER_ROUTE_FANOUT)
  const alightRoutes = topRoutes(alights, t.MAX_TRANSFER_ROUTE_FANOUT)

  for (const ra of boardRoutes) {
    const entryA = index.entries[ra]
    const boardPoints = boards.get(ra)
    if (!boardPoints) continue

    for (const rb of alightRoutes) {
      if (ra === rb) continue
      const entryB = index.entries[rb]
      const alightPoints = alights.get(rb)
      if (!alightPoints) continue

      const transfers = findTransferPoints(index, ra, rb, t.MAX_TRANSFER_WALK_KM, t)
      if (transfers.length === 0) continue

      let best: {
        cost: number
        board: AccessPoint
        alight: AccessPoint
        transfer: TransferPoint
        ride1: Ride
        ride2: Ride
      } | null = null

      for (const transfer of transfers) {
        // The cost splits cleanly: the first leg depends only on the boarding
        // point and the transfer, the second only on the transfer and the
        // alighting point. So each side can be optimized on its own.
        let bestBoard: { cost: number; point: AccessPoint; ride: Ride } | null = null
        for (const board of boardPoints) {
          const ride = rideAlongRoute(entryA, board.arcKm, transfer.arcAKm)
          if (!rideIsUsable(entryA, ride, t)) continue
          const cost = accessCostMin(board.walkKm, t) + rideCostMin(entryA, ride, t.BOARD_WAIT_MIN, t) + t.BOARD_WAIT_MIN
          if (!bestBoard || cost < bestBoard.cost) bestBoard = { cost, point: board, ride }
        }
        if (!bestBoard) continue

        let bestAlight: { cost: number; point: AccessPoint; ride: Ride } | null = null
        for (const alight of alightPoints) {
          const ride = rideAlongRoute(entryB, transfer.arcBKm, alight.arcKm)
          if (!rideIsUsable(entryB, ride, t)) continue
          const full = peak && hubBoarding(entryB, transfer.arcBKm, ride, t.HUB_BOARDING_FREE_KM)?.past
          const cost =
            rideCostMin(entryB, ride, t.TRANSFER_WAIT_MIN, t) + accessCostMin(alight.walkKm, t) + t.TRANSFER_WAIT_MIN + (full ? t.FULL_JEEP_PENALTY_MIN : 0)
          if (!bestAlight || cost < bestAlight.cost) bestAlight = { cost, point: alight, ride }
        }
        if (!bestAlight) continue

        const cost = bestBoard.cost + accessCostMin(transfer.walkKm, t) + bestAlight.cost
        if (!best || cost < best.cost) {
          best = {
            cost,
            board: bestBoard.point,
            alight: bestAlight.point,
            transfer,
            ride1: bestBoard.ride,
            ride2: bestAlight.ride,
          }
        }
      }

      if (!best) continue

      const legs: TripLeg[] = []
      const transferOnA = pointAtArcKm(entryA, best.transfer.arcAKm)
      const transferOnB = pointAtArcKm(entryB, best.transfer.arcBKm)

      if (best.board.walkKm > NEGLIGIBLE_GAP_KM) {
        legs.push(
          gapLeg(
            [origin.lat, origin.lng],
            [best.board.lat, best.board.lng],
            best.board.walkKm,
            `board the ${entryA.name} jeepney`,
            t,
          ),
        )
      }
      legs.push(jeepneyLeg(entryA, best.board.arcKm, best.transfer.arcAKm, best.ride1, t.BOARD_WAIT_MIN, t))
      if (best.transfer.walkKm > NEGLIGIBLE_GAP_KM) {
        legs.push(gapLeg(transferOnA, transferOnB, best.transfer.walkKm, `transfer to the ${entryB.name} jeepney`, t))
      }
      const loading = hubBoarding(entryB, best.transfer.arcBKm, best.ride2, t.HUB_BOARDING_FREE_KM)
      const secondRide = jeepneyLeg(entryB, best.transfer.arcBKm, best.alight.arcKm, best.ride2, t.TRANSFER_WAIT_MIN, t)
      if (loading && !loading.past) secondRide.instruction = `Ride the ${entryB.name} jeepney from ${loading.hub.name}, where it loads`
      // The seat wait is real time, so it belongs in the total the rider sees.
      if (peak && loading?.past) secondRide.extraWaitMin = (secondRide.extraWaitMin ?? 0) + t.FULL_JEEP_PENALTY_MIN
      legs.push(secondRide)
      if (best.alight.walkKm > NEGLIGIBLE_GAP_KM) {
        legs.push(
          gapLeg(
            [best.alight.lat, best.alight.lng],
            [destination.lat, destination.lng],
            best.alight.walkKm,
            "your destination",
            t,
          ),
        )
      }

      const warnings: string[] = []
      if (best.ride1.terminalsCrossed > 0 || best.ride2.terminalsCrossed > 0) {
        warnings.push("Rides through a terminal — you may be asked to get off and re-board.")
      }
      if (best.ride1.reversed || best.ride2.reversed) {
        warnings.push("One leg is mapped in the opposite direction; confirm the jeep is heading your way.")
      }
      if (isCoarse(entryA) || isCoarse(entryB)) {
        warnings.push("Route data is coarse here; boarding points are approximate.")
      }
      for (const entry of [entryA, entryB]) {
        if (INFREQUENT_ROUTES.has(entry.name)) warnings.push(rareRouteWarning(entry.name))
      }
      if (peak && loading?.past) {
        warnings.push(`At rush hour ${entryB.name} jeeps are often full past ${loading.hub.name}; allow about ${t.FULL_JEEP_PENALTY_MIN} min to get a seat.`)
      }

      out.push({ plan: finalizePlan(legs, radiusKm, t, warnings), cost: best.cost })
    }
  }

  return out
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

function legSignature(plan: TripPlan): string {
  return plan.legs
    .filter((l) => l.mode === "jeepney")
    .map((l) => l.routeName)
    .join(" > ")
}

/**
 * Collapse plans that ride the same streets under different route names.
 *
 * Several Davao routes share long stretches (Lasang via Sasa, Bunawan via Sasa and
 * Panacan - SM City Davao all cover the same corridor), so without this the panel
 * shows the same trip three times. The survivors keep the alternatives as a
 * "or take" note instead.
 */
function dedupePlans(scored: ScoredPlan[], t: Thresholds): ScoredPlan[] {
  const bySignature = new Map<string, ScoredPlan>()
  for (const candidate of scored) {
    const key = legSignature(candidate.plan)
    const existing = bySignature.get(key)
    if (!existing || candidate.cost < existing.cost) bySignature.set(key, candidate)
  }

  const unique = [...bySignature.values()].sort((a, b) => a.cost - b.cost)
  const kept: ScoredPlan[] = []
  const tolerance = t.DUPLICATE_PLAN_ARC_TOLERANCE_KM

  for (const candidate of unique) {
    const candidateJeeps = candidate.plan.legs.filter((l) => l.mode === "jeepney")

    const twin = kept.find((k) => {
      const keptJeeps = k.plan.legs.filter((l) => l.mode === "jeepney")
      if (keptJeeps.length !== candidateJeeps.length) return false
      return keptJeeps.every((leg, i) => {
        const other = candidateJeeps[i]
        // A rare route is a real fallback, not just another name for the same ride.
        if (INFREQUENT_ROUTES.has(leg.routeName ?? "") !== INFREQUENT_ROUTES.has(other.routeName ?? "")) return false
        // Matching endpoints alone is not enough: two routes can board and alight
        // in the same spots yet take very different paths between them, and
        // calling those interchangeable would send riders 3 km out of their way.
        return (
          haversineKm(leg.from[0], leg.from[1], other.from[0], other.from[1]) <= tolerance &&
          haversineKm(leg.to[0], leg.to[1], other.to[0], other.to[1]) <= tolerance &&
          Math.abs(leg.distanceKm - other.distanceKm) <= tolerance
        )
      })
    })

    if (twin) {
      const twinJeeps = twin.plan.legs.filter((l) => l.mode === "jeepney")
      candidateJeeps.forEach((leg, i) => {
        const names = twin.plan.alternativeRouteNames[i]
        if (!leg.routeName || !names) return
        // Never list the surviving plan's own route as an alternative to itself —
        // the same route resurfaces as a candidate on every widened radius tier.
        if (leg.routeName === twinJeeps[i]?.routeName) return
        if (!names.includes(leg.routeName)) names.push(leg.routeName)
      })
      continue
    }

    kept.push(candidate)
  }

  return kept
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const needsTricycle = (plan: TripPlan) => plan.needsTricycleFirstMile || plan.needsTricycleLastMile || plan.needsTricycleTransfer
const ridesJeepney = (plan: TripPlan) => plan.legs.some((l) => l.mode === "jeepney")

// Drops far-worse plans, and tricycle detours that barely beat a jeep within walking distance.
function pruneWeakPlans(plans: ScoredPlan[], t: Thresholds): ScoredPlan[] {
  if (plans.length === 0) return plans
  const best = plans.reduce((a, b) => (b.cost < a.cost ? b : a))
  const affordable = plans.filter((p) => p.cost <= best.cost + t.MAX_EXTRA_COST_MIN)
  const walkable = affordable.filter((p) => !needsTricycle(p.plan))
  const bestWalkableMin = walkable.length > 0 ? Math.min(...walkable.map((p) => p.plan.totalDurationMin)) : Number.POSITIVE_INFINITY

  const kept = affordable.filter(
    (p) => !needsTricycle(p.plan) || p.plan.totalDurationMin <= bestWalkableMin - t.TRICYCLE_DETOUR_MIN_SAVING_MIN,
  )
  // A jeep trip that still needs a tricycle, yet is slower than the tricycle alone, costs more for nothing.
  const trikeOnly = kept.find((p) => !ridesJeepney(p.plan))
  const result = trikeOnly
    ? kept.filter((p) => p === trikeOnly || !needsTricycle(p.plan) || p.plan.totalDurationMin < trikeOnly.plan.totalDurationMin)
    : kept
  return result.length > 0 ? result : [best]
}

function walkOnlyPlan(origin: LatLng, destination: LatLng, distKm: number, t: Thresholds): TripPlan {
  const leg = gapLeg([origin.lat, origin.lng], [destination.lat, destination.lng], distKm, "your destination", t)
  return finalizePlan([leg], 0, t, [])
}

// Door to door by tricycle, for short trips where the jeeps only go the long way round.
function tricycleOnlyPlan(origin: LatLng, destination: LatLng, distKm: number, t: Thresholds): ScoredPlan {
  const leg = gapLeg([origin.lat, origin.lng], [destination.lat, destination.lng], distKm, "your destination", t)
  leg.mode = "tricycle"
  leg.durationMin = tricycleMinutes(distKm, t)
  leg.recommendedMode = "tricycle"
  leg.instruction = "Take a tricycle to your destination"
  const plan = finalizePlan([leg], 0, t, ["No jeepney needed: a tricycle goes straight there."])
  return { plan, cost: leg.durationMin }
}

/**
 * Plan trips from origin to destination, best first.
 *
 * Search radius widens in tiers rather than using one hard cutoff, so a rider
 * standing on a jeepney route never pays for the case of someone in Toril — where
 * no route comes within 800 m and the honest answer involves a tricycle.
 */
export function planTrips(
  routes: Route[],
  origin: LatLng,
  destination: LatLng,
  options: PlanTripsOptions = {},
): TripPlan[] {
  const t = resolveThresholds(options.thresholds)
  const maxResults = options.maxResults ?? t.MAX_RESULTS
  const allowTransfers = options.allowTransfers ?? true
  const peak = options.peak ?? false

  const straightKm = haversineKm(origin.lat, origin.lng, destination.lat, destination.lng)
  if (straightKm < t.MIN_RIDE_KM) return [walkOnlyPlan(origin, destination, straightKm, t)]

  const index = getRouteIndex(routes)
  // Accumulate across tiers rather than replacing, so a plan found at a tight
  // radius is never lost just because a wider tier had to run.
  const pool: ScoredPlan[] = straightKm <= t.TRICYCLE_DIRECT_MAX_KM ? [tricycleOnlyPlan(origin, destination, straightKm, t)] : []
  let best: ScoredPlan[] = dedupePlans(pruneWeakPlans(pool, t), t)

  for (const radiusKm of t.CANDIDATE_RADIUS_TIERS_KM) {
    const boards = findAccessPoints(index, origin.lat, origin.lng, radiusKm, t)
    const alights = findAccessPoints(index, destination.lat, destination.lng, radiusKm, t)
    if (boards.size === 0 || alights.size === 0) continue

    const direct = solveDirect(index, origin, destination, boards, alights, radiusKm, t)
    const bestDirect = direct.reduce<ScoredPlan | null>((b, p) => (!b || p.cost < b.cost ? p : b), null)

    // Transfers are only worth their cost when a direct ride is missing or poor.
    // "Poor" is judged against the best any trip of this length could be, so a
    // long-but-efficient direct ride does not trip the search.
    const bestPossibleMin = jeepneyMinutes(straightKm, t) + t.BOARD_WAIT_MIN
    const slowThresholdMin = Math.max(t.TRANSFER_SEARCH_TRIGGER_MIN, bestPossibleMin * t.TRANSFER_SEARCH_SLACK)
    const wantTransfers =
      allowTransfers &&
      t.MAX_LEGS >= 2 &&
      (!bestDirect ||
        bestDirect.plan.totalDurationMin > slowThresholdMin ||
        bestDirect.plan.legs.some(
          (l) => l.mode !== "jeepney" && l.distanceKm > t.MAX_ACCESS_WALK_KM,
        ))

    const transfers = wantTransfers
      ? solveTransfers(index, origin, destination, boards, alights, radiusKm, t, peak)
      : []

    pool.push(...direct, ...transfers)
    best = dedupePlans(pruneWeakPlans(pool, t), t)

    // Stop only once there are enough plans that actually head where the rider is
    // going. Counting detours here is what previously let three long way-round
    // rides end the search before the wider radius exposed the obvious short
    // route sitting metres away.
    const reasonable = best.filter(
      (p) => ridesJeepney(p.plan) && p.plan.totalRideKm <= straightKm * t.ACCEPTABLE_DETOUR_RATIO,
    ).length
    if (reasonable >= t.MIN_ACCEPTABLE_RESULTS) break
  }

  // Select on cost, which penalizes long walks the raw duration ignores, but
  // present in time order — a list reading 70, 71, 69 min looks broken.
  return best
    .sort((a, b) => a.cost - b.cost)
    .slice(0, maxResults)
    .map((s) => s.plan)
    .sort((a, b) => a.totalDurationMin - b.totalDurationMin)
}
