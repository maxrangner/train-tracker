// The viewer count (Max, 2026-11-23: "how many are using my app and site. Doesn't have to be exact, but ballpark is
// fine"; our own counter, no third party). While the page or app is shown it says "I'm here" at opening and every
// 5 minutes: a random id, new each Swedish day, and 'a' (app) or 's' (site). Nothing else: no name, no address kept, no
// cookie (the day's id waits in the browser's own storage so a reload is the same person). count/i.php on one.com
// writes it down; the fetcher counts (fetcher/viewers.mjs) and the monitor's morning mail shows the numbers.
// Only builds made to count send anything (VITE_COUNT_URL: tools/deploy.mjs page and tools/apk.mjs --public); never
// the dev page, test builds or a test browser (navigator.webdriver). Settings → Debug → "Don't count me" stops it on
// this phone or browser (Max's own).
import { swedishDay } from './clock.js';

export const EVERY_MS = 5 * 60000;
const STORE = 'count-id';

// A fresh id: 12 letters and digits.
export function newId(random = n => crypto.getRandomValues(new Uint8Array(n))) {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(random(12), b => a[b % 36]).join('');
}

// The day's id: kept for the day in storage (when it can be), else for as long as the page is open.
export function dayId(day, storage, mem) {
  if (mem.day === day && mem.id) return mem.id;
  try {
    const s = JSON.parse(storage?.getItem(STORE) ?? 'null');
    if (s?.day === day && /^[a-z0-9]{12}$/.test(s.id ?? '')) return Object.assign(mem, s).id;
  } catch { /* storage blocked or broken */ }
  Object.assign(mem, { day, id: newId() });
  try { storage?.setItem(STORE, JSON.stringify(mem)); } catch { /* kept in memory only */ }
  return mem.id;
}

// Starts counting. Returns a stop function (the check uses it). All outside things come in, so the check can fake them.
export function startCount({ url, kind, now = () => Date.now(), doc = globalThis.document, storage = globalThis.localStorage,
  send = (u, body) => fetch(u, { method: 'POST', body, mode: 'no-cors', keepalive: true, credentials: 'omit' }).catch(() => {}),
  off = () => false, robot = Boolean(globalThis.navigator?.webdriver), every = setInterval, stopEvery = clearInterval } = {}) {
  if (!url || robot || !['a', 's'].includes(kind)) return () => {};
  const mem = {};
  let last = -Infinity;
  const tick = () => {
    if (off() || doc?.hidden) return;
    const t = now();
    if (t - last < EVERY_MS) return;
    last = t;
    send(url, `${dayId(swedishDay(t), storage, mem)} ${kind}`);
  };
  tick();
  const timer = every(tick, 30000);
  doc?.addEventListener?.('visibilitychange', tick);
  return () => { stopEvery(timer); doc?.removeEventListener?.('visibilitychange', tick); };
}
