// The small animations (Max's picks 1, 4, 6, 7, 8, 9 of 2026-11-20; the example page
// https://claude.ai/artifact/QJRLpa8nQ1wpDvJnvaHiFe; src/motion.js and index.html "Motion"), on a phone-size page:
//   1 a held button presses in and springs back; 9 the ☰ menu's rows follow it in;
//   6 search rows arrive, and the same results again move nothing; the card's timeline rows arrive as it opens full,
//     and its refresh moves nothing; Störningar's rows arrive as it opens (live data, skipped without problems);
//   4 + 7 the card's lateness rolls to new minutes and its tile pulses, ending on the exact text; nothing rolls when a
//     card opens; Anslutning's numbers roll, not when it opens;
//   8 a tapped station (and a disruption sign, live) gets a copy that grows and is removed;
//   with "reduce motion": none of it. Also the longest pause between frames during the menu, a lateness change and the
//   search rows, with the processor slowed 4x (measured, not a limit).
// Since the one sheet (2026-11-22): ☰'s menu has 3 rows (The day, Settings, About Spårat) and no count; the search's
// rows are .row / .chip with data-go; a train, Connection and the disruptions are pages in the sheet (tools/lib/screen.mjs).
// node tools/ui-motion-check.mjs (with npm run dev; PAGE= for another port).
import { launch, sleep, CARD_HOUR } from './lib/browser.mjs';
import { waitForMap, toRest, openSearch, openDisruptions, pageSel } from './lib/screen.mjs';
import { existsSync } from 'node:fs';

const fails = [], oks = [], notes = [];
const check = (ok, what) => (ok ? oks : fails).push(what);
const replay = existsSync(`data/routes-${CARD_HOUR}.jsonl`) ? CARD_HOUR : null;
const base = { ...(replay ? { replay } : {}), view: '12/59.33/18.06', train: 'toy', lang: 'sv', theme: 'light' };
const browser = await launch();

// The longest pause between frames while fn runs (ms), the processor slowed 4x.
async function pauses(page, fn, ms = 900) {
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.evaluate(() => { window.__gaps = []; let last = performance.now(); const f = (t) => { window.__gaps.push(t - last); last = t; if (window.__gaps.length < 400) window.__gapRaf = requestAnimationFrame(f); }; window.__gapRaf = requestAnimationFrame(f); });
  await fn();
  await sleep(ms);
  const worst = await page.evaluate(() => { cancelAnimationFrame(window.__gapRaf); return Math.round(Math.max(...window.__gaps.slice(1))); });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await cdp.detach();
  return worst;
}
const animNames = (page, sel) => page.evaluate(s => [...document.querySelectorAll(s)].flatMap(e => e.getAnimations().map(a => a.animationName)), sel);

