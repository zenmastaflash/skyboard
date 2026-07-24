// skyboard-fares — real cached fares from the Travelpayouts data API.
// Token + marker live in the RLS-locked app_secrets table; affiliate links are
// built server-side so the marker never needs to ship in frontend code.
//
// GET ?origin=AMS                → { fetchedAt, currency, fares: Fare[] }
// GET ?origin=AMS&destination=X  → { fare: Fare | null }
// Fare: { origin, destination, price, currency, departDate, deepLink, fetchedAt }
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
const TTL_S = 6 * 3600;   // fares are a cached-prices product; hours-fresh is honest

async function getSecret(name: string): Promise<string | null> {
  const env = Deno.env.get(name);
  if (env) return env;
  const { data } = await db.from("app_secrets").select("value").eq("name", name).maybeSingle();
  return data ? data.value : null;
}

async function cacheGet(key: string, maxAgeS: number) {
  const { data } = await db.from("cache").select("value, fetched_at").eq("key", key).maybeSingle();
  if (!data) return null;
  if (Date.now() - new Date(data.fetched_at).getTime() > maxAgeS * 1000) return null;
  return data.value;
}
const cacheSet = (key: string, value: unknown) =>
  db.from("cache").upsert({ key, value, fetched_at: new Date().toISOString() });

function deepLink(o: string, d: string, departDate: string | null, marker: string) {
  // aviasales search URL: ORIGIN + DDMM + DEST + passengers
  let dm = "";
  if (departDate) {
    const [, m, day] = departDate.split("-");
    dm = `${day}${m}`;
  }
  return `https://www.aviasales.com/search/${o}${dm}${d}1?marker=${marker}`;
}

type Fare = {
  origin: string; destination: string; price: number; currency: string;
  departDate: string | null; deepLink: string; fetchedAt: number;
};

// cheapest per destination out of an origin, via v2/prices/latest
async function faresFrom(origin: string, token: string, marker: string): Promise<Fare[]> {
  const res = await fetch(
    `https://api.travelpayouts.com/v2/prices/latest?currency=eur&origin=${origin}` +
    `&period_type=year&one_way=true&limit=1000&token=${token}`,
    { signal: AbortSignal.timeout(15000) },
  );
  if (!res.ok) throw new Error(`travelpayouts ${res.status}`);
  const j = await res.json();
  const best = new Map<string, Fare>();
  for (const r of j.data || []) {
    if (!r.actual || !r.show_to_affiliates || !r.destination || !r.value) continue;
    const prev = best.get(r.destination);
    if (!prev || r.value < prev.price) {
      best.set(r.destination, {
        origin, destination: r.destination, price: Math.round(r.value), currency: "EUR",
        departDate: r.depart_date || null,
        deepLink: deepLink(origin, r.destination, r.depart_date || null, marker),
        fetchedAt: Date.now(),
      });
    }
  }
  return [...best.values()].sort((a, b) => a.price - b.price);
}

// single pair via v1/prices/cheap (fills gaps the latest-dump misses)
async function farePair(o: string, d: string, token: string, marker: string): Promise<Fare | null> {
  const res = await fetch(
    `https://api.travelpayouts.com/v1/prices/cheap?origin=${o}&destination=${d}` +
    `&currency=eur&token=${token}`,
    { signal: AbortSignal.timeout(10000) },
  );
  if (!res.ok) throw new Error(`travelpayouts ${res.status}`);
  const j = await res.json();
  const options = Object.values(j.data?.[d] || {}) as
    { price: number; departure_at: string }[];
  if (!options.length) return null;
  const cheapest = options.reduce((a, b) => (a.price <= b.price ? a : b));
  const departDate = (cheapest.departure_at || "").slice(0, 10) || null;
  return {
    origin: o, destination: d, price: Math.round(cheapest.price), currency: "EUR",
    departDate, deepLink: deepLink(o, d, departDate, marker), fetchedAt: Date.now(),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const origin = (url.searchParams.get("origin") || "").toUpperCase();
  const destination = (url.searchParams.get("destination") || "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(origin)) return json({ error: "origin required" }, 400);

  const token = await getSecret("TP_TOKEN");
  const marker = (await getSecret("TP_MARKER")) || "";
  if (!token) return json({ error: "no travelpayouts token configured" }, 503);

  // origin dump (also serves most pair lookups)
  const originKey = `fares:${origin}`;
  let dump = await cacheGet(originKey, TTL_S);
  if (!dump) {
    try {
      dump = { fetchedAt: Date.now(), currency: "EUR", fares: await faresFrom(origin, token, marker) };
      await cacheSet(originKey, dump);
    } catch (err) {
      dump = await cacheGet(originKey, 7 * 86400);   // stale beats nothing
      if (!dump) return json({ error: String(err) }, 502);
    }
  }

  if (!/^[A-Z]{3}$/.test(destination)) return json(dump);

  // pair: from the dump when possible, else a targeted lookup (cached, incl. misses)
  const fromDump = (dump.fares as Fare[]).find((f) => f.destination === destination);
  if (fromDump) return json({ fare: fromDump });

  const pairKey = `fares:${origin}:${destination}`;
  const cachedPair = await cacheGet(pairKey, TTL_S);
  if (cachedPair) return json(cachedPair);
  try {
    const fare = await farePair(origin, destination, token, marker);
    const payload = { fare };
    await cacheSet(pairKey, payload);
    return json(payload);
  } catch (err) {
    return json({ fare: null, error: String(err) }, 200);   // honest empty, not a crash
  }
});
