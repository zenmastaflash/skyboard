// Skyboard.solar — solar elevation for the sunset chaser. Pure math, no API.
// NOAA simplified algorithm; accurate to ~0.2°, plenty for a golden-hour check.
window.Skyboard = window.Skyboard || {};

Skyboard.solar = (() => {
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;

  // Sun elevation in degrees at (lat, lon) for a given Date (UTC).
  function elevationDeg(lat, lon, date) {
    const ms = date.getTime();
    const julian = ms / 86400000 + 2440587.5;
    const d = julian - 2451545.0; // days since J2000
    const g = rad((357.529 + 0.98560028 * d) % 360);          // mean anomaly
    const q = (280.459 + 0.98564736 * d) % 360;               // mean longitude
    const L = rad(q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)); // ecliptic long.
    const e = rad(23.439 - 0.00000036 * d);                   // obliquity
    const decl = Math.asin(Math.sin(e) * Math.sin(L));
    const ra = deg(Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)));
    const gmst = (280.46061837 + 360.98564736629 * d) % 360;  // sidereal time
    const ha = rad(((gmst + lon - ra + 540) % 360) - 180);    // hour angle
    const φ = rad(lat);
    const sinEl = Math.sin(φ) * Math.sin(decl) + Math.cos(φ) * Math.cos(decl) * Math.cos(ha);
    return deg(Math.asin(sinEl));
  }

  // Golden hour aloft: at cruise altitude the horizon dips ~3°, so the window
  // shifts slightly below the geometric horizon. Bounds chosen for the look.
  function isGoldenHour(lat, lon, date) {
    const el = elevationDeg(lat, lon, date);
    return el > -6 && el < 6;
  }

  // Point on Earth where the sun is directly overhead — drives the globe's
  // day/night shader. Same NOAA math as elevationDeg, inverted.
  function subsolarPoint(date) {
    const ms = date.getTime();
    const julian = ms / 86400000 + 2440587.5;
    const d = julian - 2451545.0;
    const g = rad((357.529 + 0.98560028 * d) % 360);
    const q = (280.459 + 0.98564736 * d) % 360;
    const L = rad(q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g));
    const e = rad(23.439 - 0.00000036 * d);
    const decl = Math.asin(Math.sin(e) * Math.sin(L));
    const ra = deg(Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)));
    const gmst = (280.46061837 + 360.98564736629 * d) % 360;
    const lon = ((ra - gmst + 540) % 360) - 180;
    return { lat: deg(decl), lon };
  }

  return { elevationDeg, isGoldenHour, subsolarPoint };
})();
