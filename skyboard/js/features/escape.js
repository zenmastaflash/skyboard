// Feature: escape now — departures from home in the next 2–6 h, cheapest first.
window.Skyboard = window.Skyboard || {};

Skyboard.escape = (() => {
  const { state, bus, api, registry } = Skyboard;
  const btn = document.getElementById("escape-btn");
  const panel = document.getElementById("escape-panel");
  const homeLabel = document.getElementById("escape-home");

  let open = false;

  function fmtTime(ms) {
    const d = new Date(ms);
    return d.toISOString().slice(11, 16);
  }

  const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  function fmtDate(iso) {   // "2026-10-03" -> "3 OCT"
    const [, m, day] = iso.split("-");
    return `${+day} ${MONTHS[+m - 1]}`;
  }

  async function render() {
    panel.innerHTML = `<div class="escape-empty">Scanning departures…</div>`;
    let deps = await api.getDepartures(state.home, 2, 6);
    // the escape list honors the budget ring: same band, same logic
    if (state.budget.active) {
      const { min, max } = state.budget;
      deps = deps.filter((d) => d.fare.price >= min && d.fare.price <= max);
    }
    if (!deps.length) {
      panel.innerHTML = state.budget.active
        ? `<div class="escape-empty">Nothing in the next 2–6 h inside €${state.budget.min}–${state.budget.max}. Widen the budget ring or check back soon.</div>`
        : `<div class="escape-empty">Nothing departing in the window. The sky is quiet — check back soon.</div>`;
      return;
    }
    panel.innerHTML = deps.slice(0, 9).map((d) => {
      const ap = registry.airport(d.destination);
      const city = ap ? ap.city : d.destination;
      const when = d.departsAt ? fmtTime(d.departsAt)
        : (d.departDate ? fmtDate(d.departDate) : "—");
      return `<a class="escape-row" href="${d.fare.deepLink}" target="_blank" rel="noopener">
        <span class="escape-time">${when}</span>
        <span class="escape-dest">${city} <span style="color:var(--text-dim)">${d.destination}</span></span>
        <span class="escape-fare">€${d.fare.price}</span>
      </a>`;
    }).join("");
  }

  btn.addEventListener("click", () => {
    open = !open;
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (open) render();
  });

  bus.on("home:changed", () => {
    homeLabel.textContent = state.home;
    if (open) render();
  });
  bus.on("budget:changed", () => { if (open) render(); });
  homeLabel.textContent = state.home;

  return {};
})();
