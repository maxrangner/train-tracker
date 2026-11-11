import { startTrainSource } from './trains-source.js';
import { createTrains } from './trains.js';
import { createMap } from './map.js';

const map = createMap('map');
const trains = createTrains();
const statusEl = document.getElementById('status');

let mode = 'starting';
let error = null;

startTrainSource({
  onRecords(records) {
    if (trains.update(records)) map.setTrains(trains.toGeoJSON());
  },
  onStatus(s) {
    mode = s.mode;
    error = s.error ?? null;
    if (error) console.warn('train source:', error);
  },
});

const MODE_TEXT = { starting: 'connecting', stream: 'live', reconnecting: 'reconnecting', polling: 'every 10 s', stopped: 'stopped' };

setInterval(() => {
  if (trains.prune()) map.setTrains(trains.toGeoJSON());
  const ago = trains.lastReport ? Math.max(0, Math.round((Date.now() - trains.lastReport) / 1000)) : null;
  statusEl.textContent =
    `${trains.count} trains · ` +
    (ago === null ? 'no report yet' : `last report ${ago} s ago`) +
    ` · ${MODE_TEXT[mode] ?? mode}` +
    (error ? ` · ${error}` : '');
  statusEl.classList.toggle('problem', Boolean(error));
}, 1000);
