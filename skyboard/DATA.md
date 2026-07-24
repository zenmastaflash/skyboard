# Skyboard data architecture

FAIR by design: every entity has one stable public identifier, one documented schema,
one place it lives, and one access path. Mock and real adapters return identical shapes,
so swapping in edge functions (Phase 2/3) touches only `js/api/adapters/`.

## Identifiers

| Entity  | ID                      | Why                                                        |
|---------|-------------------------|------------------------------------------------------------|
| Airport | IATA code (`AMS`)       | Human-readable, used by every price API                    |
| Airline | ICAO callsign prefix (`KLM`) | Directly derivable from live callsigns                |
| Flight  | `icao24` hex transponder id | OpenSky's native key; survives callsign changes        |
| Fare    | `ORIGIN-DEST` city pair | Matches Travelpayouts cache granularity                    |

## Core entities (returned by `Skyboard.api`)

```js
Airport = { iata, icao, name, city, country, lat, lon, tz }

Airline = { icaoPrefix, iata, name, alliance }   // alliance: star|oneworld|skyteam|none

Flight = {
  id,            // icao24
  callsign,      // e.g. "KLM1234"
  airline,       // Airline | null (unresolved)
  origin, destination,  // iata | null (unresolved routes stay null, never guessed)
  aircraft,      // ICAO type, e.g. "A20N"
  lat, lon, altitudeM, headingDeg, velocityMs,
  updatedAt,     // epoch ms of last position report
  trail,         // [{lat, lon, t}] last 30 min, oldest first
}

Fare = { origin, destination, price, currency, deepLink, fetchedAt }

Departure = { callsign, airline, destination, departsAt, fare }  // fare may be null
```

## Access path — one facade, swappable adapters

All UI code calls `Skyboard.api.*` only. Never a fetch in a feature module.

```js
Skyboard.api.getFlights()                     -> Promise<Flight[]>     // poll every 15–30 s
Skyboard.api.getFare(origin, destination)     -> Promise<Fare|null>
Skyboard.api.getFaresFrom(origin)             -> Promise<Fare[]>       // budget ring
Skyboard.api.getDepartures(origin, hMin, hMax)-> Promise<Departure[]>  // escape now
Skyboard.api.getAurora()                      -> Promise<Aurora>       // aurora chaser
```

```js
Aurora = { fetchedAt, points: [{ lat, lon, intensity }] }  // intensity 0–100
```

These five calls are the contract implemented by the Supabase edge functions
(project `skyboard`, source in `supabase/functions/`), and later by the Widgy
widget and MCP server.

## Phase 2 status — what's live vs mocked

| Call | Adapter path | Source |
|------|-------------|--------|
| getFlights | edge fn `skyboard-flights` | adsb.lol / airplanes.live / adsb.fi (community ADS-B). OpenSky blocks datacenter IPs; the brief's fallback became primary. World = mosaic of ~30 hub circles (round-robin) + a fresh circle at camera focus. |
| routes (inside getFlights) | edge fn `skyboard-routes` | adsb.lol routeset, cached 30 d in the `routes` table. Only airports in the curated set are accepted; others stay null. |
| getAurora | edge fn `skyboard-aurora` | NOAA SWPC OVATION, 5-min server cache; direct NOAA fallback client-side. |
| getFare / getFaresFrom | edge fn `skyboard-fares` | Travelpayouts cached-prices API (6 h server cache, 10 min client cache). Affiliate links built server-side with the marker. Fare gains `departDate` (real bookable date). |
| getDepartures | derived | The cheapest real fares out of an origin, with travel dates — no synthetic departure times. |

Wire row from `skyboard-flights` (compact, documented in the function header):
`[icao24, callsign, lat, lon, altM, trackDeg, velocityMs, lastContactS, type]`

Trails are accumulated client-side (live feeds have no history), so ghost trails
grow over the first 30 minutes of a session. Position staleness varies by region
(focus ≤20 s, far mosaic regions up to ~5 min); the renderer dead-reckons along
each plane's heading at its reported speed for the full freshness window, so
planes glide continuously and fresh reports ease in as corrections. Adapters live in `js/api/adapters/` — Phase 1
ships `mock.js`; Phase 2 adds `live.js` with the same interface.

## Bundled static data (`js/data/`)

| File          | Source & license                          | Regeneration                |
|---------------|-------------------------------------------|-----------------------------|
| `airports.js` | OpenFlights airports.dat (ODbL), curated 343 world airports | `tools/gen_airports.js` |
| `airlines.js` | Hand-curated, ~130 carriers with alliance membership as of 2026-07 | edit by hand |
| `assets/textures.js` | NASA Blue Marble / Black Marble via three-globe examples (public domain / MIT), embedded as data URIs | re-embed from three-globe npm pkg |

Rows are stored as compact arrays (documented in each file header) and hydrated into
the entity objects above by `js/core/registry.js` at startup. Provenance, license, and
generation date live in each file's header comment.

## Caching intent (for Phase 2/3 edge functions)

| Data        | TTL        |
|-------------|------------|
| Positions   | 15–30 s    |
| Routes (callsign → O/D) | 24 h |
| Fares       | 6–12 h     |
