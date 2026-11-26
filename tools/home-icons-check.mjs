// The start's cards' icons and numbers (Max's pick A, 2026-11-25: "Give each sub card an icon before the title. And make
// it dynamic, like 'störningar' shows correctly colored triangle and number of total störningar"; src/icons.js titleIcon,
// src/home.js, src/stats-page.js). Home's cards until the start chips (Max's pick C, 2026-11-25); since then the same
// titles on the pages they went to: Filter (☰), Sparade and Statistik (chips), Störningar's on its chip
// (src/start-chips.js). On the replay (CARD_HOUR), a computer's screen, Swedish:
// - every card's title has its icon (Filter, Sparade, Sverige just nu and Statistik's cards, Mest sena; the data line
//   too), and the same titles have theirs in English;
// - the colours: Punktlighet's in the on-time colour, Inställda's and Mest sena's in the late colour;
// - the numbers: Filter none with nothing picked, 1 with a company picked, 2 with a lateness colour lit too, none again
//   when both let go; Sparade none with nothing saved, 1 with a saved trip (its chip the same); Mest sena "+N", N the
//   most late train's minutes in its list;
// - a title stays the same element while nothing in it changes (it is not drawn again each second).
// Live (Störningar is live only): its chip's number is every disruption, as its list holds them (the problems and the
// rail work); its triangle in the colour of the worst one shown (the first row's icon box), grey with rail work alone.
// None active: said, not failed.
// Run: PAGE=http://localhost:5181/ node tools/home-icons-check.mjs
import { launch, sleep, CARD_HOUR } from './lib/browser.mjs';
import { waitForMap, until, toRest, openChip, openFromMenu, openDisruptions, pageSel } from './lib/screen.mjs';

let failed = 0;
const ok = (good, what) => { console.log(`${good ? 'ok  ' : 'FAIL'} ${what}`); if (!good) failed++; };
const PC = { width: 1400, height: 900, deviceScaleFactor: 1 };
const KEYS = ['filter', 'saved', 'sweden', 'driven', 'cancelled', 'punctuality', 'kinds', 'companies', 'mostLate', 'fastest', 'busiest', 'fun'];

// In the page: a start page's titles by what they are (found by their place, not their words), each with its icon,
// colour, number; null for what that page doesn't hold.
function titles(sel) {
  const home = document.querySelector(sel);
  if (!home) return { data: { icon: false } };
  const lbl = s => home.querySelector(s);
  const at = {
    filter: lbl('.panel-head strong'),
    saved: home.querySelector('[data-saved], .add-row, .empty')?.closest('.sec')?.querySelector(':scope > h4.lab'),
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
    if (!el) continue;
    const ic = el.querySelector(':scope > .ct-ic svg');
    out[k] = { icon: Boolean(ic), colour: ic ? getComputedStyle(ic.parentElement).color : null, n: el.querySelector(':scope > .ct-n')?.textContent ?? null, text: el.textContent.trim() };
  }
  if (home.querySelector('.st-data')) out.data = { icon: Boolean(home.querySelector('.st-data > .ct-ic svg')) };
  out.colours = { ontime: probe('var(--c-ontime)'), late: probe('var(--c-late)') };
  const rows = [...home.querySelectorAll('.most-late .row .tag')].map(t => Number(/(\d+)/.exec(t.textContent)?.[1] ?? 0));
  if (home.querySelector('.most-late')) out.mostLateTop = rows.length ? Math.max(...rows) : null;
  return out;
}
// A start chip's number (the one over the map at rest)
const chipN = (page, key) => page.evaluate(k => document.querySelector(`#chips [data-chip="${k}"] .ct-n`)?.textContent ?? null, key);
// Every start page's titles: Filter from ☰, Sparade and Statistik (at full) from their chips; merged into one
async function allTitles(page) {
  await openFromMenu(page, 'filter');
  await until(page, s => Boolean(document.querySelector(`${s} .co-filter`)), 20000, pageSel('filter'));
  const f = await page.evaluate(titles, pageSel('filter'));
  await toRest(page);
  await openChip(page, 'saved');
  const sv = await page.evaluate(titles, pageSel('saved'));
  await openChip(page, 'stats');
  await page.evaluate(() => window.__stack.setLevel(2)); await sleep(1500);
  const st = await page.evaluate(titles, pageSel('stats'));
  return { ...st, filter: f.filter, saved: sv.saved };
}

