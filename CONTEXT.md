# DavGuides: project context

DavGuides is a jeepney trip planner for Davao City. A rider searches for a destination. The app uses their GPS position as the starting point and tells them which jeepney to ride, where to get on and off, where to transfer, when a tricycle beats walking, and roughly what it costs.

This document covers the domain, the data and the reasoning behind the planner. For how to work in the repo, see [AGENTS.md](AGENTS.md).

## Glossary

| Term | Meaning here |
| --- | --- |
| **Jeepney (jeep)** | Fixed-route public utility vehicle. It is the main mode, and the only one the planner routes on. |
| **Route** | One jeepney service, such as "Toril" or "Bunawan via Sasa". It is stored as a GeoJSON LineString in `src/lib/routes.ts`. |
| **Ring / loop** | A route whose last vertex meets its first. The outbound and return trips are one continuous line. 52 of the 53 routes are rings. |
| **Corridor** | A route stored as an open line, such as Panabo to Davao City. It is treated as running both ways on the same road. |
| **Arc / arcKm** | Distance along a route from vertex 0, in km. All direction logic works in arc space, not map space. |
| **Turnaround** | The far terminal of an out-and-back ring. Riding across it costs a layover penalty. |
| **Terminal** | Either end of a ring, meaning arc 0 or the turnaround. Riders are usually put off there and have to re-board. |
| **Access point** | A spot on a route within walking or tricycle range of the origin (boarding) or the destination (alighting). |
| **Gap leg** | A walk or tricycle leg: origin to boarding point, between two jeeps, or last stop to destination. |
| **Transfer** | Getting off one jeep and boarding another. The planner allows at most one (`MAX_LEGS: 2`). |
| **Tricycle** | A motorbike with a sidecar, used for short hops. It is suggested for gaps over 300 m and recommended over 500 m. |
| **Signboard** | The yellow route-name placard in the UI, modelled on the boards in jeepney windshields. |
| **LTFRB** | The national regulator that sets jeepney fares. Fares in the app are estimates. |

## Architecture

```
page.tsx (server)  ->  AppShell (client)
                         ├─ SearchBox ──> lib/nominatim.ts ──> Nominatim API
                         ├─ useUserLocation (browser geolocation)
                         ├─ useRouteData ──> dynamic import of lib/routes.ts ──> getRouteIndex
                         ├─ planTrips (lib/route-engine.ts), recomputed in useMemo
                         ├─ TripPanel (bottom sheet on phones, side panel from md: up)
                         └─ MapComponent (next/dynamic, ssr:false)
                               ├─ Leaflet map + MapLibre GL basemap (OpenFreeMap "liberty" style)
                               └─ lib/trip-render.ts draws the trip and endpoint layers
```

- **Server-rendered shell.** `AppShell` is a client component, but it still SSRs. The h1, search box and intro text are in the initial HTML. Only the map is client-only, because Leaflet touches `window` on import.
- **Route data is lazy.** `routes.ts` is about 800 KB. `useRouteData` imports it after first paint, so it stays out of the page bundle.
- **Fares are display-only.** `FareConfig` never reaches the optimizer. Editing fares re-prices the existing plans without a new search. Settings persist in `localStorage` under `davguides.fare`.

## Data model

`routes.ts` exports an array of GeoJSON Features: `{ properties: { name, color }, geometry: { coordinates: [lng, lat][] } }`.

- **Coordinate order.** GeoJSON in `routes.ts` is `[lng, lat]`. Everything else (Leaflet, app types, `TripLeg.path`) is `[lat, lng]`. Mixing them up is the classic bug here, so geometry helpers name their parameters explicitly.
- **Route colours repeat.** Only 8 hex values cover 53 routes, and Toril, Calinan and Bangkal are all `#ff0000`. Trip legs therefore use their own `LEG_PALETTE` instead.
- **Messy geometry.** The data includes 47 zero-length segments (duplicate vertices). Vertex density varies more than tenfold, from 107 to 1,423 vertices per route.

## Route index (`lib/route-index.ts`)

`getRouteIndex(routes)` builds an index once per routes array and caches it in a module-level `WeakMap`, so it survives remounts and Fast Refresh. Each entry holds:

