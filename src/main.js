import { startTrainSource } from './trains-source.js';
import { createTrains, DELAY_MS } from './trains.js';
import { createLateness, label, lateClass } from './lateness.js';
import { createMap, RAIL_SOURCES } from './map.js';
import { createPanel } from './panel.js';
import { followPassings, fetchStationNames, hasKey } from './trafikverket.js';

window.__started = true;   // index.html reports it on screen if this line is never reached
const trains = createTrains();
const lateness = createLateness();
let stationNames = new Map();
const stationName = sig => stationNames.get(sig) ?? sig;

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

startTrainSource({
  onRecords(records) { trains.update(records); },
  onStatus(s) {
    status.positions = s.mode;
    status.error = s.error ?? null;
    if (s.error) console.warn('positions:', s.error);
  },
});

if (hasKey) {
  followPassings({
    onPassings(list) { lateness.update(list); },
    onStatus(s) {
      status.passings = s.mode;
      if (s.error) { status.error = s.error; console.warn('timetable:', s.error); }
    },
  });
  fetchStationNames().then(m => { stationNames = m; }).catch(e => console.warn('station names:', e.message));
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
