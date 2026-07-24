// Skyboard cities3d — airport cities on the globe. Subtle dots everywhere,
// zoom-aware labels (hubs from afar, everything up close), tap to select.
window.Skyboard = window.Skyboard || {};

Skyboard.cities3d = (() => {
  const { state, registry, globe } = Skyboard;
  const group = new THREE.Group();
  const SURF = 60;
  const LABEL_ALL_DIST = 2.1;      // camera closer than this → label all in view

  // Hubs worth naming even from far out — a visual tier, not a data property.
  const HUBS = new Set(("AMS LHR CDG FRA IST MAD FCO ZRH CPH ARN ATH LIS DUB WAW " +
    "JFK ATL ORD DFW DEN LAX SFO SEA MIA YYZ YVR MEX PTY BOG LIM SCL EZE GRU " +
    "DXB DOH AUH RUH TLV CAI CMN LOS ADD NBO JNB CPT " +
    "DEL BOM SIN KUL BKK SGN HKG PVG PEK ICN NRT HND TPE MNL CGK " +
    "SYD MEL AKL HNL ANC KEF").split(" "));

  const airports = registry.allAirports();

  // ── dots ─────────────────────────────────────────────────
  const dotGeo = new THREE.BufferGeometry().setFromPoints(
    airports.map((ap) => globe.latLonToVec3(ap.lat, ap.lon, SURF)));
  const dots = new THREE.Points(dotGeo, new THREE.PointsMaterial({
    color: 0x7fa8c9, size: 0.0095, transparent: true, opacity: 0.7,
    sizeAttenuation: true, depthWrite: false,
  }));
  group.add(dots);

  // ── selection ring ───────────────────────────────────────
  const selRing = new THREE.Mesh(
    new THREE.RingGeometry(0.014, 0.0155, 40),
    new THREE.MeshBasicMaterial({ color: 0xe8f2fa, side: THREE.DoubleSide,
      transparent: true, opacity: 0.9, depthWrite: false })
  );
  selRing.visible = false;
  group.add(selRing);

  // ── labels: lazy sprites, visibility per frame ───────────
  const labels = new Map();   // iata -> Sprite
  function makeLabel(ap) {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 40;
    const x = c.getContext("2d");
    x.font = "500 21px 'Instrument Sans', sans-serif";
    x.fillStyle = "#9FB8CE";
    x.textBaseline = "middle";
    x.fillText(ap.city, 5, 20);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 0.9, depthWrite: false }));
    sp.scale.set(0.115, 0.018, 1);
    sp.center.set(-0.1, 0.5);
    // barely lifted: altitude is exaggerated 40× on this globe, so metres count
    sp.position.copy(globe.latLonToVec3(ap.lat, ap.lon, 1200));
    sp.visible = false;
    group.add(sp);
    return sp;
  }

  const camDir = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const REF_DIST = 3.1;

  function update(now, camera) {
    group.visible = !!state.cities;
    if (!group.visible) return;

    camDir.copy(camera.position).normalize();
    const dist = camera.position.length();
    const closeUp = dist < LABEL_ALL_DIST;
    const gs = Math.min(1.8, Math.max(0.22, dist / REF_DIST));   // constant screen size
    dots.material.size = 0.0095 * gs;
    selRing.scale.setScalar(gs);

    for (const ap of airports) {
      const wantLabel = closeUp || HUBS.has(ap.iata) || state.selectedCity === ap.iata;
      let sp = labels.get(ap.iata);
      if (!sp) {
        if (!wantLabel) continue;
        sp = makeLabel(ap);
        labels.set(ap.iata, sp);
      }
      // hide labels past the horizon
      sp.visible = wantLabel &&
        tmp.copy(sp.position).normalize().dot(camDir) > 0.25;
      if (sp.visible) sp.scale.set(0.115 * gs, 0.018 * gs, 1);
    }

    if (state.selectedCity) {
      const ap = registry.airport(state.selectedCity);
      if (ap) {
        selRing.visible = true;
        globe.latLonToVec3(ap.lat, ap.lon, SURF, tmp);
        selRing.position.copy(tmp);
        selRing.lookAt(tmp.clone().multiplyScalar(2));
      }
    } else selRing.visible = false;
  }

  // ── screen-space pick, same feel as planes ───────────────
  const pickV = new THREE.Vector3();
  function pick(px, py, camera, w, h) {
    if (!state.cities) return null;
    camDir.copy(camera.position).normalize();
    let best = null, bestD = 12;
    for (const ap of airports) {
      globe.latLonToVec3(ap.lat, ap.lon, SURF, pickV);
      if (pickV.clone().normalize().dot(camDir) < 0.15) continue;
      pickV.project(camera);
      if (pickV.z > 1) continue;
      const sx = (pickV.x * 0.5 + 0.5) * w, sy = (-pickV.y * 0.5 + 0.5) * h;
      const d = Math.hypot(sx - px, sy - py);
      if (d < bestD) { bestD = d; best = ap.iata; }
    }
    return best ? { city: best } : null;
  }

  return { group, update, pick };
})();
