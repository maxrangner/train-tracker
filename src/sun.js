// The sun's line (Max's idea 6, 2026-11-22: "with toggle in settings"): night drawn as a soft shade over Sweden, dusk
// as its lighter edge, moving with the clock (the page's own, or The day's moment when it shows an earlier time).
// The sun's place is worked out here (the U.S. Naval Observatory's short formulas, within about a minute of arc for
// these years); no outside service. tools/sun-check.mjs holds it against published sunrise and sunset times.
//
// Drawn as one small picture laid over Sweden's box (a MapLibre image source, stretched in the map's own projection:
// each row of the picture is placed at its latitude in Mercator, so the line falls where it should). Remade once a
// minute live; The day asks for it when its moment moves more than a minute.

const RAD = Math.PI / 180;

// The sun at moment t (ms): its declination (degrees) and the longitude where it stands overhead (degrees, east +).
export function sunAt(t) {
  const d = t / 86400000 + 2440587.5 - 2451545.0;                    // days since 2000-01-01 12:00 UTC
  const g = (357.529 + 0.98560028 * d) * RAD;                        // mean anomaly
  const q = 280.459 + 0.98564736 * d;                                // mean longitude
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD; // longitude on the ecliptic
  const e = (23.439 - 0.00000036 * d) * RAD;                         // the earth's tilt
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD;
  const decl = Math.asin(Math.sin(e) * Math.sin(L)) / RAD;
  const gmst = (18.697374558 + 24.06570982441908 * d) * 15;          // Greenwich sidereal time, degrees
  const lon = ((ra - gmst) % 360 + 540) % 360 - 180;
  return { decl, lon };
}

// How high the sun stands (degrees; below the horizon negative) at a place, from sunAt's answer.
export function altitude(lat, lon, sun) {
  const H = (lon - sun.lon) * RAD, p = lat * RAD, s = sun.decl * RAD;
  return Math.asin(Math.sin(p) * Math.sin(s) + Math.cos(p) * Math.cos(s) * Math.cos(H)) / RAD;
}

// Sunrise and sunset count from the sun's upper edge with the air's bending: 0.833° below the horizon. Full night from
// 12° below (nautical dusk): the shade is at its darkest from there.
export const HORIZON = -0.833, DARK = -12;
// How dark the shade is at a sun this high: 0 by day, 1 in full night, smooth between.
export function nightness(alt) {
  const f = Math.max(0, Math.min(1, (HORIZON - alt) / (HORIZON - DARK)));
  return f * f * (3 - 2 * f);
}

// Sweden's box, with a margin (the picture is only drawn here; outside it the map is covered anyway).
export const BOX = { west: 8.5, east: 26.5, south: 54.3, north: 70.2 };
const mercY = lat => Math.log(Math.tan(Math.PI / 4 + lat * RAD / 2));
const latOf = y => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / RAD;

// The picture's alpha values (0-255) for moment t, w × h, rows evenly spaced in Mercator from north to south.
export function shade(t, w = 72, h = 128) {
  const sun = sunAt(t), out = new Uint8ClampedArray(w * h);
  const yN = mercY(BOX.north), yS = mercY(BOX.south);
  for (let r = 0; r < h; r++) {
    const lat = latOf(yN + (yS - yN) * (r + 0.5) / h);
    for (let c = 0; c < w; c++) {
      const lon = BOX.west + (BOX.east - BOX.west) * (c + 0.5) / w;
      out[r * w + c] = Math.round(255 * nightness(altitude(lat, lon, sun)));
    }
  }
  return out;
}

// Is it night (the sun below the horizon) at this place and moment? (The trains' glowing windows.)
export const isNight = (lat, lon, t) => altitude(lat, lon, sunAt(t)) < HORIZON;

// The layer on a MapLibre map. look(): { dark } for the colour; time(): the moment to show; on(): the setting.
// add(beforeId) is called from the map's own addSources/addLayers (also after the base map is swapped).
const SHADE = { light: [18, 28, 72, 0.30], dark: [0, 2, 14, 0.42] };
export function createSun(map, { time, on, dark }) {
  const W = 72, H = 128;
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (canvas) { canvas.width = W; canvas.height = H; }
  let drawnFor = null, drawnDark = null;
  const coords = [[BOX.west, BOX.north], [BOX.east, BOX.north], [BOX.east, BOX.south], [BOX.west, BOX.south]];
  function picture(t) {
    const [r, g, b, a] = dark() ? SHADE.dark : SHADE.light, alpha = shade(t, W, H);
    const ctx = canvas.getContext('2d'), img = ctx.createImageData(W, H);
    for (let i = 0; i < alpha.length; i++) { img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = Math.round(alpha[i] * a); }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  }
  function update(force = false) {
    if (!canvas || !map.getSource('sun')) return;
    const t = time(), minute = Math.floor(t / 60000);
    if (!force && minute === drawnFor && drawnDark === dark()) return;
    drawnFor = minute; drawnDark = dark();
    map.getSource('sun').updateImage({ url: picture(t), coordinates: coords });
  }
  function add(beforeId) {
    if (!canvas) return;
    if (!map.getSource('sun')) { drawnFor = null; map.addSource('sun', { type: 'image', url: picture(time()), coordinates: coords }); drawnFor = Math.floor(time() / 60000); drawnDark = dark(); }
    if (!map.getLayer('sun')) map.addLayer({ id: 'sun', type: 'raster', source: 'sun',
      layout: { visibility: on() ? 'visible' : 'none' }, paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, beforeId);
  }
  function show() { if (map.getLayer('sun')) map.setLayoutProperty('sun', 'visibility', on() ? 'visible' : 'none'); if (on()) update(true); }
  return { add, update, show };
}
