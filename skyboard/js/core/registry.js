// Skyboard.registry — hydrates compact data rows (js/data/*) into entity objects.
// Single source of truth for airport/airline lookups. See DATA.md for schemas.
window.Skyboard = window.Skyboard || {};

Skyboard.registry = (() => {
  const airports = new Map();   // iata -> Airport
  const airlines = new Map();   // icaoPrefix -> Airline

  for (const [iata, icao, name, city, country, lat, lon, tz] of Skyboard.data.airportRows) {
    airports.set(iata, { iata, icao, name, city, country, lat, lon, tz });
  }
  for (const [icaoPrefix, iata, name, alliance] of Skyboard.data.airlineRows) {
    airlines.set(icaoPrefix, { icaoPrefix, iata, name, alliance });
  }

  // Route endpoints for a flight: bundled airport data when we have it,
  // adsbdb-supplied coords/cities (f.routeInfo) otherwise. null = unresolved.
  function routeEndpoints(f) {
    if (!f || !f.origin || !f.destination) return null;
    const ri = f.routeInfo || {};
    const A = airports.get(f.origin) ||
      (ri.olat != null ? { iata: f.origin, city: ri.ocity || f.origin, lat: ri.olat, lon: ri.olon } : null);
    const B = airports.get(f.destination) ||
      (ri.dlat != null ? { iata: f.destination, city: ri.dcity || f.destination, lat: ri.dlat, lon: ri.dlon } : null);
    return A && B ? { A, B } : null;
  }

  return {
    airport: (iata) => airports.get(iata) || null,
    airline: (icaoPrefix) => airlines.get(icaoPrefix) || null,
    airlineFromCallsign: (callsign) => airlines.get((callsign || "").slice(0, 3)) || null,
    allAirports: () => [...airports.values()],
    allAirlines: () => [...airlines.values()],
    routeEndpoints,
  };
})();
