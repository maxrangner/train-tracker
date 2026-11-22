// For checks of the date passes (tools/dates-check.mjs; TODO 62, 2026-11-22).
//
// fakeClock(start): a clock that moves only when told. Date.now, new Date() (also without an argument: a replaced
// Date.now alone doesn't reach it), setTimeout, setInterval and their clears are replaced; run(ms) moves the time on
// timer by timer, letting promises settle at each step. restore() puts everything back.
//
// shiftDay(rows, from, to): Trafikverket's rows of one saved day (ScheduledDepartureDateTime = from) as if they were
// of day `to`: every time keeps its Swedish wall-clock time and calendar distance from its day and gets the offset
// Stockholm has then (+01:00 / +02:00); a wall time that doesn't exist (the hour skipped in March) moves an hour on.
// Actual and estimated times are left out (the day hasn't happened); ModifiedTime is a day before.
const RealDate = Date, realSetTimeout = setTimeout, realClearTimeout = clearTimeout, realSetInterval = setInterval, realClearInterval = clearInterval;

export function fakeClock(start) {
  let now = start, id = 0;
  const timers = new Map();   // id -> { at, fn, every }
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(now); }
    static now() { return now; }
  }
  globalThis.Date = FakeDate;
  globalThis.setTimeout = (fn, ms = 0, ...a) => { timers.set(++id, { at: now + Math.max(0, Number(ms) || 0), fn: () => fn(...a) }); return id; };
  globalThis.setInterval = (fn, ms = 0, ...a) => { const every = Math.max(1, Number(ms) || 0); timers.set(++id, { at: now + every, every, fn: () => fn(...a) }); return id; };
  globalThis.clearTimeout = globalThis.clearInterval = t => { timers.delete(t); };
  const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };
  return {
    now: () => now,
    // Move on to `until` (ms), calling each due timer at its time; onMinute(t) after every whole minute passed.
    async runTo(until, onMinute = null) {
      let nextMinute = onMinute ? Math.floor(now / 60000) * 60000 + 60000 : Infinity;
      await settle();
      for (;;) {
        let next = null;
        for (const [k, x] of timers) if (x.at <= until && (!next || x.at < next[1].at)) next = [k, x];
        const at = Math.min(next ? next[1].at : Infinity, nextMinute);
        if (at > until) break;
        now = Math.max(now, at);
        if (at === nextMinute) { await onMinute(now); nextMinute += 60000; await settle(); continue; }
        const [k, x] = next;
        if (x.every) x.at += x.every; else timers.delete(k);
        x.fn();
        await settle();
      }
      now = Math.max(now, until);
    },
    restore() {
      globalThis.Date = RealDate; globalThis.setTimeout = realSetTimeout; globalThis.clearTimeout = realClearTimeout;
      globalThis.setInterval = realSetInterval; globalThis.clearInterval = realClearInterval;
    },
  };
}

// Stockholm's offset (hours) at a Swedish wall time 'YYYY-MM-DDTHH', and whether that wall time exists.
const offsets = new Map();
const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
const wallOf = t => { const p = Object.fromEntries(fmt.formatToParts(new RealDate(t)).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}`; };
function offsetAt(wallHour) {
  let o = offsets.get(wallHour);
  if (o === undefined) {
    const utc = RealDate.parse(`${wallHour}:00:00Z`);
    o = [2, 1].find(h => wallOf(utc - h * 3600000) === wallHour) ?? null;   // summer first: in the repeated hour, its first time
    offsets.set(wallHour, o);
  }
  return o;
}
const addDays = (day, n) => { const [y, m, d] = day.split('-').map(Number); return new RealDate(RealDate.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const dayDiff = (a, b) => Math.round((RealDate.parse(`${b}T00:00:00Z`) - RealDate.parse(`${a}T00:00:00Z`)) / 86400000);

// A '…+01:00' time of the day `from` (or the next) moved to the same wall time on `to` (or its next).
function move(s, from, to) {
  const wallDay = s.slice(0, 10), clock = s.slice(11, 19);
  let wd = addDays(to, dayDiff(from, wallDay)), hour = clock.slice(0, 2);
  let o = offsetAt(`${wd}T${hour}`);
  if (o === null) {   // skipped in March: an hour on
    const t = RealDate.parse(`${wd}T${clock}+01:00`);   // (02:30 read as winter time = 03:30 summer time)
    return new RealDate(t).toISOString();
  }
  return `${wd}T${clock}.000+0${o}:00`;
}
const TIMES = ['AdvertisedTimeAtLocation'];
export function shiftDay(rows, from, to) {
  const sched = `${to}T00:00:00.000+0${offsetAt(`${to}T00`)}:00`, modified = `${addDays(to, -1)}T12:00:00.000Z`;
  return rows.map((a) => {
    const b = { ...a, ScheduledDepartureDateTime: sched, ModifiedTime: modified };
    delete b.TimeAtLocation; delete b.EstimatedTimeAtLocation;
    for (const k of TIMES) if (a[k]) b[k] = move(a[k], from, to);
    return b;
  });
}
