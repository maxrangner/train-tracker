// What the 3D trains cost to draw, close in, on the rush-hour replay (2026-11-18, for the facets look; Max: "Wouldnt
// light and shadow affect fps?"). For toy and realistic trains, at a few places and zooms, prints how many trains
// are drawn as models, how many separate parts the last frames drew (each part is one call to the graphics chip),
// how many triangles, and the frames drawn a second and the longest frame over 5 seconds of nobody touching it.
// The test browser draws with the processor, so frame times are not the phone's; compare versions with each other.
//   node tools/model-cost.mjs                (PAGE=http://localhost:5197/ for another working folder's page)
import { launch, openMap, sleep } from './lib/browser.mjs';

const SPOTS = [
  { name: 'Stockholm C, zoom 14', center: [18.0585, 59.3308], zoom: 14 },
  { name: 'Stockholm C, zoom 15.5', center: [18.0585, 59.3308], zoom: 15.5 },
  { name: 'Malmö C, zoom 13.5', center: [13.0, 55.609], zoom: 13.5 },
];
const browser = await launch();
const rows = [];
for (const train of ['toy', 'real']) {
  const page = await openMap(browser, { size: { width: 1400, height: 850, deviceScaleFactor: 1 }, replay: true, theme: 'dark', train });
  for (const s of SPOTS) {
    await page.evaluate(({ center, zoom }) => window.__map.jumpTo({ center, zoom }), s);
    await sleep(2500);
    const r = await page.evaluate(async () => {
      const calls = [], tris = [], frames = [];
      let last = performance.now();
      const t0 = last;
      await new Promise((done) => {
        const step = (ts) => {
          frames.push(ts - last); last = ts;
          if (window.__3d) { calls.push(window.__3d.calls()); tris.push(window.__3d.triangles()); }
          if (ts - t0 < 5000) requestAnimationFrame(step); else done();
        };
        requestAnimationFrame(step);
      });
      const med = a => (a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : 0);
      return { calls: med(calls), triangles: med(tris), fps: frames.length / 5, longest: Math.round(Math.max(...frames.slice(1))) };
    });
    rows.push({ train, spot: s.name, ...r });
  }
  if (page.errors.length) console.log(`${train}: page errors:`, page.errors.slice(0, 3));
  await page.close();
}
await browser.close();
for (const r of rows) console.log(`${r.train.padEnd(5)} ${r.spot.padEnd(24)} parts ${String(r.calls).padStart(5)}  triangles ${String(r.triangles).padStart(8)}  frames/s ${r.fps.toFixed(1).padStart(5)}  longest ${r.longest} ms`);
