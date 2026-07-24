// Unit test for the live adapter: row mapping, trail accumulation, route merge.
// Run: node tools/test-live-adapter.js
global.window = global;
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const load = (f) => eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));

load('js/data/airports.js'); load('js/data/airlines.js');
load('js/core/bus.js'); load('js/core/registry.js'); load('js/core/geo.js'); load('js/core/solar.js');
Skyboard.config = { functionsBase: 'https://example.test/functions/v1' };

// stub the edge functions
const nowS = Math.floor(Date.now() / 1000);
let flightCalls = 0;
global.fetch = async (url, init) => {
  if (String(url).includes('skyboard-flights')) {
    flightCalls++;
    // second poll: KLM605 moved
    const lat = 52.3 + flightCalls * 0.05;
    return { ok: true, json: async () => ({ fetchedAt: Date.now(), flights: [
      ['484a3b', 'KLM605', lat, 4.7, 11000, 270, 240, nowS, 'B789'],
      ['abc123', 'NJE411X', 48.1, 11.5, 12000, 90, 220, nowS, 'C68A'],  // unknown airline
      ['low001', 'GABCD', 51.0, 0.1, 900, 180, 40, nowS, 'C172'],      // hobby: filtered
    ] }) };
  }
  if (String(url).includes('skyboard-fares')) {
    const u = new URL(String(url));
    if (u.searchParams.get('destination')) {
      return { ok: true, json: async () => ({ fare: { origin: 'AMS', destination: u.searchParams.get('destination'), price: 65, currency: 'EUR', departDate: '2026-10-03', deepLink: 'https://www.aviasales.com/search/AMS0310BCN1?marker=754808', fetchedAt: Date.now() } }) };
    }
    return { ok: true, json: async () => ({ fetchedAt: Date.now(), currency: 'EUR', fares: [
      { origin: 'AMS', destination: 'DUB', price: 31, currency: 'EUR', departDate: '2026-08-29', deepLink: 'https://www.aviasales.com/search/AMS2908DUB1?marker=754808', fetchedAt: Date.now() },
      { origin: 'AMS', destination: 'AGP', price: 32, currency: 'EUR', departDate: '2026-08-25', deepLink: 'https://www.aviasales.com/search/AMS2508AGP1?marker=754808', fetchedAt: Date.now() },
    ] }) };
  }
  if (String(url).includes('skyboard-routes')) {
    return { ok: true, json: async () => ({ routes: { KLM605: { origin: 'AMS', destination: 'SFO', ocity: 'Amsterdam', dcity: 'San Francisco', olat: 52.3, olon: 4.76, dlat: 37.6, dlon: -122.4 }, NJE411X: { origin: null, destination: null } } }) };
  }
  throw new Error('unexpected url ' + url);
};

load('js/api/adapters/mock.js'); load('js/api/adapters/live.js'); load('js/api/client.js');

(async () => {
  const t = (name, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) process.exitCode = 1; };
  t('live adapter selected', Skyboard.api.mode === 'live');

  const f1 = await Skyboard.api.getFlights();
  const klm = f1.find(x => x.callsign === 'KLM605');
  t('rows mapped', f1.length === 2 && !!klm);
  t('hobby traffic filtered', !f1.some(x => x.callsign === 'GABCD'));
  t('airline resolved from callsign', klm.airline && klm.airline.name === 'KLM');
  t('aircraft type from feed', klm.aircraft === 'B789');
  t('route resolved with coords', klm.origin === 'AMS' && klm.destination === 'SFO' && klm.routeInfo && klm.routeInfo.dlat === 37.6);
  t('unknown airline flight kept, route null', f1.find(x => x.callsign === 'NJE411X').origin === null);

  const f2 = await Skyboard.api.getFlights();
  const klm2 = f2.find(x => x.callsign === 'KLM605');
  t('trail accumulates across polls', klm2.trail.length >= 2);
  t('route cache reused (no pending)', klm2.origin === 'AMS');

  const fare = await Skyboard.api.getFare('AMS', 'BCN');
  t('real fare via edge fn', fare && fare.price === 65 && fare.deepLink.includes('marker=754808'));
  const fares = await Skyboard.api.getFaresFrom('AMS');
  t('fares-from dump', fares.length === 2 && fares[0].destination === 'DUB');
  const deps = await Skyboard.api.getDepartures('AMS', 2, 6);
  t('escape list from real fares', deps.length === 2 && deps[0].fare.price === 31 && deps[0].departDate === '2026-08-29');
  console.log(process.exitCode ? '\nFAILURES' : '\nALL PASS');
})();
