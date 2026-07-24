// Feature: settings — home airport dropdown + geolocation ("nearest airport").
// Home is a setting, not a constant: everything downstream listens to home:changed.
window.Skyboard = window.Skyboard || {};

Skyboard.settings = (() => {
  const { state, bus, registry, geo } = Skyboard;
  const select = document.getElementById("home-select");
  const geoBtn = document.getElementById("geolocate");

  const airports = registry.allAirports().sort((a, b) => a.city.localeCompare(b.city));
  for (const ap of airports) {
    const opt = document.createElement("option");
    opt.value = ap.iata;
    opt.textContent = `${ap.city} — ${ap.iata}`;
    select.appendChild(opt);
  }
  select.value = state.home;

  function setHome(iata) {
    if (!registry.airport(iata) || iata === state.home) return;
    state.home = iata;
    select.value = iata;
    try { localStorage.setItem("skyboard.home", iata); } catch {}
    bus.emit("home:changed");
  }

  // restore the last session's home airport
  (() => {
    let stored = null;
    try { stored = localStorage.getItem("skyboard.home"); } catch {}
    if (stored && stored !== state.home) setHome(stored);
  })();

  select.addEventListener("change", () => setHome(select.value));

  const hint = document.getElementById("home-hint");
  function say(msg) {
    hint.textContent = msg;
    hint.hidden = false;
    clearTimeout(say.t);
    say.t = setTimeout(() => { hint.hidden = true; }, 6000);
  }

  function nearestTo(lat, lon) {
    let best = null, bestKm = Infinity;
    for (const ap of airports) {
      const km = geo.distanceKm(lat, lon, ap.lat, ap.lon);
      if (km < bestKm) { bestKm = km; best = ap; }
    }
    return best;
  }

  // Fallback chain: GPS → network location (IP) → system clock timezone.
  // Browsers refuse precise GPS to pages opened from a local file, so the IP
  // lookup does the real work until Skyboard is served over https (Phase 4).
  async function ipFallback() {
    const res = await fetch("https://ipapi.co/json/", { signal: AbortSignal.timeout(6000) });
    const j = await res.json();
    if (!j || typeof j.latitude !== "number") throw new Error("no coordinates");
    const best = nearestTo(j.latitude, j.longitude);
    if (!best) throw new Error("no airport");
    setHome(best.iata);
    say(`Nearest by network location: ${best.iata} ${best.city}.`);
  }

  function timezoneFallback() {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const match = airports.find((ap) => ap.tz === tz);
    if (match) {
      setHome(match.iata);
      say(`No location available — guessed ${match.iata} from your clock (${tz}).`);
    } else {
      say("Location unavailable — pick your airport from the list.");
    }
  }

  geoBtn.addEventListener("click", () => {
    geoBtn.textContent = "…";
    const done = () => { geoBtn.textContent = "◎"; };
    const fallback = () => ipFallback().catch(timezoneFallback).finally(done);
    if (!navigator.geolocation) { fallback(); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        done();
        const best = nearestTo(pos.coords.latitude, pos.coords.longitude);
        if (best) { setHome(best.iata); say(`Nearest airport: ${best.iata} ${best.city}.`); }
      },
      fallback,
      { timeout: 8000 }
    );
  });

  return { setHome };
})();
