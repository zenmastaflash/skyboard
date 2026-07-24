// Feature: origin threads toggle — thin great-circle lines from each plane
// back to its departure airport.
window.Skyboard = window.Skyboard || {};

Skyboard.threads = (() => {
  const { state, bus } = Skyboard;
  const toggle = document.getElementById("threads-toggle");

  toggle.checked = state.threads;
  toggle.addEventListener("change", () => {
    state.threads = toggle.checked;
    bus.emit("threads:changed");
  });

  return {};
})();
