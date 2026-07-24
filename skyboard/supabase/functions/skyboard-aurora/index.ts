// skyboard-aurora — NOAA SWPC OVATION proxy with a 5-minute shared cache.
// Response: { fetchedAt, points: [{ lat, lon, intensity }] }  (intensity 0–100)
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const { data } = await db.from("cache").select("value, fetched_at").eq("key", "aurora").maybeSingle();
  if (data && Date.now() - new Date(data.fetched_at).getTime() < 5 * 60 * 1000)
    return json(data.value);

  try {
    const res = await fetch("https://services.swpc.noaa.gov/json/ovation_aurora_latest.json");
    if (!res.ok) throw new Error(`swpc ${res.status}`);
    const j = await res.json();
    const payload = {
      fetchedAt: Date.parse(j["Forecast Time"]) || Date.now(),
      points: (j.coordinates || [])
        .filter((c: number[]) => c[2] >= 10)
        .map(([lon, lat, intensity]: number[]) => ({
          lat, lon: lon > 180 ? lon - 360 : lon, intensity,
        })),
    };
    await db.from("cache").upsert({ key: "aurora", value: payload, fetched_at: new Date().toISOString() });
    return json(payload);
  } catch (err) {
    if (data) return json({ ...data.value, stale: true });   // any age beats nothing
    return json({ error: String(err) }, 502);
  }
});
