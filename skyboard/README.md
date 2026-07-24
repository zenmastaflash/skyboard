# Skyboard

Ambient live-flight dashboard on a 3D globe. Watch planes drift across the whole
planet, tap one, see what that trip costs today. For daydreaming, not booking.

**Status: Phase 3** — fully live. Positions and routes from community ADS-B
aggregators (adsb.lol, airplanes.live, adsb.fi), aurora from NOAA, and real
bookable fares from Travelpayouts/Aviasales with affiliate links (marker applied
server-side). Delete `js/config.js` to run fully offline on the mock adapter.
Live trails build up over the first half hour of a session — real feeds have no
history to backfill. Remaining: polish pass, then deploy + zenmastaflash.com.

## Run it

Double-click `index.html`. No build step, no server, no CDN: Three.js and the
earth textures ship inside the folder (textures are embedded as data URIs because
Chrome won't feed plain local images to WebGL).

- Drag to spin the globe, scroll to zoom, tap a plane for its card
- Leave it alone for 12 seconds and the globe drifts on its own
- Press **T** for TV mode (globe only, full bleed)
- Day, night city lights, and the dusk band track the real sun, right now
- `MOCK DATA` in the rail footer tells you Phase 1 planes and fares are simulated

## Features

1. Live globe, ~420 aircraft worldwide, positions refreshed every 15 s, 30-minute ghost trails
2. Tap a plane → airline, route, aircraft, cheapest current fare, and the full
   flight path drawn on the globe (flown solid, remaining dashed)
3. Escape now — departures from home in the next 2–6 h, cheapest first
4. Budget ring — dual-thumb €20–1500 fare band; raise the floor to skip
   low-cost hops, raise the ceiling for long-haul; matching destinations light
   up with fare tags on the 10 cheapest
5. Filters — alliance, departure, destination (non-matching planes dim, not vanish)
6. Stats bar — airborne, highest, fastest, longest leg in progress
7. Sunset chaser — planes flying through golden hour glow warm, from solar geometry
8. Cities layer (toggleable) — tap a city for today's fare from home, distance,
   live flights departing from it (click through to the plane), and a one-tap
   "make this home"
9. Aurora chaser — the live NOAA OVATION aurora oval glows green on the night
   side, and planes flying beneath it get green halos. Real data, even in Phase 1.
10. Follow mode — press F (or the card button) and the camera drifts with the
    selected plane; grab the globe to take back control
11. Dream list — star cities from their card; they persist between sessions
    with today's fare from home
12. Search — type a callsign or city name, land on it

Home airport also persists between sessions now.

The escape list honors the budget ring: when the band is active, only
departures inside it appear.

Geolocate note: browsers refuse precise GPS to pages opened from a local file,
so the ◎ button falls back to network (IP) location via ipapi.co, then to the
system timezone. Real GPS works once Skyboard is served over https (Phase 4).
The IP lookup is Skyboard's only runtime network call besides fonts.

## Architecture

```
index.html            load order = dependency order, no bundler
css/skyboard.css      design tokens + all styling, incl. view modes
vendor/three.min.js   Three.js r147 (UMD), bundled locally
assets/textures.js    NASA Blue/Black Marble textures as data URIs
js/
  data/               bundled static data (see DATA.md for provenance)
  core/               bus (events+state), registry, geo math, solar math
  api/
    client.js         THE data facade — UI code only ever calls Skyboard.api
    adapters/mock.js  Phase 1 adapter; Phase 2 adds live.js, same contract
  globe/              3D renderer: earth+camera, planes layer, markers layer
  features/           one file per feature; none import each other
  views/modes.js      swappable layouts: standard, tv (Phase 4: new-tab)
main.js               bootstrap + poll loop
```

Rules that keep feature #8 cheap later: features talk through `Skyboard.bus`
events and read `Skyboard.state`; data access goes through `Skyboard.api` only;
a new feature is one file in `features/` plus one endpoint in the adapter.

See `DATA.md` for entity schemas, identifiers, and the edge-function contract.

## Backend

Supabase project `skyboard` (source in `supabase/functions/`): `skyboard-flights`
(world mosaic of 250 nm circles, 20 s cache), `skyboard-routes` (callsign → route,
30 d cache), `skyboard-aurora` (NOAA proxy, 5 min cache). Credentials live in the
RLS-locked `app_secrets` table; nothing sensitive ever ships to the frontend.
Note: OpenSky turned out to block datacenter IPs, so the community aggregators
(the brief's named fallback) are the primary source.

## Roadmap

- Phase 3 — real fares: Travelpayouts cached fares, affiliate links live
- Phase 4 — wrappers: static-host deploy + zenmastaflash.com embed, Chrome
  new-tab extension, ambient TV mode; https unlocks real GPS geolocation
