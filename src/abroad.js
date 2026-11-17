// Trains to and from abroad (Max, 2026-11-17: "a unified solution for international trains", the look picked from a
// live sketch, 2026-11-18: "B" cuts in the line, the map's leg dashed and marching, flags yes).
// Trafikverket's data ends at the last Swedish station (Arvika, Ed, Hyllie, Storlien, Riksgränsen …) and names the
// foreign end only in FromLocation / ToLocation (No.osl, Dk.kh, De.ah …; measured 2026-11-17/18: 180–208 such trips a
// day, never a stop row abroad). The card adds a row for that end, the map a leg to it while the train is open.
// When the stop next to the border is cancelled ("Buss ersätter", "Inställt"; 2–25 trips a day) the trip does not go
// on: the row says so and the map draws no leg (docs/data.md).

// A station abroad: Trafikverket's CountryCode (src/trafikverket.js fetchStations) other than SE; without it (stations
// from an older file) the code's country prefix ("No.osl"; "Gä." is Swedish, so only these).
const PREFIX = /^(At|De|Dk|It|Nl|No|Pt)\./;
export const countryOf = (sig, st) => st?.country ?? (PREFIX.test(sig ?? '') ? sig.slice(0, 2).toUpperCase() : 'SE');
export const isAbroad = (sig, st) => Boolean(sig) && countryOf(sig, st) !== 'SE';

// The trip's ends abroad: { to, from }, each null or { dir, sig, name, country, lon, lat, cut, texts }.
// route: fetchRoute's (route.to / route.from: station codes; route.stops: one row per arrival or departure).
// station(sig) -> the station ({ name, lon, lat, country }) or undefined.
// cut: the Swedish stop next to the border is cancelled; texts: what Trafikverket says there.
export function abroadEnds(route, station) {
  const shown = (route?.stops ?? []).filter(s => s.advertised);
  const end = (sig, row, dir) => {
    const st = station(sig);
    if (!isAbroad(sig, st)) return null;
    return { dir, sig, name: st?.name ?? sig, country: countryOf(sig, st), lon: st?.lon ?? null, lat: st?.lat ?? null,
      cut: Boolean(row?.canceled), texts: row?.problems ?? [] };
  };
  return { to: end(route?.to, shown.at(-1), 'to'), from: end(route?.from, shown[0], 'from') };
}

// Flags, drawn from a few shapes (no pictures to load): the card's round dot (flagSvg) and the map's (drawFlag).
// cross: a Nordic cross; h / v: stripes across / down. Other countries: a plain ring (null).
const FLAGS = {
  NO: { cross: ['#ba0c2f', '#ffffff', '#00205b'] },
  DK: { cross: ['#c8102e', '#ffffff'] },
  DE: { h: ['#000000', '#dd0000', '#ffce00'] },
  AT: { h: ['#c8102e', '#ffffff', '#c8102e'] },
  NL: { h: ['#ae1c28', '#ffffff', '#21468b'] },
  IT: { v: ['#008c45', '#f4f5f0', '#cd212a'] },
  PT: { v: ['#046a38', '#da291c', '#da291c'] },
};
export const hasFlag = code => Boolean(FLAGS[code]);
// The flag in a w × h box: [ { x, y, w, h, fill } ] (the cross 3/8 from the left, as Nordic flags are).
function flagRects(code, w, h) {
  const f = FLAGS[code];
  if (!f) return null;
  if (f.cross) {
    const [bg, c1, c2] = f.cross, x = w * 0.3, y = h * 0.4, t1 = h * 0.25, t2 = h * 0.12;
    const out = [{ x: 0, y: 0, w, h, fill: bg }, { x: x - t1 / 2, y: 0, w: t1, h, fill: c1 }, { x: 0, y: y + h * 0.1 - t1 / 2, w, h: t1, fill: c1 }];
    if (c2) out.push({ x: x - t2 / 2, y: 0, w: t2, h, fill: c2 }, { x: 0, y: y + h * 0.1 - t2 / 2, w, h: t2, fill: c2 });
    return out;
  }
  const list = f.h ?? f.v, n = list.length;
  return list.map((fill, i) => (f.h ? { x: 0, y: (h / n) * i, w, h: h / n + 0.5, fill } : { x: (w / n) * i, y: 0, w: w / n + 0.5, h, fill }));
}
// An SVG of the flag filling a square (shown in a circle by CSS); '' for a country without one.
export function flagSvg(code) {
  const r = flagRects(code, 24, 24);
  return r ? `<svg viewBox="0 0 24 24" aria-hidden="true">${r.map(q => `<rect x="${q.x}" y="${q.y}" width="${q.w}" height="${q.h}" fill="${q.fill}"/>`).join('')}</svg>` : '';
}
// The map's round flag: a size × size canvas image, the flag in a circle with a ring (ring colour given).
export function drawFlag(code, size, ring) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d'), r = size / 2, edge = Math.max(2, size * 0.1);
  g.beginPath(); g.arc(r, r, r, 0, 2 * Math.PI); g.fillStyle = ring; g.fill();
  g.save(); g.beginPath(); g.arc(r, r, r - edge, 0, 2 * Math.PI); g.clip();
  for (const q of flagRects(code, size, size) ?? [{ x: 0, y: 0, w: size, h: size, fill: '#ffffff' }]) { g.fillStyle = q.fill; g.fillRect(q.x, q.y, q.w, q.h); }
  g.restore();
  return g.getImageData(0, 0, size, size);
}
