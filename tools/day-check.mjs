// The map side of the build plan's parts 2, 4 and 5 in the test browser (2026-11-23): The day's ribbon, the scale
// slider and the sun's line. Run by tools/check.mjs; or alone: node tools/day-check.mjs (PAGE=<the dev page>).
// Needs the dev page running (npm run dev). Exit code 0: all good; 1: something failed (it says what); 2: no page.
// How: the rush-hour recording's history files (tools/history-files.mjs --end-now: its last slot ends where the slot
// running now begins), one of them taken away (a gap); a fetcher replaying the same recording for the live files
// (fetcher/main.mjs --replay --serve); a tiny server here hands out the history files from the folder (each a moment
// late, so the waiting shows), the day's overview made from them (named in the live files), and everything else from
// that fetcher. The page reads it with #files=. Every train is given the trip ends Cst → G.
// Checked:
//   The day: ☰ → The day opens the ribbon above the search bar (the sheet at rest, the slider and the buttons above
//   it); its bars come from the day's overview and no slot is fetched until shown (the taken one a gap, striped; the
//   ribbon starts at the first file); a drag back on the ribbon says "Loading…" and shimmers its slot until the file
//   is there, then shows that moment: the frame,
//   "hh:mm · earlier today" in the live mark's place, every train where its history file has it then (a few metres);
//   in the gap no trains; a tap on a train picks it: its label (number, its trip's ends Stockholm C → Göteborg C, no
//   time, no Follow), not over the train, and still while it plays; the map follows it (held on its focus as the
//   moment moves); its whole trip in the files as a line (its earlier slots fetched first; meanwhile no line, the
//   clock says Loading); one tap on the map lets it go, Esc takes the
//   bubble away; a train's page says "Only live" and its button goes back to live with the real page; play at ×600
//   plays on and comes back to live by itself; play at the live end starts an hour back; the speed slider's ×1 plays
//   in real time; pause; Live; × closes it; Esc steps back; ☰ → Rewind puts the bar in its place at once (the chips
//   back with it, nothing pushes it after); ☰'s menu shows over the ribbon. Without files (a replay): ☰ → The day says
//   it needs the server's files.
//   The slider: its three names (Sweden all of Sweden flat, Town zoom 11 flat, Trackside zoom 16.2 tilted 60°), the
//   compass only while turned or tilted, the thumb following a zoom by other means; a followed train stays where it
//   is held while the slider zooms.
//   The sun's line: its layer under the cover outside Sweden, Settings → Day and night hides it, night trains marked.
// Not checkable here: real speed (the test browser draws with the processor), a phone's touch on the ribbon.
import { mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as netServer } from 'node:net';
import { launch, sleep, PAGE, RUSH_HOUR } from './lib/browser.mjs';
import { waitForMap, until, openFromMenu, openMenu, toRest } from './lib/screen.mjs';
import { historyOf, historyCounts, HISTORY_MS } from '../src/live-file.js';
import { buildDaySum } from '../fetcher/files.mjs';