try {
  const page = await waitForMap(browser, base);
  const frames = {};

  // ---- 1: a held button presses in ----
  const nb = await page.$('#nav-button');
  const box = await nb.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await sleep(200);
  const held = await page.evaluate(() => getComputedStyle(document.getElementById('nav-button')).scale);
  await page.mouse.up();
  await sleep(400);
  const after = await page.evaluate(() => getComputedStyle(document.getElementById('nav-button')).scale);
  check(held === '0.94' && after === 'none', `1: a held button is pressed in (scale ${held}, after ${after})`);

  // ---- 9: the menu's rows follow it in (the tap above opened it; close and open again) ----
  if (await page.evaluate(() => !document.getElementById('nav').hidden)) { await page.click('#nav-button'); await sleep(400); }
  frames.menu = await pauses(page, async () => {
    await page.click('#nav-button');
    await sleep(40);
    const names = await animNames(page, '#nav .nav-row:not([hidden])');
    check(names.filter(n => n === 'nav-in').length === 3, `9: the menu's 3 rows follow it in (${names.length} animated: ${[...new Set(names)].join(', ') || 'none'})`);
  });
  await page.click('#nav-button');
  await sleep(400);

  // ---- 6: search rows ----
  await openSearch(page);
  frames.search = await pauses(page, async () => {
    await page.type('#search', '1');
    await sleep(60);
    const n = await page.evaluate(() => document.querySelectorAll('#search-results .arrive').length);
    check(n >= 3, `6: search rows arrive (${n} arriving)`);
  });
  await sleep(800);
  // (only rows shown before count: the replay runs on, and a train that came onto the map meanwhile is a new row)
  const shownBefore = await page.evaluate(() => [...document.querySelectorAll('#search-results [data-go]')].map(e => e.dataset.go));
  await page.evaluate(() => document.getElementById('search').dispatchEvent(new Event('input')));
  await sleep(60);
  const againRows = await page.evaluate(() => [...document.querySelectorAll('#search-results .arrive')].map(e => e.dataset.go ?? e.textContent.trim().slice(0, 30)));
  const again = againRows.filter(k => shownBefore.includes(k)).length;
  check(again === 0, `6: the same results again move nothing (${again} arriving${again ? `: ${againRows.slice(0, 3).join(', ')}` : ''}${againRows.length > again ? `; ${againRows.length - again} new since` : ''})`);
  await toRest(page);

  // ---- a card: no roll as it opens; the lateness rolls and pulses; the timeline's rows arrive ----
  // a tap on the lone train nearest the middle (not `except`); its id
  const tapLone = except => page.evaluate((except) => {
    const m = window.__map, c = m.project(m.getCenter());
    const d = f => { const q = m.project(f.geometry.coordinates); return Math.hypot(q.x - c.x, q.y - c.y); };
    // a train with a label of its own, not under a "3 trains" bubble or a station's name (as tools/ui-check.mjs)
    const lone = new Set(m.queryRenderedFeatures({ layers: ['train-labels'] }).map(f => f.properties.id));
    const own = [...document.querySelectorAll('.near-label:not(.group)')].map(e => e.getBoundingClientRect());
    for (const f of m.queryRenderedFeatures({ layers: ['train-dots'] })) {
      const q = m.project(f.geometry.coordinates);
      if (own.some(r => Math.abs((r.left + r.right) / 2 - q.x) < 2 && Math.abs(r.top - q.y - 16) < 3)) lone.add(f.properties.id);
    }
    const groups = [...document.querySelectorAll('.near-label.group')].map(e => e.getBoundingClientRect());
    const names = [...document.querySelectorAll('.station-name')].map(e => e.getBoundingClientRect());   // the page's names close in
    const covered = q => [...groups, ...names].some(r => q.x > r.left - 4 && q.x < r.right + 4 && q.y > r.top - 4 && q.y < r.bottom + 4)
      || m.queryRenderedFeatures([[q.x - 8, q.y - 8], [q.x + 8, q.y + 8]], { layers: ['station-names'] }).length > 0;
    const f = m.queryRenderedFeatures({ layers: ['train-dots'] }).filter(f => lone.has(f.properties.id) && !covered(m.project(f.geometry.coordinates))
      && f.properties.id !== except && (!except || String(window.__trains.get(f.properties.id)?.number) !== String(window.__trains.get(except)?.number)) && typeof window.__lateness.get(f.properties.id)?.minutes === 'number').sort((a, b) => d(a) - d(b))[0];
    if (!f) return null;
    const q = m.project(f.geometry.coordinates);
    m.fire('click', { point: q, lngLat: m.unproject(q), originalEvent: new MouseEvent('click') });
    return f.properties.id;
  }, except);
  const id = await tapLone(null);
  await sleep(3500);
  const card = await page.evaluate(() => ({ open: window.__stack.top()?.startsWith('train:') && !document.getElementById('panel').hidden, tiles: document.querySelectorAll('#panel .tile').length,
    late: document.querySelector('#panel .cd-late b')?.textContent, rows: document.querySelectorAll('#panel .tl-row').length, list: Boolean(document.getElementById('picker') && !document.getElementById('picker').hidden) }));
  if (!id || !card.open || card.tiles !== 2) notes.push(`the card's parts not checked (train ${id}, ${JSON.stringify(card)})`);
  else {
    const opening = await animNames(page, '#panel .cd-late, #panel .cd-late b');
    check(!opening.includes('late-pop'), `7: no pulse as the card opens (${opening.join(', ') || 'none'})`);
    // the minutes change: 9 more than shown
    const m0 = await page.evaluate(id => window.__lateness.get(id).minutes, id);
    const m1 = m0 + 9, want = m1 === 0 ? 'I tid' : `${m1 > 0 ? '+' : '−'}${Math.abs(m1)} min`;
    let texts = [], pulsed = false;
    frames.late = await pauses(page, async () => {
      await page.evaluate((id, m1) => { const L = window.__lateness, get = L.get.bind(L); window.__realGet = L.get; L.get = k => (k === id ? { ...get(k), minutes: m1 } : get(k)); }, id, m1);
      for (let t0 = Date.now(); Date.now() - t0 < 2200; await sleep(40)) {
        const s = await page.evaluate(() => { const t = document.querySelector('#panel .cd-late'); return { text: t?.querySelector('b')?.textContent, pulse: t?.getAnimations().some(a => a.animationName === 'late-pop') }; });
        if (s.text && s.text !== texts.at(-1)) texts.push(s.text);
        pulsed ||= s.pulse;
      }
    }, 0);
    check(texts.length >= 3 && texts.at(-1) === want, `4: the lateness rolls to the new minutes (${texts.slice(0, 4).join(' → ')}${texts.length > 4 ? ' … ' + texts.at(-1) : ''}; want ${want})`);
    check(pulsed, '7: the lateness tile pulses when the minutes change');
    await page.evaluate(() => { window.__lateness.get = window.__realGet; });
    await sleep(1500);
    // the timeline's rows arrive as the card opens full; the refresh moves nothing
    await page.click('#panel .panel-more');
    await sleep(120);
    const arriving = await page.evaluate(() => document.querySelectorAll('#panel .tl-row.arrive, #panel .tl-now.arrive').length);
    if (card.rows > 2) check(arriving >= 2, `6: the timeline's rows arrive as the card opens full (${arriving} of ${card.rows})`);
    else notes.push(`the timeline not checked (${card.rows} rows)`);
    await sleep(1000);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));   // (the card asks for its times again at once)
    await sleep(1500);
    const refreshed = await page.evaluate(() => document.querySelectorAll('#panel .arrive').length);
    check(refreshed === 0, `6: the card's refresh moves no rows (${refreshed} arriving)`);
    // ---- 5: card to card (Max's pick 5, 2026-11-20: no "Laddar…" between them). Since the one sheet (2026-11-22) the
    // second train is a page of its own over the first (the back chip says Home): its card is never hidden or
    // "Laddar…" on the way and shows the new number. (Its number no longer rolls from the first one's: a new page slides in.)
    await page.click('#panel .panel-more');   // (compact again)
    await sleep(800);
    await page.evaluate(() => { window.__seen = { hidden: false, loading: false, heads: [] };
      const p = document.getElementById('panel');
      const look = () => { if (p.hidden) window.__seen.hidden = true; if (p.querySelector('.state.loading')) window.__seen.loading = true;
        const h = p.querySelector('.panel-title strong')?.textContent; if (h && h !== window.__seen.heads.at(-1)) window.__seen.heads.push(h);
        if (window.__seen.heads.length < 400) requestAnimationFrame(look); };
      requestAnimationFrame(look); });
    const first = await page.evaluate(id => String(window.__trains.get(id)?.number ?? ''), id);
    const id2 = await tapLone(id);
    await sleep(2500);
    const sw = await page.evaluate(() => ({ ...window.__seen, late: document.querySelector('#panel .cd-late b')?.textContent, tiles: document.querySelectorAll('#panel .tile').length,
      busy: document.querySelectorAll('#panel .busy').length, number: document.querySelector('#panel .panel-title strong')?.textContent,
      key: window.__stack.top(), inCard: Boolean(document.querySelector('#panel .panel-head .sh-follow')) }));
    const want2 = await page.evaluate(id => String(window.__trains.get(id)?.number ?? ''), id2);
    if (!id2) notes.push('5 not checked: no second lone train near the middle');
    else check(!sw.hidden && !sw.loading && sw.number === want2 && sw.tiles === 2 && !sw.busy && sw.key === `train:${id2}` && sw.inCard,
      `5: card to card: ${sw.key} over ${first} (its buttons ${sw.inCard ? 'in the card' : 'NOT in the card'}), ${sw.heads.join(' → ')}; want ${want2}; hidden ${sw.hidden}, "Laddar…" ${sw.loading}, lateness ${sw.late}`);
    await toRest(page);
  }

  // ---- 4: Anslutning: no roll as it opens; a change rolls ----
  await page.click('#status');
  await sleep(150);
  const opened = await page.evaluate(() => { const n = document.querySelector('#conn-body .n-trains'); return { text: n.textContent, v: n._v }; });
  check(String(opened.v) === opened.text.replace(/\s/g, ''), `4: Anslutning shows its numbers at once as it opens (${opened.text}, roll at ${opened.v})`);
  await page.evaluate(() => { const n = document.querySelector('#conn-body .n-trains'); n._v = Number(n.textContent.replace(/\s/g, '')) - 60; });
  let seen = new Set();
  for (let t0 = Date.now(); Date.now() - t0 < 2000; await sleep(40)) seen.add(await page.evaluate(() => document.querySelector('#conn-body .n-trains').textContent));
  check(seen.size >= 4, `4: Anslutning's numbers roll to new ones (${seen.size} values seen)`);
  await toRest(page);

  // ---- 8: a tapped station answers ----
  await page.evaluate(() => window.__map.jumpTo({ center: [18.06, 59.33], zoom: 11 }));
  await sleep(2000);
  const st = await page.evaluate(() => {
    const m = window.__map, c = m.project(m.getCenter());
    const free = q => !m.queryRenderedFeatures([[q.x - 16, q.y - 16], [q.x + 16, q.y + 16]], { layers: ['train-dots', 'disruption-icons', 'disruption-rings'] }).length;
    const f = m.queryRenderedFeatures({ layers: ['station-dots'] }).map(f => ({ f, q: m.project(f.geometry.coordinates) }))
      .filter(({ q }) => q.y > 140 && q.y < 520 && q.x > 30 && q.x < 360 && free(q)).sort((a, b) => Math.hypot(a.q.x - c.x, a.q.y - c.y) - Math.hypot(b.q.x - c.x, b.q.y - c.y))[0];
    if (!f) return null;
    m.fire('click', { point: f.q, lngLat: m.unproject(f.q), originalEvent: new MouseEvent('click') });
    const pop = document.querySelector('.sign-pop');
    return { name: f.f.properties.name, pop: Boolean(pop), anim: pop ? pop.firstElementChild.getAnimations().map(a => a.animationName).join(',') : '' };
  });
  if (!st) notes.push('no free station near the middle: 8 not checked');
  else {
    await sleep(600);
    const left = await page.evaluate(() => document.querySelectorAll('.sign-pop').length);
    check(st.pop && st.anim === 'sign-pop' && left === 0, `8: a tapped station (${st.name}) grows and goes back (${st.anim || 'no copy'}; ${left} left after 0.6 s)`);
  }
  check(!page.errors.length, `page errors: ${page.errors.length ? page.errors.slice(0, 3).join(' | ') : 'none'}`);
  notes.push(`the longest pause between frames, slowed 4x: menu ${frames.menu} ms, search rows ${frames.search} ms${frames.late ? `, lateness ${frames.late} ms` : ''} (measured, not a limit)`);
  await page.close();

  // ---- live: Störningar's rows arrive as it opens, a disruption sign answers ----
  const live = await waitForMap(browser, { view: '5.5/62/16', train: 'toy', lang: 'sv', theme: 'light' });
  // the list's page (Home → All disruptions): its rows looked at from the moment it opens
  const listIn = await live.evaluate(async (L) => {
    window.__disArrive = { n: 0, rows: 0 };
    const look = () => { const el = document.querySelector(L); if (el) { const n = el.querySelectorAll('.arrive').length, rows = el.querySelectorAll('.dis-body > .dis-row, .dis-body > .dis-fold').length;
      window.__disArrive = { n: Math.max(n, window.__disArrive.n), rows: Math.max(rows, window.__disArrive.rows) }; } if (!window.__disStop) requestAnimationFrame(look); };
    requestAnimationFrame(look); return true; }, pageSel('dislist'));
  const hasDis = listIn && await openDisruptions(live);
  if (!hasDis) notes.push('Störningar not checked (no disruption in force, or no live link)');
  else {
    await sleep(600);
    const { n, rows } = await live.evaluate(() => { window.__disStop = true; return window.__disArrive; });
    if (!rows) notes.push('Störningar has no rows now: not checked');
    else check(n >= 1, `6: Störningar's rows arrive (${n} arriving of ${rows})`);
    await toRest(live);
    // Each sign in turn, close in, until one has no train or station beside it (a tap there opens the train, its label or the
    // station first, as always: seen 2026-11-20, a live train standing at Norrköping's sign).
    const signs = await live.evaluate(() => window.__map.queryRenderedFeatures({ layers: ['disruption-icons'] }).map(f => f.geometry.coordinates));
    let r = null;
    for (const c of signs) {
      await live.evaluate(c => window.__map.jumpTo({ center: c, zoom: 8 }), c);
      await sleep(2500);
      r = await live.evaluate(() => {
        const m = window.__map, cx = m.project(m.getCenter());
        const f = m.queryRenderedFeatures({ layers: ['disruption-icons'] }).sort((a, b) => { const p = m.project(a.geometry.coordinates), q = m.project(b.geometry.coordinates); return Math.hypot(p.x - cx.x, p.y - cx.y) - Math.hypot(q.x - cx.x, q.y - cx.y); })[0];
        if (!f) return null;
        const q = m.project(f.geometry.coordinates); q.y -= 10;   // (the sign stands on its point)
        if (m.queryRenderedFeatures([[q.x - 16, q.y - 16], [q.x + 16, q.y + 16]], { layers: ['train-dots', 'train-labels', 'train-triangles', 'station-dots'] }).length) return 'busy';
        m.fire('click', { point: q, lngLat: m.unproject(q), originalEvent: new MouseEvent('click') });
        const pop = document.querySelector('.sign-pop canvas');
        return { pop: Boolean(pop), w: pop?.getBoundingClientRect().width };
      });
      if (r && r !== 'busy') break;
    }
    if (!signs.length) notes.push('no disruption sign on the map now: its tap not checked');
    else if (!r || r === 'busy') notes.push(`every disruption sign (${signs.length}) has a train or station beside it now: its tap not checked`);
    else check(r.pop, `8: a tapped disruption sign grows (${JSON.stringify(r)})`);
  }
  check(!live.errors.length, `live page errors: ${live.errors.length ? live.errors.slice(0, 3).join(' | ') : 'none'}`);
  await live.close();

  // ---- reduce motion: none of it ----
  const quiet = await waitForMap(browser, { ...base });
  await quiet.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await quiet.click('#nav-button');
  await sleep(40);
  const menuAnim = await animNames(quiet, '#nav .nav-row');
  await quiet.click('#nav-button');
  await sleep(300);
  await openSearch(quiet);
  await quiet.type('#search', '1');
  await sleep(60);
  const rowsAnim = await quiet.evaluate(() => document.querySelectorAll('#search-results .arrive').length);
  await toRest(quiet);
  const nb2 = await quiet.$('#nav-button'), b2 = await nb2.boundingBox();   // (☰ is hidden while searching)
  await quiet.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
  await quiet.mouse.down();
  await sleep(150);
  const pressed = await quiet.evaluate(() => getComputedStyle(document.getElementById('nav-button')).scale);
  await quiet.mouse.up();
  check(!menuAnim.length && !rowsAnim && pressed === 'none', `reduce motion: nothing moves (menu ${menuAnim.length}, rows ${rowsAnim}, press ${pressed})`);
  await quiet.close();
} finally {
  await browser.close();
}
for (const o of oks) console.log(`  ok   ${o}`);
for (const n of notes) console.log(`  note ${n}`);
for (const f of fails) console.log(`  FAIL ${f}`);
console.log(fails.length ? `ui-motion-check: ${fails.length} failed` : 'ui-motion-check ok: buttons, numbers, rows, the lateness, signs and the menu move as on the example page');
process.exit(fails.length ? 1 : 0);
