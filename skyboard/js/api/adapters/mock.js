// Skyboard mock adapter — Phase 1 stand-in for the Supabase edge functions.
// Implements the exact contract in DATA.md: getFlights, getFare, getFaresFrom,
// getDepartures. Phase 2 replaces this file with adapters/live.js; nothing else moves.
window.Skyboard = window.Skyboard || {};
Skyboard.adapters = Skyboard.adapters || {};

Skyboard.adapters.mock = (() => {
  const { geo, registry } = Skyboard;
  const SHORT_FLEET = 330;
  const LONG_FLEET = 90;
  const UNRESOLVED_RATE = 0.05;    // keeps the honest "route unknown" UI state alive
  const TRAIL_MIN = 30;            // minutes of ghost trail
  const TRAIL_STEP_S = 60;         // one trail point per minute

  // ── deterministic pseudo-randomness ──────────────────────
  // Fares are stable for a whole day (mirrors a cached price API); flights are
  // random per session.
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967296;
  }
  const day = new Date().toISOString().slice(0, 10);

  // ── airline bases: keeps mock routes plausible ───────────
  const BASES = {
    // Europe
    KLM: ["AMS"], KLC: ["AMS"], TRA: ["AMS"], BAW: ["LHR", "LGW"], CFE: ["LCY"],
    AFR: ["CDG"], HOP: ["CDG", "LYS"], TVF: ["ORY", "NTE"], DLH: ["FRA", "MUC"],
    CLH: ["FRA", "MUC"], EWG: ["DUS", "CGN", "STR"], AUA: ["VIE"], SWR: ["ZRH", "GVA"],
    EDW: ["ZRH"], BEL: ["BRU"], SAS: ["CPH", "OSL", "ARN"], TAP: ["LIS", "OPO"],
    LOT: ["WAW"], AEE: ["ATH"], THY: ["IST"], PGT: ["SAW"], IBE: ["MAD"], IBS: ["MAD"],
    VLG: ["BCN", "MAD"], AEA: ["MAD", "PMI"], FIN: ["HEL"], ICE: ["KEF"], BTI: ["RIX"],
    RYR: ["DUB", "STN", "BGY", "KRK", "MAD", "BER"], EZY: ["LGW", "LTN", "BER"],
    EJU: ["AMS", "BER", "NCE"], WZZ: ["BUD", "OTP", "WAW"], EXS: ["MAN", "LBA"],
    EIN: ["DUB"], NOZ: ["OSL", "ARN", "CPH"], CFG: ["FRA", "DUS"], VOE: ["NTE", "OLB"],
    ITY: ["FCO", "LIN"], CTN: ["ZAG"], ASL: ["BEG"], LGL: ["LUX"], KMM: ["MLA"],
    ROT: ["OTP"], SXS: ["AYT", "ADB"], WIF: ["BGO", "TRD"],
    // Americas
    SWA: ["MDW", "LAS", "PHX", "DEN"],
    JBU: ["JFK", "BOS", "FLL"], NKS: ["FLL", "LAS"], FFT: ["DEN"], ASA: ["SEA", "PDX", "SAN"],
    HAL: ["HNL"], WJA: ["YYC", "YYZ"], VOI: ["GDL", "MEX"], AMX: ["MEX"],
    AZU: ["GRU", "CNF", "REC"], GLO: ["GRU", "GIG", "BSB"], LAN: ["SCL", "LIM", "GRU"],
    AVA: ["BOG", "MDE"], CMP: ["PTY"], ARG: ["EZE", "AEP"],
    UAL: ["ORD", "IAH", "DEN", "SFO", "EWR", "IAD"], AAL: ["DFW", "CLT", "MIA", "PHX", "ORD"],
    DAL: ["ATL", "DTW", "MSP", "SLC", "JFK", "SEA"], ACA: ["YYZ", "YVR", "YUL"],
    // Middle East & Africa
    FDB: ["DXB"], ABY: ["SHJ"], KNE: ["RUH", "JED"], GFA: ["BAH"], MSR: ["CAI"],
    RAM: ["CMN"], TAR: ["TUN"], DAH: ["ALG"], ETH: ["ADD"], KQA: ["NBO"], SAA: ["JNB"],
    MAU: ["MRU"], OMA: ["MCT"],
    // Asia & Oceania
    IGO: ["DEL", "BOM", "BLR", "HYD"], AIC: ["DEL", "BOM"], PAL: ["MNL"], CEB: ["MNL", "CEB"],
    AXM: ["KUL", "DMK", "CGK"], TGW: ["SIN"], THA: ["BKK"], HVN: ["SGN", "HAN"],
    VJC: ["SGN", "HAN"], GIA: ["CGK"], MAS: ["KUL"], ALK: ["CMB"],
    ANA: ["HND", "NRT"], JAL: ["HND", "NRT"], APJ: ["KIX"], KAL: ["ICN"], AAR: ["ICN"],
    JJA: ["GMP", "PUS"], CES: ["PVG", "SHA"], CSN: ["CAN"], CHH: ["PEK", "PVG"],
    CQH: ["PVG"], CAL: ["TPE"], CPA: ["HKG"],
    QFA: ["SYD", "MEL"], JST: ["MEL", "SYD"], VOZ: ["BNE", "SYD", "MEL"],
    ANZ: ["AKL"], FJI: ["NAN"],
  };
  // Long-haul carriers spawn intercontinental legs from their hubs.
  const LONGHAUL = {
    UAE: ["DXB"], QTR: ["DOH"], ETD: ["AUH"], SVA: ["JED", "RUH"], ELY: ["TLV"],
    SIA: ["SIN"], CPA: ["HKG"], ANA: ["HND", "NRT"], JAL: ["HND", "NRT"], KAL: ["ICN"],
    THY: ["IST"], BAW: ["LHR"], AFR: ["CDG"], KLM: ["AMS"], DLH: ["FRA", "MUC"],
    VIR: ["LHR"], IBE: ["MAD"], TAP: ["LIS"], FIN: ["HEL"],
    UAL: ["SFO", "EWR", "IAD"], DAL: ["ATL", "JFK"], AAL: ["DFW", "MIA"], ACA: ["YYZ", "YVR"],
    QFA: ["SYD", "MEL"], ANZ: ["AKL"], LAN: ["SCL", "GRU"], AMX: ["MEX"],
    ETH: ["ADD"], SAA: ["JNB"], KQA: ["NBO"], RAM: ["CMN"], MSR: ["CAI"],
    AIC: ["DEL", "BOM"], CES: ["PVG"], CSN: ["CAN"], CAL: ["TPE"], THA: ["BKK"],
    MAS: ["KUL"], GIA: ["CGK"], HVN: ["SGN"], AVA: ["BOG"], CMP: ["PTY"],
  };
  const shortHaul = registry.allAirlines().filter(a => BASES[a.icaoPrefix]);
  const longHaul = registry.allAirlines().filter(a => LONGHAUL[a.icaoPrefix]);

  const AIRPORTS = registry.allAirports();
  const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function aircraftFor(distKm) {
    if (distKm > 3800) return rand(["B789", "A359", "B77W", "A333", "A388", "B78X"]);
    if (distKm < 500 && Math.random() < 0.35) return rand(["E190", "E195", "DH8D", "AT76", "BCS3"]);
    return rand(["A320", "A20N", "A21N", "B738", "B38M", "BCS3"]);
  }
  const CRUISE = { E190: 220, E195: 220, DH8D: 145, AT76: 140, BCS3: 225,
    A320: 230, A20N: 232, A21N: 233, B738: 230, B38M: 232,
    B789: 252, B78X: 252, A359: 252, B77W: 255, A333: 248, A388: 255 };
  const CEIL = { DH8D: 7600, AT76: 7000, E190: 11000, E195: 11000, BCS3: 11600,
    A320: 11300, A20N: 11600, A21N: 11600, B738: 11300, B38M: 11900,
    B789: 12500, B78X: 12500, A359: 12800, B77W: 12200, A333: 11900, A388: 13100 };

  // ── flight simulation ────────────────────────────────────
  let flights = [];   // sim records, superset of the public Flight shape
  let nextId = 1;

  const makeCallsign = (airline) =>
    airline.icaoPrefix + (100 + Math.floor(Math.random() * 8900));

  function makeFlight(airline, o, d, progress0) {
    const A = registry.airport(o), B = registry.airport(d);
    const distKm = geo.distanceKm(A.lat, A.lon, B.lat, B.lon);
    const aircraft = aircraftFor(distKm);
    const speed = CRUISE[aircraft] || 230;
    const durS = (distKm * 1000) / speed;
    return {
      id: "m" + (nextId++).toString(16).padStart(6, "0"),
      callsign: makeCallsign(airline),
      airline, origin: o, destination: d, aircraft,
      unresolved: Math.random() < UNRESOLVED_RATE,
      A, B, distKm, durS,
      t0: Date.now() - progress0 * durS * 1000,
    };
  }

  function spawn(pool, bases, minKm, maxKm, progress0) {
    for (let tries = 0; tries < 60; tries++) {
      const airline = rand(pool);
      const base = rand(bases[airline.icaoPrefix]);
      const dest = rand(AIRPORTS).iata;
      if (dest === base) continue;
      const A = registry.airport(base), B = registry.airport(dest);
      if (!A || !B) continue;
      const dist = geo.distanceKm(A.lat, A.lon, B.lat, B.lon);
      if (dist < minKm || dist > maxKm) continue;
      const swap = Math.random() < 0.5;   // fly it in either direction
      return makeFlight(airline, swap ? dest : base, swap ? base : dest, progress0);
    }
    return null;
  }
  const spawnShort = (p) => spawn(shortHaul, BASES, 280, 4200, p);
  const spawnLong = (p) => spawn(longHaul, LONGHAUL, 3800, 14500, p);

  function init() {
    for (let i = 0; i < SHORT_FLEET; i++) {
      const f = spawnShort(0.04 + Math.random() * 0.9);
      if (f) flights.push(f);
    }
    for (let i = 0; i < LONG_FLEET; i++) {
      const f = spawnLong(0.04 + Math.random() * 0.9);
      if (f) flights.push(f);
    }
  }

  function snapshot(f, now) {
    const progress = Math.min(1, (now - f.t0) / (f.durS * 1000));
    const p = geo.intermediatePoint(f.A.lat, f.A.lon, f.B.lat, f.B.lon, progress);
    const ahead = geo.intermediatePoint(f.A.lat, f.A.lon, f.B.lat, f.B.lon, Math.min(1, progress + 0.005));
    const phase = Math.min(1, progress / 0.08, (1 - progress) / 0.1); // climb/descent
    const cruise = CEIL[f.aircraft] || 11000;
    const speed = CRUISE[f.aircraft] || 230;
    // trail: sample the last 30 minutes of the same great circle
    const trail = [];
    const backS = Math.min(TRAIL_MIN * 60, (now - f.t0) / 1000);
    for (let s = backS; s >= 0; s -= TRAIL_STEP_S) {
      const fp = Math.max(0, progress - (s * 1000) / (f.durS * 1000));
      const tp = geo.intermediatePoint(f.A.lat, f.A.lon, f.B.lat, f.B.lon, fp);
      trail.push({ lat: tp.lat, lon: tp.lon, t: now - s * 1000 });
    }
    return {
      id: f.id, callsign: f.callsign, airline: f.airline,
      origin: f.unresolved ? null : f.origin,
      destination: f.unresolved ? null : f.destination,
      aircraft: f.aircraft,
      lat: p.lat, lon: p.lon,
      altitudeM: Math.round(cruise * Math.max(0.02, phase)),
      headingDeg: geo.bearingDeg(p.lat, p.lon, ahead.lat, ahead.lon),
      velocityMs: Math.round(speed * (0.45 + 0.55 * phase)),
      updatedAt: now, trail,
    };
  }

  // ── fares: deterministic per city pair per day ───────────
  function fare(origin, destination) {
    const A = registry.airport(origin), B = registry.airport(destination);
    if (!A || !B) return null;
    const distKm = geo.distanceKm(A.lat, A.lon, B.lat, B.lon);
    if (distKm < 180) return null;
    const jitter = 0.65 + hash(`${day}:${origin}:${destination}`) * 1.1;
    const price = Math.max(19, Math.round((26 + distKm * 0.048) * jitter));
    return {
      origin, destination, price, currency: "EUR",
      // Affiliate link stub — marker filled in when the Travelpayouts token lands (Phase 3).
      deepLink: `https://www.aviasales.com/search/${origin}${destination}?marker=SKYBOARD_STUB`,
      fetchedAt: Date.now() - Math.floor(hash(`${day}:t:${origin}${destination}`) * 6 * 3600 * 1000),
    };
  }

  // ── public contract (see DATA.md) ────────────────────────
  const simulateLatency = (value) =>
    new Promise((res) => setTimeout(() => res(value), 60 + Math.random() * 180));

  init();

  return {
    name: "mock",

    getFlights() {
      const now = Date.now();
      // land + respawn to keep the sky busy
      flights = flights.map((f) =>
        now - f.t0 > f.durS * 1000
          ? (f.distKm > 4200 ? spawnLong(0.02) : spawnShort(0.02)) || f
          : f
      );
      return simulateLatency(flights.map((f) => snapshot(f, now)));
    },

    getFare(origin, destination) {
      return simulateLatency(fare(origin, destination));
    },

    getFaresFrom(origin) {
      const out = [];
      for (const ap of AIRPORTS) {
        if (ap.iata === origin) continue;
        const f = fare(origin, ap.iata);
        if (f) out.push(f);
      }
      return simulateLatency(out);
    },

    getAurora() {
      // Live NOAA SWPC OVATION model — real data even in Phase 1: free, keyless,
      // CORS-open. Phase 2 moves this behind an edge function with server caching.
      return fetch("https://services.swpc.noaa.gov/json/ovation_aurora_latest.json")
        .then((r) => r.json())
        .then((j) => ({
          fetchedAt: Date.parse(j["Forecast Time"]) || Date.now(),
          points: j.coordinates
            .filter((c) => c[2] >= 10)
            .map(([lon, lat, intensity]) => ({
              lat, lon: lon > 180 ? lon - 360 : lon, intensity,
            })),
        }));
    },

    getDepartures(origin, hMin, hMax) {
      const now = Date.now();
      const out = [];
      const n = 16 + Math.floor(hash(`${day}:n:${origin}`) * 10);
      for (let i = 0; i < n; i++) {
        const r1 = hash(`${day}:${origin}:dep${i}`);
        const r2 = hash(`${day}:${origin}:dst${i}`);
        const airline = shortHaul[Math.floor(r1 * shortHaul.length)];
        const dest = AIRPORTS[Math.floor(r2 * AIRPORTS.length)].iata;
        if (dest === origin) continue;
        const hoursOut = 0.5 + r1 * 7.5;
        if (hoursOut < hMin || hoursOut > hMax) continue;
        const f = fare(origin, dest);
        if (!f) continue;
        out.push({
          callsign: airline.icaoPrefix + (100 + Math.floor(r2 * 8900)),
          airline, destination: dest,
          departsAt: now + hoursOut * 3600 * 1000,
          fare: f,
        });
      }
      out.sort((a, b) => a.fare.price - b.fare.price);
      return simulateLatency(out);
    },
  };
})();
