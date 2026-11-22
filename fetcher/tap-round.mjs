// The card, board and day files in groups, made in turns (out of fetcher/main.mjs since 2026-11-22, so
// tools/dates-check.mjs can drive it): all at the first round (a page opening needs them), then the oldest card, the
// oldest board and the oldest day every 30 s (each one about every 16 minutes), with a changes file every 30 s that
// brings every row changed since the oldest of them, so a tap is at most ~30 s behind Trafikverket.
// A full round again (all 96) when the timetable says it loaded a day (18:00, 03:30, after a stream gap) and when the
// Swedish day turns: until 2026-11-22 nothing was made again at midnight, so for up to 16 minutes the card, the number
// search and a station's whole day said "no train" for the new day's trains (TODO 62). The full round is decided at the
// start of a round, never in its middle (a load that came mid-round cleared the list while files were being made, and
// the changes file then started too late for the older files).
// A full round takes ~0.7 s on the saved day of 17 Nov; the thread is let go after every file.
import { swedishDay } from '../src/clock.js';
import { GROUPS } from '../src/tap-files.js';
import { FORMAT } from '../src/live-file.js';

const MIN = 60000;
const GROUP_KINDS = Array.from({ length: GROUPS }, (_, i) => String(i).padStart(2, '0')).flatMap(g => [`card-${g}`, `board-${g}`, `day-${g}`]);
const letGo = () => new Promise(r => setImmediate(r));

// breather: what to wait for between files (a check on a fake clock gives its own).
export function createTapRound({ timetable, shelf, breather = letGo }) {
  const groupAt = {};   // card-NN / board-NN / day-NN -> when its file in use was made
  let full = true, roundDay = null;
  return {
    loaded() { full = true; },   // the timetable loaded a day: every file again at the next round
    async tick() {
      if (!timetable.ready()) return;
      const t = Date.now(), day = swedishDay(t);
      if (full || day !== roundDay) { for (const k in groupAt) delete groupAt[k]; full = false; roundDay = day; }
      const due = GROUP_KINDS.some(k => !groupAt[k]) ? GROUP_KINDS.filter(k => !groupAt[k])
        : ['card', 'board', 'day'].map(w => GROUP_KINDS.filter(k => k.startsWith(w)).sort((a, b) => groupAt[a] - groupAt[b])[0]);
      for (const k of due) {
        const [what, g] = k.split('-');
        shelf.put(k, t, { v: FORMAT, ...timetable[what](g, t) });
        groupAt[k] = t;
        await breather();
      }
      const oldest = Math.min(...Object.values(groupAt));
      shelf.put('taps-add', t, { v: FORMAT, ...timetable.changes(oldest - MIN, t) });
    },
  };
}
