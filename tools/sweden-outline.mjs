// Sweden's outline for the stats page's small map (src/stats-sweden.js; 2026-11-15): the land of the map's sea mask
// (public/sweden-mask.json, from tools/sweden-mask.mjs), thinned to about 2 km. Writes src/sweden-outline.json:
// [[lon, lat, lon, lat, ...], ...], one list per piece of land (the mainland with Öland, and Gotland), ~3 kB.
//   node tools/sweden-outline.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const fc = JSON.parse(readFileSync('public/sweden-mask.json', 'utf8'));
const rings = [];
for (const f of fc.features.filter(x => x.properties?.kind === 'mask'))   // the other feature repeats the land
  for (const r of f.geometry.coordinates) {
    const lons = r.map(c => c[0]);
    if (Math.min(...lons) <= -4.9 && Math.max(...lons) >= 44.9) continue;   // the box round the sea, not land
    rings.push(r);
  }
// Douglas-Peucker in degrees, longitude shrunk by cos(62°) (the middle of Sweden).
const K = Math.cos(62 * Math.PI / 180), TOL = 0.02;
function simplify(pts) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let far = -1, fd = 0;
    const ax = pts[a][0] * K, ay = pts[a][1], dx = pts[b][0] * K - ax, dy = pts[b][1] - ay, L = Math.hypot(dx, dy) || 1e-9;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] * K - ax) * dy - (pts[i][1] - ay) * dx) / L; if (d > fd) { fd = d; far = i; } }
    if (fd > TOL) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
// A ring starts and ends on the same point: split it at the point furthest from the start and thin both halves.
const closed = (r) => {
  let m = 1, md = 0;
  r.forEach((c, i) => { const d = Math.hypot((c[0] - r[0][0]) * K, c[1] - r[0][1]); if (d > md) { md = d; m = i; } });
  return [...simplify(r.slice(0, m + 1)), ...simplify(r.slice(m)).slice(1)];
};
const out = rings.map(r => closed(r).flatMap(c => [Math.round(c[0] * 1000) / 1000, Math.round(c[1] * 1000) / 1000]));
writeFileSync('src/sweden-outline.json', JSON.stringify(out) + '\n');
console.log(`src/sweden-outline.json: ${out.length} pieces of land, ${out.reduce((s, r) => s + r.length / 2, 0)} points, ${Math.round(JSON.stringify(out).length / 1024)} kB`);
