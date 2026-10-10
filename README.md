<p align="center"><img src="public/logo.svg" alt="DavGuides" width="320"></p>

**DavGuides** tells you which jeepney to ride in Davao City. Type where you're going, and it shows the route from where you are: where to board and get off, any transfer, when a tricycle beats walking, and the estimated fare.

Live at [davguides.vercel.app](https://davguides.vercel.app).

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

Other scripts: `npm run build`, `npm run lint`, and `npx tsc --noEmit` for a type check.

No API keys are needed. The basemap and place search both use free, open services.

## Docs

- [CONTEXT.md](CONTEXT.md): domain glossary, data model and how the trip planner works.
- [AGENTS.md](AGENTS.md): file map, conventions and checks for anyone (or any agent) changing the code.

## Credits

- Basemap: [OpenFreeMap](https://openfreemap.org) © [OpenMapTiles](https://www.openmaptiles.org/), data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
- Place search: [Nominatim](https://nominatim.org).
- Fares are estimates. The LTFRB sets official fares.
