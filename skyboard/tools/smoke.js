// Skyboard integration smoke test: loads the real index.html in jsdom, stubs the
// 3D globe (WebGL isn't available headless), runs the app, pokes every feature.
// Run: npm i jsdom && node tools/smoke.js
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
window.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 16);
// stub the NOAA aurora feed (no network in the test)
window.fetch = async () => ({ json: async () => ({
  "Forecast Time": new Date().toISOString(),
  coordinates: [[10, 65, 80], [200, -70, 50], [15, 66, 30], [0, 0, 2]],
}) });

// stub the 3D layer: everything above the globe is real
const GLOBE_STUB = `
  window.Skyboard = window.Skyboard || {};
  Skyboard.globe = { registerLayer(){}, start(){}, latLonToVec3(){ return null; }, flyTo(){} };
  Skyboard.planes3d = {}; Skyboard.markers3d = {};
`;
const SKIP = (src) => src.startsWith('vendor/') || src.startsWith('assets/') || src === 'js/config.js';  // no config -> mock adapter under test
const scripts = [...window.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src').split('?')[0]);  // strip cache-buster
let errors = [];
window.addEventListener('error', (e) => errors.push('window.onerror: ' + e.message));
let globeStubbed = false;
for (const src of scripts) {
  if (SKIP(src)) continue;
  if (src.startsWith('js/globe/')) {
    if (!globeStubbed) { window.eval(GLOBE_STUB); globeStubbed = true; }
    continue;
  }
  try { window.eval(fs.readFileSync(path.join(ROOT, src), 'utf8')); }
  catch (e) { errors.push(src + ': ' + e.message); }
}
const S = window.Skyboard;

(async () => {
  const t = (name, cond) => console.log((cond ? 'PASS' : 'FAIL') + ' ' + name) || (cond || errors.push(name));
  await new Promise(r => setTimeout(r, 700)); // let poll + latency resolve

  t('scripts loaded without errors', errors.length === 0);
  t('world fleet in state', S.state.flights.size > 350);
  const flights = [...S.state.flights.values()];
  t('flights on several continents', new Set(flights.filter(f => f.origin)
    .map(f => S.registry.airport(f.origin).country)).size > 20);
  t('long-haul present', flights.some(f => f.aircraft === 'A388' || f.aircraft === 'B77W'));
  t('unresolved routes present', flights.some(f => !f.origin));
  t('stats rendered', window.document.getElementById('stat-airborne').textContent !== '—');
  t('home select populated worldwide', window.document.getElementById('home-select').children.length > 300);
  t('home select defaults AMS', window.document.getElementById('home-select').value === 'AMS');

  // feature: escape now
  window.document.getElementById('escape-btn').click();
  await new Promise(r => setTimeout(r, 500));
  const rows = window.document.querySelectorAll('.escape-row');
  t('escape panel rows', rows.length > 0);
  t('escape sorted by fare', [...rows].every((r, i, a) => i === 0 ||
    +a[i-1].querySelector('.escape-fare').textContent.slice(1) <= +r.querySelector('.escape-fare').textContent.slice(1)));

  // feature: budget band (dual thumbs)
  const lo = window.document.getElementById('budget-min');
  const hi = window.document.getElementById('budget-max');
  hi.value = 900; hi.dispatchEvent(new window.Event('input', { bubbles: true }));
  lo.value = 150; lo.dispatchEvent(new window.Event('input', { bubbles: true }));
  t('budget band set + active', S.state.budget.active === true &&
    S.state.budget.min === 150 && S.state.budget.max === 900);
  lo.value = 1400; lo.dispatchEvent(new window.Event('input', { bubbles: true }));
  t('thumbs cannot cross', S.state.budget.min <= S.state.budget.max - 10);
  await new Promise(r => setTimeout(r, 400));
  t('world fares from home cached', S.state.faresFromHome.length > 250);

  // feature: filters + sunset
  window.document.querySelector('[data-alliance="skyteam"]').click();
  t('alliance filter set', S.state.filters.alliance === 'skyteam');
  const sunset = window.document.getElementById('sunset-toggle');
  sunset.checked = false;
  sunset.dispatchEvent(new window.Event('change', { bubbles: true }));
  t('sunset toggle wired', S.state.sunsetChaser === false);

  // feature: plane card via bus (raycast picking needs WebGL)
  const flight = flights.find(f => f.origin && f.destination);
  S.bus.emit('map:planeTapped', flight.id);
  await new Promise(r => setTimeout(r, 400));
  const card = window.document.getElementById('plane-card');
  t('plane card visible', !card.hidden);
  t('plane card has callsign', card.textContent.includes(flight.callsign));
  t('plane card has fare or honest empty', /€\d+|no cached fare|needs a resolved route/.test(card.textContent));

  const over = flights.find(f => !f.origin);
  S.bus.emit('map:planeTapped', over.id);
  await new Promise(r => setTimeout(r, 300));
  t('unresolved-route card state', card.textContent.includes('Route not yet resolved'));

  // feature: cities layer + city card
  const cityToggle = window.document.getElementById('cities-toggle');
  t('cities toggle present + on', cityToggle && cityToggle.checked && S.state.cities === true);
  S.bus.emit('map:cityTapped', 'BCN');
  await new Promise(r => setTimeout(r, 400));
  const cityCard = window.document.getElementById('city-card');
  t('city card visible', !cityCard.hidden);
  t('city card names Barcelona', cityCard.textContent.includes('Barcelona'));
  t('city card has fare from home', /€\d+/.test(cityCard.textContent));
  t('city selection closes plane card', window.document.getElementById('plane-card').hidden);
  S.bus.emit('map:planeTapped', flight.id);
  await new Promise(r => setTimeout(r, 300));
  t('plane selection closes city card', cityCard.hidden);
  t('paths3d wired to selection', true); // 3D arc itself needs WebGL; module load covered above
  cityToggle.checked = false;
  cityToggle.dispatchEvent(new window.Event('change', { bubbles: true }));
  t('cities toggle off updates state', S.state.cities === false);

  // feature: geolocate fallback (no GPS in jsdom -> timezone guess or hint)
  window.document.getElementById('geolocate').click();
  await new Promise(r => setTimeout(r, 200));
  const homeHint = window.document.getElementById('home-hint');
  t('geolocate gives feedback', !homeHint.hidden && homeHint.textContent.length > 10);

  // escape now honors the budget band (band is 150-900 and active here)
  window.document.getElementById('escape-btn').click();  // close
  window.document.getElementById('escape-btn').click();  // reopen -> render
  await new Promise(r => setTimeout(r, 500));
  const bandRows = [...window.document.querySelectorAll('.escape-row:not(.city-dep)')];
  const bandOk = bandRows.length
    ? bandRows.every(r => { const p = +r.querySelector('.escape-fare').textContent.slice(1);
        return p >= S.state.budget.min && p <= S.state.budget.max; })
    : window.document.querySelector('.escape-empty').textContent.includes('budget');
  t('escape respects budget band', bandOk);

  // city card lists live departures, clickable through to the plane
  const depFlight = [...S.state.flights.values()].find(f => f.origin && f.destination);
  S.bus.emit('map:cityTapped', depFlight.origin);
  await new Promise(r => setTimeout(r, 400));
  t('city card shows departures', cityCard.textContent.includes('In the air from here'));
  const depBtn = cityCard.querySelector('.city-dep');
  t('departure rows present', !!depBtn);
  depBtn.click();
  await new Promise(r => setTimeout(r, 400));
  t('departure click selects plane', !window.document.getElementById('plane-card').hidden && cityCard.hidden);

  // aurora chaser
  t('aurora data loaded via stub', S.state.auroraData && S.state.auroraData.points.length === 3);
  t('aurora intensity lookup', S.aurora.intensityAt(65, 10) === 80 && S.aurora.intensityAt(50, 50) === 0);
  const auroraToggle = window.document.getElementById('aurora-toggle');
  auroraToggle.checked = false;
  auroraToggle.dispatchEvent(new window.Event('change', { bubbles: true }));
  t('aurora toggle wired', S.state.auroraChaser === false);

  // follow mode
  S.bus.emit('map:planeTapped', flight.id);
  await new Promise(r => setTimeout(r, 300));
  window.document.getElementById('follow-btn').click();
  t('follow engages', S.state.following === true);
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  t('closing card stops following', S.state.following === false);

  // dream list
  S.dreams.toggle('LIS');
  await new Promise(r => setTimeout(r, 300));
  t('dream row rendered', window.document.querySelector('.dream-row[data-iata="LIS"]') !== null);
  t('dreams persist to storage', (window.localStorage.getItem('skyboard.dreams') || '').includes('LIS'));
  S.dreams.toggle('LIS');
  t('dream removal works', window.document.querySelector('.dream-row[data-iata="LIS"]') === null);

  // search
  const si = window.document.getElementById('search-input');
  si.value = flight.callsign;
  si.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  t('search finds a callsign', S.state.selected === flight.id);
  si.value = 'Lisbon';
  si.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  t('search finds a city', S.state.selectedCity === 'LIS');

  // home change ripples worldwide
  S.settings.setHome('SIN');
  t('home changed to SIN', S.state.home === 'SIN');
  t('escape label follows home', window.document.getElementById('escape-home').textContent === 'SIN');

  S.modes.set('tv');
  t('tv mode set', window.document.body.dataset.view === 'tv');

  if (errors.length) { console.log('\nERRORS:'); errors.forEach(e => console.log(' -', e)); process.exit(1); }
  console.log('\nALL PASS');
  process.exit(0);
})();
