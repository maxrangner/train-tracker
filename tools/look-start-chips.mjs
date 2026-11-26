// Pictures of the start (Max's pick C, 2026-11-25; src/start-chips.js), phone and computer, live data: (1) the bar
// and the chips, (2) Störningar open, (3) Sparade, (4) Statistik, (5) ☰ open; each labelled on a sheet for Max
// (docs/kit/sheet.mjs). node tools/look-start-chips.mjs [--replay] (PAGE= for another port; --raw: the screenshots only).
// Out: shots/start-chips/.
import { mkdirSync } from 'node:fs';
import { launch, sleep, PHONE, CARD_HOUR } from './lib/browser.mjs';
import { waitForMap, until, toRest, openMenu } from './lib/screen.mjs';

const OUT = 'shots/start-chips';
const replay = process.argv.includes('--replay');
const raw = process.argv.includes('--raw');
mkdirSync(OUT, { recursive: true });
const browser = await launch();
const shots = { phone: [], pc: [] };
try {
  for (const [name, size] of [['phone', PHONE], ['pc', { width: 1280, height: 800, deviceScaleFactor: 2 }]]) {
    const page = await waitForMap(browser, { size, lang: 'sv', view: '6.2/62.0/16.0', ...(replay ? { replay: CARD_HOUR } : {}) });
    await until(page, () => (window.__trains?.count ?? 0) > 50, 30000);
    await sleep(replay ? 2500 : 6000);
    // (a computer: its left part, the box and some map, so the words can be read at the sheet's size)
    const shot = async (file, label, note) => { await sleep(900); const path = `${OUT}/${name}-${file}.png`;
      await page.screenshot({ path, ...(name === 'pc' ? { clip: { x: 0, y: 0, width: 560, height: 700 } } : {}) }); shots[name].push({ image: path, label, note }); };
    const chip = async (key) => {
      await page.evaluate(k => document.querySelector(`#sheet[data-root] .sh-chips [data-chip="${k}"], #chips [data-chip="${k}"]`).click(), key);
      await until(page, k => window.__stack.top() === k, 4000, key);
      await until(page, () => !document.querySelector('#sheet .pg.in-r, #sheet .pg.in-l, #sheet .pg-ghost'), 4000);
    };
    await toRest(page);
    await shot('1-start', 'Start', name === 'pc' ? 'The search box alone, the chips under it' : 'The bar alone, the chips above it');
    await chip('dislist');
    await shot('2-disruptions', 'Störningar', 'Its chip tapped: the card, the chips in its head');
    await chip('saved');
    await shot('3-saved', 'Sparade', 'Switched: the card replaced');
    await chip('stats');
    await shot('4-stats', 'Statistik', 'Sverige just nu and the statistics');
    await toRest(page);
    await openMenu(page);
    await shot('5-menu', '☰', 'Filter, Rewind, Settings, About');
    await page.close();
  }
} finally {
  await browser.close();
}
if (!raw) {
  // (the labelled sheet maker in this folder's docs/kit, which only the main folder has: run it there for pictures)
  const { sheet } = await import(new URL('../docs/kit/sheet.mjs', import.meta.url).href);
  const when = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' }).slice(0, 16);
  for (const [name, list] of Object.entries(shots)) {
    const sub = `${name === 'phone' ? 'Phone' : 'Computer'}, ${replay ? 'a replay' : 'live data'} ${when}`;
    console.log(await sheet({ file: `${OUT}/${name}-1-3.jpg`, title: `Start chips (option C): ${name === 'phone' ? 'phone' : 'computer'}`, sub,
      panels: list.slice(0, 3).map((p, i) => ({ ...p, letter: String(i + 1) })) }));
    console.log(await sheet({ file: `${OUT}/${name}-4-5.jpg`, title: `Start chips (option C): ${name === 'phone' ? 'phone' : 'computer'}`, sub,
      panels: list.slice(3).map((p, i) => ({ ...p, letter: String(i + 4) })) }));
  }
}