const browser = await launch();
try {
  // ---- the replay, Swedish ----
  let page = await waitForMap(browser, { size: PC, replay: CARD_HOUR, lang: 'sv' });
  await sleep(2500);
  let s = await allTitles(page);
  const missing = KEYS.filter(k => !s[k]?.icon);
  ok(!missing.length && s.data?.icon, `every card's title on the start's pages has its icon (${KEYS.length} titles and the data line)${missing.length ? `; missing: ${missing.join(', ')}` : ''}${s.data?.icon ? '' : '; the data line has none'}`);
  ok(s.punctuality?.colour === s.colours.ontime && s.cancelled?.colour === s.colours.late && s.mostLate?.colour === s.colours.late,
    `colours: Punktlighet ${s.punctuality?.colour} (on time ${s.colours.ontime}), Inställda ${s.cancelled?.colour} and Mest sena ${s.mostLate?.colour} (late ${s.colours.late})`);
  ok(s.filter?.n === null, `Filter with nothing picked: no number (${s.filter?.n ?? 'none'})`);
  const sc0 = await chipN(page, 'saved');
  ok(s.saved?.n === null && sc0 === null, `Sparade with nothing saved: no number (its title ${s.saved?.n ?? 'none'}, its chip ${sc0 ?? 'none'})`);
  ok(s.mostLateTop === null ? s.mostLate?.n === null : s.mostLate?.n === `+${s.mostLateTop}`, `Mest sena: "${s.mostLate?.n}" (its list's most late: ${s.mostLateTop === null ? 'none' : `+${s.mostLateTop}`})`);

  // not drawn again each second: the same elements a while later (Statistik open; then Sparade's)
  await page.evaluate((st) => { const h = document.querySelector(st); window.__keep = [h.querySelector('.home-stats > h3.big'), h.querySelector('.st-punct > .st-lbl')]; }, pageSel('stats'));
  await sleep(3500);
  const kept = await page.evaluate(() => window.__keep.map(e => Boolean(e?.isConnected)));
  await openChip(page, 'saved');
  await page.evaluate((sv) => { window.__keep = [document.querySelector(sv)?.querySelector('.add-row, [data-saved], .empty')?.closest('.sec')?.querySelector('h4.lab')]; }, pageSel('saved'));
  await sleep(3500);
  kept.push(...await page.evaluate(() => window.__keep.map(e => Boolean(e?.isConnected))));
  ok(kept.every(Boolean), `titles not drawn again while nothing in them changed (Sverige just nu, Punktlighet, Sparade: ${kept.join(', ')})`);

  // Filter's number follows what is picked (the Filter page stays open)
  await toRest(page);
  await openFromMenu(page, 'filter');
  const F = pageSel('filter');
  const fn = async () => (await page.evaluate(titles, F)).filter?.n ?? null;
  await page.evaluate(f => document.querySelector(`${f} [data-cofilter]`).click(), F); await sleep(1200);
  const f1 = await fn();
  await page.evaluate(f => document.querySelector(`${f} .lg-p[data-legend]`).click(), F); await sleep(1200);
  const f2 = await fn();
  await page.evaluate(f => { document.querySelector(`${f} .lg-p.on`)?.click(); }, F); await sleep(900);
  await page.evaluate(f => { document.querySelector(`${f} [data-cofilter].on`)?.click(); }, F); await sleep(1200);
  const f0 = await fn();
  ok(f1 === '1' && f2 === '2' && f0 === null, `Filter's number: a company picked "${f1}" (want 1), a lateness lit too "${f2}" (want 2), both let go: ${f0 ?? 'none'}`);
  await toRest(page);

  // Sparade's number: a saved trip (its title and its chip)
  await page.evaluate(() => localStorage.setItem('favourites', JSON.stringify({ stations: [], trains: [], trips: [{ key: 'Cst>G', from: 'Cst', to: 'G' }], changes: [] })));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await until(page, () => window.__stack?.top?.() === 'home' && Boolean(document.querySelector('#chips [data-chip="saved"]')), 30000);
  await sleep(1500);
  await openChip(page, 'saved');
  await until(page, sv => Boolean(document.querySelector(`${sv} .trip-row`)), 10000, pageSel('saved'));
  s = await page.evaluate(titles, pageSel('saved'));
  await toRest(page);
  const sc1 = await chipN(page, 'saved');
  ok(s.saved?.n === '1' && sc1 === '1', `Sparade with a saved trip: its title "${s.saved?.n ?? 'none'}", its chip "${sc1 ?? 'none'}" (want 1)`);
  await page.evaluate(() => localStorage.removeItem('favourites'));
  if (page.errors.length) ok(false, `page errors: ${page.errors.slice(0, 3).join(' | ')}`);
  await page.close();

  // ---- English: the same titles with their icons ----
  page = await waitForMap(browser, { size: PC, replay: CARD_HOUR, lang: 'en' });
  await sleep(2000);
  s = await allTitles(page);
  const missingEn = KEYS.filter(k => !s[k]?.icon);
  ok(!missingEn.length && s.data?.icon, `in English too: ${KEYS.length - missingEn.length} of ${KEYS.length} titles with their icon (${KEYS.map(k => s[k]?.text).filter(Boolean).slice(0, 4).join(', ')}, ...)`);
  await page.close();

  // ---- live: Störningar, its chip ----
  page = await waitForMap(browser, { size: PC, lang: 'sv', wait: 20000 });
  const came = await openDisruptions(page, { wait: 45000 });
  await sleep(1200);
  if (!came) console.log('note Störningar not checked: the disruptions did not come (live only)');
  else {
    const dis = await page.evaluate((L) => {
      // (the chip over the map at rest, as it is seen there: the lit one in the card's head has the lit look)
      const list = document.querySelector(L), chip = document.querySelector('#chips [data-chip="dislist"]');
      const ic = chip?.querySelector(':scope > .ct-ic'), first = list.querySelector('.dis-body > .dis-row .dis-ic');
      const muted = (() => { const p = document.createElement('i'); p.style.color = 'var(--muted)'; list.append(p); const c = getComputedStyle(p).color; p.remove(); return c; })();
      return { icon: Boolean(ic?.querySelector('svg')), colour: ic ? getComputedStyle(ic).color : null, n: chip?.querySelector(':scope > .ct-n')?.textContent ?? null,
        total: list.querySelectorAll('.dis-row').length, works: list.querySelectorAll('.dis-works .dis-row').length, worst: first ? getComputedStyle(first).color : null, muted };
    }, pageSel('dislist'));
    ok(dis.icon, 'Störningar\'s chip has its triangle');
    if (!dis.total) console.log('note no disruptions active now: its number and colour checked as none and grey');
    ok(dis.total ? dis.n === String(dis.total) : dis.n === null, `Störningar's number "${dis.n ?? 'none'}", its list holds ${dis.total} (${dis.works} of them rail work)`);
    ok(dis.colour === (dis.worst ?? dis.muted), `Störningar's triangle ${dis.colour}, the worst shown ${dis.worst ?? `none: grey ${dis.muted}`}`);
  }
  if (page.errors.length) ok(false, `page errors (live): ${page.errors.slice(0, 3).join(' | ')}`);
  await page.close();
} finally {
  await browser.close();
}
console.log(failed ? `home-icons-check: ${failed} failed` : 'home-icons-check: all ok');
process.exit(failed ? 1 : 0);
