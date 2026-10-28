# AGENTS.md

Guide for coding agents working in this repo. For background on the domain and on how the planner works, read [CONTEXT.md](CONTEXT.md) first.

## Stack

- **App**
  - Next.js 16 (App Router, Turbopack), React 19.3, TypeScript in strict mode.
  - Tailwind CSS v4: tokens live in `src/app/globals.css` under `@theme inline`.
  - `lucide-react` for icons.
- **Map**
  - Leaflet 1.9 draws the overlays.
  - MapLibre GL draws the basemap through `@maplibre/maplibre-gl-leaflet`, using the OpenFreeMap style.
- **Tooling**
  - No test runner yet.
  - Checks: `tsc`, ESLint (`next/core-web-vitals` + `next/typescript`) and `next build`.

## Commands

```bash
npm install
npm run dev          # http://localhost:3000
npx tsc --noEmit     # type check
npm run lint         # ESLint
npm run build        # production build; also generates icon, OG image, robots, sitemap, manifest
```

Run `npx tsc --noEmit && npm run lint && npm run build` before calling work done.

## File map

| Path | What lives there |
| --- | --- |
| `src/app/layout.tsx` | Fonts (Geist, Barlow Condensed), SEO metadata, viewport, JSON-LD |
| `src/app/page.tsx` | Server page: renders `AppShell` and a `<noscript>` fallback |
| `src/app/{robots,sitemap,manifest}.ts` | Generated SEO files |
| `src/app/opengraph-image.tsx` | 1200×630 social card built with `next/og` |
| `src/app/icon.svg`, `apple-icon.png`, `favicon.ico` | App icons. Next serves these automatically. |
| `src/components/app-shell.tsx` | Layout, state and trip planning. Responsive bottom sheet / side panel. |
| `src/components/search-box.tsx` | Accessible combobox for Nominatim results |
| `src/components/trip-panel.tsx` | Trip cards, signboards, leg details, fare settings |
| `src/components/map-component.tsx` | Leaflet map plus MapLibre basemap. Client-only. |
| `src/lib/route-engine.ts` | `planTrips` and the solvers |
| `src/lib/route-index.ts` | Precomputed route geometry, ring and turnaround detection, ride direction |
| `src/lib/transport-config.ts` | Every planner threshold, plus fare math |
| `src/lib/trip-render.ts` | Draws a `TripPlan` onto Leaflet layers |
| `src/lib/geo.ts` | Pure geometry and formatting helpers |
| `src/lib/nominatim.ts` | Place search on submit, throttled to 1 request/second |
| `src/lib/photon.ts` | Search-as-you-type suggestions and pin naming, with Nominatim fallback |
| `src/lib/routed-trip.ts` | Applies street walk paths to the active trip and moves stops to where they meet the route |
| `src/lib/use-*.ts` | Hooks for geolocation, lazy route data, fare settings and the live ride |
| `src/lib/ride-progress.ts` | Pure step tracker for Start ride: current leg, distance left, get-off alert |
| `src/components/ride-panel.tsx`, `precise-location-prompt.tsx` | Live ride guide, and the precise-location gate before it |
| `src/lib/davao-places.ts` | 121 well-known places searchable offline. Keep the list under 5 KB minified. |
| `src/lib/offline.ts`, `public/sw.js` | Service worker: caches the app, route data, visited tiles and walk paths |
| `src/lib/walk-graph.ts` | Offline walk router for the installed app, reading `public/walk-graph.bin` |
| `scripts/build-walk-graph.mjs` | `npm run walk-graph`: rebuilds `walk-graph.bin` from Overpass. Rerun when routes or streets change. |
| `src/lib/site.ts` | Site name, URL, description and brand colours |
| `src/lib/routes.ts` | About 800 KB of route GeoJSON. Never import it statically from client code. |
| `public/` | `logo.svg` (wordmark), `logo-mark.svg`, PWA PNG icons |

## Conventions

- **Comments.** One short sentence per comment, on one line, two lines at most. No JSDoc paragraphs, no `// ---` dividers, nothing that restates the code. Longer rationale goes in CONTEXT.md.
- **Commits.** A single line, with no body and no trailers.
  - Use `<TICKET>: message` when there is a ticket. Otherwise use `fix:`, `feat:`, `chore:` and so on.
  - Plain human wording.
  - Don't commit unless asked.
- **Code style.** No semicolons, double quotes, 2-space indent. Use the `@/` alias for `src/`. Match the surrounding code.
- **Coordinates.** `routes.ts` is `[lng, lat]`. Everything else is `[lat, lng]`, or `{ lat, lng }` objects.
- **Client-only code.**
  - Leaflet and MapLibre may only be imported from components loaded with `next/dynamic({ ssr: false })`.
  - Import the MapLibre plugin from `@maplibre/maplibre-gl-leaflet/leaflet-maplibre-gl`.
- **Mobile first.**
  - Write base classes for phones, then add `md:` for the desktop side panel.
  - Touch targets are at least 44px (`size-11` / `min-h-11`).
  - Respect safe-area insets and `prefers-reduced-motion`.
- **Brand tokens.** Use `--dg-navy`, `--dg-yellow`, `--dg-red` and `--dg-ink` from `globals.css`. The display font is `font-signboard` (Barlow Condensed): use it only for signboards and headings.
- **Accessibility.**
  - Icon-only buttons need an `aria-label`.
  - The search is a combobox/listbox with arrow-key support.
  - Trip cards use `aria-pressed`.
  - Keep `aria-live` status text accurate.

## Do and don't

- **Do** escape every string that goes into Leaflet HTML (popups, tooltips, `divIcon`) with `escapeHtml` from `src/lib/utils.ts`.
- **Do** keep planner tunables in `THRESHOLDS`. Fares are display-only and must never feed the optimizer.
- **Do** dedupe route candidates by arc separation, never by ground distance. CONTEXT.md explains why.
- **Don't** add a tile or geocoding provider that needs an API key. CARTO was dropped for that reason.
- **Don't** call Nominatim on each keystroke or more than once a second. Their usage policy forbids it. Typing suggestions go to Photon.
- **Don't** let `public/` and `src/app/` both define the same file name. For example, `icon.svg` in both places makes Next return a 500.

## Verifying UI changes

There is no e2e suite. To check a change:

1. Start `npm run dev`.
2. Open the app at 390×844 for phone and 1366×800 for desktop.
3. Grant or fake geolocation: Chrome DevTools > Sensors, set to about `7.0735, 125.6118`.
4. Search "SM Lanang", pick a result, and check the route, arrows, sheet and fare.
5. Deny location and confirm the "location needed" state appears.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
