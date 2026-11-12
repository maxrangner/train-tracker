// Open the running page in Edge (no window), wait in real time, save a picture and print the console.
// Run (with `npm run dev` going):
//   node tools/shot.mjs [--wait 25] [--out shots/shot.png] [--size 900x1100] [--view zoom/lat/lon] [--tap] [--hash a=b&c=d] [--json trains.json]
// --view opens that place; --tap taps the moving train nearest the middle of the screen before the picture.
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean)
  .map(s => s.trim().split(/\s+/)).map(([k, v]) => [k, v ?? true]));
const wait = Number(args.wait ?? 25);
const out = args.out ?? 'shots/shot.png';
const [width, height] = String(args.size ?? '900x1100').split('x').map(Number);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width, height, deviceScaleFactor: width < 600 ? 2 : 1 });
page.on('console', m => { if (!m.text().startsWith('[vite]')) console.log(`[console.${m.type()}] ${m.text()}`); });
page.on('pageerror', e => console.log(`[page error] ${e.message}`));
page.on('response', r => { if (r.status() >= 400) console.log(`[http ${r.status()}] ${r.url().slice(0, 120)}`); });
page.on('requestfailed', r => console.log(`[request failed] ${r.url().slice(0, 120)} ${r.failure()?.errorText}`));

// --page demo/brands.html opens another page of the project (no status line there); --full takes the whole page.
// --hash train=toy&toysize=70 adds more to the address after the view.
const hash = [args.view && `view=${args.view}`, args.hash].filter(Boolean).join('&').replace(/^./, c => `#${c}`);
await page.goto(`${args.host ? `http://${args.host}/` : 'http://localhost:5173/'}${args.page ?? ''}${hash}`, { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, wait * 1000));

// --closeup zoom[/pitch[/angle]]: jump to the train nearest the middle and look at it from the side
// (angle: degrees between the camera's view and the train's direction; 90 = straight from the side).
if (args.closeup) {
  const [zoom, pitch = 62, angle = 70] = String(args.closeup).split('/').map(Number);
  const picked = await page.evaluate((zoom, pitch, angle) => {
    const map = window.__map;
    const c = map.getCenter();
    const data = map.getSource('trains')._data;
    const feats = (data.geojson ?? data).features;
    let best = null;
    for (const f of feats) {
      const [lon, lat] = f.geometry.coordinates;
      const d = Math.hypot((lon - c.lng) * Math.cos(lat * Math.PI / 180), lat - c.lat);
      if (!best || d < best.d) best = { d, lon, lat, id: f.properties.id, label: f.properties.label, bearing: f.properties.bearing ?? 0 };
    }
    if (!best) return null;
    map.jumpTo({ center: [best.lon, best.lat], zoom, pitch, bearing: best.bearing + angle });
    return best;
  }, zoom, pitch, angle);
  console.log('close-up of:', picked?.label);
  await new Promise(r => setTimeout(r, 3000));
  // The train glides on meanwhile: centre on it again just before the picture.
  if (picked) await page.evaluate((id) => {
    const map = window.__map, data = map.getSource('trains')._data;
    const f = (data.geojson ?? data).features.find(x => x.properties.id === id);
    if (f) map.jumpTo({ center: f.geometry.coordinates });
  }, picked.id);
  await new Promise(r => setTimeout(r, 600));
}

if (args.tap) {
  const pt = await page.evaluate(() => {
    const map = window.__map;
    const c = map.project(map.getCenter());
    const { width, height } = map.getCanvas().getBoundingClientRect();
    const all = map.queryRenderedFeatures([[0, 0], [width, height]], { layers: ['train-dots'] });
    const dots = all;
    if (!dots.length) return { none: true, seen: all.length };
    let best = null;
    for (const f of dots) {
      const p = map.project(f.geometry.coordinates);
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (!best || d < best.d) best = { d, x: p.x, y: p.y, label: f.properties.label };
    }
    return best;
  });
  if (!pt || pt.none) console.log(`no moving train on screen to tap (${pt?.seen ?? 0} dots seen)`);
  else {
    console.log('tapped:', pt.label);
    await page.mouse.click(pt.x, pt.y);
    await new Promise(r => setTimeout(r, 4000));
  }
}

if (!args.page) console.log('status line:', await page.$eval('#status', el => el.textContent));
// --json trains.json: also save the trains on screen (id, label, company, place in CSS pixels), e.g. to label a picture.
if (args.json) {
  const onScreen = await page.evaluate(() => {
    const map = window.__map, { width, height } = map.getCanvas().getBoundingClientRect();
    const data = map.getSource('trains')._data, feats = (data.geojson ?? data).features;
    const brand = new Map((window.__last3d ?? []).map(t => [t.id, t.brand ?? null]));
    return { zoom: map.getZoom(), pitch: map.getPitch(), lat: map.getCenter().lat, width, height,
      trains: feats.map((f) => {
        const p = map.project(f.geometry.coordinates);
        return { id: f.properties.id, label: f.properties.label, brand: brand.get(f.properties.id) ?? null, x: Math.round(p.x), y: Math.round(p.y) };
      }).filter(t => t.x >= 0 && t.y >= 0 && t.x <= width && t.y <= height) };
  });
  mkdirSync(dirname(args.json), { recursive: true });
  writeFileSync(args.json, JSON.stringify(onScreen));
}
mkdirSync(dirname(out), { recursive: true });
// .jpg / .webp pictures are smaller (quality 80).
await page.screenshot({ path: out, fullPage: Boolean(args.full), ...(/\.(jpe?g|webp)$/i.test(out) ? { quality: 80 } : {}) });
console.log('picture:', out);
await browser.close();

