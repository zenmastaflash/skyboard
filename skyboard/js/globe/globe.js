// Skyboard.globe — the 3D earth. Textured sphere with a real-time day/night
// shader (sun position from solar math), night city lights, atmosphere rim,
// starfield, inertial orbit camera with idle drift, raycast picking.
// Layers (planes, markers) register with registerLayer({group, update, pick?}).
window.Skyboard = window.Skyboard || {};

Skyboard.globe = (() => {
  const container = document.getElementById("globe");
  const R = 1;                                  // globe radius, world units
  const ALT_SCALE = 40;                         // altitude exaggeration (visible cruise)
  const EARTH_KM = 6371;

  // lat/lon/altitude(m) -> position on/above the sphere
  function latLonToVec3(lat, lon, altM = 0, target) {
    const φ = (90 - lat) * Math.PI / 180;
    const λ = (lon + 180) * Math.PI / 180;
    const r = R * (1 + (altM / 1000 / EARTH_KM) * ALT_SCALE);
    const v = target || new THREE.Vector3();
    return v.set(
      -r * Math.sin(φ) * Math.cos(λ),
       r * Math.cos(φ),
       r * Math.sin(φ) * Math.sin(λ)
    );
  }

  // ── renderer / scene / camera ────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x04070c, 1);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 60);

  // orbit state: spherical around origin with inertia
  const orbit = {
    theta: 0.35, phi: 1.05, dist: 3.1,
    vTheta: 0, vPhi: 0,
    min: 1.28, max: 5.5,
    lastInput: 0,
  };

  function applyCamera() {
    const sp = Math.sin(orbit.phi), cp = Math.cos(orbit.phi);
    camera.position.set(
      orbit.dist * sp * Math.sin(orbit.theta),
      orbit.dist * cp,
      orbit.dist * sp * Math.cos(orbit.theta)
    );
    camera.lookAt(0, 0, 0);
  }

  // ── earth ────────────────────────────────────────────────
  const loader = new THREE.TextureLoader();
  const dayTex = loader.load(Skyboard.assets.earthDay);
  const nightTex = loader.load(Skyboard.assets.earthNight);
  dayTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const earthUniforms = {
    dayTex: { value: dayTex },
    nightTex: { value: nightTex },
    sunDir: { value: new THREE.Vector3(1, 0, 0) },
  };

  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(R, 96, 64),
    new THREE.ShaderMaterial({
      uniforms: earthUniforms,
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormal;
        void main() {
          vUv = uv;
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D dayTex;
        uniform sampler2D nightTex;
        uniform vec3 sunDir;
        varying vec2 vUv;
        varying vec3 vNormal;
        void main() {
          vec3 day = texture2D(dayTex, vUv).rgb;
          vec3 night = texture2D(nightTex, vUv).rgb;
          float ndl = dot(vNormal, sunDir);
          float lit = smoothstep(-0.12, 0.25, ndl);
          // dusk band: warm the day texture near the terminator
          float dusk = smoothstep(-0.12, 0.12, ndl) * (1.0 - smoothstep(0.12, 0.35, ndl));
          vec3 dayCol = day * (0.35 + 0.75 * lit) + vec3(0.25, 0.12, 0.02) * dusk * day;
          vec3 nightCol = night * vec3(1.15, 1.0, 0.75) * 1.25 + day * 0.035;
          gl_FragColor = vec4(mix(nightCol, dayCol, lit), 1.0);
        }`,
    })
  );
  scene.add(earth);
  // sunDir must be in view space (shader uses normalMatrix-transformed normals)
  const sunWorld = new THREE.Vector3();

  // ── atmosphere rim ───────────────────────────────────────
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.045, 64, 48),
    new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vNormal;
        void main() {
          float rim = pow(0.72 - dot(vNormal, vec3(0.0, 0.0, -1.0)), 4.5);
          gl_FragColor = vec4(0.28, 0.55, 0.9, 1.0) * rim;
        }`,
    })
  );
  scene.add(atmosphere);

  // ── stars ────────────────────────────────────────────────
  (() => {
    const n = 2200;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(40);
      pos.set([v.x, v.y, v.z], i * 3);
      const b = 0.35 + Math.random() * 0.65;
      const warm = Math.random() < 0.12;
      col.set(warm ? [b, b * 0.85, b * 0.7] : [b * 0.85, b * 0.92, b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.045, vertexColors: true, sizeAttenuation: false,
      transparent: true, opacity: 0.85, depthWrite: false,
    })));
  })();

  // ── layers ───────────────────────────────────────────────
  const layers = [];
  function registerLayer(layer) {
    layers.push(layer);
    if (layer.group) scene.add(layer.group);
  }

  // ── interaction ──────────────────────────────────────────
  let dragging = false, moved = false, lastX = 0, lastY = 0;
  const el = renderer.domElement;

  el.addEventListener("pointerdown", (e) => {
    dragging = true; moved = false; lastX = e.clientX; lastY = e.clientY;
    orbit.lastInput = Date.now();
    // grabbing the globe hands the camera back to the user
    if (Skyboard.state.following) {
      Skyboard.state.following = false;
      Skyboard.bus.emit("follow:changed");
    }
    el.setPointerCapture(e.pointerId);
    el.classList.add("dragging");
  });
  el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
    const k = 0.0022 * Math.sqrt(orbit.dist - 1.02);
    orbit.vTheta = -dx * k;
    orbit.vPhi = -dy * k;
    orbit.theta += orbit.vTheta;
    orbit.phi = Math.max(0.15, Math.min(Math.PI - 0.15, orbit.phi + orbit.vPhi));
    lastX = e.clientX; lastY = e.clientY;
    orbit.lastInput = Date.now();
  });
  el.addEventListener("pointerup", (e) => {
    dragging = false;
    el.classList.remove("dragging");
    orbit.lastInput = Date.now();
    if (moved) return;
    // click: screen-space picking (forgiving 14 px radius, beats raycasting darts)
    const rect = el.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    for (const layer of layers) {
      if (!layer.pick) continue;
      const hit = layer.pick(px, py, camera, rect.width, rect.height);
      if (hit && hit.plane) { Skyboard.bus.emit("map:planeTapped", hit.plane); return; }
      if (hit && hit.city) { Skyboard.bus.emit("map:cityTapped", hit.city); return; }
    }
    Skyboard.bus.emit("map:tappedEmpty");
  });
  el.addEventListener("wheel", (e) => {
    e.preventDefault();
    orbit.dist = Math.max(orbit.min, Math.min(orbit.max, orbit.dist * Math.exp(e.deltaY * 0.0011)));
    orbit.lastInput = Date.now();
  }, { passive: false });

  // fly the camera to face a lat/lon (used on home change, search, follow)
  let flyTarget = null;
  function flyTo(lat, lon) {
    flyTarget = {
      phi: (90 - lat) * Math.PI / 180,
      theta: (lon + 90) * Math.PI / 180,
    };
  }

  // ease an angle the short way around the circle
  function angLerp(a, b, k) {
    const d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    return a + d * k;
  }

  // ── loop ─────────────────────────────────────────────────
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);

  let lastFrame = Date.now();
  function frame() {
    const now = Date.now();
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;

    // inertia + idle drift
    if (!dragging) {
      orbit.theta += orbit.vTheta;
      orbit.phi = Math.max(0.15, Math.min(Math.PI - 0.15, orbit.phi + orbit.vPhi));
      orbit.vTheta *= 0.93; orbit.vPhi *= 0.93;
      if (now - orbit.lastInput > 12000 && !Skyboard.state.following)
        orbit.theta += 0.018 * dt;   // ambient spin
    }
    // follow mode: the camera drifts with the selected plane
    const st = Skyboard.state;
    if (st.following && st.selected && Skyboard.planes3d) {
      const d = Skyboard.planes3d.getDisplay(st.selected);
      if (d) {
        flyTarget = null;
        orbit.theta = angLerp(orbit.theta, (d.lon + 90) * Math.PI / 180, 0.045);
        orbit.phi += (((90 - d.lat) * Math.PI / 180) - orbit.phi) * 0.045;
      }
    } else if (flyTarget) {
      orbit.theta = angLerp(orbit.theta, flyTarget.theta, 0.06);
      orbit.phi += (flyTarget.phi - orbit.phi) * 0.06;
      if (Math.abs(flyTarget.theta - orbit.theta) + Math.abs(flyTarget.phi - orbit.phi) < 0.002)
        flyTarget = null;
    }
    applyCamera();

    // sun direction (view space) once a second is plenty
    const sub = Skyboard.solar.subsolarPoint(new Date(now));
    latLonToVec3(sub.lat, sub.lon, 0, sunWorld).normalize();
    earthUniforms.sunDir.value.copy(sunWorld)
      .transformDirection(camera.matrixWorldInverse);

    for (const layer of layers) if (layer.update) layer.update(now, camera);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  Skyboard.bus.on("home:changed", () => {
    const ap = Skyboard.registry.airport(Skyboard.state.home);
    if (ap) flyTo(ap.lat, ap.lon);
  });

  // lat/lon the camera is currently looking at (for focus-aware data fetching)
  function getCenter() {
    const lat = 90 - (orbit.phi * 180) / Math.PI;
    let lon = (orbit.theta * 180) / Math.PI - 90;
    lon = ((lon + 540) % 360) - 180;
    return { lat, lon };
  }

  return {
    registerLayer, latLonToVec3, flyTo, getCenter,
    start() {
      resize();
      const ap = Skyboard.registry.airport(Skyboard.state.home);
      if (ap) flyTo(ap.lat, ap.lon);
      frame();
    },
  };
})();
