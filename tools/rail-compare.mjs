// Which rail lines match where trains really are? For every recorded position, the distance to the nearest
// line in each source. Run: node tools/rail-compare.mjs [recording]
import { readFileSync, readdirSync } from 'node:fs';
import { netFromJSON } from '../src/rail-net.js';

const dir = new URL('../data/', import.meta.url);
const file = process.argv[2] ?? new URL(readdirSync(dir).filter(f => f.startsWith('positions-')).sort().at(-1), dir);
const positions = readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l))
  .map(p => p.Position.WGS84.match(/POINT \(([-\d.]+) ([-\d.]+)/).slice(1).map(Number));

// Local flat metres around Sweden's middle latitude: good to well under 1 % at these distances.
const LAT0 = 62, KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KY = 110574;
const CELL = 2000;   // grid cell size, metres

function index(geojson) {
  const grid = new Map();
  const segs = [];
  for (const f of geojson.features) {
    const c = f.geometry.coordinates;
    for (let i = 1; i < c.length; i++) {
      const s = [c[i - 1][0] * KX, c[i - 1][1] * KY, c[i][0] * KX, c[i][1] * KY];
      const id = segs.push(s) - 1;
      const x0 = Math.floor(Math.min(s[0], s[2]) / CELL), x1 = Math.floor(Math.max(s[0], s[2]) / CELL);
      const y0 = Math.floor(Math.min(s[1], s[3]) / CELL), y1 = Math.floor(Math.max(s[1], s[3]) / CELL);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const k = x + ',' + y;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(id);
      }
    }
  }
  return { grid, segs };
}

function nearest({ grid, segs }, [lon, lat]) {
  const px = lon * KX, py = lat * KY;
  const cx = Math.floor(px / CELL), cy = Math.floor(py / CELL);
  let best = Infinity;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    for (const id of grid.get((cx + dx) + ',' + (cy + dy)) ?? []) {
      const [ax, ay, bx, by] = segs[id];
      const vx = bx - ax, vy = by - ay, len2 = vx * vx + vy * vy;
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2)) : 0;
      const d = Math.hypot(px - ax - t * vx, py - ay - t * vy);
      if (d < best) best = d;
    }
  }
  return best;   // Infinity: over 2 km from any line
}

const pct = (a, q) => a[Math.min(a.length - 1, Math.floor(q * a.length))];
const f2 = v => v.toFixed(2);
console.log(`${positions.length} recorded positions`);
// net: the page's rail network (public/rail-net.json, simplified from trv by tools/rail-net.mjs).
for (const name of ['trv', 'net', 'osm']) {
  const g = name === 'net'
    ? netFromJSON(JSON.parse(readFileSync(new URL('../public/rail-net.json', import.meta.url), 'utf8'))).toGeoJSON()
    : JSON.parse(readFileSync(new URL(`../public/rail-${name}.geojson`, import.meta.url), 'utf8'));
  if (name === 'net') g.features = g.features[0].geometry.coordinates.map(c => ({ geometry: { coordinates: c } }));
  const idx = index(g);
  const d = positions.map(p => nearest(idx, p)).sort((a, b) => a - b);
  const share = lim => (100 * d.filter(v => v <= lim).length / d.length).toFixed(1);
  console.log(`${name}: ${g.features.length} lines; distance to nearest line: median ${pct(d, .5).toFixed(1)} m, ` +
    `(${f2(pct(d, .5))}), 90% within ${pct(d, .9).toFixed(1)} m (${f2(pct(d, .9))}), 99% within ${pct(d, .99).toFixed(0)} m; ` +
    `within 10 m: ${share(10)}%, within 25 m: ${share(25)}%, over 2 km: ${(100 * d.filter(v => v === Infinity).length / d.length).toFixed(1)}%`);
}