- **`cum`.** Cumulative arc length per vertex. The distance between two points on a route is then one subtraction.
- **`bbox` and `chunkBBox`.** Bounding boxes for the whole route and for each 64-segment chunk, used for early rejection in spatial queries.
- **`isLoop`.** True when the first and last vertex are within 20 m of each other.
- **`turnaroundArcKm`.** The far terminus of an out-and-back ring, found as follows:
  - The candidate is the vertex furthest from the seam.
  - It only counts if samples from the outbound half have the return half passing within 400 m.
  - That tolerance is loose on purpose. Return legs usually run on a parallel street, 160–645 m away, not on the same kerb.
  - True circuits, such as Route 4 and Route 11, get `null`, so ordinary rides across them aren't penalised.
  - This runs in a local planar frame. That keeps it at a few milliseconds across all 33k vertices.

### Direction rules (`rideAlongRoute`)

Getting direction wrong is what makes a planner recommend a jeep heading the other way.

- **Ring.** Vertex order is the only record of travel direction, so only increasing arc is valid. A ride that wraps the seam is allowed but counts as crossing a terminal. Crossing the turnaround also counts as a terminal.
- **Corridor.** Both directions are real service on the same road. A reverse ride is allowed, flagged as `reversed`, and drawn back in travel order so the arrows point the right way.

## Trip planner (`lib/route-engine.ts`)

`planTrips(routes, origin, destination)` returns up to 5 `TripPlan`s.

1. **Short trips.** If the straight-line distance is under 400 m (`MIN_RIDE_KM`), the planner returns a walk-only plan.
2. **Radius tiers.** For each search radius in `CANDIDATE_RADIUS_TIERS_KM` (0.5, 0.8, 1.5 and 2.5 km):
   - **Access points.** `findAccessPoints` finds boarding and alighting points.
     - Each point is a perpendicular projection onto a segment, not the nearest vertex. The nearest vertex can be off by up to half a segment: 376 m on dense loops, and kilometres on the sparse Panabo line.
     - Candidates are deduped by **separation along the arc** (`CANDIDATE_ARC_SEPARATION_KM` = 0.4 km), never by distance on the ground. Outbound and return legs often run within 40 m of each other (Toril retraces 65% of its path), so ground-distance dedupe would merge the two directions. Raising this past about 1.5 km risks bringing that bug back.
   - **Direct rides.** `solveDirect` tries every board/alight pair on routes that serve both ends.
   - **Transfers.** `solveTransfers` only runs when no direct ride exists, or the best one is slow: over 25 min **and** more than 1.5× the theoretical best (straight-line distance at jeepney speed). Without the relative test, every trip over about 4 km would pay for a transfer search it never uses.
     - It considers the 6 routes nearest each end, so at most 36 pairs.
     - `findTransferPoints` hashes route B's vertices into buckets the size of the walking tolerance, then sweeps route A, checking only the 9 neighbouring buckets. Brute force would be 640k distance checks for one pair of 800-vertex routes.
     - It emits one transfer point per stretch where the routes run together, not one global minimum. Downtown pairs share kilometres of road, and the best meeting point depends on the rider's ends.
     - The transfer cost splits cleanly into board→transfer and transfer→alight, so each side is optimised on its own.
     - Results are cached per pair in `index.transferCache`.
   - **Accumulate.** Plans from every tier are pooled, so a plan found at a tight radius is never lost.
   - **Stop early.** The search stops once 3 plans have a ride within 2× the straight-line distance (`ACCEPTABLE_DETOUR_RATIO`). Counting detours here used to let three long way-round rides end the search before the wider radius exposed the obvious short route.
3. **Dedupe.** `dedupePlans` first collapses plans with the same route sequence. It then merges "twins": plans whose jeepney legs board, alight and ride a similar distance within 300 m. Several routes share corridors (Lasang via Sasa, Bunawan via Sasa, Panacan - SM City Davao). Survivors list the others as alternatives ("Also goes there").
   - Matching endpoints alone is not enough. Two routes can board and alight at the same spots yet take very different paths, which could send a rider 3 km out of their way.
4. **Sort.** Plans are selected by cost (which includes long-walk penalties) but shown by duration. A list reading 70, 71, 69 min looks broken.

### Cost model (`lib/transport-config.ts`)

All tunables live in `THRESHOLDS`, and the optimizer reads only those. The main ones:

