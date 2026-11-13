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
