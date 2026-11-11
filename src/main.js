import { startTrainSource } from './trains-source.js';
import { createTrains, DELAY_MS } from './trains.js';
import { createLateness, label, lateClass } from './lateness.js';
import { createMap, RAIL_SOURCES } from './map.js';
import { createPanel } from './panel.js';
import { followPassings, fetchStations, fetchPlannedRoutes, hasKey } from './trafikverket.js';
import { loadNet } from './rail-net.js';
import { createRoutes } from './routes.js';

window.__started = true;   // index.html reports it on screen if this line is never reached
// The rail network: the tracks the trains follow, and Trafikverket's rail lines on the map. Positions start once it
// has loaded (or failed: then trains move in straight lines between reports).
const netReady = loadNet('/rail-net.json').catch((e) => {
  console.warn(`rail network: ${e.message} (run node tools/rail-net.mjs)`);
  return null;
});
const trains = createTrains();
if (import.meta.env.DEV) window.__trains = trains;   // for the tools in tools/; not in a build
// Each train's planned route (timetable): at junctions a coasting train takes the way to its next planned stop,
// and it waits before that stop rather than arriving in the drawing.
const routes = createRoutes();
trains.useRoutes(routes);
netReady.then(net => { if (net) routes.setNet(net); });
const lateness = createLateness();
let stations = new Map();   // signature -> { name, lon, lat }
const stationName = sig => stations.get(sig)?.name ?? sig;

const minutesOf = r => lateness.get(r.id)?.minutes;
const labelFor = r => label(r.number, minutesOf(r));
// While a train fast-forwards to catch up with its data, its label gets »» (the map's font has no ⏩).
const propsFor = (r, sim) => ({ label: labelFor(r) + (sim?.syncing ? ' »»' : ''), late: lateClass(minutesOf(r)) });

const placeNow = id => trains.placeOf(id, Date.now() - DELAY_MS);
const follow = id => map.follow(() => placeNow(id), () => panel.setFollowing(false));
const panel = createPanel(document.getElementById('panel'), {
  stationName,
  onSelect(id) {
    map.select(id);
    if (!id) { map.unfollow(); map.unpad(); }
  },
  onFollow(id, on) {
    if (on) follow(id); else map.unfollow();
  },
});
const map = createMap('map', {
  railData: { trv: () => netReady.then(net => { if (!net) throw new Error('no rail network'); return net.toGeoJSON(); }) },
  getTrains3d: () => trains.placedAt(Date.now() - DELAY_MS).map(t => ({ ...t, brand: lateness.brand(t.id) })),
  // Tapping a train opens its panel and the camera follows it; tapping the map elsewhere closes it.
  onTrainTap(id) {
    const r = id && trains.get(id);
    if (r) {
      panel.open({ id: r.id, operational: r.operational, date: r.date, label: labelFor(r) });
      follow(id);
    } else {
      panel.close();
    }
  },
});

// ---- Drawing: every frame (at most 30 a second), each train's simulation brought to DELAY_MS ago ----
let lastDraw = 0;
function frame(ts) {
  if (ts - lastDraw >= 33) {
    lastDraw = ts;
    map.setTrains(trains.toGeoJSON(Date.now() - DELAY_MS, propsFor));
    map.tick(ts);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- Rail line switch (step 2): Trafikverket / OpenStreetMap / none ----
const railEl = document.getElementById('rail');
const RAIL_CHOICES = [...Object.entries(RAIL_SOURCES).map(([id, s]) => [id, s.name]), [null, 'No lines']];
function chooseRail(id) {
  map.showRail(id);
  for (const b of railEl.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.id === String(id)));
  try { localStorage.setItem('rail', String(id)); } catch { /* storage may be blocked */ }
}
for (const [id, name] of RAIL_CHOICES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.id = String(id);
  b.textContent = name;
  b.onclick = () => chooseRail(id);
  railEl.append(b);
}
let savedRail = 'trv';
try { savedRail = localStorage.getItem('rail') ?? 'trv'; } catch { /* default */ }
chooseRail(savedRail === 'null' ? null : savedRail in RAIL_SOURCES ? savedRail : 'trv');

// ---- Tilt button ----
const tiltEl = document.getElementById('tilt');
const showTilt = () => tiltEl.setAttribute('aria-pressed', String(map.tilted));
tiltEl.onclick = () => map.toggleTilt();
map.onViewChange(showTilt);
map.ready.then(showTilt);

// ---- Live data ----
const status = { positions: 'starting', passings: 'starting', error: null };

netReady.then(net => { if (net) trains.useNet(net); }).finally(() => startTrainSource({
  onRecords(records) { trains.update(records); },
  onStatus(s) {
    status.positions = s.mode;
    status.error = s.error ?? null;
    if (s.error) console.warn('positions:', s.error);
  },
}));

if (hasKey) {
  followPassings({
    onPassings(list) { lateness.update(list); },
    onStatus(s) {
      status.passings = s.mode;
      if (s.error) { status.error = s.error; console.warn('timetable:', s.error); }
    },
  });
  fetchStations().then((m) => {
    stations = m;
    routes.setStations(new Map([...m].filter(([, st]) => st.lon !== null)));
  }).catch(e => console.warn('stations:', e.message));

  // Planned routes: asked for trains on the map whose known route ends within 30 minutes (or isn't known), at most
  // every 5 minutes per train; each answer covers 30 minutes back to 90 minutes ahead.
  const asked = new Map();   // train key -> when its route was last asked for
  async function askRoutes() {
    const now = Date.now();
    const want = trains.reports().filter(r => routes.until(r.id) < now + 30 * 60000 && !(now - (asked.get(r.id) ?? 0) < 5 * 60000));
    if (!want.length) return;
    for (const r of want) asked.set(r.id, now);
    try {
      routes.add(await fetchPlannedRoutes([...new Set(want.map(r => r.operational))], now - 30 * 60000, now + 90 * 60000));
    } catch (e) {
      console.warn('planned routes:', e.message);
      for (const r of want) asked.delete(r.id);
    }
  }
  setTimeout(askRoutes, 5000);
  setInterval(askRoutes, 30000);
}

const MODE_TEXT = { starting: 'connecting', stream: 'live', reconnecting: 'reconnecting', polling: 'every 10 s', stopped: 'stopped' };
const statusEl = document.getElementById('status');

setInterval(() => {
  trains.prune();
  const ago = trains.lastReport ? Math.max(0, Math.round((Date.now() - trains.lastReport) / 1000)) : null;
  statusEl.textContent =
    `${trains.count} trains · ` +
    (ago === null ? 'no report yet' : `last report ${ago} s ago`) +
    ` · ${MODE_TEXT[status.positions] ?? status.positions}` +
    (status.error ? ` · ${status.error}` : '');
  statusEl.classList.toggle('problem', Boolean(status.error));
}, 1000);
