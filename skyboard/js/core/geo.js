// Skyboard.geo — geodesy + Web Mercator projection helpers. Pure functions only.
window.Skyboard = window.Skyboard || {};

Skyboard.geo = (() => {
  const R = 6371; // km
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;

  // Great-circle distance in km.
  function distanceKm(lat1, lon1, lat2, lon2) {
    const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // Point at fraction f along the great circle from A to B.
  function intermediatePoint(lat1, lon1, lat2, lon2, f) {
    const φ1 = rad(lat1), λ1 = rad(lon1), φ2 = rad(lat2), λ2 = rad(lon2);
    const δ = distanceKm(lat1, lon1, lat2, lon2) / R;
    if (δ < 1e-9) return { lat: lat1, lon: lon1 };
    const a = Math.sin((1 - f) * δ) / Math.sin(δ);
    const b = Math.sin(f * δ) / Math.sin(δ);
    const x = a * Math.cos(φ1) * Math.cos(λ1) + b * Math.cos(φ2) * Math.cos(λ2);
    const y = a * Math.cos(φ1) * Math.sin(λ1) + b * Math.cos(φ2) * Math.sin(λ2);
    const z = a * Math.sin(φ1) + b * Math.sin(φ2);
    return { lat: deg(Math.atan2(z, Math.hypot(x, y))), lon: deg(Math.atan2(y, x)) };
  }

  // Initial bearing from A to B, degrees 0–360.
  function bearingDeg(lat1, lon1, lat2, lon2) {
    const φ1 = rad(lat1), φ2 = rad(lat2), dλ = rad(lon2 - lon1);
    const y = Math.sin(dλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }

  // Dead-reckon: move from (lat,lon) along heading by d km.
  function destinationPoint(lat, lon, headingDeg_, dKm) {
    const δ = dKm / R, θ = rad(headingDeg_);
    const φ1 = rad(lat), λ1 = rad(lon);
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
                               Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
    return { lat: deg(φ2), lon: ((deg(λ2) + 540) % 360) - 180 };
  }

  // Web Mercator: lon/lat -> world units (x: 0..1, y: 0..1 at zoom 0).
  function project(lat, lon) {
    const x = (lon + 180) / 360;
    const s = Math.sin(rad(Math.max(-85, Math.min(85, lat))));
    const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
    return { x, y };
  }

  function unproject(x, y) {
    const lon = x * 360 - 180;
    const lat = deg(Math.atan(Math.sinh(Math.PI * (1 - 2 * y))));
    return { lat, lon };
  }

  return { distanceKm, intermediatePoint, bearingDeg, destinationPoint, project, unproject, rad, deg };
})();
