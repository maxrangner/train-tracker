// The open train's route searched off the page's own thread (2026-11-21, TODO 13's list; the worker: src/path-worker.js).
// searchPath(places, options) -> Promise of the same path src/path.js pathOf gives. Where no worker can run (or it
// failed), the search runs here as before, so the answer is the same either way.
// The worker loads its own copy of the rail network: about 9 MB more memory (its heap with a long route searched; the
// page's own is about 108 MB), measured 2026-11-21. A long route (Stockholm C - Malmö C, 92 places) held the page's
// thread 200-300 ms on the PC and 1.0-1.9 s with the processor 4 times slower; through the worker the longest frame
// gap meanwhile was 10-30 ms, and the route showed sooner (searched during the camera's glide).
import { pathOf } from './path.js';

// netUrl: the network file (as the page's own loadNet); net(): the page's network, for the search here when needed.
export function createPathSearch(netUrl, net) {
  let worker = null, nextId = 1, sentReversals = null;
  const waiting = new Map();   // id -> { resolve, reject }
  const giveUp = (why) => {
    worker?.terminate();
    worker = null;
    for (const w of waiting.values()) w.reject(new Error(why));
    waiting.clear();
  };
  try {
    worker = new Worker(new URL('./path-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'failed') { console.warn('route worker: rail network:', data.error); giveUp('no rail network in the route worker'); return; }
      const w = waiting.get(data.id);
      if (!w) return;
      waiting.delete(data.id);
      if (data.error) w.reject(new Error(data.error)); else w.resolve(data.path);
    };
    worker.onerror = (e) => { console.warn('route worker:', e.message ?? 'failed'); giveUp('route worker failed'); };
    worker.postMessage({ type: 'net', url: new URL(netUrl, location.href).href });
  } catch (e) { console.warn('route worker:', e.message); worker = null; }

  const here = (places, options) => pathOf(places, net(), options);
  const search = (places, { reversals = null, ...options } = {}) => {
    if (!worker) return Promise.resolve(here(places, { ...options, reversals }));
    if (reversals && reversals !== sentReversals) {
      sentReversals = reversals;
      worker.postMessage({ type: 'reversals', list: reversals.map(s => ({ lon: s.lon, lat: s.lat })) });
    }
    const id = nextId++;
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      // Only what pathOf reads of each place (a place's mark is its whole station).
      const sent = places.map(p => ({ lon: p.lon, lat: p.lat, stop: p.stop, ...(p.mark ? { mark: { lon: p.mark.lon, lat: p.mark.lat } } : {}),
        ...(p.snap ? { snap: p.snap } : {}) }));
      worker.postMessage({ id, places: sent, options: { ...options, reversals: Boolean(reversals) } });
    }).catch((e) => {
      console.warn('route worker:', e.message, '(searched on the page instead)');
      return here(places, { ...options, reversals });
    });
  };
  // Whether searches run off the page's thread (else here, at once, as before).
  search.offThread = () => Boolean(worker);
  return search;
}
