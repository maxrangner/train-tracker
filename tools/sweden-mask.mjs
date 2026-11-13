// Builds public/sweden-mask.json, so the map shows only Sweden (Max, 2026-11-13: "only Sweden visible", plain like
// the sea): everything outside Sweden's border is painted in the sea's colour, and the base map's names outside it
// are left out (src/map.js).
// Run: node tools/sweden-mask.mjs <sweden.geojson>
//   The file is OpenStreetMap's outline of Sweden (relation 52822), as GeoJSON, e.g. from
//   https://polygons.openstreetmap.fr/get_geojson.py?id=52822&params=0  (© OpenStreetMap contributors, ODbL)
//
// Why OpenStreetMap's outline: it is the border the base map itself is drawn from, so it fits exactly close in, and
// it includes Sweden's territorial waters, so every Swedish island and coast is inside it and the islands of the
// countries round it are outside (Natural Earth's countries, tried first, were 1-2 km off at Haparanda and left out
// the small islands off Norway, Åland and Estonia).
//
// Out: a FeatureCollection of two features:
//   kind 'mask':   the area round Sweden (BOX) with Sweden cut out, simplified to about 20-40 m;
//   kind 'sweden': Sweden, simplified to about 1 km, for the "is this name inside Sweden" test (fewer points, as it
//                  is copied into every label layer's filter).
import fs from 'node:fs';

const src = process.argv[2];
if (!src) { console.log('usage: node tools/sweden-mask.mjs <sweden.geojson>'); process.exit(1); }
const OUT = 'public/sweden-mask.json';
// The area painted: everything the map can be panned to (map.js MAX_BOUNDS), with room to spare.
const BOX = { w: -5, s: 50, e: 45, n: 74 };
const TOL_MASK = 0.0004, TOL_NAMES = 0.01;   // degrees

const g = JSON.parse(fs.readFileSync(src, 'utf8'));
const geom = g.type === 'FeatureCollection' ? g.features[0].geometry : g.type === 'Feature' ? g.geometry : g;
const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];

// Douglas-Peucker on a closed ring (its first and last point are the same and kept).
function simplify(line, tol) {
  if (line.length < 5) return line;
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack = [[0, line.length - 1]];
  // A closed ring: split at its farthest point from the start first, or the whole ring would be one "line".
  let far = 0, farD = -1;
  for (let k = 1; k < line.length - 1; k++) { const d = (line[k][0] - line[0][0]) ** 2 + (line[k][1] - line[0][1]) ** 2; if (d > farD) { farD = d; far = k; } }
  keep[far] = 1;
  stack.pop();
  stack.push([0, far], [far, line.length - 1]);
  while (stack.length) {
    const [i, j] = stack.pop();
    const [ax, ay] = line[i], [bx, by] = line[j];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let best = -1, bestD = tol * tol;
    for (let k = i + 1; k < j; k++) {
      const [px, py] = line[k];
      const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
      const d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
      if (d > bestD) { bestD = d; best = k; }
    }
    if (best > 0) { keep[best] = 1; stack.push([i, best], [best, j]); }
  }
  return line.filter((_, k) => keep[k]).map(p => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]);
}
// Twice the signed area (>0: counter-clockwise in lon/lat). The map tells holes from outer rings by their turn.
const area = r => r.reduce((a, p, i) => (i ? a + (r[i - 1][0] * p[1] - p[0] * r[i - 1][1]) : 0), 0);
const turn = (r, ccw) => ((area(r) > 0) === ccw ? r : [...r].reverse());

const outer = turn([[BOX.w, BOX.s], [BOX.e, BOX.s], [BOX.e, BOX.n], [BOX.w, BOX.n], [BOX.w, BOX.s]], true);
const holes = [], sweden = [];
let points = 0;
for (const poly of polys) {
  // Sweden's own outer ring(s) are the mask's holes; a hole in Sweden (none expected) would be painted again.
  holes.push(turn(simplify(poly[0], TOL_MASK), false));
  const rough = simplify(poly[0], TOL_NAMES);
  if (rough.length >= 4) sweden.push([turn(rough, true)]);
  points += poly[0].length;
}
const out = { type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { kind: 'mask' }, geometry: { type: 'Polygon', coordinates: [outer, ...holes] } },
  { type: 'Feature', properties: { kind: 'sweden' }, geometry: { type: 'MultiPolygon', coordinates: sweden } },
] };
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`${OUT}: Sweden ${points} points -> mask ${holes.flat().length}, names ${sweden.flat(2).length}; ` +
  `${(fs.statSync(OUT).size / 1024).toFixed(0)} kB`);
