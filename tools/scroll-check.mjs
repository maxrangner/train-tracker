// Room for the scrollbar in every scrolling area (Max, 2026-11-19: "ALL should have proper padding"; only Statistics
// had it). Opens every card and page, on a short phone screen (so they scroll) and on a computer screen, and fails when
// an area that scrolls has less than 8 px between its content and its right edge, where the phone draws its bar,
// unless it has our own bar (src/scrollbar.js, with a mouse). It looks at every element that scrolls, not a list, so a
// new screen can't miss it. The rule itself: src/scrollbar.css.
// node tools/scroll-check.mjs (with npm run dev and the key: disruptions are live only; PAGE= for another port).
import { launch, address, sleep, PHONE } from './lib/browser.mjs';

const MIN_PAD = 8;
const fails = [], notes = [];
const SIZES = [['phone', { ...PHONE, height: 560 }], ['computer', { width: 1280, height: 640 }]];

// Every element in an open card (and the menu) that scrolls now: its name, its right padding, our own bar or not.
function measure() {
  const open = [...document.querySelectorAll('.sheet, #nav')].filter(s => !s.hidden && getComputedStyle(s).visibility !== 'hidden');
  const out = [];
  for (const s of open) for (const el of [s, ...s.querySelectorAll('*')]) {
    const cs = getComputedStyle(el);
    if (!/auto|scroll/.test(cs.overflowY) || el.scrollHeight <= el.clientHeight + 2 || !el.getClientRects().length) continue;
    const name = el.id ? `#${el.id}` : `.${[...el.classList].filter(c => !c.startsWith('sb-')).join('.')}`;
    out.push({ name: (s === el || !s.id ? '' : `#${s.id} `) + name, pad: parseFloat(cs.paddingRight), own: el.classList.contains('sb-own') });
  }
  return out;
}

const browser = await launch();
try {
  for (const [size, viewport] of SIZES) {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(address({ lang: 'sv', view: '6/59.3/16' }), { waitUntil: 'domcontentloaded' });
    for (let t0 = Date.now(); Date.now() - t0 < 45000; await sleep(500)) {
      if (await page.evaluate(() => (window.__trains?.count ?? 0) > 0 && document.getElementById('disruptions-count')?.textContent !== '').catch(() => false)) break;
    }
    await sleep(2000);
    const closeAll = async () => { for (let i = 0; i < 4; i++) { await page.keyboard.press('Escape'); await sleep(150); } };
    const viaMenu = id => async () => { await page.click('#nav-button'); await sleep(350); await page.evaluate(i => document.getElementById(i).click(), id); };
    const train = await page.evaluate(() => { const r = window.__trains.reports()[0]; return r ? String(r.number) : null; }).catch(() => null);
    // The rail work fold, opened (never shut): the page remembers it between visits, so a plain tap shut it again on the
    // second screen size, and on an evening with no problems there was then no row to tap (2026-11-19).
    const openFold = () => page.evaluate(() => { const f = document.querySelector('#disruptions-body .dis-fold'); if (f?.getAttribute('aria-expanded') === 'false') f.click(); });
    const screens = [
      ['Settings', 'settings-page', viaMenu('open-settings')],
      ['About', 'help', viaMenu('help-button')],
      ['Statistics', 'stats-page', viaMenu('open-stats')],
      ['Disruptions', 'disruptions-page', async () => { await viaMenu('open-disruptions')(); await sleep(500); await openFold(); }],
      ['One disruption', 'disruption', async () => { await viaMenu('open-disruptions')(); await sleep(500); await openFold(); await sleep(300); await page.evaluate(() => document.querySelector('#disruptions-body .dis-row')?.click()); }],
      ['Connection', 'conn-page', async () => { await page.click('#status'); }],
      ['Search', 'menu', async () => { await page.click('#menu-button'); }],
      ['Search typed', 'menu', async () => { await page.click('#menu-button'); await sleep(300); await page.type('#search', 'st'); }],
      ['Train card', 'panel', async () => { await page.click('#menu-button'); await sleep(300); await page.type('#search', train ?? '1'); await sleep(900); await page.keyboard.press('Enter'); }],
    ];
    for (const [name, id, open] of screens) {
      await closeAll();
      await open();
      await sleep(1500);
      if (await page.evaluate(i => document.getElementById(i).hidden, id)) { fails.push(`${size}, ${name}: did not open (#${id})`); continue; }
      const areas = await page.evaluate(measure);
      const bad = areas.filter(a => !a.own && a.pad < MIN_PAD);
      if (bad.length) fails.push(`${size}, ${name}: ${bad.map(a => `${a.name} has ${a.pad} px for the bar`).join('; ')}`);
      else notes.push(`${size}, ${name}: ${areas.length ? areas.map(a => `${a.name} ${a.own ? 'own bar' : `${a.pad} px`}`).join(', ') : 'nothing scrolls'}`);
    }
    if (errors.length) fails.push(`${size}: page errors: ${errors.slice(0, 3).join(' | ')}`);
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
