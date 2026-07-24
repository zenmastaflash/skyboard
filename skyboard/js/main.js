// Skyboard bootstrap — polling loop + wiring. Everything else is modules.
(() => {
  const { state, bus, api, globe } = Skyboard;
  const POLL_MS = api.mode === "live" ? 20000 : 15000;

  document.getElementById("data-mode").textContent = api.modeLabel;

  // live adapter fetches freshest data where the camera is looking
  if (api.mode === "live") {
    Skyboard.adapters.live.setFocusProvider(() => globe.getCenter());
  }

  const boot = document.getElementById("boot");
  const bootSub = boot.querySelector(".boot-sub");
  let booted = false;

  async function poll() {
    try {
      const flights = await api.getFlights();
      state.flights = new Map(flights.map((f) => [f.id, f]));
      bus.emit("flights:updated");
      if (!booted && flights.length) {
        booted = true;
        boot.classList.add("done");
        setTimeout(() => boot.remove(), 800);
      }
    } catch (err) {
      console.error("Skyboard: flight update failed", err);
      if (!booted) bootSub.textContent = "no contact yet — retrying";
    }
    setTimeout(poll, POLL_MS);
  }

  globe.registerLayer(Skyboard.planes3d);   // pick priority: planes first
  globe.registerLayer(Skyboard.cities3d);
  globe.registerLayer(Skyboard.markers3d);
  globe.registerLayer(Skyboard.paths3d);
  globe.registerLayer(Skyboard.aurora3d);
  globe.start();
  poll();
})();
