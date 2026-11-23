// Room for the scrollbar in every scrolling area (Max, 2026-11-19: "ALL should have proper padding"; only Statistics
// had it). Opens every page of the sheet, on a short phone screen (so they scroll) and on a computer screen, and fails
// when an area that scrolls has less than 8 px between its content and its right edge, where the phone draws its bar,
// unless it has our own bar (src/scrollbar.js, with a mouse). It looks at every element that scrolls in the sheet and
// ☰'s menu, not a list, so a new page can't miss it. The rule itself: src/scrollbar.css.
// Since the one sheet (2026-11-22) each page scrolls itself at full height (.pg in #sheet[data-h="2"]); Settings, Help
// and Connection no longer scroll on their own, their page does. Each page is opened the way a person does
// (tools/lib/screen.mjs) and pulled to full height.
// node tools/scroll-check.mjs (with npm run dev and the key: disruptions are live only; PAGE= for another port).
import { launch, sleep, PHONE } from './lib/browser.mjs';
import { waitForMap, until, setLevel, toRest, openFromMenu, openConnection, openSearch, typeSearch, openTrainByNumber, openStationByName, openDisruptions, HOME } from './lib/screen.mjs';

const MIN_PAD = 8;
const fails = [], notes = [];
const SIZES = [['phone', { ...PHONE, height: 560 }], ['computer', { width: 1280, height: 640 }]];

// Every element in the sheet (and ☰'s menu, the trail) that scrolls now: its name, its right padding, our own bar or not.
function measure() {
  const open = [...document.querySelectorAll('#sheet, #nav, #trail')].filter(s => !s.hidden && getComputedStyle(s).visibility !== 'hidden');
  const out = [];
  for (const s of open) for (const el of [s, ...s.querySelectorAll('*')]) {
    const cs = getComputedStyle(el);
    if (!/auto|scroll/.test(cs.overflowY) || el.scrollHeight <= el.clientHeight + 2 || !el.getClientRects().length) continue;
    const name = el.id ? `#${el.id}` : el.dataset.key ? `.pg[${el.dataset.key}]` : `.${[...el.classList].filter(c => !c.startsWith('sb-')).join('.')}`;
    out.push({ name, pad: parseFloat(cs.paddingRight), own: el.classList.contains('sb-own') });
  }
  return out;
}

const browser = await launch();
try {
  for (const [size, viewport] of SIZES) {
    const page = await waitForMap(browser, { size: viewport, lang: 'sv', view: '6/59.3/16', wait: 45000 });
    await until(page, h => Boolean(document.querySelector(`${h} .dis-list`)), 45000, HOME);   // (the disruptions are in)
    await sleep(2000);
    const train = await page.evaluate(() => { const r = window.__trains.reports().find(x => /^\d{3,5}$/.test(String(x.number))); return r ? String(r.number) : null; }).catch(() => null);
    // The rail work fold, opened (never shut): the page remembers it between visits, so a plain tap shut it again on the
    // second screen size, and on an evening with no problems there was then no row to tap (2026-11-19).
    const openFold = () => page.evaluate(() => { const f = document.querySelector('#sheet .pg[data-key="dislist"] .dis-fold'); if (f?.getAttribute('aria-expanded') === 'false') f.click(); });
    const full = () => setLevel(page, 2);
    const screens = [   // [name, the page key it shows (a start of it), how it opens]
      ['Home', 'home', async () => { await toRest(page); await full(); }],
      ['Settings', 'page:settings', async () => { await openFromMenu(page, 'settings'); await full(); }],
      ['About', 'page:help', async () => { await openFromMenu(page, 'help'); await full(); }],
      ['Disruptions', 'dislist', async () => { if (!(await openDisruptions(page))) return 'skip'; await openFold(); await full(); }],
      ['One disruption', 'dis:', async () => { if (!(await openDisruptions(page))) return 'skip'; { await openFold(); await sleep(300); await page.evaluate(() => [...document.querySelectorAll('#sheet .pg[data-key="dislist"] .dis-row')].find(r => !r.closest('.dis-works:not(.open)'))?.click()); await sleep(500); await full(); } }],
      ['Connection', 'page:conn', async () => { await toRest(page); await openConnection(page); await full(); }],
      ['A company', 'co:', async () => { await toRest(page); await full(); await page.evaluate(h => document.querySelector(`${h} [data-filter="brand"]:not([data-v=""])`)?.click(), HOME); await sleep(600); await full(); }],
      ['Search', 'home', async () => { await openSearch(page); }],
      ['Search typed', 'home', async () => { await openSearch(page); await typeSearch(page, 'st'); }],
      ['Train card', 'train:', async () => { if (await openTrainByNumber(page, train ?? '1')) await full(); }],
      ['A board', 'station:', async () => { if (await openStationByName(page, 'Stockholm C')) await full(); }],
    ];
    for (const [name, want, open] of screens) {
      if (await open() === 'skip') { notes.push(`${size}, ${name}: no disruption in force now, not checked`); continue; }
      await sleep(1500);
      const top = await page.evaluate(() => window.__stack.top());
      if (!top?.startsWith(want)) { fails.push(`${size}, ${name}: did not open (${top} on top, want ${want})`); await toRest(page); continue; }
      const areas = await page.evaluate(measure);
      const bad = areas.filter(a => !a.own && a.pad < MIN_PAD);
      if (bad.length) fails.push(`${size}, ${name}: ${bad.map(a => `${a.name} has ${a.pad} px for the bar`).join('; ')}`);
      else notes.push(`${size}, ${name}: ${areas.length ? areas.map(a => `${a.name} ${a.own ? 'own bar' : `${a.pad} px`}`).join(', ') : 'nothing scrolls'}`);
      await toRest(page);
    }
    if (page.errors.length) fails.push(`${size}: page errors: ${page.errors.slice(0, 3).join(' | ')}`);
    await page.close();
  }
} catch (e) {
  fails.push(`stopped: ${e.message}`);
} finally {
  await browser.close();
}
for (const n of notes) console.log(`ok   ${n}`);
for (const f of fails) console.log(`FAIL ${f}`);
console.log(fails.length ? `scroll-check: ${fails.length} problem(s)` : 'scroll-check: every scrolling area has room for its bar');
process.exit(fails.length ? 1 : 0);
