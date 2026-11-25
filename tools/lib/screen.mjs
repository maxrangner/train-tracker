// The steps the screen checks take on the page, in one place (the plan of 2026-11-22, part 0): since the one sheet
// (src/stack.js) a layout change means editing this file, not every check. Each step acts as a person would (a tap on
// the field, typing, a tap on a row) and waits until the page has answered. The page exposes window.__stack (src/main.js):
// keys(), top(), names(), level, heights, searching, open(key), back(), home(level), setLevel(i).
//   import { waitForMap, pageKey, openSearch, openTrainByNumber, ... } from './lib/screen.mjs';
// The sheet's heights: 0 low (at rest), 1 half, 2 full; a page scrolls itself only at full (#sheet[data-h="2"] .pg).
import { openMap, sleep } from './browser.mjs';

// A new page on the map (tools/lib/browser.mjs openMap), once the sheet is there too.
export async function waitForMap(browser, options = {}) {
  const page = await openMap(browser, options);
  await until(page, () => Boolean(window.__stack?.top()), 10000);
  return page;
}

// Wait until fn (run in the page) is true, at most ms; returns whether it came true.
export async function until(page, fn, ms = 5000, arg) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.evaluate(fn, arg).catch(() => false)) return true;
    await sleep(100);
  }
  return false;
}

// The stack's top page key ('home', 'train:<id>', 'station:<sig>', 'page:settings', ...), its keys, the sheet's height.
export const pageKey = page => page.evaluate(() => window.__stack.top());
export const pageKeys = page => page.evaluate(() => window.__stack.keys());
export const sheetLevel = page => page.evaluate(() => window.__stack.level);
export const setLevel = async (page, i) => { await page.evaluate(n => window.__stack.setLevel(n), i); await sleep(450); };

// Down to Home at rest: menus and the search closed, every page gone.
export async function toRest(page) {
  // (☰'s menu shut as a person does, Esc, and waited for: its buttons slide back into ☰; open, Home holds still)
  if (await page.evaluate(() => !document.getElementById('nav').hidden)) {
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await until(page, () => document.getElementById('nav').hidden, 1500);
  }
  const fromMenu = await page.evaluate(() => window.__stack.keys().some(k => k === 'page:settings' || k === 'page:help'));
  await page.evaluate(() => { if (window.__stack.searching) window.__stack.back(); window.__stack.home(0); });
  await until(page, () => window.__stack.top() === 'home' && window.__stack.level === 0);
  await sleep(300);
  // (back on Home from a page ☰ opened, the menu comes back by itself (src/nav-menu.js reopenOnHome): shut it too, or
  // the next tap meets the held-still sheet; 2026-11-25, scroll-check's Disruptions after About)
  if (fromMenu && await until(page, () => !document.getElementById('nav').hidden, 900)) {
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await until(page, () => document.getElementById('nav').hidden, 1500);
  }
}

// The search: Home's field tapped (the sheet rises to full); the results are #search-results.
export async function openSearch(page) {
  await toRest(page);
  await page.click('#search');
  await until(page, () => window.__stack.searching && window.__stack.level === 2);
  await sleep(350);
}
// Type into the search (after openSearch).
export async function typeSearch(page, text) {
  await page.evaluate(() => { const i = document.getElementById('search'); i.value = ''; i.dispatchEvent(new Event('input')); });
  await page.type('#search', text, { delay: 20 });
  await sleep(300);
}

// A train by its number: searched, its row tapped (one on the map first, else today's timetable's); waits for its card.
// Returns its page key, or null when none was found.
export async function openTrainByNumber(page, number) {
  await openSearch(page);
  await typeSearch(page, String(number));
  // the timetable rows come after 350 ms and an answer
  await until(page, () => Boolean(document.querySelector('#search-results [data-go^="train:"]')) && !document.querySelector('#search-results .state.loading'), 8000);
  const key = await page.evaluate(() => { const b = document.querySelector('#search-results [data-go^="train:"]'); if (!b) return null; b.click(); return b.dataset.go; });
  if (!key) return null;
  await until(page, k => window.__stack.top() === k, 3000, key);
  await until(page, () => Boolean(document.querySelector('#panel .panel-more, #panel .state.empty, #panel .state.error')), 10000);
  return key;
}

// A station by its name (or the start of it): searched, the first station row tapped. Returns its page key, or null.
export async function openStationByName(page, name) {
  await openSearch(page);
  await typeSearch(page, name);
  const key = await page.evaluate(() => { const b = document.querySelector('#search-results [data-go^="station:"]'); if (!b) return null; b.click(); return b.dataset.go; });
  if (!key) return null;
  await until(page, k => window.__stack.top() === k, 3000, key);
  await until(page, () => Boolean(document.querySelector('#board .bd-row, #board .state.empty, #board .state.error')), 10000);
  return key;
}

