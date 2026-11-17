// Our own background map (public-plan step 5): one file of Sweden's map pieces, cut out of OpenFreeMap's weekly
// world file, plus the style, lettering and icons as our own files, so the public page asks no outside map service.
//
//   node tools/map-file.mjs region            Sweden's outline with a margin, as squares: data/map/region.geojson
//   node tools/map-file.mjs cut [--source <url>] [--pmtiles <pmtiles.exe>]
//                                             cut Sweden out of the newest world file (or <url>):
//                                             data/map/sweden-<map date>.pmtiles (the date of OpenStreetMap's data)
//   node tools/map-file.mjs assets            OpenFreeMap's two styles (light: positron, dark: dark), their icons and
//                                             the Noto Sans lettering into public/map/
//   node tools/map-file.mjs show <file>       what a map file holds, and its size per zoom level
//
// The world file (~87 GB) is "clustered": the pmtiles tool reads only Sweden's parts of it over the internet.
// The pmtiles tool: go-pmtiles v1.31.2 for Windows, from github.com/protomaps/go-pmtiles/releases (checked against the
// release's sha256), kept outside the project; default D:/dev/tools/pmtiles/pmtiles.exe, or PMTILES=<path>.
//
// Licences: map data © OpenStreetMap contributors (ODbL); the map pieces © OpenMapTiles (CC BY 4.0), made by
// OpenFreeMap (MIT); the positron style: code BSD-3, design CC BY 4.0 (OpenMapTiles, from CARTO's, CC BY 3.0);
// Noto Sans: SIL Open Font License 1.1. All credited in index.html (About) and NOTICE.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const MAP_DIR = 'data/map';
const OUT = 'public/map';
const FILES = 'https://btrfs.openfreemap.com/files.txt';
const HOST = 'https://btrfs.openfreemap.com/';
const OFM = 'https://tiles.openfreemap.org';
const STYLES = { light: 'positron', dark: 'dark' };
const FONTS = ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'];
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const PMTILES = arg('--pmtiles') ?? process.env.PMTILES ?? 'D:/dev/tools/pmtiles/pmtiles.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Sweden with a margin of about 4 km, as rows of squares (0.04° east-west × 0.02° north-south, ~2.2 km): a square is
// kept when it is within 2 squares of one whose middle is inside Sweden. The outline is the mask's 'sweden' one (~1 km
// simplified); outside it the page paints the sea colour anyway (public/sweden-mask.json).
function region() {
  const mask = JSON.parse(fs.readFileSync('public/sweden-mask.json', 'utf8'));
  const sw = mask.features.find(f => f.properties.kind === 'sweden').geometry;
  const polys = sw.type === 'MultiPolygon' ? sw.coordinates : [sw.coordinates];
  const rings = polys.flat();
  let w = 180, e = -180, s = 90, n = -90;
  for (const r of rings) for (const [x, y] of r) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  const DX = 0.04, DY = 0.02, PAD = 2;
  const x0 = Math.floor(w / DX) * DX - PAD * DX, y0 = Math.floor(s / DY) * DY - PAD * DY;
  const nx = Math.ceil((e - x0) / DX) + PAD + 1, ny = Math.ceil((n - y0) / DY) + PAD + 1;
  // Inside: an even-odd test against every ring (holes count too), one row at a time.
  const inside = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const y = y0 + (j + 0.5) * DY;
    const xs = [];
    for (const r of rings) for (let k = 0, m = r.length - 1; k < r.length; m = k++) {
      const [ax, ay] = r[m], [bx, by] = r[k];
      if ((ay > y) !== (by > y)) xs.push(ax + (y - ay) / (by - ay) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * DX;
      let c = 0; for (const v of xs) if (v < x) c++;
      inside[j * nx + i] = c % 2;
    }
  }
  const keep = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!inside[j * nx + i]) continue;
    for (let dj = -PAD; dj <= PAD; dj++) for (let di = -PAD; di <= PAD; di++) {
      const jj = j + dj, ii = i + di;
      if (jj >= 0 && jj < ny && ii >= 0 && ii < nx) keep[jj * nx + ii] = 1;
    }
  }
  const boxes = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!keep[j * nx + i]) continue;
      let k = i; while (k + 1 < nx && keep[j * nx + k + 1]) k++;
      const a = +(x0 + i * DX).toFixed(4), b = +(x0 + (k + 1) * DX).toFixed(4);
      const c = +(y0 + j * DY).toFixed(4), d = +(y0 + (j + 1) * DY).toFixed(4);
      boxes.push([[[a, c], [b, c], [b, d], [a, d], [a, c]]]);
      i = k;
    }
  }
  fs.mkdirSync(MAP_DIR, { recursive: true });
  const file = `${MAP_DIR}/region.geojson`;
  fs.writeFileSync(file, JSON.stringify({ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: boxes } }));
  console.log(`${file}: ${boxes.length} strips, bounds ${x0.toFixed(2)},${y0.toFixed(2)} → ${(x0 + nx * DX).toFixed(2)},${(y0 + ny * DY).toFixed(2)}`);
  return file;
}