- **Speeds.** Walking 4.5 km/h, jeepney 18 km/h including stops, tricycle 15 km/h plus a 3 min wait.
- **Access cost.** Up to 500 m this is walking time. Beyond that it is `min(walk, tricycle)` plus a 6 min/km penalty. Tricycle awareness has to live *inside* the cost. Otherwise the planner picks a 1.1 km walk because walking looked cheap, then the UI suggests a tricycle for a plan that was only chosen on the assumption you'd walk.
- **Waits.** Boarding wait is 4 min. Transfer wait is 5 min, set higher so a direct ride beats an equal-length transfer.
- **Terminals.** Each terminal crossed adds an 8 min layover penalty. Rides covering more than 75% of a loop are rejected.
- **Doubtful data.** Riding a route against its drawn direction, or riding a coarse route (under 60 points), adds 2 min each. A ride is never rejected for this. The penalty only decides ties, such as "Panabo to Davao City" against "Sasa via JP Laurel" on the same street.
- **Rare routes.** Routes in `INFREQUENT_ROUTES` (for now only "Panabo to Davao City") wait 15 min instead of 4.
  - That wait shows in the trip time and in the leg details, and the trip carries a "passes rarely" warning.
  - A rare route is never merged into a frequent twin as "Also goes there". It stays its own card, ranked below the frequent one.
- **Pruning.**
  - Plans that cost more than 20 min above the best plan are dropped.
  - A plan that needs a tricycle is shown only when it beats the fastest walkable plan by at least 10 min.
  - From R. Castillo to Sasa, this removes "Panacan via Cabaguio" (a 1.2 km tricycle ride for 2 min saved) and "Lasang via Buhangin" (50 min).
- **Tricycle only.** Trips up to 3 km (`TRICYCLE_DIRECT_MAX_KM`) also get a door-to-door tricycle plan.
  - It follows the tricycle rule above: it shows only when no walk-to-jeep plan exists, or it beats the best one by 10 min. So a jeep that serves the short way stays the answer, and one that loops the long way loses.
  - Jeep plans that still need a tricycle leg and are slower than the tricycle alone are dropped, because they cost more and take longer.
  - It never counts toward the early stop, so the radius search runs as before.
- **Loading hubs** (`lib/loading-hubs.ts`).
  - **The problem.** Outbound jeeps fill up where they load downtown. At rush hour (5–8 AM and 5–8 PM Davao time), riders who try to board further out are left waiting.
  - **Transfer penalty.** At rush hour, transferring onto a hub-served route more than 500 m past its hub, in the outbound direction, adds a 15 min seat wait.
    - The wait counts toward the displayed time, and the trip gets a warning.
    - First boardings are never penalized, so a rider standing on the route boards where they are.
  - **Hub as a transfer point.** Each hub is always offered as a transfer point, because transfer search keeps only the shortest-walk point of a shared stretch and would otherwise skip it.
  - **Loop turnaround.** A loop's geometric turnaround within 1.5 km of its hub moves onto the hub, so boarding at the hub isn't treated as riding through a terminal.
  - **Sources.**
    - The route-to-hub list comes from the Lakbay Agila commuter guide (2024), checked against news coverage of the PHABS peak-hour buses and DC Bus routes. There is no official list.
    - Roxas Ave and Acacia have high confidence. Bankerohan, Agdao, R. Magsaysay, Gaisano Bajada, San Pedro and Ecoland have medium confidence.
    - "Acacia" means the downtown junction, not Barangay Acacia in Buhangin.
- **Fares.**
  - Jeepney fares follow the LTFRB traditional-jeepney fare in force from 28 Sept 2026: ₱14 for the first 4 km, then ₱2 for each whole extra km. Conductors charge per whole km band.
  - Tricycle fares follow Davao MTH Board Resolution No. 01-2020: ₱10 for the first 4 km, then ₱1 for each whole extra km, per passenger. Drivers often ask more for a special trip, so the app labels it an estimate.
  - Every fare rounds up to the nearest ₱0.25.
  - **Discount.** The "Student, senior or PWD" switch takes 20% off the full fare, then rounds up to the nearest 25 centavos, so ₱14 becomes ₱11.25. Students are covered by RA 11314, seniors by RA 9994 and PWDs by RA 7277. Fare Settings → Reset keeps the discount choice.

## Rendering (`lib/trip-render.ts`)

- **Ridden arc only.** Only the ridden arc is drawn solid. The rest of the loop is a faint context line, because a fully drawn ring tells the rider nothing about direction.
- **Arrows.** Direction arrows are spaced by distance (0.8 km), not by vertex count, so sparse and dense routes look alike. Headings use the true compass bearing.
- **Escaping.** Every string that goes into Leaflet popup, tooltip or divIcon HTML passes through `escapeHtml`. Place names come from OSM, which anyone can edit.
- **Street paths move stops.** When a walk's street path reaches the jeep's road before the planned stop, the stop moves to where the path first meets the route (or last leaves it, when getting off). Only points within 30 m of the route and within the walk's length along its arc count, so the return leg on the same street never matches. A move that changes terminals crossed or direction, or leaves a ride under 400 m, is skipped. Display only, like the street paths.
- **Endpoint markers.** The rider and destination markers live on their own layer. They show even when there is no trip.

