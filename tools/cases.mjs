// Cases: one train, a short window of a recording, one rule that must hold. Each comes from something seen on the
// map (tools/recordings.json, "cases"), so a bug once fixed stays fixed. Only the case's own train is replayed
// (the simulation keeps each train apart; only "no data at all" is shared, and that is taken from every report),
// from 5 minutes before the window, so a case takes seconds.
// Run: node tools/cases.mjs [case-id ...] [--src <checkout>] [--trace] [--json]
//   --src  use the train code (src/) of another checkout, e.g. a git worktree at an older commit: a case must
//          fail on the code from before its fix.
// Rules (in drawing time, Swedish time in the list; "drawn standing" = drawn speed under 0.8 m/s):
//   noStopWhileMoving: N   never drawn standing N s or more while the real train moves over 15 km/h
//   maxKmh: X              never drawn faster than X km/h (a fast-forward after a stop shows as a burst)
//   standsAt: { sig, s }   drawn standing at least s seconds within 300 m of station sig
//   noSlideWhileStanding: M  the drawn train moves at most M metres in all while the real train stands (GPS wobble
//                          or a changed path must not slide it about)
//   noWrongBranch: true    never drawn onto another track than the real train took, before its next report
//                          (tools/lib/branch.mjs; the train code must call options.onWayChange)
// Exit code 1 when a case fails that isn't marked knownFailing.
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readPositions } from './lib/records.mjs';
import { branchCounter } from './lib/branch.mjs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const srcDir = argv.includes('--src') ? resolve(argv[argv.indexOf('--src') + 1]) : resolve('.');
const only = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--src');
const TRACE = argv.includes('--trace');   // print the case's train every 2 s: drawn and real speed, distance apart
const { createTrains, DELAY_MS } = await import(pathToFileURL(`${srcDir}/src/trains.js`));
const { netFromJSON } = await import(pathToFileURL(`${srcDir}/src/rail-net.js`));
const { createRoutes } = await import(pathToFileURL(`${srcDir}/src/routes.js`));

const LIST = JSON.parse(readFileSync('tools/recordings.json', 'utf8'));
const cases = LIST.cases.filter(c => !only.length || only.includes(c.id));
const STEP = 100;
const R = Math.PI / 180;
const metres = (a, b) => Math.hypot((b.lon - a.lon) * Math.cos((a.lat + b.lat) / 2 * R), b.lat - a.lat) * R * 6371000;

