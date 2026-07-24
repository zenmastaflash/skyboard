// Feature: budget ring — dual-thumb fare range (€20–1500). Raise the floor to
// skip low-cost hops, raise the ceiling for long-haul. Lights destinations whose
// fare from home falls inside the band. Fares cached in state via the api facade.
window.Skyboard = window.Skyboard || {};

Skyboard.budget = (() => {
  const { state, bus, api } = Skyboard;
  const lo = document.getElementById("budget-min");
  const hi = document.getElementById("budget-max");
  const fill = document.getElementById("budget-fill");
  const value = document.getElementById("budget-value");
  const toggle = document.getElementById("budget-toggle");
  const GAP = 10;   // thumbs never cross

  async function refreshFares() {
    state.faresFromHome = await api.getFaresFrom(state.home);
    bus.emit("budget:changed");
  }

  function render() {
    const min = +lo.min, max = +lo.max;
    const a = ((state.budget.min - min) / (max - min)) * 100;
    const b = ((state.budget.max - min) / (max - min)) * 100;
    fill.style.left = a + "%";
    fill.style.right = (100 - b) + "%";
    value.textContent = `€${state.budget.min}–${state.budget.max}`;
  }

  function onSlide(which) {
    let a = +lo.value, b = +hi.value;
    if (which === "min" && a > b - GAP) { a = b - GAP; lo.value = a; }
    if (which === "max" && b < a + GAP) { b = a + GAP; hi.value = b; }
    state.budget.min = a;
    state.budget.max = b;
    if (!state.budget.active) { toggle.checked = true; state.budget.active = true; }
    render();
    bus.emit("budget:changed");
  }

  lo.addEventListener("input", () => onSlide("min"));
  hi.addEventListener("input", () => onSlide("max"));

  toggle.addEventListener("change", () => {
    state.budget.active = toggle.checked;
    bus.emit("budget:changed");
  });

  bus.on("home:changed", refreshFares);
  render();
  refreshFares();

  return {};
})();
