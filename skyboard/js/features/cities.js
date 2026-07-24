// Feature: cities — layer toggle + city card. Tap a city dot on the globe and
// see the place, what it costs to get there from home, and make it home.
window.Skyboard = window.Skyboard || {};

Skyboard.cities = (() => {
  const { state, bus, api, registry, geo } = Skyboard;
  const toggle = document.getElementById("cities-toggle");
  const card = document.getElementById("city-card");

  toggle.checked = state.cities;
  toggle.addEventListener("change", () => {
    state.cities = toggle.checked;
    if (!state.cities) close();
    bus.emit("cities:changed");
  });

  function close() {
    if (state.selectedCity === null) return;
    state.selectedCity = null;
    card.hidden = true;
    bus.emit("city:selected", null);
  }

  async function show(iata) {
    const ap = registry.airport(iata);
    if (!ap) return;
    state.selectedCity = iata;
    bus.emit("city:selected", iata);

    const home = registry.airport(state.home);
    const isHome = iata === state.home;
    const km = home && !isHome
      ? Math.round(geo.distanceKm(home.lat, home.lon, ap.lat, ap.lon)) : 0;

    // live flights out of this city, right now
    const departing = [...state.flights.values()]
      .filter((f) => f.origin === iata)
      .sort((a, b) => a.callsign.localeCompare(b.callsign));
    const depHtml = departing.length
      ? `<div class="city-deps">
           <div class="fare-label" style="margin-bottom:6px">In the air from here · ${departing.length}</div>
           ${departing.slice(0, 6).map((f) => `
             <button class="escape-row city-dep" data-flight="${f.id}">
               <span class="escape-time">${f.callsign}</span>
               <span class="escape-dest">${registry.airport(f.destination) ? registry.airport(f.destination).city : f.destination}</span>
               <span style="color:var(--text-dim)">→</span>
             </button>`).join("")}
         </div>`
      : `<div class="city-deps"><div class="fare-label">In the air from here</div>
           <div class="escape-empty">none airborne right now</div></div>`;

    card.innerHTML = `
      <div class="card-head">
        <span class="card-callsign">${ap.city}</span>
        <button class="card-close" aria-label="Close">×</button>
      </div>
      <div class="card-airline">${ap.name} <span class="badge">${ap.iata}</span></div>
      <div class="card-specs" style="margin-top:14px">
        <span>${ap.country}</span>
        ${isHome ? "" : `<span>${km} km from ${state.home}</span>`}
      </div>
      ${depHtml}
      <div class="card-fare" id="city-fare">
        ${isHome
          ? `<span class="fare-label">Home</span><span class="fare-none">this is your home airport</span>`
          : `<span class="fare-label">From ${state.home}</span><span class="fare-none">checking…</span>`}
      </div>
      <button class="fare-link" id="city-dream"
        style="width:100%;background:none;cursor:pointer;border-color:var(--text-dim);color:var(--text)">
        ${Skyboard.dreams && Skyboard.dreams.has(iata) ? "★ On your dream list" : "☆ Save to dream list"}</button>
      ${isHome ? "" : `<button class="fare-link" id="city-set-home"
         style="width:100%;background:none;cursor:pointer;border-color:var(--text-dim);color:var(--text)">
         Make this home</button>`}`;
    card.hidden = false;
    card.querySelector(".card-close").addEventListener("click", close);
    card.querySelector("#city-dream").addEventListener("click", () => {
      Skyboard.dreams.toggle(iata);
      show(iata);   // re-render with updated star
    });
    card.querySelectorAll(".city-dep").forEach((btn) =>
      btn.addEventListener("click", () => bus.emit("map:planeTapped", btn.dataset.flight)));
    const setHomeBtn = card.querySelector("#city-set-home");
    if (setHomeBtn) setHomeBtn.addEventListener("click", () => {
      Skyboard.settings.setHome(iata);
      show(iata);   // re-render as home
    });

    if (!isHome) {
      const fare = await api.getFare(state.home, iata);
      const slot = card.querySelector("#city-fare");
      if (!slot || state.selectedCity !== iata) return;
      if (fare) {
        slot.innerHTML = `<span class="fare-label">From ${state.home}</span>
          <span class="fare-price">€${fare.price}</span>`;
        slot.insertAdjacentHTML("afterend",
          `<a class="fare-link" href="${fare.deepLink}" target="_blank" rel="noopener">See this fare</a>`);
      } else {
        slot.innerHTML = `<span class="fare-label">From ${state.home}</span>
          <span class="fare-none">no cached fare for this pair</span>`;
      }
    }
  }

  bus.on("map:cityTapped", show);
  bus.on("map:tappedEmpty", close);
  bus.on("plane:selected", (id) => { if (id) close(); });   // one card at a time
  bus.on("home:changed", () => { if (state.selectedCity) show(state.selectedCity); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  return { show, close };
})();
