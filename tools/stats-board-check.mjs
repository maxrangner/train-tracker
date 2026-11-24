// Max's notes of 2026-11-21 (second batch), on the live page (the key page, Swedish, phone size):
//   - Statistik's "I dag, ankomster per timme" says "Laddar…" while it asks, also over the numbers saved earlier today;
//   - a filter on: the companies and kinds whose trains aren't on the map are dimmed, still buttons;
//   - a company opens its own page (only its trains, its arrivals today), back goes to all of them;
//   - the search on a station's board: the whole day from the next train, a number or a destination narrows it, the
//     button again closes it (and the sheet goes back to its height before).
// Since the one sheet (2026-11-22): Statistik is Home pulled up to full (.pg[data-key="home"]); a filter is a kind's
// or company's page with "Visa bara" kept (the line above the bar says so, its × ends it); a company's page is
// co:<brand> (its name, its trains on the map now, its day graph), back is the stack's back chip ("Hem"); Busiest's
// rows open the station's board (station:<sig>).
// node tools/stats-board-check.mjs (with npm run dev; PAGE= for another port). Needs Trafikverket (live data).
import { launch, sleep } from './lib/browser.mjs';
import { waitForMap, until, setLevel, toRest, back, sheetState, openStationByName, HOME, pageSel } from './lib/screen.mjs';

