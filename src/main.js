import { startTrainSource } from './trains-source.js';
import { createTrains, DELAY_MS } from './trains.js';
import { createLateness, label, lateClass } from './lateness.js';
import { createMap, RAIL_SOURCES } from './map.js';
import { createPanel } from './panel.js';
import { followPassings, fetchStations, fetchPlannedRoutes, hasKey } from './trafikverket.js';
import { loadNet } from './rail-net.js';
import { createRoutes } from './routes.js';
import { now } from './clock.js';
import { startReplaySource } from './replay-source.js';

// #replay=<name> in the address plays a recording (data/positions-<name>.jsonl, from tools/collect.mjs) instead of
// the live data, e.g. #view=11/59.33/18.06&replay=2026-11-11T16-46-20-921Z. The page's clock then runs from the
// recording's start (src/clock.js).
const replay = new URLSearchParams(location.hash.slice(1)).get('replay');

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
// While a train fast-forwards to catch up with its data, its label gets »» (the map's font has no ⏩). A stale train
// (silent for 2 minutes, or no data at all) is drawn grey and faded.
const propsFor = (r, sim) => ({
  label: labelFor(r) + (sim?.syncing && !sim.stale ? ' »»' : ''), late: lateClass(minutesOf(r)), stale: Boolean(sim?.stale),
});

const placeNow = id => trains.placeOf(id, now() - DELAY_MS);
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
  getTrains3d: () => trains.placedAt(now() - DELAY_MS).map(t => ({ ...t, brand: lateness.brand(t.id) })),
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
    map.setTrains(trains.toGeoJSON(now() - DELAY_MS, propsFor));
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
// When position data last arrived (this computer's clock). After NO_DATA_MS with nothing, every train brakes to a
// stop and turns grey, and the status line says since when; when data returns they fast-forward to their places.
const NO_DATA_MS = 60 * 1000;
let lastDataAt = null;

const positionHandlers = {
  onRecords(records) {
    lastDataAt = now();
    if (trains.halted) trains.setHalted(false);
    trains.update(records, now());
  },
  onStatus(s) {
    status.positions = s.mode;
    status.error = s.error ?? null;
    if (s.error) console.warn('positions:', s.error);
  },
};
netReady.then(net => { if (net) trains.useNet(net); }).finally(() => {
  if (!replay) return startTrainSource(positionHandlers);
  // A replay brings its own timetable (planned routes and passings), when the recording has one.
  startReplaySource(replay, { ...positionHandlers, onPlanned: rows => routes.add(rows), onPassings: list => lateness.update(list) });
});

if (hasKey && replay) {
  fetchStations().then((m) => {
    stations = m;
    routes.setStations(new Map([...m].filter(([, st]) => st.lon !== null)));
  }).catch(e => console.warn('stations:', e.message));
}
if (hasKey && !replay) {
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
    const t = now();
    const want = trains.reports().filter(r => routes.until(r.id) < t + 30 * 60000 && !(t - (asked.get(r.id) ?? 0) < 5 * 60000));
    if (!want.length) return;
    for (const r of want) asked.set(r.id, t);
    try {
      routes.add(await fetchPlannedRoutes([...new Set(want.map(r => r.operational))], t - 30 * 60000, t + 90 * 60000));
    } catch (e) {
      console.warn('planned routes:', e.message);
      for (const r of want) asked.delete(r.id);
    }
  }
  setTimeout(askRoutes, 5000);
  setInterval(askRoutes, 30000);
}

const MODE_TEXT = { starting: 'connecting', stream: 'live', reconnecting: 'reconnecting', polling: 'every 10 s', stopped: 'stopped',
  replay: 'replay' };
const statusEl = document.getElementById('status');

const clock = t => new Date(t).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });

setInterval(() => {
  const t = now();
  const noData = lastDataAt !== null && t - lastDataAt > NO_DATA_MS;
  if (noData && !trains.halted) trains.setHalted(true);
  trains.prune(t);
  const ago = trains.lastReport ? Math.max(0, Math.round((t - trains.lastReport) / 1000)) : null;
  statusEl.textContent =
    `${trains.count} trains · ` +
    (noData ? `no data since ${clock(lastDataAt)}` : ago === null ? 'no report yet' : `last report ${ago} s ago`) +
    ` · ${MODE_TEXT[status.positions] ?? status.positions}` +
    (replay ? ` of ${new Date(t).toLocaleTimeString('sv-SE')}` : '') +
    (status.error ? ` · ${status.error}` : '');
  statusEl.classList.toggle('problem', Boolean(status.error) || noData);

  // The open train's panel: say when it is silent, or catching up.
  if (panel.openId) {
    const st = trains.stateOf(panel.openId, t - DELAY_MS);
    panel.setStatus(!st ? 'No longer on the map (no report for 10 minutes).'
      : noData ? `No data from Trafikverket since ${clock(lastDataAt)}.`
        : st.stale ? `No report from this train for ${Math.floor(st.silentFor / 60)} min; shown where it was last seen.`
          : st.syncing ? 'Catching up with its latest report (fast-forward).' : '');
  }
}, 1000);
