// A replay: plays a recording from tools/collect.mjs (data/positions-<name>.jsonl, and data/timetable-<name>.jsonl and
// data/routes-<name>.jsonl when there are) instead of the live data, at normal speed. Each report comes in when it arrived during the
// recording; the page's clock (src/clock.js) runs from the recording's start. Opened with #replay=<name> in the
// address; the dev server serves data/ (it is not part of a build).
import { toRecord } from './trains-source.js';
import { trainKey, useSavedRoutes } from './trafikverket.js';
import { now, setClock, hhmmss } from './clock.js';

const SKIP_MS = 60 * 1000;   // start a minute in, so the first batch (the last 10 minutes) has been taken in

// onRecords(records), onStatus({ mode, error }) as startTrainSource; onPlanned(rows) and onPassings(list) get the
// timetable's planned rows (src/routes.js) and actual passings (src/lateness.js), when the recording has them.
export async function startReplaySource(name, { onRecords, onStatus, onPlanned, onPassings }) {
  const get = async (kind) => {
    const res = await fetch(`/data/${kind}-${name}.jsonl`);
    if (!res.ok) return null;
    return (await res.text()).split('\n').filter(Boolean).map(l => JSON.parse(l));
  };
  let positions;
  try {
    positions = await get('positions');
  } catch (e) {
    onStatus({ mode: 'stopped', error: `replay: ${e.message}` });
    return;
  }
  if (!positions?.length) { onStatus({ mode: 'stopped', error: `replay: no recording data/positions-${name}.jsonl` }); return; }
  const timetable = await get('timetable').catch(() => null) ?? [];
  // The trains' whole routes, when saved with the recording (data/routes-<name>.jsonl, tools/save-routes.mjs): the
  // card reads them instead of asking Trafikverket, which keeps a day's routes only about 4 days (2026-11-17: 13 Nov
  // still there, 12 Nov gone; every card in a replay of 12 Nov said "no stops"). As at the replay's clock: the file is
  // saved after the recording, so an actual time still ahead of the clock is left out (the card shows the stops ahead).
  const saved = await get('routes').catch(() => null);
  if (saved?.length) {
    const index = new Map();
    for (const a of saved) for (const f of ['AdvertisedTrainIdent', 'OperationalTrainNumber']) {
      if (a[f] === undefined || !a.ScheduledDepartureDateTime) continue;
      const k = `${f}|${a[f]}|${a.ScheduledDepartureDateTime.slice(0, 10)}`;
      (index.get(k) ?? index.set(k, []).get(k)).push(a);
    }
    useSavedRoutes(async (field, value, day) => {
      const rows = index.get(`${field}|${value}|${day}`);
      if (!rows) return null;   // not saved (a train from the day before): Trafikverket is asked, as before
      const t = now();
      return { TrainAnnouncement: rows.map(a => {
        if (!a.TimeAtLocation || Date.parse(a.TimeAtLocation) <= t) return a;
        const { TimeAtLocation, ...ahead } = a;
        return ahead;
      }) };
    });
  }

  const events = [];
  for (const p of positions) {
    const r = toRecord(p);
    if (r) events.push({ got: Date.parse(p.got), r });
  }
  const passings = [];
  for (const a of timetable) {
    if (a.Deleted || !a.OperationalTrainNumber || !a.AdvertisedTimeAtLocation) continue;
    const key = trainKey(a.OperationalTrainNumber, a.ScheduledDepartureDateTime);
    if (a.TimeAtLocation) passings.push({ got: Date.parse(a.got), p: {
      key, station: a.LocationSignature, time: Date.parse(a.TimeAtLocation),
      minutes: Math.round((Date.parse(a.TimeAtLocation) - Date.parse(a.AdvertisedTimeAtLocation)) / 60000),
      brand: a.ProductInformation?.[0]?.Description ?? null, activity: a.ActivityType ?? null } });
  }
  // The planned routes are all given at once: the page would have asked for them ahead of time.
  onPlanned?.(timetable.filter(a => !a.Deleted && a.OperationalTrainNumber && a.AdvertisedTimeAtLocation).map(a => ({
    key: trainKey(a.OperationalTrainNumber, a.ScheduledDepartureDateTime), sig: a.LocationSignature,
    activity: a.ActivityType, planned: Date.parse(a.AdvertisedTimeAtLocation) })));
  events.sort((a, b) => a.got - b.got);
  passings.sort((a, b) => a.got - b.got);

  const first = events[0].got, last = events[events.length - 1].got;
  setClock(first + SKIP_MS);
  let i = 0, j = 0;
  onStatus({ mode: 'replay' });
  const timer = setInterval(() => {
    const t = now();
    const batch = [];
    while (i < events.length && events[i].got <= t) batch.push(events[i++].r);
    if (batch.length) onRecords(batch);
    const late = [];
    while (j < passings.length && passings[j].got <= t) late.push(passings[j++].p);
    if (late.length) onPassings?.(late);
    if (i >= events.length) {
      clearInterval(timer);
      onStatus({ mode: 'stopped', error: `the replay ended (${hhmmss(last)})` });
    }
  }, 250);
}
