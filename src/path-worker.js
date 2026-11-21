// The route search on a thread of its own (2026-11-21, TODO 13's list): the open train's whole route (src/path.js
// pathOf over the rail network, src/rail-net.js) held up the page's own thread, and with it the map: 200-300 ms on the
// PC for a long trip (Stockholm C - Malmö C), 1.0-1.9 s with the processor 4 times slower. This worker keeps its own
// copy of the network (loaded here from the same file as the page's) and answers one search at a time. Started and
// asked by src/path-async.js.
// In: { type: 'net', url } once; { type: 'reversals', list: [{ lon, lat }] } when the stations change; { id, places,
// options } a search (options as pathOf's; reversals: true means the list sent before).
// Out: { id, path } (pathOf's result: plain lists) or { id, error }; { type: 'failed', error } when the network can't
// be loaded (the page then searches by itself).
import { loadNet } from './rail-net.js';
import { pathOf } from './path.js';

let ready = null, reversals = null;
self.onmessage = async ({ data }) => {
  if (data.type === 'net') {
    ready = loadNet(data.url);
    ready.catch(e => self.postMessage({ type: 'failed', error: String(e?.message ?? e) }));
    return;
  }
  if (data.type === 'reversals') { reversals = data.list; return; }
  const { id, places, options } = data;
  try {
    if (!ready) throw new Error('no network asked for');
    const net = await ready;
    self.postMessage({ id, path: pathOf(places, net, { ...options, reversals: options.reversals ? reversals : null }) });
  } catch (e) { self.postMessage({ id, error: String(e?.message ?? e) }); }
};
