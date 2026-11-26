// "You seem to be on 231" (Max's idea 7, build plan part 3) and the ride page.
// Only while My location is on (the map's button; the app never asks by itself): once it has given a fix, the phone's
// place is watched (watchPosition; the permission is already there) and fed to src/seem-on.js with the trains drawn
// near it. The place is never stored or sent. The drawn trains run DRAW_DELAY behind real time, so each fix is
// compared with the trains at the fix's own moment: the fixes wait in a short list and the one at the drawn moment
// (between two fixes) is fed.
// When it offers a train: the line above the bar ('seemon', priority 30) "You seem to be on 231 → Malmö C · Ride
// along?"; × dismisses it, and that train is not offered again this session. A tap opens 'ride:<id>': next stop,
// minutes to it, lateness, track, the map following the train.
import { createSeemOn } from './seem-on.js';
import { fetchRoute } from './trafikverket.js';
import { now, hhmm } from './clock.js';
import { t } from './i18n.js';
import { esc } from './html.js';
import { icon } from './icons.js';
import { minutesText } from './tag.js';
import { lateClass } from './lateness.js';
import { stateHtml } from './state.js';

const FEED_MS = 5000;           // a fix fed this often
const KEEP_MS = 3 * 60 * 1000;  // fixes kept this long
const LINE_KEEP_MS = 2 * 60 * 1000;   // the offer stays this long after the last fix that matched (a station with two trains)
const ROUTE_MS = 60 * 1000;