## External services

| Service | Use | Constraints |
| --- | --- | --- |
| [OpenFreeMap](https://openfreemap.org) | Vector basemap, style `liberty`, rendered through `@maplibre/maplibre-gl-leaflet` | No API key. Attribution comes from the style. Import the plugin from the `/leaflet-maplibre-gl` subpath, because the package's ESM `dist/` is missing. |
| [Nominatim](https://nominatim.org/release-docs/latest/api/Search/) | Place search on submit | At most 1 request per second, search on submit only (no autocomplete), results bounded to a Davao viewbox and filtered to "Davao City". |
| [Photon](https://photon.komoot.io) | Suggestions while typing; fallback when Nominatim search fails | No API key, fair use. 3+ characters and a 300 ms typing pause, earlier requests aborted, cached per query. Bounded to the same box and filtered to `city: "Davao City"`. |
| Browser Geolocation | Trip origin | Fixes worse than 300 m accuracy get a warning. Moves under 20 m are ignored, so GPS jitter doesn't replan. |
| [FOSSGIS OSRM foot](https://routing.openstreetmap.de/) | Street paths for the active trip's walk and tricycle legs | No API key, fair use only: 1 request/second, active trip only, cached per leg. On failure the leg stays a straight line. Distances and times it returns are display-only, like fares. |
| Photon reverse, then Nominatim reverse | Names a pin dropped or dragged on the map | Called on drop or drag end, never during a drag. Nominatim only runs when Photon fails, under the same 1 request/second budget as search. |
| Vercel Web Analytics | Visitor counts | The query string is stripped in `beforeSend`, because trip links carry riders' coordinates. |

## Map interaction and URL

- **Pins.** Long-press (450 ms) or right-click drops a destination. Both pins drag; a dragged pin lifts 18 px above the finger and drops where it is drawn. Pin moves replan but don't refit the map; search picks, swaps and trip-card taps do.
- **Bottom sheet.** `use-bottom-sheet.ts` snaps between peek, half and full. It moves by transform while dragging, then settles to a real height so the content can scroll. A flick over 0.4 px/ms moves one snap.
- **Trip links.** `?to=&to_name=&from=&from_name=&trip=` restores the endpoints and the picked trip card. `from` is left out when the start is GPS.

## Start ride

- **Gate.** Start ride needs a precise fix: GPS accuracy within 100 m. A denied, unsupported or rougher fix ("approximate" mode, Wi-Fi) opens a prompt with the device's precise-location steps. Try again asks for a fresh fix (`maximumAge: 0`) and the ride starts as soon as one is precise.
- **Frozen trip.** The active trip, with its street-snapped stops, is copied at start. Replans never swap it mid-ride.
- **Tracking.** `watchPosition` with high accuracy, plus a screen wake lock where supported. `ride-progress.ts` snaps each fix onto the current leg's line and measures what is left.
  - A leg ends within 40 m of its end. Being on a later leg's line, 100 m past its start, skips ahead, so boarding early never leaves the guide stuck.
  - On a jeepney leg, within 50 m of the stop means waiting. Within 250 m of the drop-off shows a "Get off soon" alert and vibrates once.
  - Arrival sticks, so GPS drift at the destination doesn't undo it.
  - Progress is forward-only: each fix snaps onto the leg within 100 m behind and 1.5 km ahead of the last one, so a leg that runs out and back on one road can't jump to the return lane. Leaving the stop ends "waiting" for good.
  - A failed fix says why: blocked, no signal, or no browser support.
- **Map.** Follows the rider, centred in the part the sheet leaves visible. Panning pauses follow; Locate resumes it.

## Known limits

- The start is GPS by default. Riders can drag the blue dot or long-press and pick "Start from here instead", but there is no typed "from" search yet.
- At most one transfer per trip.
- No Mandug, Tigatto or Cabantian route is in the data yet, so trips there can't be planned.
- The route data is a static snapshot. Routes that changed after it was captured will be wrong.
- Fares are estimates. The LTFRB changes them, and riders can edit them in Fare settings.
- `planTrips` runs on the main thread. The first search builds the index and can take a moment on low-end phones.
