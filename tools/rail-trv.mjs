// Download Trafikverket's rail network (their open INSPIRE map service, no key) into data/rail-trv.geojson, and
// three of each track's properties into data/rail-trv-props.json: its design speed, whether it is public, and its
// traffic direction (tools/rail-net.mjs turns them into one digit per line, for routes that prefer main tracks and the
// right track of a double track; night of 2026-11-14, docs: night-1114/yard.md). Both files are rebuilt, not committed.
// Run: node tools/rail-trv.mjs [--props]   (--props: only the properties; the lines the trains follow stay as they are)
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = 'https://geo-inspire.trafikverket.se/MapService/wfs.axd/TN_RailTransportNetwork';
const PAGE = 2000;
const round = v => Math.round(v * 1e5) / 1e5;   // ~1 m

const sleep = ms => new Promise(r => setTimeout(r, ms));
// One page of a dataset, tried again a few times (the service sometimes answers with an error page).
async function page(type, start) {
  const url = `${BASE}?service=WFS&version=2.0.0&request=GetFeature&typeNames=${type}` +
    `&srsName=urn:ogc:def:crs:EPSG::4326&count=${PAGE}&startIndex=${start}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      if (!res.ok || text.includes('ExceptionReport')) throw new Error(`HTTP ${res.status}`);
      return text;
    } catch (e) {
      if (attempt >= 5) throw new Error(`${type} at ${start}: ${e.message}`);
      await sleep(4000 * attempt);
    }
  }
}
mkdirSync(new URL('../data/', import.meta.url), { recursive: true });   // (in data/ since 2026-11-18: in public/ they went into every build, 13 MB the page never loads)

// ---- The properties: per link, the pieces of it each value covers (from-to as shares of the link) ----
// Design speed: the length-weighted mean of the link's pieces, both directions together (0: none given).
// Access: 0 public, 1 private, 2 physically impossible, 3 not given. Direction: 0 both ways, 1 along the link's point
// order, 2 against it. (Trafikverket's own spelling of the type name: AccessRescriction.)
const ACCESS = { 'public access': 0, private: 1, 'physically impossible': 2 };
const FLOW = { 'both directions': 0, 'in direction': 1, 'in opposite direction': 2 };
async function property(type, valueOf) {
  const byLink = new Map(), seen = new Set();
  for (let start = 0; ; start += PAGE) {
    const xml = await page(type, start);
    let n = 0;
    for (const m of xml.matchAll(/<wfs:member>([\s\S]*?)<\/wfs:member>/g)) {
      n++;
      const gid = m[1].match(/gml:id="([^"]+)"/)?.[1];
      if (!gid || seen.has(gid)) continue;   // some come back twice
      seen.add(gid);
      const id = m[1].match(/[?&;]Id=([0-9a-fA-F-]+)/)?.[1]?.toLowerCase();
      if (!id) continue;
      const from = Number(m[1].match(/<net:fromPosition[^>]*>([^<]+)/)?.[1] ?? 0), to = Number(m[1].match(/<net:toPosition[^>]*>([^<]+)/)?.[1] ?? 1);
      (byLink.get(id) ?? byLink.set(id, []).get(id)).push({ share: Math.abs(to - from) || 1e-6, value: valueOf(m[1]) });
    }
    console.log(`${type}: ${start + n} read`);
    if (n < PAGE) break;
    await sleep(500);
  }
  return byLink;
}
{
  const text = re => m => m.match(re)?.[1]?.trim() ?? '';
  const speed = await property('tn-ra:DesignSpeed', m => Number(m.match(/<tn-ra:speed[^>]*>([^<]*)</)?.[1]));
  const access = await property('tn:AccessRescriction', text(/<tn:restriction[^>]*>([^<]*)</));
  const flow = await property('tn:TrafficFlowDirection', text(/<tn:direction[^>]*>([^<]*)</));
  const most = list => { const by = new Map(); for (const p of list ?? []) by.set(p.value, (by.get(p.value) ?? 0) + p.share); return [...by].sort((a, b) => b[1] - a[1])[0]?.[0]; };
  const links = {};
  for (const id of new Set([...speed.keys(), ...access.keys(), ...flow.keys()])) {
    const sp = (speed.get(id) ?? []).filter(p => Number.isFinite(p.value));
    const w = sp.reduce((s, p) => s + p.share, 0);
    links[id] = [w ? Math.round(sp.reduce((s, p) => s + p.share * p.value, 0) / w) : 0, ACCESS[most(access.get(id))] ?? 3, FLOW[most(flow.get(id))] ?? 0];
  }
  writeFileSync(new URL('../data/rail-trv-props.json', import.meta.url), JSON.stringify({
    about: 'Trafikverket (CC0), INSPIRE TN_RailTransportNetwork: per link [design speed km/h (0 none), access (0 public, 1 private, 2 impossible, 3 not given), direction (0 both, 1 along, 2 against)]; tools/rail-trv.mjs',
    links }));
  console.log(`saved the properties of ${Object.keys(links).length} links`);
}
if (process.argv.includes('--props')) process.exit(0);

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

const out = new URL('../data/rail-trv.geojson', import.meta.url);
writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features }));
console.log(`saved ${features.length} lines to ${out.pathname}`);
