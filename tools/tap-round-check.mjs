// A full round of tap files (all 96 cards, boards and days) on the saved day of 17 Nov (data/measure/
// day-2026-11-17.json, 94k rows) stays quick, so the fetcher's thread is never held long (the code review of 2026-11-21,
// finding 7: 4.1 s held until 2026-11-22; measured then on this PC: 0.7 s in all, the longest file ~20 ms, the first
// with the rows' sorting by group ~50 ms). Limits with room for a slower PC: 2.5 s in all, 150 ms per file. The fetcher
// lets the thread go after each file (fetcher/main.mjs 'tap files'). About 5 s, offline. Run: node tools/tap-round-check.mjs
import { readFileSync } from 'node:fs';
import { createTimetable } from '../fetcher/timetable.mjs';
import { GROUPS } from '../src/tap-files.js';

const TOTAL_MS = 2500, FILE_MS = 150;
const DAY = JSON.parse(readFileSync(new URL('../data/measure/day-2026-11-17.json', import.meta.url), 'utf8'));
const tt = createTimetable({ log: () => {}, seed: { days: ['2026-11-17'], rows: DAY } });
let total = 0, longest = 0, which = '';
const t = Date.parse('2026-11-17T08:00:00+01:00');
for (const what of ['card', 'board', 'day']) for (let g = 0; g < GROUPS; g++) {
  const a = performance.now();
  JSON.stringify(tt[what](String(g).padStart(2, '0'), t));
  const ms = performance.now() - a;
  total += ms;
  if (ms > longest) { longest = ms; which = `${what}-${g}`; }
}
tt.stop();
const good = total <= TOTAL_MS && longest <= FILE_MS;
console.log(`${good ? 'ok  ' : 'FAIL'} a full round of ${3 * GROUPS} tap files: ${Math.round(total)} ms in all (max ${TOTAL_MS}), the longest ${Math.round(longest)} ms (${which}; max ${FILE_MS})`);
console.log(good ? 'tap-round-check ok' : 'tap-round-check FAILED');
process.exit(good ? 0 : 1);