async function newestWorld() {
  const list = await (await fetch(FILES)).text();
  const runs = list.split('\n').filter(l => /^areas\/planet\/\d{8}_\d+_pt\/tiles\.pmtiles$/.test(l.trim())).map(l => l.trim()).sort();
  if (!runs.length) throw new Error('no world PMTiles file listed in ' + FILES);
  return HOST + runs[runs.length - 1];
}

function pm(args, opts = {}) {
  const r = spawnSync(PMTILES, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
  if (r.status !== 0) throw new Error(`pmtiles ${args[0]} failed: ${r.stderr || r.stdout}`);
  return r.stdout + r.stderr;
}

async function cut() {
  const src = arg('--source') ?? await newestWorld();
  const reg = fs.existsSync(`${MAP_DIR}/region.geojson`) ? `${MAP_DIR}/region.geojson` : region();
  const head = pm(['show', src]);
  const date = /osm_date (\d{4}-\d{2}-\d{2})/.exec(head)?.[1] ?? new Date().toISOString().slice(0, 10);
  if (!/clustered: true/.test(head)) throw new Error('the world file is not clustered: it cannot be cut over the internet');
  const out = `${MAP_DIR}/sweden-${date}.pmtiles`;
  console.log(`cutting ${src}\n  → ${out} (map data of ${date})`);
  const t0 = Date.now();
  const r = spawnSync(PMTILES, ['extract', src, out, `--region=${reg}`], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('pmtiles extract failed');
  console.log(`done in ${((Date.now() - t0) / 60000).toFixed(1)} min: ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
  show(out);
}

// The file's header, a check of its inside (pmtiles verify) and its size.
function show(file) {
  console.log(pm(['show', file]).split('\n').filter(l => /zoom|bounds|tiles count|entries|contents|clustered|osm_date/.test(l)).join('\n'));
  const r = spawnSync(PMTILES, ['verify', file], { encoding: 'utf8' });
  console.log('verify:', (r.stdout + r.stderr).trim().split('\n').slice(-2).join(' | '), `(exit ${r.status})`);
  console.log(`size: ${(fs.statSync(file).size / 1e6).toFixed(1)} MB`);
}

async function get(url, tries = 3) {
  for (let k = 1; ; k++) {
    try {
      const res = await fetch(url);
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      if (res.status === 404) return null;
      throw new Error(`${res.status}`);
    } catch (e) {
      if (k >= tries) throw new Error(`${url}: ${e.message}`);
      await sleep(2000 * k);
    }
  }
}

async function assets() {
  fs.mkdirSync(`${OUT}/sprites`, { recursive: true });
  for (const [look, name] of Object.entries(STYLES)) {
    const s = JSON.parse((await get(`${OFM}/styles/${name}`)).toString('utf8'));
    // No layer uses the shaded-relief pictures (checked 2026-11-17): dropped.
    delete s.sources.ne2_shaded;
    if (s.layers.some(l => l.source === 'ne2_shaded')) throw new Error(`${name}: a layer uses ne2_shaded`);
    // The page fills these in (src/map.js ownStyle): our map file, our lettering, our icons.
    s.sources.openmaptiles = { type: 'vector', url: 'pmtiles://MAP_FILE',
      attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' };
    s.glyphs = 'GLYPHS/{fontstack}/{range}.pbf';
    s.sprite = 'SPRITE';
    s.name = `Spårat ${look} (from OpenFreeMap ${name})`;
    fs.writeFileSync(`${OUT}/${look}.json`, JSON.stringify(s));
    console.log(`${OUT}/${look}.json: ${s.layers.length} layers`);
  }
  const sprite = `${OFM}/sprites/ofm_f384/ofm`;
  for (const f of ['.json', '.png', '@2x.json', '@2x.png']) {
    const b = await get(sprite + f);
    if (!b) throw new Error('missing ' + sprite + f);
    fs.writeFileSync(`${OUT}/sprites/ofm${f}`, b);
  }
  console.log(`${OUT}/sprites: 4 files`);
  // The lettering ranges the map's names need (public/map/fonts/ranges.json, from `inside`; all 256 ranges of the three
  // fonts would be 105 MB, and public/ goes into every build, the Android app too); one request at a time. Ranges
  // no longer needed are removed.
  const { ranges } = JSON.parse(fs.readFileSync(`${OUT}/fonts/ranges.json`, 'utf8'));
  let bytes = 0, files = 0, removed = 0;
  for (const font of FONTS) {
    const dir = `${OUT}/fonts/${font}`;
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) if (!ranges.includes(f.replace(/\.pbf$/, ''))) { fs.unlinkSync(`${dir}/${f}`); removed++; }
    for (const range of ranges) {
      const b = await get(`${OFM}/fonts/${encodeURIComponent(font)}/${range}.pbf`);
      if (!b) throw new Error(`missing ${font} ${range}`);
      fs.writeFileSync(`${dir}/${range}.pbf`, b);
      bytes += b.length; files++;
    }
  }
  console.log(`${OUT}/fonts: ${files} files, ${(bytes / 1e6).toFixed(2)} MB (${removed} old ones removed)`);
}

// Read every piece of a map file: its size per zoom level (repeats such as open sea counted each time), and the
// lettering ranges its shown names use. Only place, water and river names show on our map (src/map-look.js); the
// styles take a name from name:latin, name:nonlatin, name_en or name. Written to public/map/fonts/ranges.json, which
// `assets` reads (with a few ranges always kept: Latin and its extensions, punctuation, for our own labels' letters
// that Outfit hasn't). Names are counted from zoom 6 up: below it the pieces hold the world's continents and countries
// (Arabic, Chinese, Korean names), hidden outside Sweden on our map; every Swedish name is in the pieces from 6 up too.
const NAMES_FROM_ZOOM = 6;
const NAME_LAYERS = new Set(['place', 'water_name', 'waterway']);
const NAME_KEYS = new Set(['name:latin', 'name:nonlatin', 'name_en', 'name']);
const ALWAYS = ['0-255', '256-511', '512-767', '768-1023', '7680-7935', '8192-8447', '8448-8703', '8704-8959'];
async function inside(file) {
  const { PMTiles } = await import('pmtiles');
  const { PbfReader: Pbf } = await import('pbf');   // maplibre's own (pbf 5)
  const fd = fs.openSync(file, 'r');
  const src = { getKey: () => file, getBytes: async (offset, length) => {
    const b = Buffer.alloc(length); fs.readSync(fd, b, 0, length, offset);
    return { data: b.buffer.slice(b.byteOffset, b.byteOffset + length) };
  } };
  const p = new PMTiles(src);
  const h = await p.getHeader();
  const lonX = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
  const latY = (lat, z) => Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z);
  const ranges = new Set(ALWAYS), perZoom = [], chars = new Set();
  // A vector tile: layers (3) with name (1), features (2: tags 2), keys (3), values (4: string 1).
  // (A field not read is skipped by Pbf itself.)
  const layerField = (tag, l, pb) => {
    if (tag === 1) l.name = pb.readString();
    else if (tag === 3) l.keys.push(pb.readString());
    else if (tag === 4) { const v = { s: null }; pb.readMessage((t2, o, pb2) => { if (t2 === 1) o.s = pb2.readString(); }, v); l.values.push(v.s); }
    else if (tag === 2) pb.readMessage((t2, l2, pb2) => { if (t2 === 2) l2.tags.push(pb2.readPackedVarint()); }, l);
  };
  for (let z = h.minZoom; z <= h.maxZoom; z++) {
    let n = 0, bytes = 0;
    const [x0, x1] = [lonX(h.minLon, z), lonX(h.maxLon, z)], [y0, y1] = [latY(h.maxLat, z), latY(h.minLat, z)];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const r = await p.getZxy(z, x, y);
      if (!r) continue;
      n++; bytes += r.data.byteLength;
      const pbf = new Pbf(new Uint8Array(r.data));
      pbf.readFields((tag, _, pb) => {
        if (tag !== 3) return;
        const L = pb.readMessage(layerField, { name: '', keys: [], values: [], tags: [] });
        if (!NAME_LAYERS.has(L.name) || z < NAMES_FROM_ZOOM) return;
        for (const t of L.tags) for (let k = 0; k + 1 < t.length; k += 2) {
          if (!NAME_KEYS.has(L.keys[t[k]])) continue;
          const v = L.values[t[k + 1]];
          if (v) for (const c of v) chars.add(c.codePointAt(0));
        }
      }, null);
    }
    perZoom.push({ z, tiles: n, MB: +(bytes / 1e6).toFixed(1) });
  }
  fs.closeSync(fd);
  for (const c of chars) { const a = Math.floor(c / 256) * 256; ranges.add(`${a}-${a + 255}`); }
  const list = [...ranges].sort((a, b) => parseInt(a) - parseInt(b));
  console.table(perZoom);
  console.log(`${chars.size} different letters in the shown names; ranges: ${list.join(' ')}`);
  const odd = [...chars].filter(c => c > 1023 && !(c >= 7680 && c < 8960)).map(c => `${String.fromCodePoint(c)} U+${c.toString(16)}`);
  if (odd.length) console.log('outside Latin:', odd.slice(0, 40).join(', '));
  fs.mkdirSync(`${OUT}/fonts`, { recursive: true });
  fs.writeFileSync(`${OUT}/fonts/ranges.json`, JSON.stringify({ map: path.basename(file), ranges: list }, null, 1));
}

const cmd = process.argv[2];
if (cmd === 'inside') await inside(process.argv[3]);
else if (cmd === 'region') region();
else if (cmd === 'cut') await cut();
else if (cmd === 'assets') await assets();
else if (cmd === 'show') show(process.argv[3]);
else { console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('\n').slice(0, 13).join('\n')); process.exit(1); }