// ☰: its small menu open (rows: #open-day, #open-settings, #help-button).
export async function openMenu(page) {
  // (the search left: the sheet glides down first; a click aimed at ☰ while it slid can land beside it, on a loaded PC
  // in a whole check, 2026-11-23)
  if (await page.evaluate(() => { const s = window.__stack.searching; if (s) window.__stack.back(); return s; })) await sleep(500);
  if (await page.evaluate(() => document.getElementById('nav').hidden)) await page.click('#nav-button');
  // (a card since 2026-11-25: until it has slid out and stands, shown; with Home raised it waits for Home to go down
  // first, hidden: a click on a choice mid-slide or before it showed found "not clickable")
  await until(page, () => { const n = document.getElementById('nav'); return !n.hidden && n.style.visibility !== 'hidden' && !n.getAnimations().length; }, 4000);
  await sleep(100);
}
// A row of ☰'s menu: 'day', 'settings' or 'help' (or its words as shown). Waits for its page (not for The day).
const ROWS = { day: '#open-day', settings: '#open-settings', help: '#help-button', about: '#help-button' };
export async function openFromMenu(page, name) {
  if (await pageKey(page) !== 'home') await toRest(page);
  await openMenu(page);
  const sel = ROWS[String(name).toLowerCase()] ?? await page.evaluate((w) => {
    const b = [...document.querySelectorAll('#nav .nav-row')].find(r => r.textContent.trim().toLowerCase() === w.toLowerCase());
    return b ? `#${b.id}` : null;
  }, String(name));
  if (!sel) throw new Error(`no row "${name}" in ☰`);
  await page.click(sel);
  const want = { '#open-settings': 'page:settings', '#help-button': 'page:help' }[sel];
  if (want) await until(page, k => window.__stack.top() === k, 3000, want);
  // until the page has slid in and the one it pushed out is gone (2026-11-25: four checks at a time, a click on
  // Settings' theme button 400 ms after the tap hit the page mid-slide: "Node is either not clickable")
  await until(page, () => !document.querySelector('#sheet .pg.in-r, #sheet .pg.in-l, #sheet .pg-ghost'), 4000);
  await sleep(200);
  return pageKey(page);
}

// Home: the search bar alone since 2026-11-25 (Max's pick C); its parts are pages of their own, opened by the start's
// chips (src/start-chips.js): 'dislist' (Störningar), 'saved' (Sparade), 'stats' (Statistik); Filter from ☰ ('filter').
export const HOME = '#sheet .pg[data-key="home"]';
export const pageSel = key => `#sheet .pg[data-key="${key}"]`;
// A start chip tapped as a person does: the one over the map at rest, else the one in an open chip card's head; waits
// for its card to stand (slid in, the one it replaced gone). Returns whether it opened.
export async function openChip(page, key) {
  if (!(await page.evaluate(() => document.getElementById('sheet').hasAttribute('data-root')))) await toRest(page);
  const sel = await page.evaluate(() => (document.getElementById('sheet').hasAttribute('data-root') ? '#sheet .sh-chips' : '#chips'));
  await page.click(`${sel} [data-chip="${key}"]`);
  const came = await until(page, k => window.__stack.top() === k, 3000, key);
  await until(page, () => !document.querySelector('#sheet .pg.in-r, #sheet .pg.in-l, #sheet .pg-ghost'), 4000);
  await page.evaluate(() => window.__stack.whenSettled());
  await sleep(200);
  return came;
}
// The list of disruptions (live only): the chip Störningar tapped once they are in (its number shows); waits for its
// page. Returns whether it opened (false: none came).
export async function openDisruptions(page, { wait = 45000 } = {}) {
  await toRest(page);
  if (!(await until(page, () => Boolean(document.querySelector('#chips [data-chip="dislist"] .ct-n')), wait))) return false;
  return openChip(page, 'dislist');
}

// The live mark at the top: Connection as a page.
export async function openConnection(page) {
  await page.click('#status');
  await until(page, () => window.__stack.top() === 'page:conn');
  await sleep(400);
}

// One step back, as Esc and Android's back do: returns the page
// key after it.
export async function back(page) {
  await page.keyboard.press('Escape');
  await sleep(450);
  return pageKey(page);
}
// What the sheet shows now, for a check's message: { key, keys, level, names }.
export const sheetState = page => page.evaluate(() => ({ key: window.__stack.top(), keys: window.__stack.keys(), level: window.__stack.level,
  names: window.__stack.names() }));
