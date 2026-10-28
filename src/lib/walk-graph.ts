// Offline walk router over the packed street graph from scripts/build-walk-graph.mjs.

import { haversineKm, planarFrame, projectPointOnSegment } from "./geo"
import { isInstalledApp } from "./offline"
import type { WalkPath } from "./walk-router"

const GRAPH_URL = "/walk-graph.bin"
const SCALE = 1e5
const CELL_DEG = 0.003
// Farther than this from any street means the point is outside the packed area.
const MAX_SNAP_KM = 0.25

interface Graph {
  lat: Float64Array
  lng: Float64Array
  /** Neighbours of node i are adj[start[i]..start[i + 1]). */
  start: Int32Array
  adj: Int32Array
  adjKm: Float32Array
  segA: Int32Array
  segB: Int32Array
  /** Segment ids by grid cell, for snapping. */
  cells: Map<number, number[]>
}

function decode(buffer: ArrayBuffer): Graph {
  const bytes = new Uint8Array(buffer)
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== "DGW1") throw new Error("Unknown walk graph format")
  let pos = 4
  const varint = () => {
    let n = 0
    let mul = 1
    for (;;) {
      const b = bytes[pos++]
      n += (b & 0x7f) * mul
      if (b < 0x80) return n
      mul *= 128
    }
  }
  const signed = () => {
    const z = varint()
    return z % 2 ? -(z + 1) / 2 : z / 2
  }

  const count = varint()
  const lineCount = varint()
  const lat = new Float64Array(count)
  const lng = new Float64Array(count)
  let [la, ln] = [0, 0]
  for (let i = 0; i < count; i++) {
    la += signed()
    ln += signed()
    lat[i] = la / SCALE
    lng[i] = ln / SCALE
  }

  const a: number[] = []
  const b: number[] = []
  for (let l = 0; l < lineCount; l++) {
    const length = varint()
    let prev = 0
    for (let k = 0; k < length; k++) {
      const id = prev + signed()
      if (k > 0 && id !== prev) {
        a.push(prev)
        b.push(id)
      }
      prev = id
    }
  }

  // Compressed adjacency: each segment is walkable both ways.
  const degree = new Int32Array(count + 1)
  for (let s = 0; s < a.length; s++) {
    degree[a[s] + 1]++
    degree[b[s] + 1]++
  }
  for (let i = 0; i < count; i++) degree[i + 1] += degree[i]
  const start = degree.slice()
  const fill = degree.slice(0, count)
  const adj = new Int32Array(a.length * 2)
  const adjKm = new Float32Array(a.length * 2)
  const cells = new Map<number, number[]>()
  for (let s = 0; s < a.length; s++) {
    const km = haversineKm(lat[a[s]], lng[a[s]], lat[b[s]], lng[b[s]])
    adj[fill[a[s]]] = b[s]
    adjKm[fill[a[s]]++] = km
    adj[fill[b[s]]] = a[s]
    adjKm[fill[b[s]]++] = km
    const [y0, y1] = [Math.floor(Math.min(lat[a[s]], lat[b[s]]) / CELL_DEG), Math.floor(Math.max(lat[a[s]], lat[b[s]]) / CELL_DEG)]
    const [x0, x1] = [Math.floor(Math.min(lng[a[s]], lng[b[s]]) / CELL_DEG), Math.floor(Math.max(lng[a[s]], lng[b[s]]) / CELL_DEG)]
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const key = y * 100_000 + x
        const list = cells.get(key)
        if (list) list.push(s)
        else cells.set(key, [s])
      }
    }
  }

  return { lat, lng, start, adj, adjKm, segA: Int32Array.from(a), segB: Int32Array.from(b), cells }
}

let loading: Promise<Graph | null> | null = null

// Loads once; a failed load is forgotten so a later call retries.
export function loadWalkGraph(): Promise<Graph | null> {
  if (!isInstalledApp()) return Promise.resolve(null)
  loading ??= fetch(GRAPH_URL)
    .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(`HTTP ${response.status}`))))
    .then(decode)
    .catch(() => {
      loading = null
      return null
    })
  return loading
}

