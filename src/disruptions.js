// Disruptions (Max, 2026-11-14: "in the hamburger and on the map", and the stations' own messages on their boards).
// Trafikverket's traffic messages in force that have a text for travellers (src/trafikverket.js fetchDisruptions):
// about 8 at a time, asked every 5 minutes while the page is shown (12 small asks an hour). Live only: a recording
// holds none. The texts are Trafikverket's own, in Swedish (CC0).
// - the list: the menu's "Disruptions" page; a tap flies to one and opens its card;
// - the map: each one's stretch along our tracks (src/path.js over its from / via / to stations) and a mark at its
//   place (src/map.js setDisruptions);
// - the card: where a train's panel opens, with the header, places, times and the whole text.
import { pathOf, progressAlong } from './path.js';
import { t, lang } from './i18n.js';
import { hhmm } from './clock.js';

const ASK_EVERY_MS = 5 * 60 * 1000;
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Trafikverket's level 1 is "green", but each of these has a message for travellers: shown as yellow (1-2), orange, red.
export const levelName = level => (level >= 4 ? 'red' : level === 3 ? 'orange' : 'yellow');

// A path's ({ coords }) length, in degrees of latitude (enough to compare two stretches).
function length({ coords: c }) {
  let s = 0;
  for (let i = 1; i < c.length; i++) s += Math.hypot((c[i][0] - c[i - 1][0]) * Math.cos(c[i][1] * Math.PI / 180), c[i][1] - c[i - 1][1]);
  return s;
}
// The point halfway along a path ({ coords }), as { lon, lat }.
function halfway(path) {
  const c = path.coords, share = progressAlong(path);
  const i = Math.max(1, share.findIndex(f => f >= 0.5));
  const f = (0.5 - share[i - 1]) / ((share[i] - share[i - 1]) || 1);
  return { lon: c[i - 1][0] + (c[i][0] - c[i - 1][0]) * f, lat: c[i - 1][1] + (c[i][1] - c[i - 1][1]) * f };
}

// load(at) -> Promise of disruptions (fetchDisruptions); now() -> ms; station(sig) -> { name, lon, lat } or undefined;
// net() -> the rail network or null; onData({ list, geojson }) after each answer.
export function createDisruptions({ load, now, station, net, onData }) {
  let list = [];
  let timer = null, asking = false, last = 0;
  const geoCache = new Map();   // a disruption's stretch, by its stations (work done once)

  function stretch(sigs) {
    const key = sigs.join('|');
    if (geoCache.has(key)) return geoCache.get(key);
    const places = sigs.map(station).filter(st => st && st.lon !== null && st.lon !== undefined).map(st => ({ lon: st.lon, lat: st.lat, stop: true }));
    const coords = places.length >= 2 ? pathOf(places, net()).coords : null;
    geoCache.set(key, coords);
    return coords;
  }
  // A disruption's drawn stretches (coordinate lists of 2 or more points).
  const stretchesOf = d => d.sections.map(stretch).filter(c => c && c.length >= 2);
  // The map shows a stretch as its line only; a mark (a ring, src/map.js) only for a disruption with no stretch
  // drawn, i.e. one station (Max, 2026-11-15, picked "B, line only" from sketches: "The smaller sections will show
  // when you zoom in. Or you just use the list").
  function geojson() {
    const features = [];
    for (const d of list) {
      const lines = stretchesOf(d);
      for (const coords of lines) features.push({ type: 'Feature', properties: { id: d.id, level: d.level }, geometry: { type: 'LineString', coordinates: coords } });
      const p = !lines.length && placeOf(d);
      if (p) features.push({ type: 'Feature', properties: { id: d.id, level: d.level }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } });
    }
    return { type: 'FeatureCollection', features };
  }
  // Where a disruption is (the list's "fly to"): halfway along its longest drawn stretch, else its first station,
  // else Trafikverket's own point. Not that point first: it is the middle of a straight line between the stretch's
  // end stations, beside the track, once 11 km out (measured 2026-11-15, docs/data.md).
  function placeOf(d) {
    const longest = stretchesOf(d).map(coords => ({ coords })).sort((a, b) => length(b) - length(a))[0];
    if (longest) return halfway(longest);
    const st = d.sections.flat().map(station).find(s => s?.lon !== null && s?.lon !== undefined);
    if (st) return { lon: st.lon, lat: st.lat };
    return d.point ?? null;
  }

  async function ask() {
    if (asking || document.hidden) return;
    asking = true;
    try {
      list = (await load(now())).sort((a, b) => b.level - a.level || b.since - a.since);
      last = Date.now();
      onData({ list, geojson: geojson() });
    } catch (e) {
      console.warn('disruptions:', e.message);
    } finally { asking = false; }
  }
  function start() {
    ask();
    clearInterval(timer);
    timer = setInterval(ask, ASK_EVERY_MS);
    // Back on the page after a while: ask at once if the last answer is old.
    document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - last > ASK_EVERY_MS) ask(); });
  }

  return { start, get list() { return list; }, byId: id => list.find(d => d.id === id) ?? null, placeOf };
}

// The places of a disruption in words: "Göteborg C – Alingsås".
export function placesText(d, stationName) {
  return d.sections.map(s => s.map(stationName).join(' – ')).join('; ');
}

// When it started and when it is expected to end, in words.
export function timesText(d, now) {
  const day = ms => new Date(ms).toLocaleDateString(lang() === 'sv' ? 'sv-SE' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/Stockholm' });
  const when = ms => (day(ms) === day(now) ? hhmm(ms) : `${day(ms)} ${hhmm(ms)}`);
  return d.until ? t('disruptionUntil', when(d.since), when(d.until)) : t('disruptionSince', when(d.since));
}

// One row of the list (a button): the level's dot, the header, the places and the times.
export function rowHtml(d, stationName, now) {
  return `<button type="button" class="dis-row" data-id="${esc(d.id)}"><span class="dis-dot ${levelName(d.level)}" aria-hidden="true"></span>` +
    `<span><b>${esc(d.header)}</b><span class="dis-sub">${esc(placesText(d, stationName))} · ${esc(timesText(d, now))}</span></span></button>`;
}

// The card's contents.
export function cardHtml(d, stationName, now) {
  return `<div class="panel-head"><strong><span class="dis-dot ${levelName(d.level)}" aria-hidden="true"></span> ${esc(d.header)}</strong>` +
    `<button class="panel-close" type="button" aria-label="${esc(t('close'))}">×</button></div>` +
    `<p class="panel-note">${esc(d.kind)} · ${esc(placesText(d, stationName))}<br>${esc(timesText(d, now))}</p>` +
    `<div class="dis-text">${esc(d.text)}</div><p class="panel-note dis-source">${esc(t('disruptionSource'))}</p>`;
}
