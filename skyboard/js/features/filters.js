// Feature: filters — alliance chips + departure/destination selects.
// Filtering dims non-matching planes rather than removing them; the sky stays alive.
window.Skyboard = window.Skyboard || {};

Skyboard.filters = (() => {
  const { state, registry, bus } = Skyboard;
  const chips = document.querySelectorAll("#alliance-chips .chip");
  const selOrigin = document.getElementById("filter-origin");
  const selDest = document.getElementById("filter-dest");

  // populate airport selects, sorted by city
  const airports = registry.allAirports().sort((a, b) => a.city.localeCompare(b.city));
  for (const sel of [selOrigin, selDest]) {
    for (const ap of airports) {
      const opt = document.createElement("option");
      opt.value = ap.iata;
      opt.textContent = `${ap.city} ${ap.iata}`;
      sel.appendChild(opt);
    }
  }

  chips.forEach((chip) =>
    chip.addEventListener("click", () => {
      chips.forEach((c) => c.classList.toggle("active", c === chip));
      state.filters.alliance = chip.dataset.alliance;
      bus.emit("filters:changed");
    })
  );
  selOrigin.addEventListener("change", () => {
    state.filters.origin = selOrigin.value;
    bus.emit("filters:changed");
  });
  selDest.addEventListener("change", () => {
    state.filters.destination = selDest.value;
    bus.emit("filters:changed");
  });

  return {};
})();
