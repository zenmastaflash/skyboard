// Feature: dream list — destinations you keep coming back to, with today's fare
// from home. Persists in localStorage; degrades to in-memory if storage is blocked.
window.Skyboard = window.Skyboard || {};

Skyboard.dreams = (() => {
  const { state, bus, api, registry } = Skyboard;
  const KEY = "skyboard.dreams";
  const listEl = document.getElementById("dreams-list");
  const hintEl = document.getElementById("dreams-hint");

  let items = (() => {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch { return []; }
  })();

  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {} };
  const has = (iata) => items.includes(iata);

  function toggle(iata) {
    if (!registry.airport(iata)) return;
    items = has(iata) ? items.filter((x) => x !== iata) : [...items, iata];
    save();
    render();
    bus.emit("dreams:changed");
  }

  async function render() {
    hintEl.hidden = items.length > 0;
    listEl.innerHTML = items.map((iata) => {
      const ap = registry.airport(iata);
      return `<div class="escape-row dream-row" data-iata="${iata}" role="button" tabindex="0">
        <span class="escape-time">${iata}</span>
        <span class="escape-dest">${ap ? ap.city : iata}</span>
        <span class="escape-fare" id="dream-fare-${iata}">…</span>
        <button class="dream-x" data-x="${iata}" aria-label="Remove ${iata}">×</button>
      </div>`;
    }).join("");

    listEl.querySelectorAll(".dream-row").forEach((row) =>
      row.addEventListener("click", (e) => {
        if (e.target.dataset.x) return;
        const ap = registry.airport(row.dataset.iata);
        if (ap) { Skyboard.globe.flyTo(ap.lat, ap.lon); bus.emit("map:cityTapped", ap.iata); }
      }));
    listEl.querySelectorAll(".dream-x").forEach((x) =>
      x.addEventListener("click", () => toggle(x.dataset.x)));

    // fares fill in as they arrive
    for (const iata of items) {
      if (iata === state.home) {
        const slot = document.getElementById(`dream-fare-${iata}`);
        if (slot) slot.textContent = "home";
        continue;
      }
      api.getFare(state.home, iata).then((fare) => {
        const slot = document.getElementById(`dream-fare-${iata}`);
        if (slot) slot.textContent = fare ? `€${fare.price}` : "—";
      });
    }
  }

  bus.on("home:changed", render);
  render();

  return { has, toggle };
})();
