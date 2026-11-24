// The page on a computer's screen (1500 x 1000, a mouse; Max's PC notes of 2026-11-23), on the replay of 17 Nov
// 16:00 (CARD_HOUR):
// - the map always drags: pulling the sheet up with the mouse by Home's text leaves no text selected; a selection left
//   on the page is cleared by a press on the map, which then moves; the browser's own drag of a picture never starts
//   on the map (a press on selected content dragged a ghost picture instead of the map, and "live" showed highlighted);
// - with Home raised (half, full) the map's buttons and the live mark stay shown.
// Not checkable here: the browser's own drag-and-drop of a selection (this test browser makes none), a real mouse.
// Run: PAGE=http://localhost:5181/ node tools/pc-check.mjs
import { launch, CARD_HOUR, sleep } from './lib/browser.mjs';
import { waitForMap, setLevel } from './lib/screen.mjs';

let failed = 0;
const ok = (good, what) => { console.log(`${good ? 'ok  ' : 'FAIL'} ${what}`); if (!good) failed++; };
const PC = { width: 1500, height: 1000, deviceScaleFactor: 1 };

const browser = await launch();
try {
  const page = await waitForMap(browser, { size: PC, replay: CARD_HOUR, lang: 'en' });
  await sleep(2500);
  const center = () => page.evaluate(() => { const c = window.__map.getCenter(); return `${c.lng.toFixed(4)},${c.lat.toFixed(4)}`; });
  const selected = () => page.evaluate(() => String(getSelection()));
  async function mouseDrag(x, y, dx, dy) {
    await page.mouse.move(x, y); await page.mouse.down();
    for (let i = 1; i <= 15; i++) { await page.mouse.move(x + dx * i / 15, y + dy * i / 15); await sleep(16); }
    await page.mouse.up(); await sleep(600);
  }

  // 1. Home pulled up by its text with the mouse (up and to the right, over the map)
  await setLevel(page, 1);
  const at = await page.evaluate(() => {
    const el = [...document.querySelectorAll('#sheet .pg p, #sheet .pg h2, #sheet .pg h3')].find(e => e.offsetParent && e.getBoundingClientRect().top > 0 && e.textContent.trim());
    const r = el.getBoundingClientRect();
    return { x: r.x + 20, y: r.y + r.height / 2 };
  });
  await mouseDrag(at.x, at.y, 600, 380);   // (down: on a computer the sheet hangs from the top, 2026-11-23)
  ok(await page.evaluate(() => window.__stack.level) > 1, 'a mouse pull by Home\'s text raises the sheet');
  const left = await selected();
  ok(!left.trim(), `no text selected after the pull${left.trim() ? ` (selected: "${left.trim().slice(0, 40)}")` : ''}`);

  // 2. a selection left on the page: a press on the map clears it, and the map moves
  await page.evaluate(() => getSelection().selectAllChildren(document.body));
  const c0 = await center();
  await mouseDrag(900, 400, -240, -100);
  ok(!(await selected()).trim(), 'a press on the map clears a selection on the page');
  ok(await center() !== c0, 'the map moves with that drag');

  // 3. the browser's own drag never starts on the map
  const stopped = await page.evaluate(() => {
    const e = new DragEvent('dragstart', { bubbles: true, cancelable: true });
    document.querySelector('#map canvas').dispatchEvent(e);
    return e.defaultPrevented;
  });
  ok(stopped, 'a picture drag starting on the map is stopped');

  // 4. Home raised: the map's buttons and the live mark stay (the sheet floats at the left and covers neither)
  for (const level of [1, 2]) {
    await setLevel(page, level);
    await sleep(300);
    // (the buttons' corner box takes no presses by design, its buttons do; the live mark is fixed: no offsetParent)
    const seen = await page.evaluate(() => Object.fromEntries([['the map buttons', '.maplibregl-ctrl-bottom-right'], ['the live mark', '#status']].map(([name, sel]) => {
      const el = document.querySelector(sel), cs = el && getComputedStyle(el);
      const press = el && getComputedStyle(el.querySelector('.maplibregl-ctrl') ?? el).pointerEvents;
      return [name, Boolean(el && el.getClientRects().length && cs.opacity === '1' && cs.visibility !== 'hidden' && press !== 'none')];
    })));
    for (const [name, shown] of Object.entries(seen)) ok(shown, `${name} shown with Home at ${level === 2 ? 'full' : 'half'}`);
  }

  // 5. a row's edge pressed at hand speed (Max, 2026-11-24: the › on a saved trip "Still doesn't do anything": a held
  //    press shrank the row, the release was beside it); and pressed, then moved off it: no click
  await page.evaluate(() => localStorage.setItem('favourites', JSON.stringify({ stations: [], trains: [], trips: [{ key: 'Cst>G>Mc', from: 'Cst', via: 'G', to: 'Mc' }], changes: [] })));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__stack?.top?.() === 'home' && document.querySelector('#sheet .trip-row'), { timeout: 30000 });
  await sleep(2000);
  const edge = async () => {
    await page.evaluate(() => window.__stack.home(1)); await sleep(1200);
    return page.evaluate(() => { const r = [...document.querySelector('#sheet .trip-row').querySelectorAll('svg')].at(-1).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  };
  let p = await edge();
  await page.mouse.move(p.x, p.y, { steps: 4 }); await sleep(150);
  await page.mouse.down(); await sleep(150); await page.mouse.up(); await sleep(900);
  const opened = await page.evaluate(() => window.__stack.top());
  ok(opened === 'trip:Cst>G>Mc', `the › on a saved trip, held 150 ms: ${opened}`);
  p = await edge();
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await sleep(100);
  await page.mouse.move(p.x + 200, p.y + 120, { steps: 8 }); await page.mouse.up(); await sleep(900);
  const stayed = await page.evaluate(() => window.__stack.top());
  ok(stayed === 'home', `pressed on the row, moved off it and let go: no click (${stayed})`);
} finally {
  await browser.close();
}
console.log(failed ? `pc-check: ${failed} failed` : 'pc-check: all ok');
process.exit(failed ? 1 : 0);
