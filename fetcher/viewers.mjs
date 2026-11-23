// Counts the viewers from count/i.php's day files on one.com (Max, 2026-11-23: "how many are using my app and site";
// src/count.js sends, count/i.php writes "<unix time> <id> <a|s>" a line, one a viewer every 5 minutes while shown).
// Every 10 minutes the new lines of yesterday's and today's file are read (over the uploader's SFTP connection, only
// that folder, only reading); older days once at the start. For each Swedish day: people (different ids), app and site,
// and the most at once (different ids in a 5-minute slot); for each hour the same. The monitor gets them in the
// fetcher's status (viewers) for its morning mail.
import { swedishDay, swedishParts, addDays, midnightOf } from '../src/clock.js';

const SLOT_MS = 5 * 60000;
const DAYS = 8;
export const DAY_FILE = /^(\d{4}-\d\d-\d\d)\.txt$/;

// One day's counts, built up line by line.
function newDay(day) {
  return { day, offset: 0, rest: '', ids: new Map(), hours: new Map(), slots: new Map(), done: false };
}
export function addLines(d, text) {
  const all = d.rest + text;
  const end = all.lastIndexOf('\n');
  d.rest = end < 0 ? all : all.slice(end + 1);
  if (end < 0) return;
  for (const line of all.slice(0, end).split('\n')) {
    const m = /^(\d{9,11}) ([a-z0-9]{12}) ([as])$/.exec(line.trim());
    if (!m) continue;
    const t = Number(m[1]) * 1000, id = m[2], kind = m[3];
    if (swedishDay(t) !== d.day) continue;
    if (!d.ids.has(id) || kind === 'a') d.ids.set(id, kind);   // an id seen in the app counts as app
    const p = swedishParts(t), hourKey = t - p.minute * 60000 - (t % 60000);
    (d.hours.get(hourKey) ?? d.hours.set(hourKey, { t: hourKey, ids: new Set(), slots: new Map() }).get(hourKey)).ids.add(id);
    const slot = Math.floor(t / SLOT_MS);
    (d.slots.get(slot) ?? d.slots.set(slot, new Set()).get(slot)).add(id);
    const h = d.hours.get(hourKey);
    (h.slots.get(slot) ?? h.slots.set(slot, new Set()).get(slot)).add(id);
  }
}
const most = slots => { let n = 0, at = null; for (const [s, ids] of slots) if (ids.size > n) { n = ids.size; at = s * SLOT_MS; } return { n, at }; };
export function dayCounts(d) {
  let app = 0; for (const k of d.ids.values()) if (k === 'a') app++;
  const peak = most(d.slots);
  return { day: d.day, people: d.ids.size, app, site: d.ids.size - app, peak: peak.n, peakAt: peak.at };
}
export function hourCounts(d) {
  return [...d.hours.values()].sort((a, b) => a.t - b.t).map(h => ({ t: h.t, people: h.ids.size, peak: most(h.slots).n }));
}

// read(name, offset) -> the file's text from that byte on ('' when none); list() -> the day files' names.
export function createViewers({ read, list, log = () => {}, now = () => Date.now() }) {
  const days = new Map();   // day -> its counts
  const stats = { at: null, error: null, reads: 0 };
  let started = false, busy = false;

  async function readDay(day) {
    const d = days.get(day) ?? days.set(day, newDay(day)).get(day);
    const text = await read(`${day}.txt`, d.offset);
    stats.reads++;
    d.offset += Buffer.byteLength(text, 'utf8');
    addLines(d, text);
  }
  async function round() {
    if (busy) return;
    busy = true;
    try {
      const today = swedishDay(now()), yesterday = addDays(today, -1);
      if (!started) {
        // At the start, every day file of the last 8 days.
        const names = (await list()).map(n => DAY_FILE.exec(n)?.[1]).filter(Boolean).filter(day => day >= addDays(today, -(DAYS - 1)));
        for (const day of names.sort()) await readDay(day);
        started = true;
      } else {
        for (const day of [yesterday, today]) if (day === today || !days.get(day)?.done) await readDay(day);
        // Yesterday's file read once more after its end, then left as it is.
        if (days.has(yesterday) && now() - midnightOf(today) > 3600000) days.get(yesterday).done = true;
      }
      for (const day of days.keys()) if (day < addDays(today, -(DAYS - 1))) days.delete(day);
      stats.at = now(); if (stats.error) log('viewers: read again'); stats.error = null;
    } catch (e) {
      if (!stats.error) log(`viewers: ${e.message}`);
      stats.error = String(e.message).slice(0, 200);
    } finally { busy = false; }
  }
  function status() {
    const sorted = [...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
    const cut = now() - 25 * 3600000;
    return {
      at: stats.at, error: stats.error,
      days: sorted.map(dayCounts),
      hours: sorted.flatMap(hourCounts).filter(h => h.t > cut - 3600000),
    };
  }
  return { round, status };
}