const fails = [], ok = [];
const check = (cond, what) => (cond ? ok : fails).push(what);
const browser = await launch();
try {
  const page = await waitForMap(browser, { lang: 'sv' });
  await page.evaluateOnNewDocument(() => { try { if (!sessionStorage.getItem('kept')) { localStorage.clear(); sessionStorage.setItem('kept', '1'); } } catch { /* none */ } });
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.setItem('kept', '1'); } catch { /* none */ } });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const ready = async () => {
    await until(page, () => (window.__trains?.count ?? 0) > 20 && Boolean(window.__stack?.top()), 30000);
    await sleep(2000);
  };
  await ready();
  const graph = () => page.evaluate(h => Boolean(document.querySelector(`${h} .st-dayin svg`)), HOME);

  // ---- 1. "Laddar…" beside today's graph: the first time Home is pulled up, and over the numbers saved earlier today ----
  const watchBusy = () => page.evaluate((h) => {
    window.__busy = []; const t0 = performance.now(), home = document.querySelector(h);
    const look = () => { const b = home.querySelector('.st-busy'); if (!b) return; const v = b.hidden ? 'hidden' : 'shown';
      if (window.__busy.at(-1)?.[1] !== v) window.__busy.push([Math.round(performance.now() - t0), v]); };
    new MutationObserver(look).observe(home, { subtree: true, attributes: true, childList: true });
    look();
    window.__stack.setLevel(2);
  }, HOME);
  await watchBusy();
  for (let t0 = Date.now(); Date.now() - t0 < 25000 && !(await graph()); await sleep(300));
  await sleep(500);
  const first = await page.evaluate(() => window.__busy);
  check(first.some(x => x[1] === 'shown') && first.at(-1)?.[1] === 'hidden', `the first time: "Laddar…" while asking, gone with the graph (${JSON.stringify(first)})`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  await watchBusy();
  for (let t0 = Date.now(); Date.now() - t0 < 25000; await sleep(300)) if ((await page.evaluate(() => window.__busy.at(-1)?.[1])) === 'hidden' && (await graph())) break;
  const saved = await page.evaluate(() => window.__busy);
  check(saved.some(x => x[1] === 'shown'), `numbers saved earlier today: "Laddar…" over them while asking (${JSON.stringify(saved)})`);

  // ---- 2. a filter on: rows whose trains aren't on the map dimmed ----
  const rows = () => page.evaluate(h => [...document.querySelectorAll(`${h} .st-brow`)].filter(r => r.offsetParent)
    .map(r => ({ type: r.dataset.filter, v: r.dataset.v, off: r.classList.contains('st-off'), on: r.getAttribute('aria-pressed') === 'true' })), HOME);
  check((await rows()).every(r => !r.off), 'no filter: nothing dimmed');
  // the biggest kind: its page, "Visa bara", back to Home
  const kindV = await page.evaluate(h => { const r = [...document.querySelectorAll(`${h} .st-brow[data-filter="kind"]`)].find(x => x.style.order === '0'); r.click(); return r.dataset.v; }, HOME);
  await until(page, k => window.__stack.top() === `kind:${k}`, 3000, kindV);
  await sleep(500);
  await page.evaluate(() => document.querySelector('#sheet .show-only')?.click());
  await sleep(300);
  await back(page);
  await setLevel(page, 2);
  await sleep(800);
  const after = await rows();
  const kind = after.find(r => r.type === 'kind' && r.v === kindV);
  const line = await page.evaluate(() => (document.getElementById('line').hidden ? '' : document.getElementById('line').textContent));
  check(after.filter(r => r.type === 'kind' && r.v !== kindV).every(r => r.off) && !kind?.off && after.some(r => r.type === 'brand' && r.off) && after.some(r => r.type === 'brand' && !r.off),
    `a kind (${kindV}) shown only: the other kinds and the companies of other kinds dimmed, its own companies not (the line: "${line}")`);
  await page.evaluate(() => document.querySelector('#line .line-x')?.click());
  await sleep(600);
  check((await rows()).every(r => !r.off), 'the filter off again (× on the line): nothing dimmed');

  // ---- 3. a company's own page ----
  const allCount = Number(await page.evaluate(h => document.querySelector(`${h} .st-count`).textContent.replace(/\D/g, ''), HOME));
  const name = await page.evaluate(h => { const b = [...document.querySelectorAll(`${h} .st-brow[data-filter="brand"]`)].filter(x => x.dataset.v).sort((a, c) => a.style.order - c.style.order)[0]; b.click(); return b.dataset.v; }, HOME);
  await until(page, n => window.__stack.top() === `co:${n}`, 3000, name);
  await sleep(1500);
  const sel = pageSel(`co:${name}`);
  for (let t0 = Date.now(); Date.now() - t0 < 15000; await sleep(300)) if (await page.evaluate(s => Boolean(document.querySelector(`${s} .st-dayin svg`)), sel)) break;
  const co = await page.evaluate(s => ({ head: document.querySelector(`${s} .g-head .ttl`)?.textContent, count: Number(document.querySelector(`${s} .tiles .tile b`)?.textContent.replace(/\D/g, '')),
    today: document.querySelector(`${s} .st-dayin`)?.parentElement?.textContent ?? '', graph: Boolean(document.querySelector(`${s} .st-dayin svg`)),
    rows: [...document.querySelectorAll(`${s} .rows [data-go^="train:"]`)].length, companies: Boolean(document.querySelector(`${s} .st-brow[data-filter="brand"]`)) }), sel);
  check(co.head === name && co.count > 0 && co.count < allCount && !co.companies && co.rows === Math.min(co.count, 80), `${name}: its page, ${co.count} of ${allCount} trains now (${co.rows} listed), no company list`);
  check(co.graph && /ankomst/.test(co.today), `its arrivals today: "${co.today.replace(/\s+/g, ' ').slice(0, 80)}"`);
  const s = await sheetState(page);
  const backKey = await back(page);
  await sleep(800);
  const homeAgain = await page.evaluate(h => ({ count: Number(document.querySelector(`${h} .st-count`).textContent.replace(/\D/g, '')), companies: Boolean(document.querySelector(`${h} .st-brow[data-filter="brand"]`)) }), HOME);
  check(s.keys.at(-2) === 'home' && backKey === 'home' && homeAgain.companies && homeAgain.count > co.count, `back from ${s.keys.join(' > ')}: ${backKey}, all trains again (${homeAgain.count})`);
  // Busiest's rows open the station's board
  const busy = await page.evaluate(h => { const b = document.querySelector(`${h} .st-rank [data-sig]`); b?.click(); return Boolean(b); }, HOME);
  if (busy) {
    await sleep(1200);
    const k = await page.evaluate(() => window.__stack.top());
    check(k.startsWith('station:'), `a busiest station tapped: ${k}`);
  } else ok.push('(no busiest station listed now: its tap not checked)');
  await toRest(page);

  // ---- 4. the search on a station's board (opened at half height: the search raises the sheet, closed it comes back) ----
  if (!(await openStationByName(page, 'Uppsala C'))) throw new Error('no Uppsala C in the search');
  for (let t0 = Date.now(); Date.now() - t0 < 15000; await sleep(300)) if (await page.evaluate(() => Boolean(document.querySelector('#board .bd-row')))) break;
  const levelBefore = await page.evaluate(() => window.__stack.level);
  const look = () => page.evaluate(() => { const b = document.getElementById('board'), tab = b.querySelector('.board-found .panel-table'), pg = b.closest('.pg');
    const list = [...b.querySelectorAll('.board-found .bd-row')], top = tab && list.find(r => r.offsetTop >= tab.scrollTop - 2 && r.getBoundingClientRect().top >= pg.getBoundingClientRect().top - 2);
    return { full: b.classList.contains('full'), level: window.__stack.level, n: list.length, gone: list.filter(r => r.classList.contains('gone')).length, topGone: top ? top.classList.contains('gone') : null,
      numbers: list.map(r => r.querySelector('.bd-name small').textContent.split(' ')[0]), names: list.map(r => r.querySelector('.bd-name b').textContent), empty: Boolean(b.querySelector('.board-found .state')) }; });
  await page.evaluate(() => document.querySelector('#board .board-find').click());
  // (the board's rows stay, dimmed, until the day is in: wait for the day)
  for (let t0 = Date.now(); Date.now() - t0 < 15000; await sleep(200)) if (await page.evaluate(() => Boolean(document.querySelector('#board .board-found:not(.busy) .bd-row')) && !document.querySelector('#board .board-found .busy'))) break;
  await sleep(500);
  const day = await look();
  check(day.full && day.level === 2 && day.n > 30 && day.topGone === false, `the search: the sheet at full (${day.level}), the whole day (${day.n} trains, ${day.gone} gone), starting at the next train`);
  const num = day.numbers.find(Boolean).slice(0, 2);
  await page.type('#board .board-q', num);
  await sleep(300);
  const byNum = await look();
  check(byNum.n > 0 && byNum.n < day.n && byNum.numbers.every(n => n.startsWith(num)), `"${num}": ${byNum.n} trains, every number starting so`);
  await page.evaluate(() => { const q = document.querySelector('#board .board-q'); q.value = 'stockholm'; q.dispatchEvent(new Event('input')); });
  await sleep(300);
  const byName = await look();
  check(byName.n > 0 && byName.names.every(n => /stockholm/i.test(n)), `"stockholm": ${byName.n} trains, every one to a Stockholm station`);
  await page.evaluate(() => { const q = document.querySelector('#board .board-q'); q.value = 'xyzq'; q.dispatchEvent(new Event('input')); });
  await sleep(200);
  check((await look()).empty, '"xyzq": "Inget tåg i dag matchar."');
  await page.evaluate(() => document.querySelector('#board .board-find').click());
  await sleep(1500);
  const closed = await page.evaluate(() => ({ full: document.getElementById('board').classList.contains('full'), q: Boolean(document.querySelector('#board .board-q')), rows: document.querySelectorAll('#board .bd-row').length, level: window.__stack.level }));
  check(!closed.full && !closed.q && closed.rows > 0 && closed.level === levelBefore, `the button again: the board as before (${closed.rows} trains), the sheet back at ${closed.level} (was ${levelBefore})`);
  check(!page.errors.length, `no page errors${page.errors.length ? `: ${page.errors.slice(0, 3).join(' | ')}` : ''}`);
} finally {
  await browser.close();
}
for (const o of ok) console.log(`ok   ${o}`);
for (const f of fails) console.log(`FAIL ${f}`);
console.log(fails.length ? `stats-board-check: ${fails.length} failed` : 'stats-board-check ok: Statistik\'s loading on Home, dimming and company pages, the board\'s search');
process.exit(fails.length ? 1 : 0);
