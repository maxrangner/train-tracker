// A recording's history files (the day, build plan part 4, 2026-11-22), for tests and demos: the recording played
// through the fetcher's memory (fetcher/state.mjs) and files (fetcher/files.mjs buildHistory), every slot written to a
// folder as history-<slot>.json, as the fetcher puts them on one.com. A page reading that folder finds them by name
// (src/files-source.js history()).
// --shift-to-today: every time moved to today, keeping the Swedish wall clock (16:05 on 17 Nov is 16:05 today; not
// exact on a clock-change day), and the trains' days in their ids moved with it.
// --end-now (2026-11-23, tools/day-check.mjs): every time moved by whole slots so the recording's last slot ends where the
// slot running now begins: all its files are finished ones, just before now (a page can scrub them at once);
// --end-now 3: ending 3 hours before that instead (two recordings in one folder make a longer day, with a gap).
// Run: node tools/history-files.mjs <recording name or data/positions-*.jsonl> --out <folder> [--shift-to-today | --end-now [hours back]]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { swedishDay, swedishMidnight, midnightOf, addDays } from '../src/clock.js';
import { historyName, HISTORY_EVERY_MS, HISTORY_MS, historySlot } from '../src/live-file.js';
import { createState } from '../fetcher/state.mjs';
import { buildHistory } from '../fetcher/files.mjs';
import { eventsOf, play } from './lib/history-play.mjs';

const args = process.argv.slice(2);
const arg = n => { const i = args.indexOf(n); return i < 0 ? null : args[i + 1]; };
const name = (args.find(a => !a.startsWith('--') && a !== arg('--out')) ?? '').replace(/^.*positions-/, '').replace(/\.jsonl$/, '');
const out = arg('--out');
if (!name || !out) { console.log('run: node tools/history-files.mjs <recording> --out <folder> [--shift-to-today | --end-now]'); process.exit(2); }
const events = eventsOf(name);
if (!events.length) { console.log(`no recording data/positions-${name}.jsonl`); process.exit(2); }

const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
let shift = 0, days = 0;
if (args.includes('--shift-to-today')) {
  const from = swedishDay(events[0][1]), to = swedishDay(Date.now());
  shift = midnightOf(to) - swedishMidnight(events[0][1]);
  days = dayDiff(from, to);
} else if (args.includes('--end-now')) {
  const back = Number(arg('--end-now')) || 0;
  shift = historySlot(Date.now() - back * 3600000) * HISTORY_MS - Math.ceil(events.at(-1)[1] / HISTORY_MS) * HISTORY_MS;
  days = dayDiff(swedishDay(events[0][1]), swedishDay(events[0][1] + shift));
}
const moveId = id => { if (!days) return id; const cut = id.lastIndexOf('/'); return `${id.slice(0, cut)}/${addDays(id.slice(cut + 1), days)}`; };

mkdirSync(out, { recursive: true });
let files = 0, trains = new Set(), bytes = 0;
play(createState(), events, {
  every: HISTORY_EVERY_MS, shift,
  onSlot(slot, list) {
    if (!list.length) return;
    const f = buildHistory(slot, list.map(tr => ({ ...tr, id: moveId(tr.id) })));
    const json = JSON.stringify(f);
    writeFileSync(join(out, historyName(slot)), json);
    files++; bytes += json.length;
    for (const tr of list) trains.add(tr.id);
  },
});
console.log(`${files} history files (${(bytes / 1e6).toFixed(1)} MB unpacked, ${trains.size} trains) into ${out}${shift ? `, moved ${days} days (${(shift / 3600000).toFixed(2)} h)` : ''}`);
