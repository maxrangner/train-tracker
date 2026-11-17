// The sheets on a phone (Max's phone test of 0.2.0, 2026-11-17), in the test browser at phone size with a mouse as the
// finger: 1 the empty search with the keyboard up (the viewport shortened) shows its hint whole, the sheet scrolls;
// 2 a card grown upwards and dragged back below its start comes back to its small height (or closes past 100 px);
// 3 every size change glides (heights in between, sampled each frame): Mer, the handle tap, a short drag down from full.
// node tools/sheet-check.mjs (with npm run dev; PAGE= for another port). Not the phone: the feel and the real keyboard.
import { mkdirSync } from 'node:fs';
import { launch, address, sleep, PHONE, CARD_HOUR } from './lib/browser.mjs';
mkdirSync('shots/test-0117', { recursive: true });   // (pictures aren't in git: a fresh working folder has no such folder)

const KEYBOARD_PX = 430;   // the phone keyboard's height in CSS pixels (Max's screenshot, 2026-11-17: 1120 of 2340 device pixels, 2.625 each)
const browser = await launch();
const fails = [], notes = [];
const page = await browser.newPage();
try {
  await page.setViewport(PHONE);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(address({ replay: CARD_HOUR, lang: 'sv', view: '11/59.33/18.06' }), { waitUntil: 'domcontentloaded' });
  for (let t0 = Date.now(); Date.now() - t0 < 30000; await sleep(300)) {
    if (await page.evaluate(() => (window.__trains?.count ?? 0) > 0 && Boolean(window.__map?.loaded())).catch(() => false)) break;
  }
  await sleep(1500);

  // ---- 1. The empty search with the keyboard up ----
  await page.evaluate(() => { try { localStorage.removeItem('favourites'); } catch {} });
  await page.click('#menu-button');
  await sleep(400);
  // the keyboard's height, and 90 px more (live data adds a "Störningar (n)" row the recording lacks; Max's screenshot)
  for (const extra of [0, 90]) {
    await page.setViewport({ ...PHONE, height: PHONE.height - KEYBOARD_PX - extra });
    await sleep(500);
    const s1 = await page.evaluate(() => {
      const res = document.getElementById('search-results'), menu = document.getElementById('menu');
      const hint = res.querySelector('.menu-note, .fav-label');
      return { squeezed: res.scrollHeight - res.clientHeight, hint: hint?.textContent?.slice(0, 30) ?? null,
        menuScrolls: menu.scrollHeight > menu.clientHeight && getComputedStyle(menu).overflowY === 'auto' };
    });
    const h = PHONE.height - KEYBOARD_PX - extra;
    if (s1.squeezed > 1) fails.push(`1 search, ${h} px left: the favourites part is squeezed (${s1.squeezed} px of it hidden)`);
    notes.push(`1 search, keyboard up, ${h} px left: hint "${s1.hint}…", squeezed ${s1.squeezed} px, the sheet scrolls: ${s1.menuScrolls}`);
    await page.screenshot({ path: `shots/test-0117/search-keyboard-${h}.jpg`, quality: 85 });
  }
  await page.setViewport(PHONE);
  await page.evaluate(() => document.querySelector('#menu .menu-close').click());
  await sleep(400);

  // ---- a train card (through the search, as tools/back-check.mjs) ----
  // a train whose card has stops to show (a Mer button); up to 8 tries
  async function openCard() {
    const numbers = await page.evaluate(() => [...new Set(window.__map.queryRenderedFeatures({ layers: ['train-dots'] })
      .map(f => String(window.__trains.get(f.properties.id)?.number ?? '')).filter(Boolean))].slice(0, 8));
    for (const number of numbers) {
      await page.evaluate(() => { if (document.getElementById('menu').hidden) document.getElementById('menu-button').click(); });
      await sleep(300);
      await page.evaluate((n) => { const i = document.getElementById('search'); i.focus(); i.value = n; i.dispatchEvent(new Event('input', { bubbles: true })); }, number);
      await sleep(500);
      await page.keyboard.press('Enter'); await sleep(1500);
      if (await page.evaluate(() => !document.getElementById('panel').hidden && Boolean(document.querySelector('#panel .panel-more')))) return true;
      await page.evaluate(() => document.querySelector('#panel .panel-close')?.click()); await sleep(300);
    }
    return false;
  }
  const card = () => page.evaluate(() => { const p = document.getElementById('panel'), r = p.getBoundingClientRect();
    return { open: !p.hidden, full: p.classList.contains('full'), h: Math.round(r.height), top: Math.round(r.top),
      transform: p.style.transform, styleH: p.style.height }; });
  // the height each frame for ms (during a glide)
  const sample = ms => page.evaluate(ms => new Promise((done) => { const out = [], t0 = performance.now();
    const step = () => { out.push(Math.round(document.getElementById('panel').getBoundingClientRect().height));
      if (performance.now() - t0 < ms) requestAnimationFrame(step); else done(out); }; requestAnimationFrame(step); }), ms);
  const between = (hs, a, b) => hs.filter(h => h > Math.min(a, b) + 3 && h < Math.max(a, b) - 3).length;
  async function drag(points, { hold = 0 } = {}) {   // from the card's handle, through dy points, then let go
    const c = await card();
    const x = PHONE.width / 2, y0 = c.top + 12;
    await page.mouse.move(x, y0); await page.mouse.down();
    for (const dy of points) { await page.mouse.move(x, y0 + dy, { steps: 6 }); await sleep(30); }
    if (hold) await sleep(hold);
    await page.mouse.up();
  }

  if (!(await openCard())) fails.push('setup: no train card opened');
  else {
    // ---- 2. Grown upwards, then back below the start ----
    const small = await card();
    await drag([-60, -150, -100, 0, 60]);
    await sleep(500);
    const s2 = await card();
    if (!s2.open || s2.full || Math.abs(s2.h - small.h) > 4 || (s2.transform && s2.transform !== 'none' && s2.transform !== 'translateY(0px)'))
      fails.push(`2 grow then down: open ${s2.open}, full ${s2.full}, height ${s2.h} (small ${small.h}), transform "${s2.transform}"`);
    notes.push(`2 grow then 60 px below the start: height ${s2.h} (small ${small.h}), transform "${s2.transform || 'none'}"`);
    await drag([-60, -150, 0, 170]);
    await sleep(600);
    const s2b = await card();
    if (s2b.open) fails.push('2 grow then 170 px down: the card did not close');
    if (!s2b.open && !(await openCard())) fails.push('setup: no train card reopened');

    // ---- 3. Glides: Mer, Mindre, the handle tap, a short drag down from full ----
    const glide = async (name, act, want) => {
      const a = await card();
      const [hs] = await Promise.all([sample(450), act()]);
      await sleep(150);
      const b = await card();
      const mid = between(hs, a.h, b.h);
      if (b.full !== want) fails.push(`3 ${name}: full ${b.full}, wanted ${want}`);
      if (mid < 3) fails.push(`3 ${name}: jumped ${a.h} → ${b.h} px (${mid} frames in between)`);
      notes.push(`3 ${name}: ${a.h} → ${b.h} px, ${mid} frames in between`);
    };
    const tapHandle = async () => { const c = await card(); await page.mouse.click(PHONE.width / 2, c.top + 12); };
    await glide('Mer', () => page.evaluate(() => document.querySelector('#panel .panel-more')?.click()), true);
    await glide('Mindre', () => page.evaluate(() => document.querySelector('#panel .panel-more')?.click()), false);
    await glide('handle tap up', tapHandle, true);
    await glide('short drag down from full', () => drag([30, 60]), false);
    await glide('handle tap up again', tapHandle, true);
    await glide('handle tap down', tapHandle, false);
  }
  if (errors.length) fails.push('page errors: ' + errors.slice(0, 3).join(' | '));
} finally { await browser.close(); }
for (const n of notes) console.log('  ' + n);
console.log(fails.length ? `sheet-check FAILED:\n  ${fails.join('\n  ')}` : 'sheet-check ok: the search fits with the keyboard up, the card comes back, every size change glides');
process.exit(fails.length ? 1 : 0);
