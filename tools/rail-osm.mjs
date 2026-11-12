// Download OpenStreetMap's railway lines in Sweden (through the free Overpass service) into public/rail-osm.geojson.
// Only running lines: railway=rail without a "service" tag (that tag marks yards, sidings and spurs).
// Run: node tools/rail-osm.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const QUERY = `[out:json][timeout:300];
area["ISO3166-1"="SE"][admin_level=2]->.se;
way["railway"="rail"][!"service"](area.se);
out tags geom;`;
const round = v => Math.round(v * 1e5) / 1e5;

const res = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'sparad (private prototype)' },
  body: 'data=' + encodeURIComponent(QUERY),
});
if (!res.ok) throw new Error(`Overpass answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
const data = await res.json();

const features = data.elements
  .filter(e => e.type === 'way' && e.geometry?.length >= 2)
  .map(e => ({
    type: 'Feature',
    properties: { id: e.id, usage: e.tags?.usage ?? null, name: e.tags?.name ?? null },
    geometry: { type: 'LineString', coordinates: e.geometry.map(p => [round(p.lon), round(p.lat)]) },
  }));

mkdirSync(new URL('../public/', import.meta.url), { recursive: true });
const out = new URL('../public/rail-osm.geojson', import.meta.url);
writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features }));
console.log(`saved ${features.length} lines to ${out.pathname} (OSM data as of ${data.osm3s?.timestamp_osm_base})`);
