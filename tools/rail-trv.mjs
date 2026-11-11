// Download Trafikverket's rail network (their open INSPIRE map service, no key) into public/rail-trv.geojson.
// Run: node tools/rail-trv.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = 'https://geo-inspire.trafikverket.se/MapService/wfs.axd/TN_RailTransportNetwork';
const PAGE = 2000;
const round = v => Math.round(v * 1e5) / 1e5;   // ~1 m

const features = [];
for (let start = 0; ; start += PAGE) {
  const url = `${BASE}?service=WFS&version=2.0.0&request=GetFeature&typeNames=tn-ra:RailwayLink` +
    `&srsName=urn:ogc:def:crs:EPSG::4326&count=${PAGE}&startIndex=${start}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} at ${start}`);
  const xml = await res.text();
  let n = 0;
  for (const m of xml.matchAll(/<tn-ra:RailwayLink[^>]*gml:id="([^"]+)"[\s\S]*?<\/tn-ra:RailwayLink>/g)) {
    n++;
    const coords = [];
    for (const pl of m[0].matchAll(/<gml:posList>([^<]+)<\/gml:posList>/g)) {
      const v = pl[1].trim().split(/\s+/).map(Number);
      for (let i = 0; i + 1 < v.length; i += 2) {
        const c = [round(v[i + 1]), round(v[i])];          // the service gives lat lon; GeoJSON wants lon lat
        const last = coords.at(-1);
        if (!last || last[0] !== c[0] || last[1] !== c[1]) coords.push(c);
      }
    }
    if (coords.length >= 2) features.push({ type: 'Feature', properties: { id: m[1] }, geometry: { type: 'LineString', coordinates: coords } });
  }
  console.log(`${start + n} links read`);
  if (n < PAGE) break;
}

mkdirSync(new URL('../public/', import.meta.url), { recursive: true });
const out = new URL('../public/rail-trv.geojson', import.meta.url);
writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features }));
console.log(`saved ${features.length} lines to ${out.pathname}`);
