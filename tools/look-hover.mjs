// Pictures, not a check: a train's label under the mouse on a computer (Max, 2026-11-25: "Hovering over a drop or train
// should show it's label"), and the map while pressed and held (its labels gone). node tools/look-hover.mjs <folder>
import { mkdirSync } from 'node:fs';
import { launch, openMap, sleep, CARD_HOUR } from './lib/browser.mjs';

const out = (process.argv[2] ?? 'shots/hover').replace(/\/$/, '');
mkdirSync(out, { recursive: true });
const browser = await launch();
try {
  const page = await openMap(browser, { size: { width: 1400, height: 900, deviceScaleFactor: 1 }, replay: CARD_HOUR, lang: 'sv' });
  await sleep(2500);
  await page.evaluate(() => window.__map.jumpTo({ center: [16.5, 59.6], zoom: 7.2 })); await sleep(2500);
  const dot = await page.evaluate(() => { for (const f of window.__map.queryRenderedFeatures({ layers: ['train-dots'] }).filter(f => !f.properties.point_count)) {
    const q = window.__map.project(f.geometry.coordinates); if (q.x > 600 && q.x < 1250 && q.y > 200 && q.y < 700) return { x: q.x, y: q.y }; } return null; });
  if (dot) {
    await page.mouse.move(dot.x, dot.y, { steps: 3 }); await sleep(500);
    await page.screenshot({ path: `${out}/hover.jpg`, quality: 88, clip: { x: dot.x - 200, y: dot.y - 120, width: 400, height: 240 } });
  }
  await page.mouse.move(1000, 450);
  await page.evaluate(() => window.__map.jumpTo({ center: [18.06, 59.33], zoom: 12.5 })); await sleep(2500);
  await page.screenshot({ path: `${out}/before-hold.jpg`, quality: 85, clip: { x: 500, y: 150, width: 800, height: 600 } });
  await page.mouse.down(); await sleep(500);
  await page.screenshot({ path: `${out}/held.jpg`, quality: 85, clip: { x: 500, y: 150, width: 800, height: 600 } });
  await page.mouse.up();
} finally { await browser.close(); }
console.log(`pictures in ${out}`);
