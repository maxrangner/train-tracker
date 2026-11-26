// Films of the page's moves, to look at before anything goes to Max (2026-11-26, Max: "I can't go around hunting all
// these discrepancies manually after every change"): each scene's every painted frame (the browser's screencast), laid
// out numbered on one picture per scene, its name burned in. The numbers the tests read miss what only shows on screen
// (a corner showing through, rows sliding under the search box); a film shows it. Every change to a move or a look:
// the scenes it touches, both sizes, looked at frame by frame.
//   node tools/film.mjs [--only <name part>] [--size phone|pc] [--slow 4] [--live] [--out <folder>]   (with npm run dev; PAGE= for another port)
//   (--live: today's trains instead of the replay; Störningar's scenes need it)
// Pictures: shots/film/<size> <scene>.png (not in git). The scenes: SCENES below; add one for each new move.
import { mkdirSync } from 'node:fs';
import { launch, sleep, PHONE, CARD_HOUR, address } from './lib/browser.mjs';
import { toRest, until, openMenu, openChip, openFromMenu, openTrainByNumber } from './lib/screen.mjs';

const args = process.argv.slice(2), opt = k => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const ONLY = opt('--only'), OUT = opt('--out') ?? 'shots/film', SLOW = Number(opt('--slow') ?? 1);   // --slow 4: the CPU four times slower (a slow phone)
const SIZES = { phone: PHONE, pc: { width: 1400, height: 900, deviceScaleFactor: 1 } };
mkdirSync(OUT, { recursive: true });

// A point on the map's empty ground (no train, station or name within 20 px), away from the sheet
const emptyMap = p => p.evaluate(() => {
  const s = document.getElementById('sheet').getBoundingClientRect();
  for (const [x, y] of [[innerWidth - 160, 140], [innerWidth - 260, 220], [innerWidth / 2, 120], [innerWidth - 120, s.top - 60]]) {
    if (x > s.left && x < s.right && y > s.top && y < s.bottom) continue;
    if (document.elementFromPoint(x, y)?.tagName === 'CANVAS' && !window.__map.queryRenderedFeatures([[x - 20, y - 20], [x + 20, y + 20]]).some(f => f.layer.type === 'symbol' || /train|station/.test(f.layer.id))) return { x, y };
  }
  return null;
});
const clickMap = async (p) => { const q = await emptyMap(p); if (q) await p.mouse.click(q.x, q.y); };
const station = p => p.evaluate(() => window.__stack.open('station:Cst', { go: true, fromMap: true }));
// A train's card at full with its status box (Läget), its messages open or shut: the first train in view that has one
async function trainWithStatus(p, open) {
  const nums = await p.evaluate(() => [...new Set(window.__map.queryRenderedFeatures({ layers: ['train-dots'] }).map(f => String(window.__trains.get(f.properties.id)?.number ?? '')).filter(Boolean))].slice(0, 10));
  for (const n of nums) {
    await toRest(p);
    if (!(await openTrainByNumber(p, n))) continue;
    await p.evaluate(() => window.__stack.setLevel(2)); await sleep(1200 * SLOW);
    if (!(await p.evaluate(() => Boolean(document.querySelector('#panel .tv-toggle'))))) continue;
    const isOpen = await p.evaluate(() => document.querySelector('#panel .tv-toggle').getAttribute('aria-expanded') === 'true');
    if (isOpen !== open) { await p.evaluate(() => document.querySelector('#panel .tv-toggle').click()); await sleep(1000 * SLOW); }
    return true;
  }
  return false;
}

