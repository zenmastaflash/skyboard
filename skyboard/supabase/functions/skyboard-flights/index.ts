// skyboard-flights — live positions from the community ADS-B aggregators
// (adsb.lol, airplanes.live, adsb.fi — they mirror the same receiver network).
// OpenSky blocks datacenter IPs, so the brief's named fallback became primary.
//
// The aggregators serve 250 nm circles, not global snapshots, so we mosaic the
// world: ~61 fixed regions refreshed round-robin plus a fresh circle at the
// caller's camera focus. Viewer responses are served from cache immediately
// (only the focus circle is awaited); region refreshes run in the background.
// A pg_cron job calls ?warm=1 every minute so the mosaic never goes cold.
//
// Request:  GET ?lat=..&lon=..   (optional camera focus); ?warm=1 = cron mode
// Response: { fetchedAt, source, flights: Row[] }
// Row: [icao24, callsign, lat, lon, altM, trackDeg, velocityMs, lastContactS, type]
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const RADIUS_NM = 250;
const REGION_FRESH_S = 1200;   // regions older than this are dropped from the merge
const FOCUS_FRESH_S = 20;
const REFRESH_STEADY = 5;      // regions refreshed per call (61-region cycle ≈ 12 min)
const REFRESH_WARMUP = 8;

const SOURCES = [
  (lat: number, lon: number) => `https://api.airplanes.live/v2/point/${lat}/${lon}/${RADIUS_NM}`,
  (lat: number, lon: number) => `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${RADIUS_NM}`,
  (lat: number, lon: number) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${RADIUS_NM}`,
];

// [lat, lon, label] — circles centered on the world's traffic
const REGIONS: [number, number, string][] = [
  [51.8, 3.0, "nw-europe"], [50.2, 9.0, "germany"], [44.0, 10.5, "italy"],
  [39.5, -6.0, "iberia"], [39.5, 25.0, "aegean"], [57.5, 12.0, "nordics"],
  [50.8, 17.0, "central-eu"], [53.5, -6.5, "ireland"],
  [40.8, -74.5, "us-ne"], [33.9, -82.5, "us-se"], [26.8, -80.5, "florida"],
  [41.5, -87.5, "midwest"], [32.5, -96.5, "texas"], [36.0, -115.5, "us-sw"],
  [37.5, -121.5, "norcal"], [45.0, -122.5, "us-nw"], [43.7, -79.6, "toronto"],
  [19.4, -99.1, "mexico"], [-23.5, -46.6, "brazil"],
  [25.3, 55.4, "gulf"], [30.1, 31.4, "cairo"], [-26.1, 28.2, "joburg"],
  [28.5, 77.1, "delhi"], [19.1, 72.9, "mumbai"],
  [1.35, 103.9, "singapore"], [13.7, 100.6, "bangkok"], [22.5, 114.0, "hongkong"],
  [31.5, 120.5, "shanghai"], [35.7, 139.8, "tokyo"], [37.5, 127.0, "seoul"],
  [-33.9, 151.2, "sydney"],
  // second ring: Africa, LatAm, Russia/Central Asia, more Asia-Pacific,
  // and the oceanic entry corridors where transatlantic traffic is visible
  [6.6, 3.3, "lagos"], [-1.3, 36.9, "nairobi"], [9.0, 38.8, "addis"],
  [33.6, -7.6, "casablanca"], [36.8, 3.2, "algiers"], [24.7, 46.7, "riyadh"],
  [55.8, 37.6, "moscow"], [43.3, 76.9, "almaty"], [24.9, 67.2, "karachi"],
  [13.0, 78.5, "south-india"], [30.6, 104.1, "chengdu"], [40.1, 116.6, "beijing"],
  [25.1, 121.5, "taipei"], [14.5, 121.0, "manila"], [21.0, 105.8, "hanoi"],
  [-6.1, 106.7, "jakarta"], [-31.9, 115.9, "perth"], [-37.7, 144.8, "melbourne"],
  [-37.0, 174.8, "auckland"], [21.3, -157.9, "hawaii"], [61.2, -150.0, "anchorage"],
  [4.7, -74.1, "bogota"], [-12.0, -77.1, "lima"], [-33.4, -70.8, "santiago"],
  [-34.8, -58.5, "buenos-aires"], [18.4, -66.0, "san-juan"], [9.0, -79.4, "panama"],
  [39.8, -104.9, "denver"], [48.0, -52.0, "gander"], [52.0, -15.0, "shanwick"],
];

type Row = [string, string, number, number, number, number, number, number, string];

async function fetchCircle(lat: number, lon: number, sourceIdx: number): Promise<Row[]> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < SOURCES.length; attempt++) {
    const url = SOURCES[(sourceIdx + attempt) % SOURCES.length](+lat.toFixed(2), +lon.toFixed(2));
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
      if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
      const j = await res.json();
      const rawNow = j.now ?? Date.now();
      const nowS = rawNow > 1e12 ? Math.floor(rawNow / 1000) : Math.floor(rawNow);
      return (j.ac || j.aircraft || [])
        .filter((a: Record<string, unknown>) =>
          typeof a.lat === "number" && typeof a.lon === "number" &&
          typeof a.alt_baro === "number" && (a.alt_baro as number) > 500 &&
          ((a.gs as number) || 0) > 60)
        .map((a: Record<string, unknown>): Row => [
          a.hex as string,
          ((a.flight as string) || "").trim(),
          +(a.lat as number).toFixed(4),
          +(a.lon as number).toFixed(4),
          Math.round((a.alt_baro as number) * 0.3048),
          Math.round((a.track as number) ?? 0),
          Math.round(((a.gs as number) ?? 0) * 0.5144),
          nowS - Math.round((a.seen as number) ?? 0),
          ((a.t as string) || "").trim(),
        ]);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const warm = url.searchParams.get("warm") === "1";
  const focusLat = parseFloat(url.searchParams.get("lat") ?? "");
  const focusLon = parseFloat(url.searchParams.get("lon") ?? "");
  const hasFocus = Number.isFinite(focusLat) && Number.isFinite(focusLon) &&
    Math.abs(focusLat) <= 85;

  // current mosaic
  const { data: cached } = await db.from("cache")
    .select("key, value, fetched_at")
    .like("key", "region:%");
  const byKey = new Map((cached || []).map((r) => [r.key, r]));
  const ageS = (r: { fetched_at: string }) =>
    (Date.now() - new Date(r.fetched_at).getTime()) / 1000;

  const doJob = async (job: { key: string; lat: number; lon: number }, i: number) => {
    try {
      const rows = await fetchCircle(job.lat, job.lon, i % SOURCES.length);
      const entry = { key: job.key, value: { rows }, fetched_at: new Date().toISOString() };
      await db.from("cache").upsert(entry);
      byKey.set(job.key, entry);
    } catch (_err) { /* a missed circle stays stale one cycle */ }
  };

  // focus circle: awaited — it's what the viewer is looking at right now
  let focusJob: { key: string; lat: number; lon: number } | null = null;
  if (hasFocus) {
    const key = `region:focus:${Math.round(focusLat / 4) * 4}:${Math.round(focusLon / 4) * 4}`;
    const row = byKey.get(key);
    if (!row || ageS(row) > FOCUS_FRESH_S) focusJob = { key, lat: focusLat, lon: focusLon };
  }

  // stalest fixed regions: refreshed in the background so responses stay fast
  const ranked = REGIONS
    .map(([lat, lon, name]) => {
      const row = byKey.get(`region:${name}`);
      return { key: `region:${name}`, lat, lon, age: row ? ageS(row) : 1e12 };
    })
    .sort((a, b) => b.age - a.age);
  const missing = ranked.filter((r) => r.age > REGION_FRESH_S).length;
  const budget = missing > 8 ? REFRESH_WARMUP : REFRESH_STEADY;
  const regionJobs = ranked.slice(0, budget);

  const background = Promise.all(regionJobs.map((j, i) => doJob(j, i + 1)));
  if (warm) {
    await background;                     // the cron has no one waiting on it
    return json({ ok: true, refreshed: regionJobs.length });
  }
  if (focusJob) await doJob(focusJob, 0);
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt && rt.waitUntil) rt.waitUntil(background);
  else background.catch(() => {});       // fire and forget

  // merge, newest report wins per aircraft; airliner traffic only
  const merged = new Map<string, Row>();
  for (const r of byKey.values()) {
    if (ageS(r) > REGION_FRESH_S) continue;
    for (const row of (r.value.rows || []) as Row[]) {
      if (!row[1] || (row[6] < 80 && row[4] < 5000)) continue;   // hobby traffic
      const prev = merged.get(row[0]);
      if (!prev || row[7] > prev[7]) merged.set(row[0], row);
    }
  }
  // cap by altitude, not insertion order: cruise traffic survives in every
  // region instead of whole regions falling off the end
  const flights = [...merged.values()];
  if (flights.length > 4200) flights.sort((a, b) => b[4] - a[4]).length = 4200;

  return json({
    fetchedAt: Date.now(),
    source: "adsb community aggregators",
    flights,
  });
});
