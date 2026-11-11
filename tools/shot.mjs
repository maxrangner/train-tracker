// Open the running page in Edge (no window), wait in real time, save a picture and print the console.
// Run (with `npm run dev` going):
//   node tools/shot.mjs [--wait 25] [--out shots/shot.png] [--size 900x1100] [--view zoom/lat/lon] [--rail trv|osm|none] [--tap]
// --view opens that place; --tap taps the moving train nearest the middle of the screen before the picture.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
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

if (args.rail) await page.evaluateOnNewDocument(r => { try { localStorage.setItem('rail', r === 'none' ? 'null' : r); } catch {} }, args.rail);
await page.goto(`http://localhost:5173/${args.view ? `#view=${args.view}` : ''}`, { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, wait * 1000));

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

console.log('status line:', await page.$eval('#status', el => el.textContent));
mkdirSync(dirname(out), { recursive: true });
await page.screenshot({ path: out });
console.log('picture:', out);
await browser.close();
