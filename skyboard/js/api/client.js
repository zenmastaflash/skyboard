// Skyboard.api — the single data-access facade. All UI code calls this and only
// this. Adapter selection is the ONLY thing that changes between phases.
// Future consumers (Widgy widget, MCP server) hit the same five endpoints.
window.Skyboard = window.Skyboard || {};

Skyboard.api = (() => {
  const live = Skyboard.config && Skyboard.config.functionsBase;
  const adapter = live ? Skyboard.adapters.live : Skyboard.adapters.mock;

  return {
    mode: adapter.name,
    modeLabel: live ? "LIVE DATA" : "MOCK DATA",
    getFlights: () => adapter.getFlights(),
    getFare: (origin, destination) => adapter.getFare(origin, destination),
    getFaresFrom: (origin) => adapter.getFaresFrom(origin),
    getDepartures: (origin, hMin, hMax) => adapter.getDepartures(origin, hMin, hMax),
    getAurora: () => adapter.getAurora(),
  };
})();
