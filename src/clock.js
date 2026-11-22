// The page's clock. Live it is this computer's clock; in a replay (src/replay-source.js) it runs from the
// recording's start, at normal speed, so everything that reads the time sees the recording's time.
let offset = 0;

export const now = () => Date.now() + offset;

// From now on the clock says t (ms) and runs on from there.
export function setClock(t) { offset = t - Date.now(); }

// Every time on the screen is Swedish time, wherever the phone is (Max, 2026-11-13: abroad the times followed the
// phone's own time zone, and a search around Swedish midnight asked for the wrong day).
const SWEDEN = 'Europe/Stockholm';
export const hhmm = t => new Date(t).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', timeZone: SWEDEN });
export const hhmmss = t => new Date(t).toLocaleTimeString('sv-SE', { timeZone: SWEDEN });
// The Swedish day of moment t, as YYYY-MM-DD (the day a train number is looked up for).
export const swedishDay = t => new Date(t).toLocaleDateString('sv-SE', { timeZone: SWEDEN });
// Date passes (TODO 62, 2026-11-22): one copy of each, right on the 23- and 25-hour days and whatever the computer's
// own time zone (the Linux PC's, a phone abroad).
// Swedish midnight of moment t (ms). Swedish time is UTC+1 or +2, and the clock never changes at midnight.
export function swedishMidnight(t) {
  const utc = Date.parse(`${swedishDay(t)}T00:00:00Z`);
  const h = Number(new Date(utc).toLocaleString('sv-SE', { hour: '2-digit', hour12: false, timeZone: SWEDEN }));
  return utc - h * 3600000;
}
// Swedish midnight starting a day 'YYYY-MM-DD'.
export const midnightOf = day => swedishMidnight(Date.parse(`${day}T12:00:00Z`));
// A day n calendar days from 'YYYY-MM-DD' (not ± 24 h: around a clock change that lands on the wrong day).
export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
// Moment t in Swedish time: { day 'YYYY-MM-DD', hour 0-23, minute }.
const partsFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: SWEDEN, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function swedishParts(t) {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}