const net = netFromJSON(JSON.parse(readFileSync('public/rail-net.json', 'utf8')));
const stations = new Map(JSON.parse(readFileSync('data/stations.json', 'utf8')).map(st => {
  const m = /POINT \(([-\d.]+) ([-\d.]+)/.exec(st.Geometry?.WGS84 ?? '');
  return [st.LocationSignature, m ? { lon: Number(m[1]), lat: Number(m[2]) } : null];
}).filter(([, v]) => v));
const stopPlaces = existsSync('public/stop-places.json') ? JSON.parse(readFileSync('public/stop-places.json', 'utf8')).places : {};

// A recording, read as tools/motion-check.mjs does; kept while its cases run.
const loaded = new Map();
function load(name) {
  if (loaded.has(name)) return loaded.get(name);
  const file = `data/positions-${name}.jsonl`, ttFile = `data/timetable-${name}.jsonl`;
  if (!existsSync(file)) return null;
  const recs = readPositions(file);   // as the page reads them (tools/lib/records.mjs)
  const rows = existsSync(ttFile) ? readFileSync(ttFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  const out = { recs, rows };
  loaded.set(name, out);
  return out;
}

function run(c) {
  const rec = load(c.recording);
  if (!rec) return { ok: false, why: `recording ${c.recording} is not in data/` };
  const key = c.train, from = Date.parse(c.from), to = Date.parse(c.to);
  const mine = rec.recs.filter(r => r.id === key);
  if (!mine.length) return { ok: false, why: `no reports of ${key}` };
  // The page's planned route and passings, for this train only.
  const routes = createRoutes({ stations, net });
  routes.setStopPlaces?.(stopPlaces);   // as the page (src/main.js); older code (--src) has none
  const rows = rec.rows.filter(a => !a.Deleted && a.OperationalTrainNumber && a.AdvertisedTimeAtLocation &&
    `${a.OperationalTrainNumber}/${a.ScheduledDepartureDateTime.slice(0, 10)}` === key);
  routes.add(rows.map(a => ({ key, sig: a.LocationSignature, activity: a.ActivityType, planned: Date.parse(a.AdvertisedTimeAtLocation) })));
  const passings = rows.filter(a => a.TimeAtLocation).map(a => ({ got: Date.parse(a.got), p: { key, station: a.LocationSignature,
    time: Date.parse(a.TimeAtLocation), activity: a.ActivityType,
    minutes: Math.round((Date.parse(a.TimeAtLocation) - Date.parse(a.AdvertisedTimeAtLocation)) / 60000) } })).sort((x, y) => x.got - y.got);
  // The real way, for wrong branches: the train's whole recording, all of it kept.
  const oracle = createTrains({ net, keepMs: Infinity }), branches = branchCounter(oracle);
  if (c.rules.noWrongBranch) for (let i = 0; i < mine.length;) { const T = mine[i].got, batch = []; while (i < mine.length && mine[i].got <= T + 1000) batch.push(mine[i++]); oracle.update(batch, T + 1000); }
  const drawn = createTrains({ net, routes, onWayChange: branches.onWayChange }), truth = createTrains({ net, routes });   // the truth knows the routes too, on purpose (as in motion-check)
  const gots = rec.recs.map(r => r.got);   // every report's arrival: "no data at all" for 60 s halts every train
  const feed = (trains, upTo, i) => {
    const batch = [];
    while (i < mine.length && mine[i].got <= upTo) batch.push(mine[i++]);
    if (batch.length) trains.update(batch, upTo);
    return i;
  };
  let k = 0, kt = 0, kp = 0, ka = 0, lastArrival = -Infinity;
  const m = { standMovingMaxS: 0, maxKmh: 0, standsAtS: 0, slideM: 0, firstSlide: null };
  let standRun = 0, prevP = null;
  const place = c.rules.standsAt ? stations.get(c.rules.standsAt.sig) : null;
  if (c.rules.standsAt && !place) return { ok: false, why: `no station ${c.rules.standsAt.sig}` };
  for (let T = from - 5 * 60000 + DELAY_MS; T <= to + DELAY_MS; T += STEP) {
    k = feed(drawn, T, k);
    while (ka < gots.length && gots[ka] <= T) lastArrival = gots[ka++];
    drawn.setHalted(T - lastArrival > 60000);
    const now = [];
    while (kp < passings.length && passings[kp].got <= T) now.push(passings[kp++].p);
    if (now.length) { routes.addPassings(now); drawn.addPassings(now); }
    kt = feed(truth, T + 120000, kt);
    const t = T - DELAY_MS;
    if (T % 1000 < STEP) drawn.prune(T);
    const d = drawn.placedAt(t).find(x => x.id === key);
    const sim = drawn.simOf(key), tru = truth.reportedAt(key, t - (d?.extra ?? 0));   // at the moment it is drawn for
    if (t < from || !d || !sim) continue;
    if (TRACE && T % 2000 < STEP) console.log(`  ${new Date(t).toLocaleTimeString('sv-SE', { timeZone: 'Europe/Stockholm' })} drawn ${(sim.v * 3.6).toFixed(0)} km/h ` +
      `(${sim.target}${sim.syncing ? ', fast-forward' : ''}) at ${d.lat.toFixed(5)},${d.lon.toFixed(5)}; real ${tru ? `${tru.kmh.toFixed(0)} km/h, ${metres(d, tru).toFixed(0)} m away` : '-'}`);
    const dt = STEP / 1000;
    const standing = sim.v < 0.8;
    m.maxKmh = Math.max(m.maxKmh, sim.v * 3.6);
    standRun = standing && tru && tru.kmh > 15 ? standRun + dt : 0;
    m.standMovingMaxS = Math.max(m.standMovingMaxS, standRun);
    if (place && standing && metres(d, place) < 300) m.standsAtS += dt;
    if (prevP && tru && tru.kmh < 1) {
      const moved = metres(prevP, d);
      if (moved > 0.01) { m.slideM += moved; m.firstSlide ??= new Date(t).toLocaleTimeString('sv-SE', { timeZone: 'Europe/Stockholm' }); }
    }
    prevP = d;
  }
  const r = c.rules, bad = [];
  if (r.noStopWhileMoving !== undefined && m.standMovingMaxS >= r.noStopWhileMoving) bad.push(`drawn standing ${m.standMovingMaxS.toFixed(1)} s while the real train moved (limit ${r.noStopWhileMoving} s)`);
  if (r.maxKmh !== undefined && m.maxKmh > r.maxKmh) bad.push(`drawn at ${Math.round(m.maxKmh)} km/h (limit ${r.maxKmh})`);
  if (r.standsAt && m.standsAtS < r.standsAt.s) bad.push(`drawn standing ${m.standsAtS.toFixed(0)} s at ${r.standsAt.sig} (needs ${r.standsAt.s} s)`);
  const wrongs = branches.events.filter(e => e.time >= from - DELAY_MS && e.time <= to);
  if (r.noWrongBranch && wrongs.length) bad.push(`drawn onto a wrong branch: ${wrongs.map(e => `${new Date(e.time).toLocaleTimeString('sv-SE', { timeZone: 'Europe/Stockholm' })} slid ${e.slide} m`).join(', ')}`);
  if (r.noSlideWhileStanding !== undefined && m.slideM > r.noSlideWhileStanding) bad.push(`drawn moved ${m.slideM.toFixed(0)} m while the real train stood (from ${m.firstSlide}; limit ${r.noSlideWhileStanding} m)`);
  const said = [
    r.noStopWhileMoving !== undefined && `standing while moving at most ${m.standMovingMaxS.toFixed(1)} s`,
    r.maxKmh !== undefined && `top ${Math.round(m.maxKmh)} km/h`,
    r.standsAt && `stood ${m.standsAtS.toFixed(0)} s at ${r.standsAt.sig}`,
    r.noSlideWhileStanding !== undefined && `moved ${m.slideM.toFixed(0)} m while the real train stood`,
    r.noWrongBranch && 'no wrong branch',
  ].filter(Boolean).join(', ');
  return { ok: !bad.length, why: bad.join('; '), said };
}

let failed = 0;
const t0 = Date.now();
const results = [];
for (const c of cases) {
  const res = run(c);
  results.push({ id: c.id, ...res, knownFailing: Boolean(c.knownFailing) });
  const tag = res.ok ? 'ok  ' : c.knownFailing ? 'known' : 'FAIL';
  if (!res.ok && !c.knownFailing) failed++;
  if (!argv.includes('--json')) console.log(`${tag} case ${c.id} (${c.train}, ${c.from.slice(11, 16)}–${c.to.slice(11, 16)}): ${res.ok ? res.said : res.why}`);
}
if (argv.includes('--json')) console.log(JSON.stringify(results));
else console.log(failed ? `${failed} of ${cases.length} cases failed` : `all ${cases.length} cases hold (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
process.exit(failed ? 1 : 0);
