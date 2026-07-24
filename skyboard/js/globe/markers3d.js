// Skyboard markers3d — home crosshair, budget range rings on the sphere,
// destinations lit by affordability, floating fare tags for the cheapest picks.
window.Skyboard = window.Skyboard || {};

Skyboard.markers3d = (() => {
  const { state, registry, geo, globe } = Skyboard;
  const group = new THREE.Group();
  const SURF = 60;   // metres above sea level so markers sit on the skin

  // sub-groups rebuilt wholesale on state changes — simple beats clever here
  const homeGroup = new THREE.Group();
  const ringGroup = new THREE.Group();
  const destGroup = new THREE.Group();
  const tagGroup = new THREE.Group();
  group.add(homeGroup, ringGroup, destGroup, tagGroup);

  const dispose = (g) => {
    while (g.children.length) {
      const c = g.children.pop();
      if (c.geometry) c.geometry.dispose();
      if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); }
    }
  };

  // ── home crosshair ───────────────────────────────────────
  function buildHome() {
    dispose(homeGroup);
    const ap = registry.airport(state.home);
    if (!ap) return;
    const pos = globe.latLonToVec3(ap.lat, ap.lon, SURF);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.012, 0.0135, 40),
      new THREE.MeshBasicMaterial({ color: 0xa8d4f5, side: THREE.DoubleSide,
        transparent: true, opacity: 0.85, depthWrite: false })
    );
    ring.position.copy(pos);
    ring.lookAt(pos.clone().multiplyScalar(2));   // face outward along the normal
    homeGroup.add(ring);
  }

  // ── budget rings + destinations ──────────────────────────
  function circleOnSphere(lat, lon, radiusKm) {
    const pts = [];
    for (let b = 0; b <= 360; b += 3) {
      const p = geo.destinationPoint(lat, lon, b, radiusKm);
      pts.push(globe.latLonToVec3(p.lat, p.lon, SURF));
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }

  function fareTag(text) {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 56;
    const x = c.getContext("2d");
    x.font = "500 30px 'IBM Plex Mono', monospace";
    x.fillStyle = "#FFB454";
    x.textBaseline = "middle";
    x.fillText(text, 8, 30);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(0.16, 0.035, 1);
    sp.center.set(0, 0.5);
    return sp;
  }

  function buildBudget() {
    dispose(ringGroup); dispose(destGroup); dispose(tagGroup);
    if (!state.budget.active) return;
    const home = registry.airport(state.home);
    if (!home) return;

    // range rings, one per 2000 km — quiet dashes of distance
    const ringMat = new THREE.LineBasicMaterial({ color: 0x5c7089,
      transparent: true, opacity: 0.28 });
    for (let km = 2000; km <= 8000; km += 2000)
      ringGroup.add(new THREE.LineLoop(circleOnSphere(home.lat, home.lon, km), ringMat.clone()));

    // destinations: lit amber if today's fare falls inside the band, ember gray if not
    const lit = [], dimPts = [];
    const { min, max } = state.budget;
    for (const f of state.faresFromHome) {
      const ap = registry.airport(f.destination);
      if (!ap) continue;
      (f.price >= min && f.price <= max ? lit : dimPts).push({ ap, f });
    }
    const mkPoints = (items, color, size, opacity) => {
      const gpts = items.map(({ ap }) => globe.latLonToVec3(ap.lat, ap.lon, SURF));
      const g = new THREE.BufferGeometry().setFromPoints(gpts);
      return new THREE.Points(g, new THREE.PointsMaterial({
        color, size, transparent: true, opacity, sizeAttenuation: true, depthWrite: false }));
    };
    if (dimPts.length) destGroup.add(mkPoints(dimPts, 0x30405a, 0.012, 0.5));
    if (lit.length) destGroup.add(mkPoints(lit, 0xffb454, 0.018, 0.95));

    // fare tags for the 10 cheapest reachable — enough story, no clutter
    lit.sort((a, b) => a.f.price - b.f.price);
    for (const { ap, f } of lit.slice(0, 10)) {
      const tag = fareTag(`${ap.iata} €${f.price}`);
      tag.position.copy(globe.latLonToVec3(ap.lat, ap.lon, 2000));   // 40× exaggerated
      tagGroup.add(tag);
    }
  }

  Skyboard.bus.on("home:changed", () => { buildHome(); buildBudget(); });
  Skyboard.bus.on("budget:changed", buildBudget);
  buildHome();

  // constant screen size for tags, dots, and the home ring
  const REF_DIST = 3.1;
  function update(now, camera) {
    const gs = Math.min(1.8, Math.max(0.22, camera.position.length() / REF_DIST));
    for (const tag of tagGroup.children) tag.scale.set(0.16 * gs, 0.035 * gs, 1);
    for (const ring of homeGroup.children) ring.scale.setScalar(gs);
    for (const pts of destGroup.children) {
      if (pts.userData.baseSize === undefined) pts.userData.baseSize = pts.material.size;
      pts.material.size = pts.userData.baseSize * gs;
    }
  }

  return { group, update };
})();
