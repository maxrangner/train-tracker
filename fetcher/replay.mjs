// --replay <recording>: the fetcher plays a recording (data/positions-<name>.jsonl and data/timetable-<name>.jsonl,
// from tools/collect.mjs) instead of following Trafikverket's two streams, at normal speed, with every time moved to
// now (as if it were happening today), so the page reading the files can be checked the same way every time, without
// Trafikverket and without the key (public-plan step 3). The planned routes are given at once from the recording's
// timetable (the page's own replay does the same, src/replay-source.js).
import { readFileSync, existsSync } from 'node:fs';
import { toRecord } from '../src/trains-source.js';
import { passingsOf, trainKey } from '../src/trafikverket.js';

const lines = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

// onRecords(records), onPassings(list, { first }), onPlanned(rows), onStatus({ mode, error }). Returns stop().
export function startReplay(name, { onRecords, onPassings, onPlanned, onStatus }) {
  const pos = lines(`data/positions-${name}.jsonl`), tt = lines(`data/timetable-${name}.jsonl`);
  if (!pos.length) throw new Error(`no recording data/positions-${name}.jsonl`);
  const events = [...pos.map(x => ['p', Date.parse(x.got), x]), ...tt.map(x => ['t', Date.parse(x.got), x])].sort((a, b) => a[1] - b[1]);
  const shift = Date.now() - events[0][1];   // recording time + shift = now
  onPlanned(tt.filter(a => !a.Deleted && a.OperationalTrainNumber && a.AdvertisedTimeAtLocation).map(a => ({
    key: trainKey(a.OperationalTrainNumber, a.ScheduledDepartureDateTime), sig: a.LocationSignature, activity: a.ActivityType,
    planned: Date.parse(a.AdvertisedTimeAtLocation) + shift, brand: a.ProductInformation?.[0]?.Description ?? null })));
  onStatus({ mode: 'stream' });
  let i = 0;
  const timer = setInterval(() => {
    const upTo = Date.now() - shift, records = [];
    while (i < events.length && events[i][1] <= upTo) {
      const [kind, , x] = events[i++];
      if (kind === 'p') {
        const r = toRecord(x);
        if (r) records.push({ ...r, time: r.time + shift });
      } else {
        const list = passingsOf([x]).map(p => ({ ...p, time: p.time + shift }));
        if (list.length) onPassings(list, { first: x.via === 'start' });
      }
    }
    if (records.length) onRecords(records);
    if (i >= events.length) { clearInterval(timer); onStatus({ mode: 'stopped', error: 'the replay ended' }); }
  }, 250);
  return () => clearInterval(timer);
}
