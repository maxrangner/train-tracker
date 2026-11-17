// How hard the page works, in numbers (Max, 2026-11-15: "Optimization is KEY here. No slow reloads, or bad
// framerates"). Runs the page in the test browser and prints:
//   start   how long until the trains are on screen
//   idle    nobody touching it, at zoom 5.5, 11 and 14, with no train open and with one open (followed): map frames
//           drawn a second, and how busy the page's main thread is (script, and all its work)
//   tap     a tap on a train close in: the longest frame and the biggest jump of the train on the screen in the
//           first second (the first tap of the page, then a second one)
//   back    the page hidden and shown again (as when switching windows or apps): the longest frame and the work
//           done in the first second back
// The test browser draws with the processor (no graphics chip), so its frame times are not the phone's or the PC's;
// the counts (frames drawn, work done) compare one version with another.
//   node tools/perf-check.mjs                 rush-hour replay, PC window (1400 x 850)
//   node tools/perf-check.mjs --phone         a phone's screen
//   node tools/perf-check.mjs --live          live data (needs the key)
//   node tools/perf-check.mjs --only idle     one part: start, idle, tap or back
//   node tools/perf-check.mjs --runs 5        tap, idle and back 5 times, each on a newly opened page: the page's
//                                             work used to swing from load to load (zoom 11: 13 % or 95 %; 2026-11-17)
import { launch, openMap, sleep, PHONE, address } from './lib/browser.mjs';

const args = process.argv.slice(2);
const live = args.includes('--live');
const size = args.includes('--phone') ? PHONE : { width: 1400, height: 850, deviceScaleFactor: 1 };
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const part = name => !only || only === name;
const runs = args.includes('--runs') ? Math.max(1, Number(args[args.indexOf('--runs') + 1]) || 1) : 1;
const STOCKHOLM = [18.0585, 59.3308];
const KARLBERG = [18.0345, 59.3405];   // trains away from a station's ring (a tap near one opens the station)
const base = { size, theme: 'dark', ...(live ? {} : { replay: true }) };

const browser = await launch();
const out = [];
const say = (...s) => { console.log(...s); out.push(s.join(' ')); };
say(`perf-check: ${live ? 'live' : 'replay 07:01'}, ${size.width} x ${size.height}`);

// Work done by the page between two moments (Chrome's own counters), as a share of the time.
async function counters(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.map(m => [m.name, m.value]));
}
const share = (a, b, key, seconds) => `${Math.round((b[key] - a[key]) / seconds * 100)}%`;

// Map frames drawn and frame times, recorded inside the page.
const startRecording = page => page.evaluate(() => {
  const rec = window.__perf = { draws: 0, frames: [], t0: performance.now() };
  window.__map.on('render', rec.onDraw = () => rec.draws++);
  let last = performance.now();
  const step = (ts) => { rec.frames.push(ts - last); last = ts; if (!rec.stop) requestAnimationFrame(step); };
  requestAnimationFrame(step);
});
const stopRecording = page => page.evaluate(() => {
  const rec = window.__perf;
  rec.stop = true;
  window.__map.off('render', rec.onDraw);
  const seconds = (performance.now() - rec.t0) / 1000;
  return { drawsPerSecond: rec.draws / seconds, longest: Math.max(0, ...rec.frames.slice(1)), seconds };
});

// The train nearest a place, and where it is on the screen.
const nearestTrain = (page, lonLat) => page.evaluate((C) => {
  const kx = Math.cos(C[1] * Math.PI / 180);
  let best = null;
  for (const x of window.__last3d ?? []) {
    const d = Math.hypot((x.lon - C[0]) * kx, x.lat - C[1]);
    if (!best || d < best.d) best = { d, id: x.id, lon: x.lon, lat: x.lat };
  }
  return best;
}, lonLat);
const onScreen = (page, lonLat) => page.evaluate((ll) => {
  const p = window.__map.project(ll), r = window.__map.getCanvas().getBoundingClientRect();
  return { x: r.left + p.x, y: r.top + p.y };
}, lonLat);
// Where train id is drawn now (the 3D layer's outline close in, else its simulated place).
const placeOf = (page, id) => page.evaluate((id) => {
  const x = (window.__last3d ?? []).find(t => t.id === id);
  return x ? [x.lon, x.lat] : null;
}, id);
const closePanel = page => page.evaluate(() => document.querySelector('#panel .panel-close')?.click());

if (part('start')) {
  const page = await browser.newPage();
  await page.setViewport(size);
  const t0 = Date.now();
  await page.goto(address(base.replay ? { replay: true, theme: 'dark' } : { theme: 'dark' }), { waitUntil: 'domcontentloaded' });
  let trainsAt = null, shownAt = null;
  while (Date.now() - t0 < 30000 && (trainsAt === null || shownAt === null)) {
    const s = await page.evaluate(() => ({ trains: (window.__trains?.count ?? 0) > 0, shown: document.getElementById('splash')?.hidden === true })).catch(() => ({}));
    if (s.trains && trainsAt === null) trainsAt = Date.now() - t0;
    if (s.shown && shownAt === null) shownAt = Date.now() - t0;
    await sleep(50);
  }
  say(`start   start screen gone after ${shownAt ?? '-'} ms, trains there after ${trainsAt ?? '-'} ms`);
  await page.close();
}

