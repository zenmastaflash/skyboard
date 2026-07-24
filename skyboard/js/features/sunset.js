// Feature: sunset chaser toggle — golden-hour highlighting on or off.
window.Skyboard = window.Skyboard || {};

Skyboard.sunset = (() => {
  const { state, bus } = Skyboard;
  const toggle = document.getElementById("sunset-toggle");

  toggle.checked = state.sunsetChaser;
  toggle.addEventListener("change", () => {
    state.sunsetChaser = toggle.checked;
    bus.emit("sunset:changed");
  });

  return {};
})();
