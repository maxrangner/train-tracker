// The shop window (Max's idea 4, build plan part 6): a phone on its side (or on a charger, where the phone can tell)
// with no touch for 30 s: the buttons and the sheet fade (<html class="shop">) and the camera tours Sweden by itself
// (src/tour.js stops: the fastest train, the most late, a disruption, two trains about to meet), one stop every
// STOP_MS with one line of text. Any touch or key brings everything back (that touch does nothing else). The screen is
// kept awake meanwhile (the Wake Lock API, where there is one). Settings → Shop window (on by default).
// Not while a page or the search is up (the sheet raised), nor while The day shows another time (hooks.dayOther).
// deps: { map, enabled(), busy(), trains() -> [{ id, number, brand, lon, lat, speed (km/h), bearing, late }],
//   disruptions() -> [{ id, header, place }], follow(id), unfollow() }
import { stops, shouldRun, STOP_MS } from './tour.js';
import { t } from './i18n.js';

const CHECK_MS = 2000;

export function createShopWindow({ map, enabled, busy, trains, disruptions, follow, unfollow }) {
  const root = document.documentElement;
  const cover = Object.assign(document.createElement('div'), { id: 'shop', hidden: true });
  cover.innerHTML = '<p class="shop-line"></p>';
  document.body.append(cover);
  const lineEl = cover.querySelector('.shop-line');
  let lastTouch = Date.now(), running = false, timer = null, lock = null, charging = null, i = 0;
  const landscape = typeof matchMedia === 'function' ? matchMedia('(orientation: landscape)') : null;
  // sideways: a phone-sized screen wider than tall (a computer's wide window is no phone on its side)
  const sideways = () => Boolean(landscape?.matches) && Math.min(innerWidth, innerHeight) <= 500;
  // Charging: only where the browser tells (navigator.getBattery; not in every WebView, not checked on a phone).
  try {
    navigator.getBattery?.().then((b) => { charging = b.charging; b.addEventListener('chargingchange', () => { charging = b.charging; }); }).catch(() => { charging = null; });
  } catch { charging = null; }

  const touched = () => { lastTouch = Date.now(); };
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) document.addEventListener(type, touched, { capture: true, passive: true });
  // The touch that ends it ends only it.
  const end = (e) => { e.preventDefault(); e.stopPropagation(); stop(); };
  cover.addEventListener('pointerdown', end);
  cover.addEventListener('click', end);
  document.addEventListener('keydown', (e) => { if (running) end(e); }, true);

  async function wake() {
    try { lock = await navigator.wakeLock?.request('screen') ?? null; } catch { lock = null; }
  }
  document.addEventListener('visibilitychange', () => { if (running && !document.hidden) wake(); });

  function words(s) {
    if (s.kind === 'fastest') return t('shopFastest', s.train.number, s.value);
    if (s.kind === 'late') return t('shopLate', s.train.number, s.value);
    if (s.kind === 'disruption') return t('shopDisruption', s.disruption.header);
    if (s.kind === 'meeting') return t('shopMeeting', s.trains[0].number, s.trains[1].number);
    return '';
  }
  async function next() {
    if (!running) return;
    const list = stops(trains(), disruptions());
    if (!list.length) { lineEl.textContent = t('shopNothing'); timer = setTimeout(next, STOP_MS); return; }
    const s = list[i++ % list.length];
    lineEl.textContent = words(s);
    lineEl.classList.remove('in'); void lineEl.offsetWidth; lineEl.classList.add('in');
    unfollow();
    timer = setTimeout(next, STOP_MS);
    await map.fly(s, s.zoom);
    if (running && s.train) follow(s.train.id);
  }
  function start() {
    if (running) return;
    running = true; i = 0;
    root.classList.add('shop');
    cover.hidden = false;
    wake();
    next();
  }
  function stop() {
    if (!running) return;
    running = false;
    clearTimeout(timer);
    root.classList.remove('shop');
    cover.hidden = true;
    unfollow();
    lock?.release?.().catch(() => {});
    lock = null;
    lastTouch = Date.now();
  }
  setInterval(() => {
    const on = shouldRun({ sideways: sideways(), charging, lastTouch, now: Date.now(), enabled: enabled(), busy: busy() || document.hidden });
    if (on) start();
    else if (running && (!enabled() || (!sideways() && charging !== true))) stop();
  }, CHECK_MS);
  return {
    start, stop,
    get running() { return running; },
    get line() { return lineEl.textContent; },
    state: () => ({ sideways: sideways(), charging, idleS: Math.round((Date.now() - lastTouch) / 1000), enabled: enabled(), busy: busy(), running, wakeLock: Boolean(lock) }),
    pretendIdle: () => { lastTouch = 0; },   // (tools: no 30-s wait)
  };
}
