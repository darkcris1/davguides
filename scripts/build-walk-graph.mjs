// Builds public/walk-graph.bin: OSM streets within ~1.5 km of a jeepney route, packed for src/lib/walk-graph.ts.
// Run with `npm run walk-graph` (Node 22.18+ for the .ts import). Data © OpenStreetMap contributors, ODbL.

import { writeFileSync } from "node:fs"
import { routes } from "../src/lib/routes.ts"

// The main server often answers 502/504 when busy, so a mirror backs it up.
const OVERPASS_URLS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
const HIGHWAYS = "trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|pedestrian|footway|steps|road|service|path"
const CORRIDOR_KM = 1.5
const CELL_DEG = 0.005
const SIMPLIFY_M = 5
const SCALE = 1e5

const lines = routes.map((r) => r.geometry.coordinates)
const pts = lines.flat()
const pad = 0.02
const bbox = [
  Math.min(...pts.map((p) => p[1])) - pad,
  Math.min(...pts.map((p) => p[0])) - pad,
  Math.max(...pts.map((p) => p[1])) + pad,
  Math.max(...pts.map((p) => p[0])) + pad,
].map((n) => n.toFixed(4))

const query = `[out:json][timeout:250];way[highway~"^(${HIGHWAYS})$"](${bbox.join(",")});(._;>;);out skel qt;`
console.log("Fetching streets from Overpass…")
let response
for (const url of OVERPASS_URLS) {
  response = await fetch(url, { method: "POST", body: new URLSearchParams({ data: query }), headers: { "User-Agent": "davguides-walk-graph" } }).catch(
    (error) => (console.log(`${url} failed: ${error.message}`), undefined),
  )
  if (response?.ok) break
  if (response) console.log(`${url} answered HTTP ${response.status}`)
}
if (!response?.ok) throw new Error(`Overpass failed: ${response ? `HTTP ${response.status}` : "no response"}`)
const { elements } = await response.json()

const nodes = new Map()
for (const e of elements) if (e.type === "node") nodes.set(e.id, [e.lat, e.lon])

// Grid cells near any route; a street with a node in one is kept.
const near = new Set()
const reach = Math.ceil(CORRIDOR_KM / (CELL_DEG * 111))
for (const line of lines) {
  for (let i = 0; i < line.length - 1; i++) {
    const [[x1, y1], [x2, y2]] = [line[i], line[i + 1]]
    const steps = Math.max(1, Math.ceil((Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) / CELL_DEG) * 2))
    for (let s = 0; s <= steps; s++) {
      const cx = Math.floor((x1 + ((x2 - x1) * s) / steps) / CELL_DEG)
      const cy = Math.floor((y1 + ((y2 - y1) * s) / steps) / CELL_DEG)
      for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) near.add(`${cx + dx},${cy + dy}`)
    }
  }
}
const inCorridor = (id) => {
  const [lat, lng] = nodes.get(id)
  return near.has(`${Math.floor(lng / CELL_DEG)},${Math.floor(lat / CELL_DEG)}`)
}
const ways = elements.filter((e) => e.type === "way" && e.nodes.some(inCorridor)).map((e) => e.nodes)

// Junctions and way ends must survive simplification, or the graph would lose its connections.
const uses = new Map()
for (const way of ways) {
  for (const id of way) uses.set(id, (uses.get(id) ?? 0) + 1)
  for (const id of [way[0], way.at(-1)]) uses.set(id, uses.get(id) + 1)
}
const isJunction = (id) => uses.get(id) >= 2

function offsetM(p, a, b) {
  const k = 111320
  const cos = Math.cos((a[0] * Math.PI) / 180)
  const [ax, ay, bx, by, px, py] = [a[1] * k * cos, a[0] * k, b[1] * k * cos, b[0] * k, p[1] * k * cos, p[0] * k]
  const [dx, dy] = [bx - ax, by - ay]
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}

// Douglas-Peucker over node ids.
function simplify(ids) {
  if (ids.length < 3) return ids
  const [a, b] = [nodes.get(ids[0]), nodes.get(ids.at(-1))]
  let [worst, worstM] = [0, 0]
  for (let i = 1; i < ids.length - 1; i++) {
    const m = offsetM(nodes.get(ids[i]), a, b)
    if (m > worstM) [worst, worstM] = [i, m]
  }
  if (worstM <= SIMPLIFY_M) return [ids[0], ids.at(-1)]
  return [...simplify(ids.slice(0, worst + 1)).slice(0, -1), ...simplify(ids.slice(worst))]
}

const kept = ways.map((way) => {
  const out = []
  let run = [way[0]]
  for (const id of way.slice(1)) {
    run.push(id)
    if (isJunction(id)) {
      out.push(...simplify(run).slice(0, -1))
      run = [id]
    }
  }
  out.push(...(run.length > 1 ? simplify(run) : run))
  return out
})

const bytes = []
const varint = (n) => {
  while (n >= 0x80) {
    bytes.push((n & 0x7f) | 0x80)
    n = Math.floor(n / 128)
  }
  bytes.push(n)
}
const zigzag = (n) => (n < 0 ? -2 * n - 1 : 2 * n)

// Points in first-seen order, so neighbours sit close and their deltas stay small.
const index = new Map()
const order = []
for (const way of kept) for (const id of way) if (!index.has(id)) index.set(id, order.push(id) - 1)

bytes.push(..."DGW1".split("").map((c) => c.charCodeAt(0)))
varint(order.length)
varint(kept.length)
let [pLat, pLng] = [0, 0]
for (const id of order) {
  const [lat, lng] = nodes.get(id).map((v) => Math.round(v * SCALE))
  varint(zigzag(lat - pLat))
  varint(zigzag(lng - pLng))
  ;[pLat, pLng] = [lat, lng]
}
for (const way of kept) {
  varint(way.length)
  let prev = 0
  for (const id of way) {
    varint(zigzag(index.get(id) - prev))
    prev = index.get(id)
  }
}

writeFileSync(new URL("../public/walk-graph.bin", import.meta.url), Uint8Array.from(bytes))
console.log(`Wrote public/walk-graph.bin: ${kept.length} streets, ${order.length} points, ${(bytes.length / 1024).toFixed(0)} KB`)
