// Feature: search — type a callsign or a city, land on it. Callsigns match live
// flights; anything else matches the airport list. Suggestions via datalist.
window.Skyboard = window.Skyboard || {};

Skyboard.search = (() => {
  const { state, bus, registry } = Skyboard;
  const input = document.getElementById("search-input");
  const datalist = document.getElementById("search-list");

  const airports = registry.allAirports();
  const cityOptions = airports
    .map((ap) => `<option value="${ap.city} ${ap.iata}">`)
    .join("");

  let callsignOptions = "";
  bus.on("flights:updated", () => {
    callsignOptions = [...state.flights.values()]
      .map((f) => `<option value="${f.callsign}">`).join("");
    datalist.innerHTML = cityOptions + callsignOptions;
  });
  datalist.innerHTML = cityOptions;

  function resolve(qRaw) {
    const q = qRaw.trim();
    if (!q) return;
    const Q = q.toUpperCase();

    // 1. live callsign
    for (const f of state.flights.values()) {
      if (f.callsign === Q) {
        Skyboard.globe.flyTo(f.lat, f.lon);
        bus.emit("map:planeTapped", f.id);
        input.value = "";
        return;
      }
    }
    // 2. airport: "City IATA" from the datalist, bare IATA, or city prefix
    const last = Q.split(/\s+/).pop();
    const ap = registry.airport(last) || registry.airport(Q) ||
      airports.find((a) => a.city.toUpperCase().startsWith(Q));
    if (ap) {
      Skyboard.globe.flyTo(ap.lat, ap.lon);
      bus.emit("map:cityTapped", ap.iata);
      input.value = "";
    }
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") resolve(input.value);
    if (e.key === "Escape") input.blur();
  });
  input.addEventListener("change", () => resolve(input.value));

  return { resolve };
})();