// deps: { map, stack, line, drawDelay, frame() -> the drawn trains [{ id, lon, lat, bearing, v (m/s), stale }],
//   info(id) -> { number, operational, date } | null, stationName(sig), lateOf(id), follow(id), unfollow() }
export function createRide({ map, stack, line, drawDelay, frame, info, stationName, lateOf, follow, unfollow }) {
  const seem = createSeemOn();
  const fixes = [];
  const dismissed = new Set();
  let watch = null, offer = null, offerSeen = 0, lastFed = 0;
  const routes = new Map();   // id -> { at, route }

  function add(fix) { fixes.push({ t: now(), lon: fix.lon, lat: fix.lat, accuracy: fix.accuracy ?? 0 }); while (fixes.length && fixes[0].t < now() - KEEP_MS) fixes.shift(); }
  // The place at moment T, between the fixes around it (null: none close enough).
  function placeAt(T) {
    let i = fixes.findIndex(f => f.t > T);
    if (i === 0) return null;
    if (i < 0) { const f = fixes.at(-1); return f && T - f.t < 15000 ? { ...f, t: T } : null; }
    const a = fixes[i - 1], b = fixes[i], k = (T - a.t) / ((b.t - a.t) || 1);
    return { t: T, lon: a.lon + (b.lon - a.lon) * k, lat: a.lat + (b.lat - a.lat) * k, accuracy: Math.max(a.accuracy, b.accuracy) };
  }
  async function start() {
    if (watch !== null || !navigator.geolocation) return;
    // never a question: only when the permission is already given (the button's own fix came)
    try { const p = await navigator.permissions?.query({ name: 'geolocation' }); if (p && p.state !== 'granted') return; } catch { /* not known: the button's fix says it is */ }
    if (watch !== null) return;
    watch = navigator.geolocation.watchPosition(p => add({ lon: p.coords.longitude, lat: p.coords.latitude, accuracy: p.coords.accuracy }),
      () => { /* a failed fix: the next one */ }, { enableHighAccuracy: true, maximumAge: 5000 });
  }
  function stop() {
    if (watch !== null) navigator.geolocation.clearWatch(watch);
    watch = null; fixes.length = 0; seem.clear();
    if (offer) { offer = null; line.clear('seemon'); }
  }
  map.onLocation((fix) => { add(fix); if (!document.hidden) start(); });
  // Not while the page is hidden (no GPS behind another app); back, again if My location is still on.
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (watch !== null) { navigator.geolocation.clearWatch(watch); watch = null; } } else if (map.location) start(); });

  async function routeOf(id) {
    const c = routes.get(id);
    if (c && Date.now() - c.at < ROUTE_MS) return c.route;
    const m = info(id);
    if (!m) return c?.route ?? null;
    try { const route = await fetchRoute(m.operational, m.date, m.number); routes.set(id, { at: Date.now(), route }); return route; } catch { return c?.route ?? null; }
  }
  const toOf = id => { const r = routes.get(id)?.route; return r?.to ? stationName(r.to) : null; };
  function showOffer() {
    if (!offer) { line.clear('seemon'); return; }
    const to = toOf(offer.id);
    line.set('seemon', { priority: 30, html: `<span class="ln-ic seem">${icon('train', 16)}</span><span>${esc(t('seemOn', offer.number, to))}</span>`,
      onTap: () => stack.open(`ride:${offer.id}`), onClose: () => { dismissed.add(offer.id); offer = null; seem.clear(); line.clear('seemon'); }, closeLabel: t('seemOnNo') });
  }
  function tick() {
    if (!map.location) { if (watch !== null || fixes.length) stop(); return; }
    if (!fixes.length) return;
    const T = now() - drawDelay;
    if (T - lastFed < FEED_MS - 50) return;
    const p = placeAt(T);
    if (!p) return;
    lastFed = T;
    const k = Math.cos(p.lat * Math.PI / 180);
    const near = frame().filter(x => !x.stale && Math.abs(x.lat - p.lat) < 0.03 && Math.abs(x.lon - p.lon) * k < 0.03)
      .map(x => ({ id: x.id, number: info(x.id)?.number ?? '', lon: x.lon, lat: x.lat, bearing: x.bearing ?? 0, speed: (x.v ?? 0) * 3.6 }));
    const got = seem.feed(p, near);
    if (got && !dismissed.has(got.id)) {
      offerSeen = T;
      if (offer?.id !== got.id) { offer = got; showOffer(); routeOf(got.id).then(() => { if (offer?.id === got.id) showOffer(); }); }
    } else if (offer && T - offerSeen > LINE_KEEP_MS) { offer = null; showOffer(); }
  }
  setInterval(tick, 1000);

  // ---------- the ride page ----------
  function ridePage(id) {
    const m0 = info(id);
    if (!m0) return null;
    let el = null, route = null;
    function draw() {
      if (!el) return;
      const late = lateOf(id), to = route?.to ? stationName(route.to) : null;
      const stops = (route?.stops ?? []).filter(s => s.advertised);
      const next = stops.find(s => !s.actual && !s.canceled);
      let body;
      if (!route) body = stateHtml('loading', t('loadingRoute'));
      else if (!next) body = stateHtml('empty', t('rideArrived'));
      else {
        const at = next.actual ?? next.estimated ?? next.planned, min = Math.max(0, Math.round((at - now()) / 60000));
        const dep = stops.find(s => s.station === next.station && s.activity === 'Avgang');
        const track = next.track || dep?.track || '';
        body = `<div class="ride-next"><small>${esc(t('rideNextStop'))}</small><b>${esc(stationName(next.station))}</b>` +
          `<span class="ride-min"><b>${min}</b> min</span><small>${esc(t('rideAt', hhmm(at)))}</small></div>` +
          `<div class="tiles"><div class="tile t-${late === null || late === undefined ? 'unknown' : lateClass(late)}"><b>${late === null || late === undefined ? '–' : esc(minutesText(late))}</b><small>${esc(t('lateness'))}</small></div>` +
          `<div class="tile"><b>${esc(track || '–')}</b><small>${esc(t('track'))}</small></div></div>`;
      }
      const html = `<div class="ride"><small class="ride-lab">${icon('train', 15)} ${esc(t('riding'))}</small><b class="ttl">${esc(`${m0.number}${to ? ` → ${to}` : ''}`)}</b>${body}` +
        `<button type="button" class="show-only" data-go="train:${esc(id)}">${icon('chevron', 18)}<span>${esc(t('rideCard'))}</span></button></div>`;
      if (el._h !== html) { el.innerHTML = html; el._h = html; }
    }
    const load = () => routeOf(id).then((r) => { route = r; draw(); });
    return {
      name: () => t('rideName', m0.number), kind: 'ride',
      mount(page) { el = page; },
      show() { line.clear('seemon'); draw(); load(); follow(id); },
      hide() { unfollow(); },
      unmount() { unfollow(); },
      every() { draw(); const c = routes.get(id); if (!c || Date.now() - c.at > ROUTE_MS) load(); },
      redraw: () => { if (el) el._h = ''; draw(); },
    };
  }
  return { define: key => (key.startsWith('ride:') ? ridePage(key.slice(5)) : undefined), get offer() { return offer; }, get watching() { return watch !== null; } };
}
