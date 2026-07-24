// Feature: telemetry stats bar — airborne count, highest, fastest, longest leg.
window.Skyboard = window.Skyboard || {};

Skyboard.stats = (() => {
  const { state, registry, geo } = Skyboard;
  const el = {
    airborne: document.getElementById("stat-airborne"),
    highest: document.getElementById("stat-highest"),
    fastest: document.getElementById("stat-fastest"),
    longest: document.getElementById("stat-longest"),
    clock: document.getElementById("clock"),
  };

  function update() {
    const flights = [...state.flights.values()];
    el.airborne.textContent = flights.length || "—";

    let hi = null, fast = null, long_ = null, longKm = 0;
    for (const f of flights) {
      if (!hi || f.altitudeM > hi.altitudeM) hi = f;
      if (!fast || f.velocityMs > fast.velocityMs) fast = f;
      if (f.origin && f.destination) {
        const A = registry.airport(f.origin), B = registry.airport(f.destination);
        if (A && B) {
          const km = geo.distanceKm(A.lat, A.lon, B.lat, B.lon);
          if (km > longKm) { longKm = km; long_ = f; }
        }
      }
    }
    el.highest.textContent = hi ? `${Math.round(hi.altitudeM / 100) * 100} m · ${hi.callsign}` : "—";
    el.fastest.textContent = fast ? `${Math.round(fast.velocityMs * 3.6)} km/h · ${fast.callsign}` : "—";
    el.longest.textContent = long_ ? `${long_.origin}–${long_.destination} · ${Math.round(longKm)} km` : "—";
  }

  function tickClock() {
    el.clock.textContent = new Date().toISOString().slice(11, 19) + " UTC";
  }

  Skyboard.bus.on("flights:updated", update);
  setInterval(tickClock, 1000);
  tickClock();

  return { update };
})();
