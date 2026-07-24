// Skyboard planes3d — aircraft over the 3D globe: instanced darts at exaggerated
// altitude, additive ghost trails, golden-hour glow, filter dimming, raycast
// picking, live callsign label on the selected plane.
window.Skyboard = window.Skyboard || {};

Skyboard.planes3d = (() => {
  const { state, geo, globe } = Skyboard;
  const MAX = 4000;   // live worldwide traffic; adapter caps at 3800
  const TRAIL_MS = 30 * 60 * 1000;

  const group = new THREE.Group();

  // Glyphs keep a constant on-screen size: world size scales with camera
  // distance. 1.0 at the default view, smaller as you zoom in.
  const REF_DIST = 3.1;
  const glyphScale = (camera) =>
    Math.min(1.8, Math.max(0.22, camera.position.length() / REF_DIST));

  // ── instanced planes: a tiny airliner silhouette, nose forward ──
  const dartGeo = (() => {
    const s = new THREE.Shape();
    const pts = [   // right half, nose at +Y: fuselage, swept wing, tailplane
      [0, 5.2], [0.55, 4.2], [0.62, 1.5], [4.6, -0.5], [4.6, -1.3],
      [0.62, -0.3], [0.5, -3.0], [2.1, -4.2], [2.1, -4.9], [0.32, -4.35], [0, -4.4],
    ];
    s.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
    for (let i = pts.length - 2; i >= 0; i--) s.lineTo(-pts[i][0], pts[i][1]);
    const g = new THREE.ShapeGeometry(s);
    const k = 0.0016;
    g.scale(k, k, k);
    g.rotateX(Math.PI / 2);   // silhouette flat on the sphere, nose +Z (forward)
    return g;
  })();
  const dartMat = new THREE.MeshBasicMaterial({ vertexColors: false, side: THREE.DoubleSide });
  const darts = new THREE.InstancedMesh(dartGeo, dartMat, MAX);
  darts.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
  darts.count = 0;
  group.add(darts);

  const COL_PLANE = new THREE.Color(0xa8d4f5);
  const COL_GOLD = new THREE.Color(0xffd9a0);
  const COL_AUR = new THREE.Color(0x9ff5c9);
  const COL_DIM = new THREE.Color(0x11202e);
  const AURORA_MIN = 25;   // oval probability (%) that counts as "under the aurora"

  // ── trails: static tail (rebuilt per poll) + live head (per frame) ──
  const tailGeo = new THREE.BufferGeometry();
  const tailPos = new Float32Array(MAX * 32 * 2 * 3);
  const tailCol = new Float32Array(MAX * 32 * 2 * 3);
  tailGeo.setAttribute("position", new THREE.BufferAttribute(tailPos, 3));
  tailGeo.setAttribute("color", new THREE.BufferAttribute(tailCol, 3));
  const trailMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const tails = new THREE.LineSegments(tailGeo, trailMat);
  group.add(tails);

  const headGeo = new THREE.BufferGeometry();
  const headPos = new Float32Array(MAX * 2 * 3);
  const headCol = new Float32Array(MAX * 2 * 3);
  headGeo.setAttribute("position", new THREE.BufferAttribute(headPos, 3));
  headGeo.setAttribute("color", new THREE.BufferAttribute(headCol, 3));
  const heads = new THREE.LineSegments(headGeo, trailMat);
  group.add(heads);

  // ── origin threads: every plane faintly tied to where it came from ──
  const THREAD_SEGS = 14;
  const threadGeo = new THREE.BufferGeometry();
  const threadPos = new Float32Array(MAX * THREAD_SEGS * 2 * 3);
  threadGeo.setAttribute("position", new THREE.BufferAttribute(threadPos, 3));
  threadGeo.setDrawRange(0, 0);
  const threads = new THREE.LineSegments(threadGeo, new THREE.LineBasicMaterial({
    color: 0x3e9edb, transparent: true, opacity: 0.13,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  group.add(threads);

  // ── halos: soft additive points (gold = golden hour, green = aurora) ──
  function haloCloud(stops) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    for (const [at, color] of stops) g.addColorStop(at, color);
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const geo = new THREE.BufferGeometry();
    const posArr = new Float32Array(MAX * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
    geo.setDrawRange(0, 0);
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      map: new THREE.CanvasTexture(c), size: 0.075, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    group.add(pts);
    return { geo, posArr, mat: pts.material };
  }
  const goldHalo = haloCloud([
    [0, "rgba(255,217,160,0.9)"], [0.4, "rgba(255,190,120,0.25)"], [1, "rgba(255,180,100,0)"]]);
  const greenHalo = haloCloud([
    [0, "rgba(159,245,201,0.9)"], [0.4, "rgba(90,230,170,0.25)"], [1, "rgba(60,210,150,0)"]]);

  // ── selection ring + HTML label ──────────────────────────
  const selRing = new THREE.Mesh(
    new THREE.RingGeometry(0.02, 0.023, 40),
    new THREE.MeshBasicMaterial({ color: 0xa8d4f5, side: THREE.DoubleSide,
      transparent: true, opacity: 0.9, depthWrite: false })
  );
  selRing.visible = false;
  group.add(selRing);
  const label = document.createElement("div");
  label.className = "plane-label";
  label.hidden = true;
  document.querySelector(".map-wrap").appendChild(label);

  // ── per-flight bookkeeping ───────────────────────────────
  let list = [];                     // flights in instance order
  const display = new Map();         // id -> {lat, lon, alt} eased position
  const golden = new Map();          // id -> bool, refreshed per poll
  const auroral = new Map();         // id -> bool, refreshed per poll
  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const P = new THREE.Vector3(), F = new THREE.Vector3(),
        N = new THREE.Vector3(), S = new THREE.Vector3(),
        SCL = new THREE.Vector3(), basis = new THREE.Matrix4();

  // ── cinematic drift ──────────────────────────────────────
  // True aircraft speed reads as standstill at planetary zoom (a jet crosses
  // one pixel every ~10 s). So the sky flows: planes fly up to 60× ahead along
  // their real heading when zoomed out — imperceptible positional licence at
  // that scale — and ease back to true speed and position as you zoom in,
  // where taps, cards, and routes need accuracy. Data stays truthful.
  const driftS = new Map();   // id -> seconds of visual flight ahead of truth
  const DRIFT_MAX = 60;
  function driftParams(camDist) {
    const k = Math.min(1, Math.max(0, (camDist - 1.6) / 1.5));   // 0 close … 1 far
    return { mult: 1 + (DRIFT_MAX - 1) * k * k, capS: 1800 * k * k };
  }

  function matchesFilters(f) {
    const { alliance, origin, destination } = state.filters;
    if (alliance && (f.airline ? f.airline.alliance : "none") !== alliance) return false;
    if (origin && f.origin !== origin) return false;
    if (destination && f.destination !== destination) return false;
    return true;
  }

  function refreshColors() {
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const c = !matchesFilters(f) ? COL_DIM
        : (state.auroraChaser && auroral.get(f.id)) ? COL_AUR
        : (state.sunsetChaser && golden.get(f.id)) ? COL_GOLD : COL_PLANE;
      darts.setColorAt(i, c);
    }
    if (darts.instanceColor) darts.instanceColor.needsUpdate = true;
  }

  // rebuild trails + halos + golden flags after each poll
  function onFlightsUpdated() {
    list = [...state.flights.values()].slice(0, MAX);
    darts.count = list.length;
    const now = Date.now();
    const date = new Date(now);

    let seg = 0, goldN = 0, greenN = 0, thr = 0;
    const Q = new THREE.Vector3();
    for (const f of list) {
      // origin thread: a thin great-circle line back to where this flight began
      const ends = state.threads !== false && matchesFilters(f) &&
        Skyboard.registry.routeEndpoints(f);
      if (ends) {
        const { A } = ends;
        for (let i = 0; i < THREAD_SEGS && thr < MAX * THREAD_SEGS; i++) {
          const p1 = geo.intermediatePoint(A.lat, A.lon, f.lat, f.lon, i / THREAD_SEGS);
          const p2 = geo.intermediatePoint(A.lat, A.lon, f.lat, f.lon, (i + 1) / THREAD_SEGS);
          globe.latLonToVec3(p1.lat, p1.lon, f.altitudeM * 0.6, P);
          globe.latLonToVec3(p2.lat, p2.lon, f.altitudeM * 0.6, Q);
          threadPos.set([P.x, P.y, P.z, Q.x, Q.y, Q.z], thr * 6);
          thr++;
        }
      }
      golden.set(f.id, Skyboard.solar.isGoldenHour(f.lat, f.lon, date));
      auroral.set(f.id, !!(Skyboard.aurora &&
        Skyboard.aurora.intensityAt(f.lat, f.lon) >= AURORA_MIN));
      if (matchesFilters(f)) {
        if (state.auroraChaser && auroral.get(f.id)) {
          globe.latLonToVec3(f.lat, f.lon, f.altitudeM, P);
          greenHalo.posArr.set([P.x, P.y, P.z], greenN * 3);
          greenN++;
        } else if (state.sunsetChaser && golden.get(f.id)) {
          globe.latLonToVec3(f.lat, f.lon, f.altitudeM, P);
          goldHalo.posArr.set([P.x, P.y, P.z], goldN * 3);
          goldN++;
        }
      }
      if (!f.trail || f.trail.length < 2 || !matchesFilters(f)) continue;
      for (let i = 1; i < f.trail.length && seg < MAX * 32; i++) {
        const a = f.trail[i - 1], b = f.trail[i];
        const fade = Math.max(0, 1 - (now - b.t) / TRAIL_MS);
        const k = 0.5 * fade * fade;
        globe.latLonToVec3(a.lat, a.lon, f.altitudeM, P);
        tailPos.set([P.x, P.y, P.z], seg * 6);
        globe.latLonToVec3(b.lat, b.lon, f.altitudeM, P);
        tailPos.set([P.x, P.y, P.z], seg * 6 + 3);
        tailCol.set([0.24 * k, 0.62 * k, 0.86 * k], seg * 6);
        tailCol.set([0.24 * k, 0.62 * k, 0.86 * k], seg * 6 + 3);
        seg++;
      }
    }
    tailGeo.setDrawRange(0, seg * 2);
    tailGeo.attributes.position.needsUpdate = true;
    tailGeo.attributes.color.needsUpdate = true;
    threadGeo.setDrawRange(0, thr * 2);
    threadGeo.attributes.position.needsUpdate = true;
    goldHalo.geo.setDrawRange(0, goldN);
    goldHalo.geo.attributes.position.needsUpdate = true;
    greenHalo.geo.setDrawRange(0, greenN);
    greenHalo.geo.attributes.position.needsUpdate = true;
    refreshColors();
    // drop eased positions of landed flights
    for (const id of display.keys()) if (!state.flights.has(id)) display.delete(id);
    for (const id of driftS.keys()) if (!state.flights.has(id)) driftS.delete(id);
  }

  Skyboard.bus.on("flights:updated", onFlightsUpdated);
  Skyboard.bus.on("filters:changed", refreshColors);
  Skyboard.bus.on("sunset:changed", () => { onFlightsUpdated(); });
  Skyboard.bus.on("aurora:changed", () => { onFlightsUpdated(); });
  Skyboard.bus.on("aurora:updated", () => { onFlightsUpdated(); });
  Skyboard.bus.on("threads:changed", () => { onFlightsUpdated(); });

  // ── per-frame: glide planes, live head segments, selection ──
  let lastFrameT = 0;
  function update(now, camera) {
    const frameDt = lastFrameT ? Math.min(0.1, (now - lastFrameT) / 1000) : 0;
    lastFrameT = now;
    const { mult, capS } = driftParams(camera.position.length());
    const gs = glyphScale(camera);
    SCL.set(gs, gs, gs);
    goldHalo.mat.size = 0.075 * gs;
    greenHalo.mat.size = 0.075 * gs;
    selRing.scale.setScalar(gs);
    let headN = 0;
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      // dead-reckon truth, then add the cinematic drift offset along heading
      const dtS = Math.min(1200, Math.max(0, (now - f.updatedAt) / 1000));
      let off = driftS.get(f.id) || 0;
      off = off > capS
        ? off + (capS - off) * frameDt * 0.5          // zoomed in: glide back to truth
        : Math.min(capS, off + frameDt * (mult - 1)); // zoomed out: the sky flows
      driftS.set(f.id, off);
      const tgt = geo.destinationPoint(f.lat, f.lon, f.headingDeg,
        (f.velocityMs * (dtS + off)) / 1000);
      let d = display.get(f.id);
      if (!d) { d = { lat: tgt.lat, lon: tgt.lon, alt: f.altitudeM }; display.set(f.id, d); }
      d.lat += (tgt.lat - d.lat) * 0.1;
      d.lon += (tgt.lon - d.lon) * 0.1;
      d.alt += (f.altitudeM - d.alt) * 0.1;

      globe.latLonToVec3(d.lat, d.lon, d.alt, P);
      // orientation: right-handed basis, nose (+Z) along the direction of flight
      const aheadPt = geo.destinationPoint(d.lat, d.lon, f.headingDeg, 30);
      globe.latLonToVec3(aheadPt.lat, aheadPt.lon, d.alt, F).sub(P).normalize();
      N.copy(P).normalize();                 // radial up
      S.crossVectors(N, F).normalize();      // side = up × forward
      F.crossVectors(S, N).normalize();      // re-orthogonalize forward
      basis.makeBasis(S, N, F);
      tmpQ.setFromRotationMatrix(basis);
      tmpM.compose(P, tmpQ, SCL);
      darts.setMatrixAt(i, tmpM);

      // live head segment: last trail point → current position
      if (f.trail && f.trail.length && matchesFilters(f)) {
        const last = f.trail[f.trail.length - 1];
        globe.latLonToVec3(last.lat, last.lon, f.altitudeM, F);
        globe.latLonToVec3(d.lat, d.lon, d.alt, S);
        headPos.set([F.x, F.y, F.z, S.x, S.y, S.z], headN * 6);
        headCol.set([0.12, 0.31, 0.43, 0.12, 0.31, 0.43], headN * 6);
        headN++;
      }

      // selection ring + label follow
      if (state.selected === f.id) {
        selRing.visible = true;
        selRing.position.copy(P);
        selRing.lookAt(camera.position);
        const sp = P.clone().project(camera);
        const el = document.getElementById("globe");
        label.hidden = sp.z > 1;
        label.textContent = f.callsign;
        label.style.left = ((sp.x * 0.5 + 0.5) * el.clientWidth + 14) + "px";
        label.style.top = ((-sp.y * 0.5 + 0.5) * el.clientHeight - 8) + "px";
      }
    }
    if (state.selected === null) { selRing.visible = false; label.hidden = true; }
    darts.instanceMatrix.needsUpdate = true;
    headGeo.setDrawRange(0, headN * 2);
    headGeo.attributes.position.needsUpdate = true;
    headGeo.attributes.color.needsUpdate = true;
  }

  // Screen-space pick: nearest visible plane within 14 px of the tap.
  const pickV = new THREE.Vector3();
  function pick(px, py, camera, w, h) {
    const camDir = camera.position.clone().normalize();
    let best = null, bestD = 14;
    for (const f of list) {
      if (!matchesFilters(f)) continue;
      const d = display.get(f.id);
      if (!d) continue;
      globe.latLonToVec3(d.lat, d.lon, d.alt, pickV);
      // skip planes beyond the globe's horizon (behind the earth)
      if (pickV.clone().normalize().dot(camDir) < 0.12) continue;
      pickV.project(camera);
      if (pickV.z > 1) continue;
      const sx = (pickV.x * 0.5 + 0.5) * w, sy = (-pickV.y * 0.5 + 0.5) * h;
      const dist = Math.hypot(sx - px, sy - py);
      if (dist < bestD) { bestD = dist; best = f.id; }
    }
    return best ? { plane: best } : null;
  }

  // Eased on-screen position of a flight (used by follow mode).
  const getDisplay = (id) => display.get(id) || null;

  return { group, update, pick, getDisplay };
})();
