// Feature: aurora chaser — polls NOAA's OVATION aurora forecast every 5 minutes
// and keeps it in state. The globe layer draws the oval; planes3d greens the
// planes flying beneath it. Degrades quietly when offline.
window.Skyboard = window.Skyboard || {};

Skyboard.aurora = (() => {
  const { state, bus, api } = Skyboard;
  const toggle = document.getElementById("aurora-toggle");
  const POLL_MS = 5 * 60 * 1000;

  toggle.checked = state.auroraChaser;
  toggle.addEventListener("change", () => {
    state.auroraChaser = toggle.checked;
    bus.emit("aurora:changed");
  });

  async function load() {
    try {
      const data = await api.getAurora();
      // 1°×1° cell lookup for "is this plane under the aurora"
      data.byCell = new Map();
      for (const p of data.points)
        data.byCell.set(`${Math.round(p.lat)},${Math.round(p.lon)}`, p.intensity);
      state.auroraData = data;
      bus.emit("aurora:updated");
    } catch (err) {
      state.auroraData = null;   // offline or blocked: the layer just stays empty
      console.warn("Skyboard: aurora feed unavailable", err.message);
    }
    setTimeout(load, POLL_MS);
  }

  // Aurora probability (0–100) at a position, 0 when no data.
  function intensityAt(lat, lon) {
    const d = state.auroraData;
    if (!d) return 0;
    return d.byCell.get(`${Math.round(lat)},${Math.round(lon)}`) || 0;
  }

  load();

  return { intensityAt };
})();
