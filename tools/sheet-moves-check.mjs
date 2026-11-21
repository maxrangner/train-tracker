// Every card moves in one go (Max, 2026-11-21: the station card "bounces twice", the search "jumps around"): the card's
// top edge is read every frame during each move, and a move that turns around (down, up, down) fails. Big single
// steps are not counted: the test browser drops frames, a phone doesn't.
//   - the train card (the 17 Nov evening replay): All stops / Less, the handle both ways, the stops ahead open/close;
//   - a station's board (live, Uppsala C: it usually has a message): its message open/close, the handle both ways,
//     the search from compact and from the message open, the search closed.
// node tools/sheet-moves-check.mjs (with npm run dev; PAGE= for another port).
import { launch, address, sleep, PHONE, CARD_HOUR } from './lib/browser.mjs';

const fails = [], ok = [], notes = [];
const check = (cond, what) => (cond ? ok : fails).push(what);
const browser = await launch();
try {
  const page = await browser.newPage();
  await page.setViewport(PHONE);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch { /* none */ } });
  const ready = async () => {
    for (let t0 = Date.now(); Date.now() - t0 < 30000; await sleep(300)) if (await page.evaluate(() => (window.__trains?.count ?? 0) > 20 && Boolean(window.__map?.loaded())).catch(() => false)) break;
    await sleep(2000);
  };
  // One move: its frames' top edges; turns = times it turned around.
  const move = async (what, id, act, ms = 1500) => {
    await page.evaluate((i) => { window.__f = []; const el = document.getElementById(i), t0 = performance.now();
      const step = () => { if (!el.hidden) window.__f.push(Math.round(el.getBoundingClientRect().top)); if (performance.now() - t0 < 1900) requestAnimationFrame(step); };
      requestAnimationFrame(step); }, id);
    await page.evaluate(act);
    await sleep(ms + 500);
    const f = await page.evaluate(() => window.__f);
    let turns = 0, dir = 0;
    for (let i = 1; i < f.length; i++) { const d = Math.sign(f[i] - f[i - 1]); if (d && dir && d !== dir) turns++; if (d) dir = d; }
    const path = f.filter((v, i) => i === 0 || v !== f[i - 1]);
    check(turns === 0, `${what}: ${path[0]} → ${path.at(-1)} px${turns ? `, turned ${turns} times (${path.slice(0, 24).join(' ')})` : ', in one go'}`);
  };
  const handle = (id, n) => `(() => { const el = document.getElementById('${id}'), r = el.getBoundingClientRect();
    const o = { bubbles: true, pointerId: ${n}, pointerType: 'touch', clientX: r.left + r.width / 2, clientY: r.top + 10, isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerdown', o)); el.dispatchEvent(new PointerEvent('pointerup', o)); })()`;

  // ---- the train card ----
  await page.goto(address({ replay: CARD_HOUR, lang: 'sv', view: '11/59.33/18.06' }), { waitUntil: 'domcontentloaded' });
  await ready();
  const dot = await page.evaluate(() => { const f = window.__map.queryRenderedFeatures({ layers: ['train-dots'] }).find(x => window.__trains.get(x.properties.id)?.number > 1000);
    if (!f) return null; const p = window.__map.project(f.geometry.coordinates); return { x: p.x, y: p.y }; });
  if (!dot) fails.push('the train card: no train in view');
  else {
    await page.touchscreen.tap(dot.x, dot.y);
    for (let t0 = Date.now(); Date.now() - t0 < 15000; await sleep(300)) if (await page.evaluate(() => Boolean(document.querySelector('#panel .panel-more')))) break;
    await sleep(1500);
    await move('train card, All stops', 'panel', () => document.querySelector('#panel .panel-more').click());
    await move('train card, Less', 'panel', () => document.querySelector('#panel .panel-more').click());
    await move('train card, the handle to full', 'panel', handle('panel', 11));
    await move('train card, the handle back', 'panel', handle('panel', 12));
    await move('train card, the stops ahead open', 'panel', () => document.querySelector('#panel .cd-stop')?.click());
    await move('train card, the stops ahead close', 'panel', () => document.querySelector('#panel .cd-stop')?.click());
  }

  // ---- a station's board (live: its message) ----
  await page.goto('about:blank');
  await page.goto(address({ lang: 'sv' }), { waitUntil: 'domcontentloaded' });
  await ready();
  await page.evaluate(() => document.getElementById('menu-button').click());
  await sleep(400);
  await page.type('#search', 'Uppsala C');
  await sleep(800);
  await page.evaluate(() => [...document.querySelectorAll('#search-results button')].find(b => b.textContent.includes('Uppsala C'))?.click());
  for (let t0 = Date.now(); Date.now() - t0 < 15000; await sleep(300)) if (await page.evaluate(() => Boolean(document.querySelector('#board .bd-row')))) break;
  for (let t0 = Date.now(); Date.now() - t0 < 6000; await sleep(300)) if (await page.evaluate(() => Boolean(document.querySelector('#board .board-msgs-toggle')))) break;
  await sleep(1000);
  const message = await page.evaluate(() => Boolean(document.querySelector('#board .board-msgs-toggle')));
  if (message) {
    await move('board, its message open', 'board', () => document.querySelector('#board .board-msgs-toggle').click());
    await move('board, its message closed', 'board', () => document.querySelector('#board .board-msgs-toggle').click());
  } else notes.push('the board\'s message not checked: Uppsala C has none now');
  await move('board, the handle to full', 'board', handle('board', 13));
  await move('board, the handle back', 'board', handle('board', 14));
  await move('board, the search from compact', 'board', () => document.querySelector('#board .board-find').click(), 2500);
  await move('board, the search closed', 'board', () => document.querySelector('#board .board-find').click(), 2500);
  if (message) {
    await page.evaluate(() => document.querySelector('#board .board-msgs-toggle').click());
    await sleep(1000);
    await move('board, the search with its message open', 'board', () => document.querySelector('#board .board-find').click(), 2500);
    check(await page.evaluate(() => Boolean(document.querySelector('#board .board-msg-list[hidden]'))), 'the search folds the message');
    await move('board, that search closed', 'board', () => document.querySelector('#board .board-find').click(), 2500);
  }
  check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
} finally {
  await browser.close();
}
for (const o of ok) console.log(`ok   ${o}`);
for (const n of notes) console.log(`note ${n}`);
for (const f of fails) console.log(`FAIL ${f}`);
console.log(fails.length ? `sheet-moves-check: ${fails.length} failed` : 'sheet-moves-check ok: every card moves in one go');
process.exit(fails.length ? 1 : 0);
