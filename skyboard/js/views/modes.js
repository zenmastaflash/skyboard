// View modes — layout is swappable by design (Phase 4: Chrome new-tab, TV mode).
// A mode is just a name; CSS owns what each mode shows. Adding a mode = one CSS
// block + one entry here.
window.Skyboard = window.Skyboard || {};

Skyboard.modes = (() => {
  const MODES = ["standard", "tv"];
  let current = "standard";

  function set(mode) {
    if (!MODES.includes(mode)) return;
    current = mode;
    document.body.dataset.view = mode;
    Skyboard.bus.emit("view:changed", mode);
    // canvas fills the freed space
    window.dispatchEvent(new Event("resize"));
  }

  document.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "t" && !e.metaKey && !e.ctrlKey &&
        !/^(input|select|textarea)$/i.test(document.activeElement.tagName)) {
      set(current === "tv" ? "standard" : "tv");
    }
  });

  // TV mode: the cursor fades away when idle — it's a window, not a screen
  let cursorTimer = null;
  document.addEventListener("mousemove", () => {
    document.body.style.cursor = "";
    clearTimeout(cursorTimer);
    if (current === "tv") {
      cursorTimer = setTimeout(() => { document.body.style.cursor = "none"; }, 3000);
    }
  });

  return { set, get: () => current };
})();
