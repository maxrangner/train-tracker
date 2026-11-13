// Do the dots glide at the trains' speed? Reads where the page draws every train, twice, 2 s apart, and compares
// the drawn speed with the speed the train itself reported.
// Run (with `npm run dev` going): node tools/glide-check.mjs [wait seconds=40]
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH, PAGE } from './lib/browser.mjs';

const wait = Number(process.argv[2] ?? 40);
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
page.on('pageerror', e => console.log(`[page error] ${e.message}`));
await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, wait * 1000));

const read = () => page.evaluate(() => {
  const src = window.__map.getSource('trains');
  return src._data?.geojson ?? src._data;   // the data last given to setData
});
const a = await read();
await new Promise(r => setTimeout(r, 2000));
const b = await read();
const before = new Map(a.features.map(f => [f.properties.id, f.geometry.coordinates]));

const metres = ([lo1, la1], [lo2, la2]) => {
  const r = Math.PI / 180, x = (lo2 - lo1) * r * Math.cos((la1 + la2) / 2 * r), y = (la2 - la1) * r;
  return Math.hypot(x, y) * 6371000;
};
const speeds = [];
for (const f of b.features) {
  const p = before.get(f.properties.id);
  if (p) speeds.push(metres(p, f.geometry.coordinates) / 2 * 3.6);
}
speeds.sort((x, y) => x - y);
const moving = speeds.filter(s => s > 1);
const q = (arr, f) => arr[Math.floor(f * (arr.length - 1))]?.toFixed(0);
console.log(`${b.features.length} trains drawn; ${moving.length} moved in 2 s`);
console.log(`drawn speed of those moving: median ${q(moving, .5)} km/h, 10% ${q(moving, .1)}, 90% ${q(moving, .9)}, max ${q(moving, 1)}`);
console.log(`colours: ${JSON.stringify(b.features.reduce((m, f) => (m[f.properties.late] = (m[f.properties.late] ?? 0) + 1, m), {}))}`);
await browser.close();
