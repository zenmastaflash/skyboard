// Skyboard paths3d — the selected plane's full route drawn on the globe:
// flown portion solid, remainder dashed, quiet rings and IATA tags at both ends.
window.Skyboard = window.Skyboard || {};

Skyboard.paths3d = (() => {
  const { state, registry, geo, globe } = Skyboard;
  const group = new THREE.Group();
  const SAMPLES = 90;

  const dispose = (g) => {
    while (g.children.length) {
      const c = g.children.pop();
      if (c.geometry) c.geometry.dispose();
      if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); }
    }
  };

  function iataTag(text) {
    const c = document.createElement("canvas");
    c.width = 128; c.height = 48;
    const x = c.getContext("2d");
    x.font = "500 26px 'IBM Plex Mono', monospace";
    x.fillStyle = "#C9D6E3";
    x.textBaseline = "middle";
    x.fillText(text, 6, 24);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(0.08, 0.03, 1);
    sp.center.set(0, 0.5);
    return sp;
  }

  function endRing(pos) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.008, 0.0095, 32),
      new THREE.MeshBasicMaterial({ color: 0x6fb4e0, side: THREE.DoubleSide,
        transparent: true, opacity: 0.8, depthWrite: false })
    );
    ring.position.copy(pos);
    ring.lookAt(pos.clone().multiplyScalar(2));
    return ring;
  }

  function arcPoints(A, B, f0, f1, altM) {
    const pts = [];
    const n = Math.max(2, Math.round(SAMPLES * (f1 - f0)));
    for (let i = 0; i <= n; i++) {
      const p = geo.intermediatePoint(A.lat, A.lon, B.lat, B.lon, f0 + (f1 - f0) * (i / n));
      pts.push(globe.latLonToVec3(p.lat, p.lon, altM));
    }
    return pts;
  }

  function build() {
    dispose(group);
    const f = state.selected ? state.flights.get(state.selected) : null;
    if (!f) return;
    const ends = registry.routeEndpoints(f);   // bundled airports or adsbdb coords
    if (!ends) return;
    const { A, B } = ends;

    const total = geo.distanceKm(A.lat, A.lon, B.lat, B.lon);
    const flownKm = geo.distanceKm(A.lat, A.lon, f.lat, f.lon);
    const progress = Math.max(0.01, Math.min(0.99, flownKm / total));
    const altM = Math.max(f.altitudeM, 9000);   // keep the arc clear of the skin

    const flown = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(arcPoints(A, B, 0, progress, altM)),
      new THREE.LineBasicMaterial({ color: 0x6fb4e0, transparent: true,
        opacity: 0.85, depthWrite: false })
    );
    const ahead = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(arcPoints(A, B, progress, 1, altM)),
      new THREE.LineDashedMaterial({ color: 0x6fb4e0, transparent: true,
        opacity: 0.45, dashSize: 0.014, gapSize: 0.011, depthWrite: false })
    );
    ahead.computeLineDistances();
    group.add(flown, ahead);

    const pa = globe.latLonToVec3(A.lat, A.lon, 60);
    const pb = globe.latLonToVec3(B.lat, B.lon, 60);
    group.add(endRing(pa), endRing(pb));
    const ta = iataTag(A.iata), tb = iataTag(B.iata);
    ta.position.copy(globe.latLonToVec3(A.lat, A.lon, 2000));   // 40× exaggerated
    tb.position.copy(globe.latLonToVec3(B.lat, B.lon, 2000));
    group.add(ta, tb);
  }

  Skyboard.bus.on("plane:selected", build);
  Skyboard.bus.on("flights:updated", () => { if (state.selected) build(); });

  // constant screen size for endpoint rings and IATA tags
  const REF_DIST = 3.1;
  function update(now, camera) {
    if (!group.children.length) return;
    const gs = Math.min(1.8, Math.max(0.22, camera.position.length() / REF_DIST));
    for (const child of group.children) {
      if (child.isSprite) child.scale.set(0.08 * gs, 0.03 * gs, 1);
      else if (child.isMesh) child.scale.setScalar(gs);
    }
  }

  return { group, update };
})();
