// How smoothly do the drawn trains turn? Watches every moving train's drawn direction frame by frame for 20 s of the
// rush-hour replay and counts the frames with any turning and the size of each step. Smooth turning is many frames
// with tiny steps; a train "clicking" round a bend is few frames with steps of 1-4 degrees.
// (2026-11-12: before smooth turning 2,168 frames, 42 % of all turning in steps of 2° or more; after 63,500 and 4 %.)
// Run (with `npm run dev` going): node tools/turn-probe.mjs [--json]
import { launch, openMap, sleep } from './lib/browser.mjs';

const browser = await launch();
const page = await openMap(browser, { size: { width: 600, height: 600 }, replay: true, view: '9/59.33/18.06', theme: 'light', lang: 'en' });
await sleep(5000);
const steps = await page.evaluate(() => new Promise((done) => {
  const prev = new Map(), out = [];
  const t0 = performance.now();
  (function frame() {
    for (const t of window.__last3d ?? []) {
      const q = prev.get(t.id);
      if (q) {
        let d = Math.abs(t.bearing - q.bearing) % 360; if (d > 180) d = 360 - d;
        const moved = Math.hypot((t.lon - q.lon) * Math.cos(t.lat * Math.PI / 180), t.lat - q.lat) * 111195;
        if (moved > 0.05) out.push(d);
      }
      prev.set(t.id, { bearing: t.bearing, lon: t.lon, lat: t.lat });
    }
    if (performance.now() - t0 < 20000) requestAnimationFrame(frame); else done(out);
  })();
}));
await browser.close();

const turning = steps.filter(d => d > 0.01);
const sum = a => a.reduce((x, y) => x + y, 0);
const result = { frames: steps.length, framesTurning: turning.length,
  under05: turning.filter(d => d < 0.5).length, over2: turning.filter(d => d >= 2).length,
  shareInBigStepsPct: turning.length ? Math.round(100 * sum(turning.filter(d => d >= 2)) / sum(turning)) : 0 };
if (process.argv.includes('--json')) console.log(JSON.stringify(result));
else console.log(`frames of moving trains: ${result.frames}; with any turning: ${result.framesTurning} ` +
  `(under 0.5° a frame: ${result.under05}; 2° or more: ${result.over2}); ` +
  `share of all turning done in steps of 2° or more: ${result.shareInBigStepsPct} %`);