// name, setup (to the moment before), act (the move filmed), ms (how long after it), live (only with --live)
const SCENES = [
  { name: 'menu open', setup: toRest, act: p => p.click('#nav-button') },
  { name: 'menu close by its button', setup: async (p) => { await toRest(p); await openMenu(p); }, act: p => p.click('#nav-button') },
  { name: 'menu close by the map', setup: async (p) => { await toRest(p); await openMenu(p); }, act: clickMap },
  { name: 'menu → filter', setup: async (p) => { await toRest(p); await openMenu(p); }, act: p => p.click('#open-filter'), ms: 1300 },
  { name: 'filter more', setup: async (p) => { await openFromMenu(p, 'filter'); await until(p, () => Boolean(document.querySelector('#sheet [data-act="comore"]:not([hidden])')), 20000); await sleep(600 * SLOW); }, act: p => p.evaluate(() => document.querySelector('#sheet [data-act="comore"]').click()), ms: 1500 },
  { name: 'filter fewer', setup: async (p) => { await openFromMenu(p, 'filter'); await until(p, () => Boolean(document.querySelector('#sheet [data-act="comore"]:not([hidden])')), 20000); await sleep(600); await p.evaluate(() => document.querySelector('#sheet [data-act="comore"]').click()); await sleep(1500 * SLOW); }, act: p => p.evaluate(() => document.querySelector('#sheet [data-act="comore"]').click()), ms: 1500 },
  { name: 'filter → back', setup: async (p) => { await openFromMenu(p, 'filter'); await sleep(800); }, act: p => p.keyboard.press('Escape'), ms: 1300 },
  { name: 'menu → settings', setup: async (p) => { await toRest(p); await openMenu(p); }, act: p => p.click('#open-settings'), ms: 1300 },
  { name: 'settings → back', setup: async (p) => { await openFromMenu(p, 'settings'); await sleep(800); }, act: p => p.keyboard.press('Escape'), ms: 1300 },
  { name: 'station → map click', setup: async (p) => { await toRest(p); await station(p); await sleep(2000); }, act: clickMap },
  { name: 'station → back', setup: async (p) => { await toRest(p); await station(p); await sleep(2000); }, act: p => p.keyboard.press('Escape') },
  { name: 'chip → statistik', setup: toRest, act: p => p.evaluate(() => document.querySelector('#chips [data-chip="stats"]').click()), ms: 1300 },
  { name: 'chip → sparade', setup: toRest, act: p => p.evaluate(() => document.querySelector('#chips [data-chip="saved"]').click()), ms: 1300 },
  // (each of Home's three cards closed every way: its chip again, Esc, a map click; Max, 2026-11-26: "When closing either
  // störningar, sparade or statistik the card visually buggs out when closing. Clipping the search bar")
  ...[['stats', 'statistik'], ['saved', 'sparade'], ['dislist', 'störningar']].flatMap(([chip, word]) => [
    { name: `${word} → closed by its chip`, live: chip === 'dislist', setup: async (p) => { await openChip(p, chip); await sleep(800); }, act: p => p.click(`#sheet .sh-chips [data-chip="${chip}"]`) },
    { name: `${word} → closed by Esc`, live: chip === 'dislist', setup: async (p) => { await openChip(p, chip); await sleep(800); }, act: p => p.keyboard.press('Escape') },
    { name: `${word} → closed by the map`, live: chip === 'dislist', setup: async (p) => { await openChip(p, chip); await sleep(800); }, act: clickMap },
  ]),
  // (Störningar's rail work fold opened and shut; Max, 2026-11-26: "expanding and contracting the card leaves a lot of
  // empty space"; --live)
  { name: 'störningar fold open', live: true, setup: async (p) => { await openChip(p, 'dislist'); await sleep(1500); if (await p.evaluate(() => document.querySelector('.dis-fold')?.getAttribute('aria-expanded') === 'true')) { await p.click('.dis-fold'); await sleep(2500); } }, act: p => p.click('.dis-fold'), ms: 1600 },
  { name: 'störningar fold shut', live: true, setup: async (p) => { await openChip(p, 'dislist'); await sleep(1500); if (await p.evaluate(() => document.querySelector('.dis-fold')?.getAttribute('aria-expanded') !== 'true')) { await p.click('.dis-fold'); await sleep(2500); } }, act: p => p.click('.dis-fold'), ms: 2600 },
  { name: 'statistik → sparade', setup: async (p) => { await openChip(p, 'stats'); await sleep(800); }, act: p => p.click('#sheet .sh-chips [data-chip="saved"]') },
  { name: 'train status open', setup: p => trainWithStatus(p, false), act: p => p.evaluate(() => document.querySelector('#panel .tv-toggle')?.click()) },
  { name: 'train status shut', setup: p => trainWithStatus(p, true), act: p => p.evaluate(() => document.querySelector('#panel .tv-toggle')?.click()) },
  { name: 'train i on', setup: p => trainWithStatus(p, false), act: p => p.evaluate(() => document.querySelector('#panel .panel-info')?.click()) },
  // (full to compact by "Mindre ⌃"; Max, 2026-11-26: "after the contration the small card jumps a few pixels up and down")
  { name: 'train less', setup: p => trainWithStatus(p, false), act: p => p.evaluate(() => document.querySelector('#panel .panel-more')?.click()), ms: 1600 },
  { name: 'search open', setup: toRest, act: p => p.evaluate(() => document.querySelector('#sheet .sh-field input, #sheet .sh-field')?.click()) },
];

