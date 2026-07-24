// Curated world airports, coordinates from OpenFlights (via airport-codes npm pkg).
const fs = require('fs');
const all = require('./node_modules/airport-codes/airports.json');
const WANT = `
AMS LHR LGW STN LTN LCY MAN EDI GLA BHX BRS NCL LBA DUB ORK BFS
CDG ORY LYS MRS NCE TLS BOD NTE LIL FRA MUC BER HAM DUS CGN STR HAJ NUE
ZRH GVA BSL VIE SZG INN BRU CRL LUX MAD BCN PMI IBZ AGP ALC VLC SVQ BIO
LIS OPO FAO FNC FCO MXP LIN BGY VCE NAP PSA FLR BLQ TRN CTA PMO CAG OLB
ATH SKG HER RHO JTR JMK CFU IST SAW ADB AYT ESB CPH BLL OSL BGO TRD SVG ARN
GOT HEL KEF RIX TLL VNO WAW KRK GDN WRO PRG BUD OTP CLJ SOF BEG ZAG SPU
DBV LJU SKP TIA MLA LCA PFO TFS LPA ACE FUE
ATL ORD DFW DEN LAX SFO SEA JFK EWR LGA BOS IAD DCA MIA MCO TPA FLL CLT
PHL PHX LAS IAH AUS SAT MSP DTW SLC SAN PDX MDW BWI HNL ANC
YYZ YVR YUL YYC YEG YOW YHZ MEX CUN GDL MTY SJD PVR
PTY SJO GUA SAL BOG MDE CTG LIM UIO GYE SCL EZE AEP GRU GIG BSB CNF SSA
REC FOR POA CWB MVD ASU VVI LPB CCS AUA CUR SXM PUJ SDQ HAV MBJ NAS BGI POS
DXB SHJ AUH DOH RUH JED DMM KWI BAH MCT AMM BEY TLV
CAI HRG SSH CMN RAK AGA TUN ALG DKR ABJ ACC LOS ABV DLA NSI FIH LAD ADD
NBO MBA DAR JRO EBB KGL LUN HRE GBE WDH JNB CPT DUR TNR MRU SEZ RUN
DEL BOM BLR MAA HYD CCU COK GOI ISB KHI LHE DAC CMB MLE KTM
PEK PVG SHA CAN SZX CTU CKG XIY KMG HGH WUH HKG MFM TPE KHH
NRT HND KIX ITM NGO CTS FUK OKA ICN GMP PUS
SIN KUL PEN BKK DMK HKT CNX SGN HAN DAD PNH REP RGN VTE BWN
MNL CEB DPS CGK SUB JOG BKI KCH
TAS ALA TSE GYD TBS EVN FRU
SVO DME LED OVB
SYD MEL BNE PER ADL CBR OOL CNS DRW HBA AKL WLG CHC ZQN NAN PPT NOU GUM
`.trim().split(/\s+/);
// Airports too new for the bundled OpenFlights snapshot:
const EXTRA = {
  PKX: ["ZBAD", "Beijing Daxing Intl", "Beijing", "China", 39.5098, 116.4105, "Asia/Shanghai"],
};
const byIata = new Map(all.map(a => [a.iata, a]));
const rows = [];
const missing = [];
for (const code of WANT) {
  const a = byIata.get(code);
  if (!a) { missing.push(code); continue; }
  rows.push([a.iata, a.icao, a.name, a.city, a.country, +(+a.latitude).toFixed(4), +(+a.longitude).toFixed(4), a.tz]);
}
for (const [iata, rest] of Object.entries(EXTRA)) rows.push([iata, ...rest]);
const out = `// Skyboard bundled data: curated world airports (majors + leisure destinations)
// Source: OpenFlights airports.dat (ODbL); selection hand-curated for Skyboard v1
// Schema: [iata, icao, name, city, country, lat, lon, tz] — iata is the stable
// public identifier used across all Skyboard modules and future endpoints.
// Generated: ${new Date().toISOString().slice(0,10)} by tools/gen_airports.js
window.Skyboard = window.Skyboard || {};
Skyboard.data = Skyboard.data || {};
Skyboard.data.airportRows = ${JSON.stringify(rows)};
`;
fs.writeFileSync('/sessions/dazzling-trusting-rubin/mnt/outputs/skyboard/js/data/airports.js', out);
console.log('airports:', rows.length, 'bytes:', out.length, 'missing:', missing.join(' ') || 'none');
