// A recording played through the fetcher's memory for the day's history (tools/history-size.mjs, history-files.mjs,
// history-check.mjs; build plan part 4, 2026-11-22): its rows in arrival order and each fed to fetcher/state.mjs as
// fetcher/main.mjs feeds the live streams (positions; passings with their lateness and company; planned rows with
// the company), at the recording's own times (or moved by `shift` ms), with no timers.
import { readFileSync, existsSync } from 'node:fs';
import { toRecord } from '../../src/trains-source.js';
import { passingsOf, trainKey } from '../../src/trafikverket.js';
import { historySlot, HISTORY_MS } from '../../src/live-file.js';

const lines = f => existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];

// [[kind 'p' | 't', got (ms), row]], sorted by arrival; [] when the recording is not in data/.
export function eventsOf(name) {
  const pos = lines(`data/positions-${name}.jsonl`), tt = lines(`data/timetable-${name}.jsonl`);
  return [...pos.map(p => ['p', Date.parse(p.got), p]), ...tt.map(a => ['t', Date.parse(a.got), a])].sort((a, b) => a[1] - b[1]);
}

// One event into a state; returns the position record (moved), or null.
export function feed(state, [kind, got, x], shift = 0) {
  if (kind === 'p') {
    const r = toRecord(x);
    if (!r) return null;
    const m = shift ? { ...r, time: r.time + shift } : r;
    state.addRecords([m], got + shift);
    return m;
  }
  state.addPassings(passingsOf([x]).map(p => shift ? { ...p, time: p.time + shift } : p), got + shift, { first: x.via === 'start' });
  if (!x.Deleted && x.AdvertisedTimeAtLocation && x.OperationalTrainNumber)
    state.addPlanned([{ key: trainKey(x.OperationalTrainNumber, x.ScheduledDepartureDateTime), sig: x.LocationSignature,
      activity: x.ActivityType, planned: Date.parse(x.AdvertisedTimeAtLocation) + shift, brand: x.ProductInformation?.[0]?.Description ?? null }], got + shift);
  return null;
}

// Plays events through state, sampling every `every` ms on the clock's whole steps (+50 ms, as the fetcher's live tick)
// and handing out each slot when it ends: onSlot(slot, trains, whole) (whole: the slot lies inside the recording).
// onRecord(record): each position record as fed (moved; not the first answer's); onSample(t): before each sample. The last slot, unfinished, is handed
// out too (whole false).
export function play(state, events, { every, shift = 0, onSlot, onRecord = () => {}, onSample = () => {} }) {
  if (!events.length) return;
  const first = events[0][1] + shift, last = events.at(-1)[1] + shift;
  const whole = s => s * HISTORY_MS >= first && (s + 1) * HISTORY_MS <= last;
  let next = Math.ceil(first / every) * every + 50, slot = null;
  for (const e of events) {
    while (e[1] + shift >= next) {
      const s = historySlot(next);
      if (slot !== null && s !== slot) onSlot(slot, state.takeHistory(slot), whole(slot));
      slot = s;
      onSample(next);
      state.sampleHistory(next);
      next += every;
    }
    const r = feed(state, e, shift);
    if (r && e[2].via !== 'start') onRecord(r);
  }
  if (slot !== null) onSlot(slot, state.takeHistory(slot), false);
}
