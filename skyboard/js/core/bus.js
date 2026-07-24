// Skyboard.bus — tiny pub/sub + shared state. No dependencies.
// Every module reads Skyboard.state and reacts to events; nobody talks to the DOM
// of another module. This is what keeps feature #8 from touching features #1–7.
window.Skyboard = window.Skyboard || {};

Skyboard.state = {
  home: "AMS",                 // iata of home airport
  flights: new Map(),          // id -> Flight
  filters: { alliance: "", origin: "", destination: "" },
  budget: { active: false, min: 50, max: 400 },   // fare band in EUR
  sunsetChaser: true,
  cities: true,                // cities layer on the globe
  threads: true,               // faint lines from each plane to its origin
  auroraChaser: true,          // aurora layer + green plane halos
  auroraData: null,            // {fetchedAt, points, byCell} from api.getAurora
  following: false,            // camera tracks the selected plane
  selected: null,              // flight id or null
  selectedCity: null,          // airport iata or null
  faresFromHome: [],           // Fare[] cache for budget ring
};

Skyboard.bus = (() => {
  const handlers = {};
  return {
    on(event, fn) { (handlers[event] = handlers[event] || []).push(fn); },
    emit(event, payload) { (handlers[event] || []).forEach(fn => fn(payload)); },
  };
})();

// Events used across Skyboard:
//   "flights:updated"   — new positions merged into state.flights
//   "filters:changed"   — state.filters mutated
//   "budget:changed"    — state.budget mutated
//   "home:changed"      — state.home mutated
//   "sunset:changed"    — state.sunsetChaser mutated
//   "cities:changed"    — state.cities mutated
//   "aurora:changed"    — state.auroraChaser mutated
//   "aurora:updated"    — fresh state.auroraData arrived
//   "follow:changed"    — state.following mutated
//   "dreams:changed"    — dream list mutated
//   "plane:selected"    — state.selected mutated (id | null)
//   "city:selected"     — state.selectedCity mutated (iata | null)
