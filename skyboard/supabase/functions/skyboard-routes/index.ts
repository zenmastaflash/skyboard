// skyboard-routes — callsign → route resolution via adsbdb.com, cached ~30 days.
// (adsb.lol's routeset began returning empty bodies; adsbdb also gives airport
// coordinates and city names, which the origin-threads layer needs.)
//
// Request:  POST { planes: [{ callsign, lat, lon }] }   (max 200)
// Response: { routes: { CALLSIGN: { origin, destination, ocity, dcity,
//                                   olat, olon, dlat, dlon } } }
// Callsigns absent from the response weren't resolved this round (the client
// retries); origin:null means adsbdb doesn't know the route (cached negative).
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
const TTL_DAYS = 30;
const RESOLVE_PER_CALL = 20;   // adsbdb is one GET per callsign — stay polite

type Route = {
  origin: string | null; destination: string | null;
  ocity: string | null; dcity: string | null;
  olat: number | null; olon: number | null;
  dlat: number | null; dlon: number | null;
  aname: string | null;   // airline name from adsbdb (world coverage)
};
const NO_ROUTE: Route = {
  origin: null, destination: null, ocity: null, dcity: null,
  olat: null, olon: null, dlat: null, dlon: null, aname: null,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let planes: { callsign: string }[];
  try {
    planes = (await req.json()).planes || [];
  } catch {
    return json({ error: "bad body" }, 400);
  }
  const callsigns = [...new Set(planes
    .filter((p) => p && typeof p.callsign === "string" && p.callsign.length >= 4)
    .map((p) => p.callsign.toUpperCase().trim()))].slice(0, 200);
  if (!callsigns.length) return json({ routes: {} });

  const routes: Record<string, Route> = {};

  // cached first
  const since = new Date(Date.now() - TTL_DAYS * 86400 * 1000).toISOString();
  const { data: known } = await db
    .from("routes")
    .select("callsign, origin, destination, ocity, dcity, olat, olon, dlat, dlon, aname")
    .in("callsign", callsigns)
    .gte("resolved_at", since);
  for (const r of known || []) {
    routes[r.callsign] = {
      origin: r.origin, destination: r.destination, ocity: r.ocity, dcity: r.dcity,
      olat: r.olat, olon: r.olon, dlat: r.dlat, dlon: r.dlon, aname: r.aname,
    };
  }

  // resolve a polite batch of the rest; unresolved ones retry next poll
  const missing = callsigns.filter((c) => !(c in routes)).slice(0, RESOLVE_PER_CALL);
  const upserts: Record<string, unknown>[] = [];
  await Promise.all(missing.map(async (cs) => {
    try {
      const res = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(cs)}`, {
        signal: AbortSignal.timeout(6000),
      });
      let entry: Route;
      if (res.status === 404) entry = NO_ROUTE;              // unknown: cache the no
      else if (!res.ok) return;                              // transient: don't cache
      else {
        const fr = (await res.json())?.response?.flightroute;
        entry = fr && fr.origin && fr.destination
          ? {
            origin: fr.origin.iata_code ?? null,
            destination: fr.destination.iata_code ?? null,
            ocity: fr.origin.municipality ?? null,
            dcity: fr.destination.municipality ?? null,
            olat: fr.origin.latitude ?? null,
            olon: fr.origin.longitude ?? null,
            dlat: fr.destination.latitude ?? null,
            dlon: fr.destination.longitude ?? null,
            aname: fr.airline?.name ?? null,
          }
          : NO_ROUTE;
      }
      routes[cs] = entry;
      upserts.push({ callsign: cs, ...entry, resolved_at: new Date().toISOString() });
    } catch (_err) { /* retry next poll */ }
  }));
  if (upserts.length) await db.from("routes").upsert(upserts);

  return json({ routes });
});