try { await fetch(PAGE); } catch { console.log(`day-check skipped: nothing answers at ${PAGE} (start it with npm run dev)`); process.exit(2); }
const HOLD = process.argv.includes('--hold');   // (keep the servers going and print the address: for pictures by hand)
const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); return ok; };
const freePort = () => new Promise((res, rej) => { const s = netServer().once('error', rej).listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

// ---- The files: history from the recording, live from a fetcher replaying it ----
const dir = join(tmpdir(), `sparat-day-check-${process.pid}`);
mkdirSync(dir, { recursive: true });
execFileSync(process.execPath, ['tools/history-files.mjs', RUSH_HOUR, '--out', dir, '--end-now'], { stdio: 'ignore' });
const names = readdirSync(dir).filter(f => /^history-\d+\.json$/.test(f)).sort();
const slots = names.map(f => Number(f.slice(8, -5)));
if (slots.length < 4) { console.log(`FAIL day-check: the recording gave ${slots.length} history files, 4 wanted`); process.exit(1); }
const GAP = slots[1];   // taken away: a gap
rmSync(join(dir, `history-${GAP}.json`));
// every train's trip ends (positions 11, 12; src/live-file.js historyRow), and the day's overview of the files left
for (const slot of slots) if (slot !== GAP) {
  const p = join(dir, `history-${slot}.json`), f = JSON.parse(readFileSync(p, 'utf8'));
  for (const r of f.trains) { r[11] = 'Cst'; r[12] = 'G'; }
  writeFileSync(p, JSON.stringify(f));
}
const daySum = JSON.stringify(buildDaySum(Date.now(), new Map(slots.filter(x => x !== GAP).map(x => [x, historyCounts(JSON.parse(readFileSync(join(dir, `history-${x}.json`), 'utf8')).trains)]))));
const SLOW_MS = 400;   // each history file this late (the page's waiting shows meanwhile)
const fileOf = slot => JSON.parse(readFileSync(join(dir, `history-${slot}.json`), 'utf8'));

const live = await freePort(), port = await freePort();
const fetcher = spawn(process.execPath, ['fetcher/main.mjs', '--env', '.env', '--replay', RUSH_HOUR, '--serve', String(live), '--minutes', HOLD ? '120' : '10'], { stdio: 'ignore' });   // (held for filming: long enough for a whole film)
const server = createServer(async (req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://x').pathname.slice(1));
  const head = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (name === 'daysum-test.json') { res.writeHead(200, head); return res.end(daySum); }
  if (/^history-\d+\.json$/.test(name)) {
    await sleep(SLOW_MS);
    const f = join(dir, name);
    if (!existsSync(f)) { res.writeHead(404, { ...head, 'Cache-Control': 'no-store' }); return res.end('{}'); }
    res.writeHead(200, head); return res.end(readFileSync(f));
  }
  try {
    const r = await fetch(`http://127.0.0.1:${live}/${name}`);
    res.writeHead(r.status, { ...head, 'Cache-Control': r.headers.get('cache-control') ?? 'no-store', ...(r.headers.get('date') ? { Date: r.headers.get('date') } : {}) });
    let body = Buffer.from(await r.arrayBuffer());
    // (the live file names the day's overview made here)
    if (r.ok && /^live-\d+\.json$/.test(name)) { const j = JSON.parse(body); j.files = { ...j.files, daysum: 'daysum-test.json' }; body = Buffer.from(JSON.stringify(j)); }
    res.end(body);
  } catch { res.writeHead(502, head); res.end('{}'); }
}).listen(port, '127.0.0.1');
const files = `http://localhost:${port}/`;
const stopAll = () => { fetcher.kill(); server.close(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* left */ } };
if (HOLD) { console.log(`holding: ${PAGE}#files=${files}  (history in ${dir}; gap at slot ${GAP}); Ctrl+C ends`); await new Promise(() => {}); }

// a live file there (the fetcher needs a few seconds)
const t0 = Date.now();
while (Date.now() - t0 < 30000) { const s = await fetch(`http://127.0.0.1:${live}/status`).then(r => r.json()).catch(() => null); if (s?.state?.trains > 50) break; await sleep(500); }

const browser = await launch();
try {
  const page = await waitForMap(browser, { files, view: '7/58.2/15.2', lang: 'en', theme: 'light', slider: '1' });
  expect(!page.errors.length, `errors on the page: ${page.errors.join(' | ')}`);
  const day = () => page.evaluate(() => window.__day?.state());

  // ---- The ribbon: in its place from its first frame (Max, 2026-11-27: the chips came back late and pushed it) ----
  await openMenu(page);
  await sleep(500);
  await page.evaluate(() => { window.__tops = []; const t0 = performance.now(); const f = () => { const d = document.getElementById('day'); if (d && !d.hidden) window.__tops.push(Math.round(d.getBoundingClientRect().top)); if (performance.now() - t0 < 1200) requestAnimationFrame(f); }; requestAnimationFrame(f); document.getElementById('open-day').click(); });
  const opened = await until(page, () => window.__day?.isOpen && !document.getElementById('day').hidden, 3000);
  expect(opened, '☰ → The day did not open the ribbon');
  await sleep(1300);
  const tops = await page.evaluate(() => [...new Set(window.__tops)]);
  expect(tops.length === 1, `the ribbon moved after it came: its top ${tops.join(' → ')}`);
  expect(await page.evaluate(() => !document.documentElement.classList.contains('chips-off')), 'the chips are not back with the ribbon');
  // the day's overview: every slot with a file, nothing fetched but the slot before the first (a gap: the ribbon then
  // starts at the first file)
  const known = await until(page, (want) => (window.__day.state().overview ?? []).join() === want.join(), 8000, slots.filter(x => x !== GAP));
  await sleep(SLOW_MS + 600);
  const st = await day();
  expect(known, `the day's overview not taken: ${JSON.stringify(st.overview)}`);
  const fetched = Object.keys(st.slots).map(Number);
  expect(fetched.every(x => x === slots[0] - 1), `slots fetched at opening (only the one before the first wanted): ${JSON.stringify(st.slots)}`);
  expect(Math.abs(st.start - slots[0] * HISTORY_MS) < 1000, `the ribbon starts at ${new Date(st.start).toISOString()}, not at the first file (${new Date(slots[0] * HISTORY_MS).toISOString()})`);
  // the bars there before any file: the last slot's part of the ribbon is coloured
  const barPx = await page.evaluate((l) => {
    const c = document.querySelector('#day canvas'), s = window.__day.state(), span = s.edge - s.start;
    const x0 = Math.ceil((l * 900000 - s.start) / span * c.width) + 2, x1 = Math.floor(((l + 1) * 900000 - s.start) / span * c.width) - 2;
    const d = c.getContext('2d').getImageData(x0, 0, Math.max(1, x1 - x0), c.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && (Math.abs(d[i] - d[i + 1]) > 30 || Math.abs(d[i + 1] - d[i + 2]) > 30)) n++;
    return n;
  }, slots.at(-1));
  expect(barPx > 50, `the last slot's bar is not drawn from the overview (${barPx} coloured pixels)`);
  const box = await page.evaluate(() => {
    const r = (s) => { const b = document.querySelector(s)?.getBoundingClientRect(); return b && { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
    return { day: r('#day'), sheet: r('#sheet'), scale: r('.scale'), geo: r('.maplibregl-ctrl-geolocate'), level: window.__stack.level };
  });
  expect(box.level === 0, `the sheet is not at rest with the ribbon open (level ${box.level})`);
  expect(box.day.bottom <= box.sheet.top + 1, `the ribbon (bottom ${box.day.bottom}) is not above the sheet (top ${box.sheet.top})`);
  expect(box.scale.bottom <= box.day.top && box.geo.bottom <= box.day.top + 1, `the slider (${box.scale.bottom}) or My location (${box.geo.bottom}) is not above the ribbon (${box.day.top})`);
  expect(box.geo.top >= box.scale.bottom - 1, `My location (${box.geo.top}) overlaps the slider (${box.scale.bottom})`);
  // the gap is drawn striped: its part of the ribbon has more than one colour
  const stripes = await page.evaluate((g) => {
    const c = document.querySelector('#day canvas'), s = window.__day.state(), span = s.edge - s.start;
    const x0 = Math.ceil((g * 900000 - s.start) / span * c.width) + 2, x1 = Math.floor(((g + 1) * 900000 - s.start) / span * c.width) - 2;
    const d = c.getContext('2d').getImageData(x0, 0, Math.max(1, x1 - x0), c.height).data, seen = new Set();
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 40) seen.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
    return seen.size;
  }, GAP);
  expect(stripes >= 1, `the gap is not drawn striped on the ribbon (${stripes} colours)`);

  // ---- Back in time: a drag on the ribbon ----
  const slot = slots[2], f = fileOf(slot);
  // a train with a point in the middle of that slot, moving
  const rows = f.trains.map(r => historyOf(r, f.t));
  const pick = rows.map(h => ({ h, p: h.points.find(p => p.time > f.t + 4 * 60000 && p.time < f.t + 11 * 60000 && (p.speed ?? 0) > 30) })).find(x => x.p);
  const dragTo = async (T) => {
    const pt = await page.evaluate((T) => { const r = document.querySelector('.day-track').getBoundingClientRect(), s = window.__day.state();
      return { x: r.left + (T - s.start) / (s.edge - s.start) * r.width, y: r.top + r.height / 2 }; }, T);
    await page.mouse.move(pt.x + 30, pt.y); await page.mouse.down(); await page.mouse.move(pt.x + 10, pt.y, { steps: 3 }); await page.mouse.move(pt.x, pt.y); await page.mouse.up();
  };
  await dragTo(pick.p.time);
  const wait1 = await page.evaluate(() => ({ clock: document.getElementById('day-clock').textContent, shimmer: !document.querySelector('#day .day-shimmer').hidden }));
  expect(/Loading/.test(wait1.clock) && wait1.shimmer, `a drag into a slot not fetched yet: the clock says "${wait1.clock}", the slot ${wait1.shimmer ? 'shimmers' : 'does not shimmer'}`);
  const loaded = await until(page, () => document.querySelector('#day .day-shimmer').hidden && !/Loading/.test(document.getElementById('day-clock').textContent), 4000);
  expect(loaded, 'the waiting did not end when the file came');
  const fetchedNow = Object.keys((await day()).slots).length;
  expect(fetchedNow <= 5, `a drag fetched ${fetchedNow} slots (its own and its neighbours wanted)`);
  const past = await until(page, () => window.__day.past, 2000);
  expect(past, 'a drag back on the ribbon did not show an earlier moment');
  const T = (await day()).T;
  expect(Math.abs(T - pick.p.time) < 3 * 60000, `the drag landed at ${new Date(T).toISOString()}, wanted about ${new Date(pick.p.time).toISOString()}`);
  const look = await page.evaluate(() => ({ frame: !document.getElementById('day-frame').hidden, clock: document.getElementById('day-clock').textContent,
    clockShown: !document.getElementById('day-clock').hidden, status: getComputedStyle(document.getElementById('status')).visibility }));
  expect(look.frame, 'no frame round the map at an earlier moment');
  expect(look.clockShown && /^\d\d:\d\d · (earlier today|yesterday)/.test(look.clock), `the clock at the top says "${look.clock}"`);
  expect(look.status === 'hidden', 'the live mark still shows at an earlier moment');
  // exactly at the point: the train is drawn where its file has it
  await page.evaluate(t => window.__day.seek(t), pick.p.time);
  await sleep(600);
  const drawn = await page.evaluate(id => (window.__last3d ?? []).find(x => x.id === id) ?? null, pick.h.id);
  const off = drawn ? Math.hypot((drawn.lon - pick.p.lon) * Math.cos(pick.p.lat * Math.PI / 180), drawn.lat - pick.p.lat) * 111195 : Infinity;
  expect(off < 15, `train ${pick.h.number} is drawn ${Math.round(off)} m from where its history file has it at that moment`);
  const count = await page.evaluate(() => (window.__last3d ?? []).length);
  const inFile = rows.filter(h => h.from <= pick.p.time && h.until + 60000 >= pick.p.time).length;
  expect(Math.abs(count - inFile) <= Math.max(3, inFile * 0.02), `${count} trains drawn, the file has ${inFile} at that moment`);
  // moving the moment moves the train
  await page.evaluate(t => window.__day.seek(t), pick.p.time + 60000);
  await sleep(500);
  const later = await page.evaluate(id => (window.__last3d ?? []).find(x => x.id === id) ?? null, pick.h.id);
  expect(later && Math.hypot(later.lon - drawn.lon, later.lat - drawn.lat) > 0.002, `train ${pick.h.number} did not move with the moment`);

  // ---- The bubble ----
  await page.evaluate(t => window.__day.seek(t), pick.p.time);
  await page.evaluate(p => window.__map.jumpTo({ center: [p.lon, p.lat], zoom: 12 }), pick.p);
  await sleep(900);
  const at = await page.evaluate(p => window.__map.project([p.lon, p.lat]), pick.p);
  await page.mouse.click(at.x, at.y);
  await sleep(400);
  const bubble = await page.evaluate(() => ({ shown: !document.getElementById('day-bubble').hidden, text: document.getElementById('day-bubble').textContent, top: window.__stack.top(),
    picked: window.__day.picked, following: Boolean(window.__followFocus?.()), button: Boolean(document.querySelector('#day-bubble button')) }));
  expect(bubble.shown && bubble.text.includes(String(pick.h.number)), `a tap on train ${pick.h.number} at an earlier moment: bubble ${bubble.shown ? `"${bubble.text}"` : 'not shown'}`);
  expect(bubble.top === 'home', `a tap on a train at an earlier moment opened a page (${bubble.top})`);
  expect(bubble.picked === pick.h.id && bubble.following && !bubble.button, `a tap on train ${pick.h.number} at an earlier moment: picked ${bubble.picked}, followed ${bubble.following}, a button in its label ${bubble.button}`);
  expect(/Stockholm C → Göteborg C/.test(bubble.text) && !/at \d\d:\d\d/.test(bubble.text), `the label: "${bubble.text}" (its trip's ends wanted, no time)`);
  // its whole trip in the files on the map (Max, 2026-11-27: "Either all or nothing"): the slots before fetched while it
  // has a row in them, then a line from its first point there to the train
  const done = await until(page, () => !window.__day.state().walking && Boolean(window.__map.getSource('day-trail')?.serialize?.().data?.geometry), 8000);
  const trail = await page.evaluate((id) => {
    const d = window.__map.getSource('day-trail')?.serialize?.().data, lines = d?.geometry?.coordinates ?? [], end = lines.at(-1)?.at(-1);
    const x = (window.__last3d ?? []).find(t => t.id === id);
    return { first: lines[0]?.[0] ?? null, points: lines.flat().length, off: end && x ? Math.hypot((end[0] - x.lon) * 0.5, end[1] - x.lat) * 111195 : null };
  }, pick.h.id);
  let firstSlot = slot;   // (its first point: back from the moment's slot while its files have it; the gap stops it)
  while (slots.includes(firstSlot - 1) && firstSlot - 1 !== GAP && fileOf(firstSlot - 1).trains.some(r => r[0] === pick.h.id)) firstSlot--;
  const ff = fileOf(firstSlot), fp = historyOf(ff.trains.find(r => r[0] === pick.h.id), ff.t).points[0];
  const fromOff = trail.first ? Math.hypot((trail.first[0] - fp.lon) * 0.5, trail.first[1] - fp.lat) * 111195 : null;
  expect(done && trail.points >= 3 && trail.off !== null && trail.off < 300 && fromOff !== null && fromOff < 5,
    `the picked train's whole trip: ${JSON.stringify({ ...trail, fromOff, firstSlot: firstSlot - slot })}`);
  // followed as the moment moves: held on its focus (src/map.js window.__followFocus)
  const onFocus = () => page.evaluate((id) => {
    const x = (window.__last3d ?? []).find(t => t.id === id), f = window.__followFocus?.();
    if (!x || !f) return null;
    const p = window.__map.project([x.lon, x.lat]);
    return Math.hypot(p.x - f.x, p.y - f.y);
  }, pick.h.id);
  await sleep(1200);
  await page.evaluate(t => window.__day.seek(t, { keep: true }), pick.p.time + 90000);
  await sleep(1500);
  const heldPx = await onFocus();
  expect(heldPx !== null && heldPx < 4, `the followed train at an earlier moment is ${heldPx === null ? "not followed" : `${Math.round(heldPx)} px off where it is held`} after the moment moved`);
  // the bubble beside the train, not over it (its box clear of the train's point by its ring), and still while it plays
  // followed (Max, 2026-11-27: "Following label covers the train"; "the label jitter when moving")
  const clear = await page.evaluate((id) => {
    const x = (window.__last3d ?? []).find(t => t.id === id), b = document.getElementById('day-bubble').getBoundingClientRect();
    const p = x && window.__map.project([x.lon, x.lat]);
    return p && { dx: Math.max(b.left - p.x, p.x - b.right, 0), dy: Math.max(b.top - p.y, p.y - b.bottom, 0), side: window.__day.state().side };
  }, pick.h.id);
  expect(clear && Math.max(clear.dx, clear.dy) >= 8, `the bubble covers the train: ${JSON.stringify(clear)}`);
  await page.evaluate(() => { const el = document.querySelector('#day .day-speed'); el.value = '1'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#day .day-play');
  const moves = await page.evaluate(() => new Promise((res) => {
    const seen = []; const t0 = performance.now();
    const f = () => { const b = document.getElementById('day-bubble').getBoundingClientRect(); seen.push([b.left, b.top, window.__day.state().side, b.width, b.height]); if (performance.now() - t0 < 1500) requestAnimationFrame(f); else res(seen); };
    requestAnimationFrame(f);
  }));
  await page.click('#day .day-play');
  // (a station's name coming under it moves it to another side, as the live label: counted apart, a few at most)
  let steps = 0, most = 0, flips = 0;
  for (let i = 1; i < moves.length; i++) {
    if (moves[i][2] !== moves[i - 1][2]) { flips++; continue; }
    const d = Math.hypot(moves[i][0] - moves[i - 1][0], moves[i][1] - moves[i - 1][1]);
    if (d > 0) steps++;
    most = Math.max(most, d);
  }
  expect(steps <= 3 && most <= 2 && flips <= 2, `the bubble of a followed train playing ×10 moved in ${steps} of ${moves.length} frames, at most ${most.toFixed(2)} px; changed sides ${flips} times`);
  // one tap on the map lets it go (its label and line go, the map stops following)
  const emptyAt = await page.evaluate(() => (innerWidth > 600 ? { x: innerWidth - 120, y: innerHeight - 120 } : { x: 30, y: 120 }));
  await page.mouse.click(emptyAt.x, emptyAt.y);
  await sleep(500);
  const tap1 = await page.evaluate(() => ({ picked: window.__day.picked, hidden: document.getElementById('day-bubble').hidden, following: Boolean(window.__followFocus?.()),
    line: Boolean(window.__map.getSource('day-trail')?.serialize?.().data?.geometry) }));
  expect(!tap1.picked && tap1.hidden && !tap1.following && !tap1.line, `a tap on the map did not let the train go: ${JSON.stringify(tap1)}`);
  await page.evaluate(t => window.__day.seek(t), pick.p.time);
  await page.evaluate(p => window.__map.jumpTo({ center: [p.lon, p.lat], zoom: 12 }), pick.p);
  await sleep(900);
  const at2 = await page.evaluate(p => window.__map.project([p.lon, p.lat]), pick.p);
  await page.mouse.click(at2.x, at2.y);
  await sleep(400);
  await page.keyboard.press('Escape');
  await sleep(200);
  expect(await page.evaluate(() => document.getElementById('day-bubble').hidden && !window.__day.picked && !window.__followFocus?.()), 'Esc did not take the bubble away and let the train go');

  // ---- The gap: no trains ----
  await page.evaluate(t => window.__day.seek(t), GAP * HISTORY_MS + 7 * 60000);
  await page.evaluate(() => window.__map.jumpTo({ center: [15.2, 58.2], zoom: 5 }));
  await sleep(600);
  // (only the trains the next file has on the map from a report older than this moment: standing with no new report)
  const gapT = GAP * HISTORY_MS + 7 * 60000, inGap = await page.evaluate(() => (window.__last3d ?? []).length);
  const before = fileOf(slots[0]), next = fileOf(slots[2]);
  const around = [...before.trains.map(r => historyOf(r, before.t)).filter(h => h.until + 60000 >= gapT),
    ...next.trains.map(r => historyOf(r, next.t)).filter(h => Math.min(h.from, h.points[0]?.time ?? h.from) <= gapT)].length;
  expect(inGap === around && inGap < count / 5, `${inGap} trains drawn in the gap (no file), ${around} known there from the files around it`);

  // ---- "Only live" on a train's page ----
  await page.evaluate(t => window.__day.seek(t), pick.p.time);
  await sleep(300);
  const liveId = await page.evaluate(() => window.__trains.reports()[0]?.id);
  await page.evaluate(id => window.__stack.open(`train:${id}`), liveId);
  await sleep(500);
  const only = await page.evaluate(() => { const el = document.querySelector('#sheet .pg:last-child .only-live'); return { text: el?.textContent ?? '', top: window.__stack.top() }; });
  expect(/Only live/.test(only.text), `a train's page at an earlier moment: "${only.text}" (${only.top})`);
  await page.evaluate(() => document.querySelector('#sheet .only-live-go')?.click());
  await sleep(800);
  const real = await page.evaluate(() => ({ past: window.__day.past, top: window.__stack.top(), panel: Boolean(document.querySelector('#sheet .pg #panel')) }));
  expect(!real.past && real.top === `train:${liveId}` && real.panel, `"Back to live": ${JSON.stringify(real)}`);
  await toRest(page);

  // ---- Playing fast ----
  const speedTo = i => page.evaluate((i) => { const el = document.querySelector('#day .day-speed'); el.value = String(i); el.dispatchEvent(new Event('input', { bubbles: true })); }, i);
  await page.evaluate(t => window.__day.seek(t), slots[2] * HISTORY_MS);
  await speedTo(4);
  await page.click('#day .day-play');
  await sleep(1500);
  const playing = await day();
  expect(playing.rate === 600 && playing.T > slots[2] * HISTORY_MS + 4 * 60000, `×600: ${playing.rate}, moved ${Math.round((playing.T - slots[2] * HISTORY_MS) / 60000)} min in 1.5 s`);
  const ended = await until(page, () => !window.__day.past, 15000);
  expect(ended, '×600 did not come back to live at the end of the files');
  // play at the live end: from an hour back; ×1 real time; pause
  await speedTo(0);
  await page.click('#day .day-play');
  await sleep(1200);
  const hour = await day();
  expect(hour.T !== null && hour.rate === 1 && Math.abs(hour.edge - hour.T - 3600000) < 60000, `play at the live end, ×1: rate ${hour.rate}, ${hour.T === null ? 'live' : `${Math.round((hour.edge - hour.T) / 60000)} min back`}`);
  const a = (await day()).T; await sleep(2000); const b = (await day()).T;
  expect(b - a > 1000 && b - a < 4000, `×1 moved ${Math.round((b - a) / 100) / 10} s in 2 s`);
  await page.click('#day .day-play');
  await sleep(300);
  const c = (await day()).T; await sleep(800); const d = (await day()).T;
  expect((await day()).rate === 0 && c === d, `pause: rate ${(await day()).rate}, moved ${d - c} ms`);
  await page.click('#day .day-live');
  await sleep(300);
  const back = await page.evaluate(() => ({ past: window.__day.past, frame: !document.getElementById('day-frame').hidden, status: getComputedStyle(document.getElementById('status')).visibility,
    trail: window.__map.getSource('day-trail')?.serialize?.().data?.features?.length ?? 0 }));
  expect(!back.past && !back.frame && back.status === 'visible' && !back.trail, `Live: ${JSON.stringify(back)}`);
  // ☰'s menu over the ribbon (Max, 2026-11-27: "Menu is hidden behind the rewind UI")
  await openMenu(page);
  const onTop = await page.evaluate(() => {
    const n = document.getElementById('nav').getBoundingClientRect(), d = document.getElementById('day').getBoundingClientRect();
    const l = Math.max(n.left, d.left) + 4, r = Math.min(n.right, d.right) - 4, t = Math.max(n.top, d.top) + 4, b = Math.min(n.bottom, d.bottom) - 4;
    if (r <= l || b <= t) return 'apart';
    return document.elementFromPoint((l + r) / 2, (t + b) / 2)?.closest('#nav, #day')?.id ?? 'neither';
  });
  expect(onTop === 'nav' || onTop === 'apart', `☰'s menu with the ribbon open: ${onTop} on top where they meet`);
  await page.click('#nav-button');
  await until(page, () => document.getElementById('nav').hidden, 3000);
  // × closes; Esc too
  await page.click('#day .day-x');
  await sleep(300);
  expect(await page.evaluate(() => document.getElementById('day').hidden && !document.documentElement.classList.contains('day-open')), '× did not close the ribbon');
  await openFromMenu(page, 'day');
  await sleep(300);
  await page.keyboard.press('Escape');
  await sleep(300);
  expect(await page.evaluate(() => document.getElementById('day').hidden), 'Esc did not close the ribbon');

  // ---- The sun's line ----
  const sun = await page.evaluate(() => { const ids = window.__map.getStyle().layers.map(l => l.id); return { sun: ids.indexOf('sun'), mask: ids.indexOf('sweden-mask'), vis: window.__map.getLayoutProperty('sun', 'visibility') }; });
  expect(sun.sun >= 0 && sun.sun < sun.mask && sun.vis === 'visible', `the sun's layer: ${JSON.stringify(sun)}`);
  await page.evaluate(() => window.__stack.open('page:settings'));
  await sleep(400);
  await page.evaluate(() => document.querySelector('.seg[data-key="dayNight"] [data-v="false"]').click());
  await sleep(300);
  expect(await page.evaluate(() => window.__map.getLayoutProperty('sun', 'visibility')) === 'none', 'Settings → Day and night off did not hide the sun\'s line');
  await page.evaluate(() => document.querySelector('.seg[data-key="dayNight"] [data-v="true"]').click());
  await toRest(page);

  // ---- The slider ----
  const camera = () => page.evaluate(() => ({ z: window.__map.getZoom(), p: window.__map.getPitch(), min: window.__map.getMinZoom(),
    turned: document.getElementById('map').classList.contains('turned'), compass: Boolean(document.querySelector('.maplibregl-ctrl-compass')?.offsetParent) }));
  await page.evaluate(() => window.__map.jumpTo({ center: [18.06, 59.33], zoom: 8 }));
  for (const [stop, z, p] of [['town', 11, 0], ['trackside', 16.2, 60], ['sweden', null, 0]]) {
    await page.click(`.scale-name[data-stop="${stop}"]`);
    await sleep(1400);
    const c = await camera();
    expect(Math.abs(c.z - (z ?? c.min)) < 0.05 && Math.abs(c.p - p) < 1, `the slider's ${stop}: zoom ${c.z.toFixed(2)}, tilt ${c.p.toFixed(0)}`);
    expect(c.compass === c.turned && c.turned === p > 0.5, `the compass at ${stop}: ${c.compass ? 'shown' : 'hidden'}, map ${c.turned ? 'tilted' : 'flat'}`);
  }
  await page.evaluate(() => window.__map.jumpTo({ zoom: 9 }));
  await sleep(300);
  const thumb = await page.evaluate(() => ({ f: Number(getComputedStyle(document.querySelector('.scale')).getPropertyValue('--f')), z: window.__map.getZoom(), min: window.__map.getMinZoom() }));
  const want = (thumb.z - thumb.min) / (11 - thumb.min) * 0.5;
  expect(Math.abs(thumb.f - want) < 0.02, `the thumb didn't follow a zoom by other means (${thumb.f}, wanted ${want.toFixed(3)})`);
  // a followed train stays where it is held while the slider zooms (on its focus: src/map.js window.__followFocus)
  const fol = await page.evaluate(() => window.__trains.reports().filter(r => !r.gone && (r.speed ?? 0) > 20).map(r => r.id));
  const offFocus = id => page.evaluate((id) => {
    const x = (window.__last3d ?? []).find(t => t.id === id), f = window.__followFocus?.();
    if (!x || !f) return null;
    const p = window.__map.project([x.lon, x.lat]);
    return Math.hypot(p.x - f.x, p.y - f.y);
  }, id);
  let held = null, moved = null;
  for (const id of fol.slice(0, 20)) {
    if (!await page.evaluate(id => window.__stack.open(`train:${id}`), id)) continue;
    await sleep(2000);
    if (!await page.evaluate(() => document.querySelector('#sheet .sh-follow[aria-pressed="true"]'))) continue;
    const a = await offFocus(id);
    if (a === null || a > 3) continue;   // (not locked on yet, or gone)
    const tr = await page.evaluate(() => { const r = document.querySelector('.scale-track').getBoundingClientRect(); return { x: r.left + r.width / 2, y0: r.top + r.height * 0.55, y1: r.top + r.height * 0.3 }; });
    await page.mouse.move(tr.x, tr.y0); await page.mouse.down(); await page.mouse.move(tr.x, tr.y1, { steps: 8 }); await page.mouse.up();
    await sleep(700);
    const b = await offFocus(id);
    if (b === null) continue;
    held = id; moved = b;
    break;
  }
  if (expect(held, 'no train could be followed for the slider')) expect(moved < 4, `the followed train is ${Math.round(moved)} px off where it is held after the slider zoomed`);
  expect(!page.errors.length, `errors on the page: ${page.errors.join(' | ')}`);
  await page.close();

  // ---- Without files: The day says it needs them ----
  const plain = await waitForMap(browser, { replay: true, lang: 'en' });
  await openFromMenu(plain, 'day');
  await sleep(400);
  const note = await plain.evaluate(() => ({ note: document.querySelector('.map-note:not([hidden])')?.textContent ?? '', ribbon: Boolean(document.getElementById('day') && !document.getElementById('day').hidden) }));
  expect(/server's files/.test(note.note) && !note.ribbon, `without files, ☰ → The day: "${note.note}"${note.ribbon ? ', ribbon open' : ''}`);
  await plain.close();
} finally {
  await browser.close();
  stopAll();
}
if (problems.length) { for (const p of problems) console.log(`FAIL ${p}`); console.log(`day-check: ${problems.length} failed`); process.exit(1); }
console.log(`day-check: all good (The day on ${slots.length} history files with a gap, the slider's stops and a followed train, the sun's line)`);
process.exit(0);