const browser = await launch();
const made = [];
try {
  for (const [size, view] of Object.entries(SIZES)) {
    if (opt('--size') && opt('--size') !== size) continue;
    const page = await browser.newPage();
    await page.setViewport(view);
    await page.goto(address({ ...(args.includes('--live') ? {} : { replay: CARD_HOUR }), view: '13/59.33/18.06' }), { waitUntil: 'domcontentloaded' });
    await until(page, () => Boolean(window.__stack?.top()), 30000);
    // (--live: today's trains, for what a replay lacks: Störningar's chip waits for the disruptions)
    if (args.includes('--live')) await until(page, () => Boolean(document.querySelector('#chips [data-chip="dislist"]')), 60000);
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await sleep(3000);
    const cdp = await page.createCDPSession();
    if (SLOW > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOW });
    for (const sc of SCENES) {
      if (ONLY && !sc.name.includes(ONLY)) continue;
      if (sc.live && !args.includes('--live')) continue;   // (Störningar: only with today's trains)
      await sc.setup(page);
      await sleep(400);
      const frames = [];
      const on = async (f) => { frames.push({ t: f.metadata.timestamp, data: f.data }); await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); };
      cdp.on('Page.screencastFrame', on);
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, everyNthFrame: 1 });
      await sleep(150);
      const t0 = Date.now() / 1000;
      await sc.act(page);
      await sleep((sc.ms ?? 900) * SLOW);
      await cdp.send('Page.stopScreencast');
      cdp.off('Page.screencastFrame', on);
      const shown = frames.filter(f => f.t >= t0 - 0.03);
      // (the frames up to the last one that differs, at most 40: the rest is the same still picture)
      let last = shown.length - 1;
      while (last > 0 && shown[last].data === shown[last - 1].data) last--;
      const keep = shown.slice(0, Math.min(last + 2, 40));
      const cols = size === 'pc' ? 4 : 6, cw = size === 'pc' ? 460 : 260, ch = size === 'pc' ? 300 : Math.round(260 * view.height / view.width);
      const html = `<body style="margin:0;padding:10px;background:#fff;font:600 15px 'Segoe UI',sans-serif;width:${cols * (cw + 6)}px">
        <div style="font:800 26px 'Segoe UI',sans-serif;margin-bottom:6px">${size === 'pc' ? 'Computer' : 'Phone'}: ${sc.name}</div>
        <div style="color:#57606a;margin-bottom:8px">every painted frame, numbered (about 16 ms apart when the PC keeps up); ${args.includes('--live') ? 'live' : 'replay 17 Nov 15:00'}${size === 'pc' ? '; the sheet\'s corner of the screen' : ''}</div>
        <div style="display:grid;grid-template-columns:repeat(${cols},${cw}px);gap:6px">${keep.map((f, i) => `<div><div>${i + 1}</div><div style="width:${cw}px;height:${ch}px;overflow:hidden;border:2px solid #1b1f24;border-radius:4px"><img style="display:block;width:${size === 'pc' ? 920 : cw}px" src="data:image/jpeg;base64,${f.data}"></div></div>`).join('')}</div></body>`;
      const sheet = await browser.newPage();
      await sheet.setViewport({ width: cols * (cw + 6) + 20, height: 400 });
      await sheet.setContent(html);
      const file = `${OUT}/${size}${SLOW > 1 ? ` slow${SLOW}` : ''} ${sc.name.replace(/[^\p{L}\p{N} →-]/gu, '')}.png`;
      await sheet.screenshot({ path: file, fullPage: true });
      await sheet.close();
      made.push(`${file} (${keep.length} frames)`);
    }
    await page.close();
  }
} finally { await browser.close(); }
console.log(made.join('\n'));
