// Rewind's timeline labels (Max, 2026-11-27, "Yes" to "Day and hours on the timeline"): with 24 hours rolling the
// ribbon crosses midnight, so midnight gets a line and its label says "Today", the start says "Yesterday" when the
// ribbon begins on the day before, and the hours in between come every 1, 2, 3, 4 or 6 hours, as many as fit (at least
// MIN_GAP px apart; on a phone a day gets one every 3 hours). Pure (no page): tools/history-check.mjs checks it.
//   ticksFor(t0, t1, width, { yesterday, today, now }) -> { ticks: [{ x, text, kind: 'hour' | 'today' | 'yesterday' |
//     'now' }], midnight: x of the midnight line or null }   (t0, t1: the ribbon's span in ms; x in px from its left)
import { hhmm, swedishDay, midnightOf } from './clock.js';

const HOUR = 3600000;
const MIN_GAP = 34;       // px between two hour labels
const END_ROOM = 34;      // px kept clear of "now" at the right end
const START_ROOM = 40;    // px kept clear of "Yesterday" at the left end

export function ticksFor(t0, t1, width, words) {
  const span = Math.max(1, t1 - t0), x = at => ((at - t0) / span) * width;
  const hours = span / HOUR, step = [1, 2, 3, 4, 6].find(k => (width / hours) * k >= MIN_GAP) ?? 6;
  const mid = midnightOf(swedishDay(t1)), crosses = mid > t0 && mid < t1;
  const ticks = [];
  if (crosses) ticks.push({ x: 0, text: words.yesterday, kind: 'yesterday' });
  for (let at = Math.ceil(t0 / HOUR) * HOUR; at < t1; at += HOUR) {
    const xa = x(at), hh = Number(hhmm(at).slice(0, 2));
    if (crosses && at === mid) { ticks.push({ x: xa, text: words.today, kind: 'today' }); continue; }
    if (hh % step) continue;
    if (xa > width - END_ROOM || (crosses && xa < START_ROOM)) continue;
    if (crosses && Math.abs(xa - x(mid)) < MIN_GAP) continue;   // (clear of "Today")
    ticks.push({ x: xa, text: hhmm(at).slice(0, 2), kind: 'hour' });
  }
  ticks.push({ x: width, text: words.now, kind: 'now' });
  return { ticks, midnight: crosses ? x(mid) : null };
}