interface Snap {
  seg: number
  point: [number, number]
  km: number
}

// Nearest point on any street, measured on a local flat plane.
function snap(g: Graph, lat: number, lng: number): Snap | null {
  const frame = planarFrame(lat)
  const [cy, cx] = [Math.floor(lat / CELL_DEG), Math.floor(lng / CELL_DEG)]
  let best: Snap | null = null
  const seen = new Set<number>()
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      for (const s of g.cells.get((cy + dy) * 100_000 + cx + dx) ?? []) {
        if (seen.has(s)) continue
        seen.add(s)
        const p = projectPointOnSegment(frame, lat, lng, g.lat[g.segA[s]], g.lng[g.segA[s]], g.lat[g.segB[s]], g.lng[g.segB[s]])
        if (!best || p.distKm < best.km) best = { seg: s, point: [p.lat, p.lng], km: p.distKm }
      }
    }
  }
  return best && best.km <= MAX_SNAP_KM ? best : null
}

// A* from the snapped start to the snapped end; null when either end is off the packed streets.
function route(g: Graph, from: [number, number], to: [number, number]): WalkPath | null {
  const s = snap(g, from[0], from[1])
  const e = snap(g, to[0], to[1])
  if (!s || !e) return null
  // Distance from each tap to its street; the A* cost runs between the snapped points.
  const ends = s.km + e.km

  if (s.seg === e.seg) {
    return { path: [from, s.point, e.point, to], distanceKm: ends + haversineKm(s.point[0], s.point[1], e.point[0], e.point[1]) }
  }

  const n = g.lat.length
  const cost = new Float64Array(n).fill(Infinity)
  const prev = new Int32Array(n).fill(-1)
  const goal = new Map([g.segA[e.seg], g.segB[e.seg]].map((id) => [id, haversineKm(g.lat[id], g.lng[id], e.point[0], e.point[1])]))
  const guess = (id: number) => haversineKm(g.lat[id], g.lng[id], e.point[0], e.point[1])

  // Binary min-heap of [estimate, node].
  const heap: [number, number][] = []
  const push = (f: number, id: number) => {
    heap.push([f, id])
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p][0] <= heap[i][0]) break
      ;[heap[p], heap[i]] = [heap[i], heap[p]]
      i = p
    }
  }
  const pop = () => {
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length > 0) {
      heap[0] = last
      let i = 0
      for (;;) {
        const [l, r] = [i * 2 + 1, i * 2 + 2]
        let m = i
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }

  for (const id of [g.segA[s.seg], g.segB[s.seg]]) {
    const km = haversineKm(s.point[0], s.point[1], g.lat[id], g.lng[id])
    if (km < cost[id]) {
      cost[id] = km
      push(km + guess(id), id)
    }
  }

  let bestKm = Infinity
  let bestEnd = -1
  while (heap.length > 0) {
    const [f, id] = pop()
    if (f >= bestKm) break
    if (f > cost[id] + guess(id) + 1e-9) continue
    const tail = goal.get(id)
    if (tail !== undefined && cost[id] + tail < bestKm) {
      bestKm = cost[id] + tail
      bestEnd = id
    }
    for (let k = g.start[id]; k < g.start[id + 1]; k++) {
      const next = g.adj[k]
      const km = cost[id] + g.adjKm[k]
      if (km < cost[next]) {
        cost[next] = km
        prev[next] = id
        push(km + guess(next), next)
      }
    }
  }
  if (bestEnd < 0) return null

  const nodes: [number, number][] = []
  for (let id = bestEnd; id >= 0; id = prev[id]) nodes.push([g.lat[id], g.lng[id]])
  nodes.reverse()
  return { path: [from, s.point, ...nodes, e.point, to], distanceKm: bestKm + ends }
}

export async function routeOffline(from: [number, number], to: [number, number]): Promise<WalkPath | null> {
  const graph = await loadWalkGraph()
  return graph ? route(graph, from, to) : null
}
