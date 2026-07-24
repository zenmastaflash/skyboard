// Feature: plane card — tap a plane, see who it is and what the route costs today.
window.Skyboard = window.Skyboard || {};

Skyboard.planeCard = (() => {
  const { state, bus, api, registry } = Skyboard;
  const card = document.getElementById("plane-card");

  const ALLIANCE_LABEL = { star: "Star Alliance", oneworld: "oneworld", skyteam: "SkyTeam", none: "" };

  function close() {
    state.selected = null;
    card.hidden = true;
    if (state.following) { state.following = false; bus.emit("follow:changed"); }
    bus.emit("plane:selected", null);
  }

  function toggleFollow() {
    if (!state.selected) return;
    state.following = !state.following;
    bus.emit("follow:changed");
    syncFollowBtn();
  }

  function syncFollowBtn() {
    const btn = card.querySelector("#follow-btn");
    if (btn) btn.textContent = state.following ? "Following — press F to stop" : "Follow this plane";
  }

  async function show(id) {
    const f = state.flights.get(id);
    if (!f) return;
    state.selected = id;
    bus.emit("plane:selected", id);

    const airlineName = f.airline ? f.airline.name
      : (f.routeInfo && f.routeInfo.aname) || "Unknown operator";
    const alliance = f.airline ? ALLIANCE_LABEL[f.airline.alliance] : "";
    const ends = registry.routeEndpoints(f);
    const A = ends ? ends.A : null;
    const B = ends ? ends.B : null;
    const golden = state.sunsetChaser &&
      Skyboard.solar.isGoldenHour(f.lat, f.lon, new Date());

    const routeHtml = A && B
      ? `<div class="card-route">
           <div class="route-end"><div class="route-iata">${A.iata}</div><div class="route-city">${A.city}</div></div>
           <div class="route-arrow">→</div>
           <div class="route-end"><div class="route-iata">${B.iata}</div><div class="route-city">${B.city}</div></div>
         </div>`
      : `<div class="card-route"><div class="route-city" style="grid-column:1/-1">Route not yet resolved — passing through</div></div>`;

    card.innerHTML = `
      <div class="card-head">
        <span class="card-callsign">${f.callsign}</span>
        <button class="card-close" aria-label="Close">×</button>
      </div>
      <div class="card-airline">${airlineName}
        ${alliance ? `<span class="badge">${alliance}</span>` : ""}
        ${golden ? `<span class="badge gold">Golden hour</span>` : ""}
      </div>
      ${routeHtml}
      <div class="card-specs">
        <span>${f.aircraft || "type —"}</span>
        <span>${Math.round(f.altitudeM)} m</span>
        <span>${Math.round(f.velocityMs * 3.6)} km/h</span>
      </div>
      <button class="follow-btn" id="follow-btn">Follow this plane</button>
      <div class="card-fare" id="card-fare">
        <span class="fare-label">Cheapest fare</span>
        <span class="fare-none">checking…</span>
      </div>`;
    card.hidden = false;
    card.querySelector(".card-close").addEventListener("click", close);
    card.querySelector("#follow-btn").addEventListener("click", toggleFollow);
    syncFollowBtn();

    if (A && B) {
      const fare = await api.getFare(A.iata, B.iata);
      const slot = card.querySelector("#card-fare");
      if (!slot || state.selected !== id) return;   // card changed meanwhile
      if (fare) {
        slot.innerHTML = `<span class="fare-label">Cheapest found fare</span>
          <span class="fare-price">€${fare.price}</span>`;
        slot.insertAdjacentHTML("afterend",
          `<a class="fare-link" href="${fare.deepLink}" target="_blank" rel="noopener">See this fare</a>`);
      } else {
        slot.innerHTML = `<span class="fare-label">Cheapest fare</span>
          <span class="fare-none">no cached fare for this pair</span>`;
      }
    } else {
      card.querySelector("#card-fare").innerHTML =
        `<span class="fare-label">Cheapest fare</span>
         <span class="fare-none">needs a resolved route</span>`;
    }
  }

  bus.on("map:planeTapped", show);
  bus.on("map:tappedEmpty", close);
  bus.on("city:selected", (iata) => { if (iata) close(); });   // one card at a time
  bus.on("follow:changed", syncFollowBtn);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
    if (e.key.toLowerCase() === "f" && !e.metaKey && !e.ctrlKey &&
        !/^(input|select|textarea)$/i.test(document.activeElement.tagName))
      toggleFollow();
  });

  return { show, close };
})();
