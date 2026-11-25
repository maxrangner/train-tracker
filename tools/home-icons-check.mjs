// Home's cards' icons and numbers (Max's pick A, 2026-11-25: "Give each sub card an icon before the title. And make it
// dynamic, like 'störningar' shows correctly colored triangle and number of total störningar"; src/icons.js titleIcon,
// src/home.js, src/stats-page.js). On the replay (CARD_HOUR), a computer's screen, Swedish:
// - every card's title on Home has its icon (Filter, Sparade, Sverige just nu and Statistik's cards, Mest sena; the data
//   line too), and the same titles have theirs in English;
// - the colours: Punktlighet's in the on-time colour, Inställda's and Mest sena's in the late colour;
// - the numbers: Filter none with nothing picked, 1 with a company picked, 2 with a lateness colour lit too, none again
//   when both let go; Sparade none with nothing saved, 1 with a saved trip; Mest sena "+N", N the most late train's
//   minutes in its list;
// - a title stays the same element while nothing in it changes (it is not drawn again each second).
// Live (Störningar is live only): its number is every disruption, as "Alla störningar" counts them; its triangle in the
// colour of the worst one shown (the first row's icon box), grey with rail work alone. None active: said, not failed.
// Run: PAGE=http://localhost:5181/ node tools/home-icons-check.mjs
import { launch, sleep, CARD_HOUR } from './lib/browser.mjs';
import { waitForMap, until, HOME } from './lib/screen.mjs';

let failed = 0;
const ok = (good, what) => { console.log(`${good ? 'ok  ' : 'FAIL'} ${what}`); if (!good) failed++; };
const PC = { width: 1400, height: 900, deviceScaleFactor: 1 };
const KEYS = ['filter', 'saved', 'sweden', 'driven', 'cancelled', 'punctuality', 'kinds', 'companies', 'mostLate', 'fastest', 'busiest', 'fun'];

// In the page: Home's titles by what they are (found by their place, not their words), each with its icon, colour, number.
function titles() {
  const home = document.querySelector('#sheet .pg[data-key="home"]');
  const sec = k => home.querySelector(`:scope > .sec.${k}`);
  const lbl = sel => home.querySelector(sel);
  const at = {
    filter: sec('filter-card')?.querySelector('h4.lab'),
    saved: home.querySelector('[data-saved], .add-row, .empty')?.closest('.sec')?.querySelector(':scope > h4.lab'),
    disruptions: home.querySelector('.dis-list')?.closest('.sec')?.querySelector(':scope > h4.lab'),
    sweden: lbl('.home-stats > h3.big'),
    driven: lbl('.st-duo .st-tile:not(.st-cancel) > .st-lbl'),
    cancelled: lbl('.st-duo .st-cancel > .st-lbl'),
    punctuality: lbl('.st-punct > .st-lbl'),
    kinds: [...home.querySelectorAll('.st-sec-bars')].find(s => s.querySelector('[data-filter="kind"]'))?.querySelector('.st-lbl'),
    companies: [...home.querySelectorAll('.st-sec-bars')].find(s => s.querySelector('[data-filter="brand"]'))?.querySelector('.st-lbl'),
    mostLate: lbl('.most-late > h4.lab'),
    fastest: lbl('.st-fast')?.closest('.st-sec')?.querySelector('.st-lbl'),
    busiest: lbl('.st-rank')?.closest('.st-sec')?.querySelector('.st-lbl'),
    fun: lbl('.st-fun .st-lbl'),
  };
  const probe = (colour) => { const p = document.createElement('i'); p.style.color = colour; home.append(p); const c = getComputedStyle(p).color; p.remove(); return c; };
  const out = {};
  for (const [k, el] of Object.entries(at)) {
    if (!el) { out[k] = null; continue; }
    const ic = el.querySelector(':scope > .ct-ic svg');
    out[k] = { icon: Boolean(ic), colour: ic ? getComputedStyle(ic.parentElement).color : null, n: el.querySelector(':scope > .ct-n')?.textContent ?? null, text: el.textContent.trim() };
  }
  out.data = { icon: Boolean(home.querySelector('.st-data > .ct-ic svg')) };
  out.colours = { ontime: probe('var(--c-ontime)'), late: probe('var(--c-late)'), muted: probe('var(--muted)'), d1: probe('var(--dis-1)'), d2: probe('var(--dis-2)'), d3: probe('var(--dis-3)') };
  const rows = [...home.querySelectorAll('.most-late .row .tag')].map(t => Number(/(\d+)/.exec(t.textContent)?.[1] ?? 0));
  out.mostLateTop = rows.length ? Math.max(...rows) : null;
  return out;
}
const full = async (page) => { await page.evaluate(() => window.__stack.setLevel(2)); await sleep(1200); };

