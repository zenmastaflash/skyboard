// Skyboard aurora3d — the aurora oval as a soft green glow ribbon floating just
// above the planes, night side only (aurora you could actually see).
window.Skyboard = window.Skyboard || {};

Skyboard.aurora3d = (() => {
  const { state, globe } = Skyboard;
  const group = new THREE.Group();
  const ALT_M = 13000;         // just above cruise traffic (40× exaggerated)

  const glowTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(120, 255, 190, 0.55)");
    g.addColorStop(0.5, "rgba(60, 220, 150, 0.16)");
    g.addColorStop(1, "rgba(40, 200, 130, 0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();

  let cloud = null;

  function rebuild() {
    if (cloud) {
      group.remove(cloud);
      cloud.geometry.dispose();
      cloud.material.dispose();
      cloud = null;
    }
    const d = state.auroraData;
    if (!d) return;

    const date = new Date();
    const pos = [], col = [];
    for (const p of d.points) {
      if (p.intensity < 15) continue;
      // only where it's dark enough to see it
      if (Skyboard.solar.elevationDeg(p.lat, p.lon, date) > -3) continue;
      const v = globe.latLonToVec3(p.lat, p.lon, ALT_M);
      pos.push(v.x, v.y, v.z);
      const k = Math.min(1, p.intensity / 70);
      col.push(0.45 * k + 0.1, 0.9 * k + 0.1, 0.65 * k + 0.1);
    }
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    cloud = new THREE.Points(geo, new THREE.PointsMaterial({
      map: glowTex, vertexColors: true, size: 0.055, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    group.add(cloud);
  }

  Skyboard.bus.on("aurora:updated", rebuild);

  function update() {
    group.visible = !!state.auroraChaser;
  }

  return { group, update };
})();
