// Max's notes of 2026-11-21 (second batch), on the live page (the key page, Swedish, phone size):
//   - Statistik's "I dag, ankomster per timme" says "Laddar…" while it asks, also over the numbers saved earlier today;
//   - a filter on: the companies and kinds whose trains aren't on the map are dimmed, still buttons;
//   - "›" on a company opens its own page (only its trains, its trains today), "‹ Alla bolag" goes back;
//   - the search on a station's board: the whole day from the next train, a number or a destination narrows it, the
//     button again closes it.
// node tools/stats-board-check.mjs (with npm run dev; PAGE= for another port). Needs Trafikverket (live data).
import { launch, address, sleep, PHONE } from './lib/browser.mjs';

const fails = [], ok = [];
const check = (cond, what) => (cond ? ok : fails).push(what);
const browser = await launch();
try {
  const page = await browser.newPage();
  await page.setViewport(PHONE);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.evaluateOnNewDocument(() => { try { if (!sessionStorage.getItem('kept')) { localStorage.clear(); sessionStorage.setItem('kept', '1'); } } catch { /* none */ } });
  const ready = async () => {
    for (let t0 = Date.now(); Date.now() - t0 < 30000; await sleep(300)) if (await page.evaluate(() => (window.__trains?.count ?? 0) > 20).catch(() => false)) break;
    await sleep(2000);
  };
  await page.goto(address({ lang: 'sv' }), { waitUntil: 'domcontentloaded' });
  await ready();
  const graph = () => page.evaluate(() => Boolean(document.querySelector('#stats-page .st-dayin svg')));

  // ---- 1. "Laddar…" beside today's graph: the first time, and over the numbers saved earlier today ----
  const watchBusy = () => page.evaluate(() => {
    window.__busy = []; const t0 = performance.now();
    new MutationObserver(() => { const b = document.querySelector('#stats-page .st-busy'); if (!b) return; const v = b.hidden ? 'hidden' : 'shown';
      if (window.__busy.at(-1)?.[1] !== v) window.__busy.push([Math.round(performance.now() - t0), v]); })
      .observe(document.getElementById('stats-page'), { subtree: true, attributes: true, childList: true });
    document.getElementById('open-stats').click();
  });
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
  const rows = () => page.evaluate(() => [...document.querySelectorAll('#stats-page .st-brow')].filter(r => r.offsetParent)
    .map(r => ({ type: r.dataset.filter, v: r.dataset.v, off: r.classList.contains('st-off'), on: r.getAttribute('aria-pressed') === 'true' })));
  check((await rows()).every(r => !r.off), 'no filter: nothing dimmed');
  await page.evaluate(() => [...document.querySelectorAll('#stats-page .st-brow[data-filter="kind"]')].find(r => r.style.order === '0').click());   // the biggest kind
  await sleep(800);
  const after = await rows();
  const kind = after.find(r => r.type === 'kind' && r.on);
  check(after.filter(r => r.type === 'kind' && !r.on).every(r => r.off) && after.some(r => r.type === 'brand' && r.off) && after.some(r => r.type === 'brand' && !r.off),
    `a kind (${kind?.v}) on: the other kinds and the companies of other kinds dimmed, its own companies not`);
  await page.evaluate(() => document.querySelector('#stats-page .st-brow[data-filter="kind"][aria-pressed="true"]').click());
  await sleep(600);
  check((await rows()).every(r => !r.off), 'the filter off again: nothing dimmed');

  // ---- 3. a company's own page ----
  const allCount = Number(await page.evaluate(() => document.querySelector('#stats-page .st-count').textContent.replace(/\D/g, '')));
  const name = await page.evaluate(() => { const b = [...document.querySelectorAll('#stats-page .st-brow-w')].find(w => w.style.order === '0').querySelector('.st-cogo'); b.click(); return b.dataset.company; });
  await sleep(1500);
  const co = await page.evaluate(() => ({ head: document.querySelector('#stats-page .st-coname b')?.textContent, count: Number(document.querySelector('#stats-page .st-count')?.textContent.replace(/\D/g, '')),
    today: document.querySelector('#stats-page .st-cotoday')?.textContent ?? '', companies: Boolean(document.querySelector('#stats-page .st-cogo')) }));
  check(co.head === name && co.count > 0 && co.count < allCount && !co.companies, `"›" on ${name}: its page, ${co.count} of ${allCount} trains now, no company list`);
  check(/\d+ tåg i dag/.test(co.today), `its trains today: "${co.today}"`);
  await page.evaluate(() => document.querySelector('#stats-page .st-back').click());
  await sleep(1500);
  const back = await page.evaluate(() => ({ count: Number(document.querySelector('#stats-page .st-count').textContent.replace(/\D/g, '')), companies: Boolean(document.querySelector('#stats-page .st-cogo')) }));
  check(back.companies && back.count > co.count, `"‹ Alla bolag": all trains again (${back.count})`);
  await page.evaluate(() => document.querySelector('#stats-page .panel-close').click());
  await sleep(500);

  // ---- 4. the search on a station's board ----
  await page.evaluate(() => document.getElementById('menu-button').click());
  await sleep(400);
  await page.type('#search', 'Uppsala C');
  await sleep(800);
  await page.evaluate(() => [...document.querySelectorAll('#search-results button')].find(b => /Uppsala C/.test(b.textContent))?.click());
  for (let t0 = Date.now(); Date.now() - t0 < 15000; await sleep(300)) if (await page.evaluate(() => Boolean(document.querySelector('#board .bd-row')))) break;
  const look = () => page.evaluate(() => { const b = document.getElementById('board'), tab = b.querySelector('.board-found .panel-table');
    const list = [...b.querySelectorAll('.board-found .bd-row')], top = tab && list.find(r => r.offsetTop >= tab.scrollTop - 2);
    return { full: b.classList.contains('full'), n: list.length, gone: list.filter(r => r.classList.contains('gone')).length, topGone: top ? top.classList.contains('gone') : null,
      numbers: list.map(r => r.querySelector('.bd-name small').textContent.split(' ')[0]), names: list.map(r => r.querySelector('.bd-name b').textContent), empty: Boolean(b.querySelector('.board-found .state')) }; });
  await page.evaluate(() => document.querySelector('#board .board-find').click());
  // (the board's rows stay, dimmed, until the day is in: wait for the day)
  for (let t0 = Date.now(); Date.now() - t0 < 15000; await sleep(200)) if (await page.evaluate(() => Boolean(document.querySelector('#board .board-found:not(.busy) .bd-row')) && !document.querySelector('#board .board-found .busy'))) break;
  const day = await look();
  check(day.full && day.n > 30 && day.topGone === false, `the search: the card full, the whole day (${day.n} trains, ${day.gone} gone), starting at the next train`);
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
  const closed = await page.evaluate(() => ({ full: document.getElementById('board').classList.contains('full'), q: Boolean(document.querySelector('#board .board-q')), rows: document.querySelectorAll('#board .bd-row').length }));
  check(!closed.full && !closed.q && closed.rows > 0, `the button again: the board as before (${closed.rows} trains)`);
  check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
} finally {
  await browser.close();
}
for (const o of ok) console.log(`ok   ${o}`);
for (const f of fails) console.log(`FAIL ${f}`);
console.log(fails.length ? `stats-board-check: ${fails.length} failed` : 'stats-board-check ok: Statistik\'s loading, dimming and company pages, the board\'s search');
process.exit(fails.length ? 1 : 0);