const browser = await launch();
try {
  // ---- the replay, Swedish ----
  let page = await waitForMap(browser, { size: PC, replay: CARD_HOUR, lang: 'sv' });
  await sleep(2500);
  await full(page);
  await until(page, () => Boolean(document.querySelector('#sheet .co-filter')), 20000);
  await sleep(1500);
  let s = await page.evaluate(titles);
  const missing = KEYS.filter(k => !s[k]?.icon);
  ok(!missing.length && s.data.icon, `every card's title on Home has its icon (${KEYS.length} titles and the data line)${missing.length ? `; missing: ${missing.join(', ')}` : ''}${s.data.icon ? '' : '; the data line has none'}`);
  ok(s.punctuality?.colour === s.colours.ontime && s.cancelled?.colour === s.colours.late && s.mostLate?.colour === s.colours.late,
    `colours: Punktlighet ${s.punctuality?.colour} (on time ${s.colours.ontime}), Inställda ${s.cancelled?.colour} and Mest sena ${s.mostLate?.colour} (late ${s.colours.late})`);
  ok(s.filter?.n === null, `Filter with nothing picked: no number (${s.filter?.n ?? 'none'})`);
  ok(s.saved?.n === null, `Sparade with nothing saved: no number (${s.saved?.n ?? 'none'})`);
  ok(s.mostLateTop === null ? s.mostLate?.n === null : s.mostLate?.n === `+${s.mostLateTop}`, `Mest sena: "${s.mostLate?.n}" (its list's most late: ${s.mostLateTop === null ? 'none' : `+${s.mostLateTop}`})`);

  // not drawn again each second: the same elements a while later
  await page.evaluate(() => { const h = document.querySelector('#sheet .pg[data-key="home"]'); window.__keep = [h.querySelector('.home-stats > h3.big'), h.querySelector('.st-punct > .st-lbl'), h.querySelector('.add-row, [data-saved]')?.closest('.sec')?.querySelector('h4.lab')]; });
  await sleep(3500);
  const kept = await page.evaluate(() => window.__keep.map(e => Boolean(e?.isConnected)));
  ok(kept.every(Boolean), `titles not drawn again while nothing in them changed (Sverige just nu, Punktlighet, Sparade: ${kept.join(', ')})`);

  // Filter's number follows what is picked
  await page.evaluate(() => window.__stack.setLevel(1)); await sleep(900);
  await page.evaluate(s => document.querySelector(`${s} [data-cofilter]`).click(), HOME); await sleep(1200);
  const f1 = (await page.evaluate(titles)).filter?.n;
  await page.evaluate(s => document.querySelector(`${s} .lg-p[data-legend]`).click(), HOME); await sleep(1200);
  const f2 = (await page.evaluate(titles)).filter?.n;
  await page.evaluate(s => { document.querySelector(`${s} .lg-p.on`)?.click(); }, HOME); await sleep(900);
  await page.evaluate(s => { document.querySelector(`${s} [data-cofilter].on`)?.click(); }, HOME); await sleep(1200);
  const f0 = (await page.evaluate(titles)).filter?.n;
  ok(f1 === '1' && f2 === '2' && f0 === null, `Filter's number: a company picked "${f1}" (want 1), a lateness lit too "${f2}" (want 2), both let go: ${f0 ?? 'none'}`);

  // Sparade's number: a saved trip
  await page.evaluate(() => localStorage.setItem('favourites', JSON.stringify({ stations: [], trains: [], trips: [{ key: 'Cst>G', from: 'Cst', to: 'G' }], changes: [] })));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await until(page, () => window.__stack?.top?.() === 'home' && Boolean(document.querySelector('#sheet .trip-row')), 30000);
  await sleep(1500);
  await page.evaluate(() => window.__stack.setLevel(1)); await sleep(1200);
  s = await page.evaluate(titles);
  ok(s.saved?.n === '1', `Sparade with a saved trip: "${s.saved?.n ?? 'none'}" (want 1)`);
  await page.evaluate(() => localStorage.removeItem('favourites'));
  if (page.errors.length) ok(false, `page errors: ${page.errors.slice(0, 3).join(' | ')}`);
  await page.close();

  // ---- English: the same titles with their icons ----
  page = await waitForMap(browser, { size: PC, replay: CARD_HOUR, lang: 'en' });
  await sleep(2000);
  await full(page);
  await until(page, () => Boolean(document.querySelector('#sheet .co-filter')), 20000);
  await sleep(1000);
  s = await page.evaluate(titles);
  const missingEn = KEYS.filter(k => !s[k]?.icon);
  ok(!missingEn.length && s.data.icon, `in English too: ${KEYS.length - missingEn.length} of ${KEYS.length} titles with their icon (${KEYS.map(k => s[k]?.text).filter(Boolean).slice(0, 4).join(', ')}, ...)`);
  await page.close();

  // ---- live: Störningar ----
  page = await waitForMap(browser, { size: PC, lang: 'sv', wait: 20000 });
  await page.evaluate(() => window.__stack.setLevel(2)); await sleep(800);
  const came = await until(page, () => Boolean(document.querySelector('#sheet .pg[data-key="home"] .dis-list')), 45000);
  await sleep(1200);
  if (!came) console.log('note Störningar not checked: the disruptions did not come (live only)');
  else {
    const dis = await page.evaluate(() => {
      const home = document.querySelector('#sheet .pg[data-key="home"]'), list = home.querySelector('.dis-list'), h = list.closest('.sec').querySelector(':scope > h4.lab');
      const ic = h.querySelector(':scope > .ct-ic'), first = list.querySelector('.dis-row:not(.dis-all) .dis-ic');
      const sub = list.querySelector('.dis-all .dis-sub')?.textContent ?? '';
      const total = (sub.match(/\d+/g) ?? []).map(Number).reduce((a, b) => a + b, 0);
      return { icon: Boolean(ic?.querySelector('svg')), colour: ic ? getComputedStyle(ic).color : null, n: h.querySelector(':scope > .ct-n')?.textContent ?? null, total, sub,
        worst: first ? getComputedStyle(first).color : null, muted: (() => { const p = document.createElement('i'); p.style.color = 'var(--muted)'; home.append(p); const c = getComputedStyle(p).color; p.remove(); return c; })() };
    });
    ok(dis.icon, 'Störningar has its triangle');
    if (!dis.total) console.log(`note no disruptions active now ("${dis.sub || 'none'}"): its number and colour checked as none and grey`);
    ok(dis.total ? dis.n === String(dis.total) : dis.n === null, `Störningar's number "${dis.n ?? 'none'}", "Alla störningar" counts ${dis.total} ("${dis.sub}")`);
    ok(dis.colour === (dis.worst ?? dis.muted), `Störningar's triangle ${dis.colour}, the worst shown ${dis.worst ?? `none: grey ${dis.muted}`}`);
  }
  if (page.errors.length) ok(false, `page errors (live): ${page.errors.slice(0, 3).join(' | ')}`);
  await page.close();
} finally {
  await browser.close();
}
console.log(failed ? `home-icons-check: ${failed} failed` : 'home-icons-check: all ok');
process.exit(failed ? 1 : 0);