for (let run = 1; run <= runs && (part('idle') || part('tap') || part('back')); run++) {
  if (runs > 1) say(`run ${run} of ${runs}`);
  const page = await openMap(browser, { ...base, view: `11/${STOCKHOLM[1]}/${STOCKHOLM[0]}` });
  const cdp = await page.createCDPSession();
  await cdp.send('Performance.enable');

  if (part('tap')) {
    for (const which of ['first tap', 'second tap']) {
      await page.evaluate(C => window.__map.jumpTo({ center: C, zoom: 14 }), STOCKHOLM);
      await sleep(2500);
      const t = await nearestTrain(page, STOCKHOLM);
      if (!t) { say('tap     no train near Stockholm C'); break; }
      // put the train a little off the hold point, as when tapping one seen on the map
      await page.evaluate(([lon, lat]) => {
        const map = window.__map, p = map.project([lon, lat]);
        map.jumpTo({ center: map.unproject([p.x + 120, p.y + 90]) });
      }, [t.lon, t.lat]);
      await sleep(1200);
      const at = await onScreen(page, await placeOf(page, t.id));
      await page.evaluate((id) => {
        const rec = window.__tap = { pos: [], frames: [], at: [] };
        let last = performance.now();
        const t0 = last;
        const step = (ts) => {
          const x = (window.__last3d ?? []).find(t => t.id === id);
          const p = x ? window.__map.project([x.lon, x.lat]) : null;
          rec.pos.push(p && [p.x, p.y]);
          rec.frames.push(ts - last);
          rec.at.push(Math.round(ts - t0));
          last = ts;
          if (ts - t0 < 1000) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }, t.id);
      await page.mouse.click(at.x, at.y);
      await sleep(1300);
      const r = await page.evaluate(() => window.__tap);
      let jump = 0, jumpAt = 0;
      for (let i = 1; i < r.pos.length; i++) {
        const d = r.pos[i] && r.pos[i - 1] ? Math.hypot(r.pos[i][0] - r.pos[i - 1][0], r.pos[i][1] - r.pos[i - 1][1]) : 0;
        if (d > jump) { jump = d; jumpAt = r.at[i]; }
      }
      const end = r.pos.at(-1);
      const slowAt = r.frames.map((f, i) => (i > 0 && f > 33 ? `${r.at[i]}` : null)).filter(Boolean);
      const slow = slowAt.length;
      say(`tap     ${which.padEnd(10)} longest frame ${Math.round(Math.max(...r.frames.slice(1)))} ms, frames over 33 ms ${slow}${slow ? ` (ending at ${slowAt.join(', ')} ms)` : ''}, biggest jump ${jump.toFixed(1)} px (at ${jumpAt} ms), train ends at ${end ? end.map(Math.round).join(', ') : '-'}`);
      await closePanel(page);
      await sleep(800);
    }
  }

  if (part('idle')) {
    for (const zoom of [5.5, 11, 14]) {
      for (const open of [false, true]) {
        await closePanel(page);
        await page.evaluate(([C, z]) => window.__map.jumpTo({ center: C, zoom: z, bearing: 0, pitch: 0 }), [STOCKHOLM, zoom]);
        await sleep(2000);
        if (open) {
          const t = await nearestTrain(page, KARLBERG);
          await page.evaluate(([lon, lat]) => window.__map.jumpTo({ center: [lon, lat] }), [t.lon, t.lat]);
          await sleep(600);
          for (let tries = 0; tries < 3; tries++) {   // a moving train can slip from under a tap: try again
            const at = await onScreen(page, await placeOf(page, t.id));
            await page.mouse.click(at.x, at.y);
            await sleep(700);
            if (await page.evaluate(() => document.getElementById('panel')?.hidden === false)) break;
          }
          await sleep(2000);   // the glide is over
        }
        await startRecording(page);
        const a = await counters(cdp);
        await sleep(5000);
        const b = await counters(cdp);
        const r = await stopRecording(page);
        const openId = await page.evaluate(() => document.getElementById('panel')?.hidden === false);
        say(`idle    zoom ${String(zoom).padEnd(4)} ${open ? `train open${openId ? '' : ' (FAILED to open)'}` : 'nothing open'}`.padEnd(42) +
          `map frames ${r.drawsPerSecond.toFixed(0).padStart(3)}/s   script ${share(a, b, 'ScriptDuration', r.seconds).padStart(4)}   all work ${share(a, b, 'TaskDuration', r.seconds).padStart(4)}`);
      }
    }
    await closePanel(page);
  }

  if (part('back')) {
    // Hidden and shown again: the page's visibility, as the browser sets it when its window or tab is covered.
    for (const away of [3000, 12000]) {
      await page.evaluate(C => window.__map.jumpTo({ center: C, zoom: 11 }), STOCKHOLM);
      await sleep(1500);
      await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => {});
      const other = await browser.newPage();   // in front: the map's page is hidden
      await other.bringToFront();
      const hidden = await page.evaluate(() => document.visibilityState);
      await sleep(away);
      await page.bringToFront();
      const a = await counters(cdp);
      await startRecording(page);
      await sleep(1000);
      const r = await stopRecording(page);
      const b = await counters(cdp);
      await other.close();
      say(`back    after ${String(away / 1000).padStart(2)} s ${hidden === 'hidden' ? 'hidden' : `(page stayed ${hidden})`}: longest frame ${Math.round(r.longest)} ms, map frames ${r.drawsPerSecond.toFixed(0)}/s, script ${share(a, b, 'ScriptDuration', 1)}, all work ${share(a, b, 'TaskDuration', 1)}`);
    }
  }
  if (page.errors.length) say('errors  ' + page.errors.join(' | '));
  await page.close();
}
await browser.close();
