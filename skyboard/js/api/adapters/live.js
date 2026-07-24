// Skyboard live adapter — Phase 2. Real positions and routes via the Supabase
// edge functions; fares stay mocked until Phase 3 (Travelpayouts).
// Same five-call contract as the mock (DATA.md); nothing above this file changes.
window.Skyboard = window.Skyboard || {};
Skyboard.adapters = Skyboard.adapters || {};

Skyboard.adapters.live = (() => {
  const { registry } = Skyboard;
  const base = () => Skyboard.config.functionsBase;
  const TRAIL_MS = 30 * 60 * 1000;
  const MAX_FLIGHTS = 3800;
  const ROUTE_BATCH = 150;

  // camera focus hook (set by main.js) — tells the server where to look closest
  let focusProvider = null;
  const setFocusProvider = (fn) => { focusProvider = fn; };

  // client-side accumulation: trails grow as the session runs
  const history = new Map();     // icao24 -> [{lat, lon, t}]
  // callsign -> {origin, destination} | null (unknown) | "pending"
  const routeCache = new Map();

  function appendHistory(id, lat, lon, t) {
    let h = history.get(id);
    if (!h) { h = []; history.set(id, h); }
    const last = h[h.length - 1];
    if (!last || Math.abs(last.lat - lat) + Math.abs(last.lon - lon) > 0.001) {
      h.push({ lat, lon, t });
    }
    while (h.length && t - h[0].t > TRAIL_MS) h.shift();
    if (h.length > 60) h.splice(0, h.length - 60);
    return h;
  }

  async function resolveRoutes(flights) {
    // any airline-shaped callsign, not just carriers in the bundled table —
    // adsbdb knows far more of the world than we do
    const need = flights.filter((f) =>
      f.callsign && /^[A-Z]{2,3}[0-9][A-Z0-9]*$/.test(f.callsign) &&
      !routeCache.has(f.callsign)).slice(0, ROUTE_BATCH);
    if (!need.length) return;
    for (const f of need) routeCache.set(f.callsign, "pending");
    try {
      const res = await fetch(`${base()}/skyboard-routes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planes: need.map((f) => ({ callsign: f.callsign, lat: f.lat, lon: f.lon })),
        }),
      });
      const { routes } = await res.json();
      for (const f of need) {
        if (!(f.callsign in routes)) {
          routeCache.delete(f.callsign);   // not resolved this round: retry
          continue;
        }
        const r = routes[f.callsign];
        // adsbdb supplies coordinates + city names, so routes work even for
        // airports outside the bundled set; null = honestly unknown
        routeCache.set(f.callsign, r && r.origin ? r : null);
      }
    } catch (_err) {
      for (const f of need) routeCache.delete(f.callsign);   // retry next poll
    }
  }

  // ── real fares (Phase 3): skyboard-fares with short client caches ──
  const FARE_TTL = 10 * 60 * 1000;
  const faresFromCache = new Map();   // origin -> {t, list}
  const pairCache = new Map();        // "A:B" -> {t, fare}

  async function getFaresFrom(origin) {
    const hit = faresFromCache.get(origin);
    if (hit && Date.now() - hit.t < FARE_TTL) return hit.list;
    try {
      const res = await fetch(`${base()}/skyboard-fares?origin=${origin}`);
      if (!res.ok) throw new Error(`fares ${res.status}`);
      const { fares } = await res.json();
      const list = fares || [];
      faresFromCache.set(origin, { t: Date.now(), list });
      return list;
    } catch (_err) {
      return hit ? hit.list : [];   // stale beats empty; empty beats a crash
    }
  }

  async function getFare(o, d) {
    const dump = faresFromCache.get(o);
    if (dump && Date.now() - dump.t < FARE_TTL) {
      const f = dump.list.find((x) => x.destination === d);
      if (f) return f;
    }
    const key = `${o}:${d}`;
    const hit = pairCache.get(key);
    if (hit && Date.now() - hit.t < FARE_TTL) return hit.fare;
    try {
      const res = await fetch(`${base()}/skyboard-fares?origin=${o}&destination=${d}`);
      const { fare } = await res.json();
      pairCache.set(key, { t: Date.now(), fare: fare || null });
      return fare || null;
    } catch (_err) {
      return null;
    }
  }

  return {
    name: "live",
    setFocusProvider,

    async getFlights() {
      const focus = focusProvider ? focusProvider() : null;
      const q = focus ? `?lat=${focus.lat.toFixed(1)}&lon=${focus.lon.toFixed(1)}` : "";
      const res = await fetch(`${base()}/skyboard-flights${q}`);
      if (!res.ok) throw new Error(`flights ${res.status}`);
      const { flights: rows } = await res.json();

      let flights = rows.map((r) => {
        const [id, callsign, lat, lon, altitudeM, headingDeg, velocityMs, lastContactS, type] = r;
        return {
          id, callsign,
          airline: registry.airlineFromCallsign(callsign),
          origin: null, destination: null,
          aircraft: type || null,
          lat, lon, altitudeM, headingDeg, velocityMs,
          updatedAt: lastContactS * 1000,
          trail: null,
        };
      })
      // airliners over hobby traffic: fast or high, with a callsign
      .filter((f) => f.callsign && (f.velocityMs >= 80 || f.altitudeM >= 5000));

      // known airlines first, then the fast movers; then cap for the renderer
      flights.sort((a, b) =>
        (b.airline ? 1 : 0) - (a.airline ? 1 : 0) || b.velocityMs - a.velocityMs);
      flights = flights.slice(0, MAX_FLIGHTS);

      await resolveRoutes(flights);

      for (const f of flights) {
        const r = routeCache.get(f.callsign);
        if (r && r !== "pending") {
          f.origin = r.origin;
          f.destination = r.destination;
          f.routeInfo = r;   // cities + coords for threads, paths, cards
        }
        f.trail = appendHistory(f.id, f.lat, f.lon, f.updatedAt).slice();
      }
      // forget planes gone from view for a while
      if (history.size > MAX_FLIGHTS * 2) {
        const seen = new Set(flights.map((f) => f.id));
        for (const id of history.keys()) if (!seen.has(id)) history.delete(id);
      }
      return flights;
    },

    async getAurora() {
      try {
        const res = await fetch(`${base()}/skyboard-aurora`);
        if (!res.ok) throw new Error(`aurora ${res.status}`);
        return await res.json();
      } catch (_err) {
        return Skyboard.adapters.mock.getAurora();   // NOAA direct as fallback
      }
    },

    getFare,
    getFaresFrom,
    // real fares have travel dates, not synthetic departure times; the escape
    // list shows the cheapest ways out with their bookable dates
    async getDepartures(origin, _hMin, _hMax) {
      const fares = await getFaresFrom(origin);
      return fares.slice(0, 12).map((f) => ({
        callsign: null, airline: null, destination: f.destination,
        departsAt: null, departDate: f.departDate, fare: f,
      }));
    },
  };
})();
