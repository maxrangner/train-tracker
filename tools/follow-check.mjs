// Does the camera follow a tapped train? Taps the moving train nearest the middle, then measures (in screen pixels)
// how far the train sits from the point the camera keeps it at; then drags the map a little and far (since
// 2026-11-13 a drag keeps following and moves the point the train is kept at: the px after a drag are from the new
// point, so 0), and presses Follow again (back to the usual point).
// Run (with `npm run dev` going): node tools/follow-check.mjs [--view 12/59.33/18.06] [--size 400x800] [--wait 25] [--fastest]
// --fastest taps the fastest-moving train on screen instead of the one nearest the middle.
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH, PAGE } from './lib/browser.mjs';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean)
  .map(s => s.trim().split(/\s+/)).map(([k, v]) => [k, v ?? true]));
const view = args.view ?? '12/59.33/18.06';
const [width, height] = String(args.size ?? '400x800').split('x').map(Number);
const sleep = s => new Promise(r => setTimeout(r, s * 1000));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width, height, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log(`[page error] ${e.message}`));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warn') console.log(`[console.${m.type()}] ${m.text()}`); });
await page.goto(`${PAGE}#view=${view}`, { waitUntil: 'domcontentloaded' });
await sleep(Number(args.wait ?? 25));

// Where the train is drawn, against the camera's follow point (the middle of the padded view).
const measure = id => page.evaluate((id) => {
  const map = window.__map, src = map.getSource('trains');
  const f = (src._data?.geojson ?? src._data).features.find(x => x.properties.id === id);
  if (!f) return null;
  const at = map.project(f.geometry.coordinates), c = map.project(map.getCenter());
  return { off: Math.round(Math.hypot(at.x - c.x, at.y - c.y)), lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
}, id);
const button = () => page.$eval('.panel-follow', b => b.textContent).catch(() => '(no panel)');

// Pick the moving train nearest the middle: two readings 2 s apart.
const read = () => page.evaluate(() => {
  const map = window.__map, src = map.getSource('trains');
  const { width, height } = map.getCanvas().getBoundingClientRect();
  return (src._data?.geojson ?? src._data).features.map(f => ({ id: f.properties.id, label: f.properties.label, c: f.geometry.coordinates, p: map.project(f.geometry.coordinates) }))
    .filter(t => t.p.x > 20 && t.p.y > 60 && t.p.x < width - 20 && t.p.y < height - 20);
});
const a = await read(); await sleep(2); const b = new Map((await read()).map(t => [t.id, t]));
const moving = a.filter(t => b.has(t.id) && Math.hypot(b.get(t.id).p.x - t.p.x, b.get(t.id).p.y - t.p.y) > 0.5);
if (!moving.length) { console.log('no moving train on screen'); await browser.close(); process.exit(1); }
const moved = t => { const o = a.find(x => x.id === t.id); return Math.hypot(t.p.x - o.p.x, t.p.y - o.p.y); };
const pick = moving.map(t => b.get(t.id)).sort(args.fastest
  ? (x, y) => moved(y) - moved(x)
  : (x, y) => Math.hypot(x.p.x - width / 2, x.p.y - height / 2) - Math.hypot(y.p.x - width / 2, y.p.y - height / 2))[0];
console.log(`tapping ${pick.label} at ${Math.round(pick.p.x)},${Math.round(pick.p.y)} (${moving.length} moving trains on screen)`);
await page.mouse.click(pick.p.x, pick.p.y);

const watch = async (what, seconds) => {
  const offs = [];
  let first, last;
  for (let i = 0; i < seconds * 2; i++) {
    await sleep(0.5);
    const m = await measure(pick.id);
    if (m) { offs.push(m.off); first ??= m; last = m; }
  }
  const metres = first ? Math.round(Math.hypot((last.lon - first.lon) * Math.cos(first.lat * Math.PI / 180), last.lat - first.lat) * 111195) : 0;
  console.log(`${what}: px from the follow point ${offs.join(' ')} · the train went ${metres} m · button "${await button()}"`);
  return offs;
};
mkdirSync('shots', { recursive: true });
await watch('following, 10 s', 10);

// Smoothness while following, frame by frame: at every frame the map draws, where the followed train's 3D model
// (as the 3D layer drew it) and its ring sit on screen, against the follow point. Steady = 0 change between frames.
const frames = (zoom) => page.evaluate((id, zoom) => new Promise((done) => {
  const map = window.__map;
  map.jumpTo({ zoom });
  const out = [];
  let stopAt = null;
  const onRender = () => {
    const now = performance.now();
    stopAt ??= now + 5000;
    const c = map.project(map.getCenter());
    const t = (window.__last3d ?? []).find(x => x.id === id);
    const at = p => { const q = map.project(p); return [q.x - c.x, q.y - c.y]; };
    // The ring: the selection marker on top of the map (its middle, in the map's own pixels).
    const el = document.querySelector('.sel-train'), box = map.getCanvas().getBoundingClientRect();
    const r = el?.getBoundingClientRect();
    const ring = r ? [r.left + r.width / 2 - box.left - c.x, r.top + r.height / 2 - box.top - c.y] : null;
    out.push({ ms: now, model: t ? at([t.lon, t.lat]) : null, ring });
    if (now > stopAt) { map.off('render', onRender); done(out); }
  };
  map.on('render', onRender);
  map.triggerRepaint();
}), pick.id, zoom);
for (const zoom of [11, 15]) {
  const f = await frames(zoom);
  const jumps = (key) => {
    const d = [];
    for (let i = 1; i < f.length; i++) if (f[i][key] && f[i - 1][key]) d.push(Math.hypot(f[i][key][0] - f[i - 1][key][0], f[i][key][1] - f[i - 1][key][1]));
    d.sort((a, b) => a - b);
    return d.length ? `median ${d[d.length >> 1].toFixed(1)} px, 90 % ${d[Math.floor(d.length * 0.9)].toFixed(1)} px, max ${d[d.length - 1].toFixed(1)} px` : 'not drawn';
  };
  const fps = (f.length - 1) / ((f[f.length - 1].ms - f[0].ms) / 1000);
  console.log(`zoom ${zoom}: ${f.length} frames (${fps.toFixed(0)} a second); frame-to-frame jump of the 3D model ${jumps('model')}; of the ring ${jumps('ring')}`);
}
await page.evaluate(() => window.__map.jumpTo({ zoom: 12 }));
await page.screenshot({ path: 'shots/follow-1.png' });

const drag = async (dx, dy) => {
  await page.mouse.move(width / 2, height * 0.3);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(width / 2 + dx * i / 10, height * 0.3 + dy * i / 10); await sleep(0.03); }
  await page.mouse.up();
};
await drag(25, 10);
await watch('after a small drag (25 px)', 4);
await page.mouse.wheel({ deltaY: -300 });
await watch('after a wheel zoom in', 4);
await drag(-(width * 0.45), -(height * 0.25));
await watch('after a long drag (re-framed)', 4);
await page.screenshot({ path: 'shots/follow-2.png' });
await page.click('.panel-follow');
await watch('after pressing Follow', 4);
await page.screenshot({ path: 'shots/follow-3.png' });
await page.click('#panel .panel-close');   // the train card's × (Help and Settings have one too)
await sleep(1);
console.log(`after × : panel ${await page.$eval('#panel', el => el.hidden ? 'hidden' : 'open')}, padding`,
  await page.evaluate(() => JSON.stringify(window.__map.getPadding())));
await browser.close();
