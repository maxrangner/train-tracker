// Disruptions: rail work told apart from real problems (2026-11-18, Max: the list as C, the map as B, the count
// problems only, Settings → Disruptions on the map: Off / Problems / All, default All). On the live page (disruptions
// are live only), so what is checked depends on what is in force: said when a kind is missing.
// node tools/disruption-check.mjs (with npm run dev and the key; PAGE= for another port).
import { launch, address, sleep, PHONE } from './lib/browser.mjs';

const fails = [], notes = [];
const expect = (ok, what) => { (ok ? notes : fails).push(what); };

const browser = await launch();
try {
  const page = await browser.newPage();
  await page.setViewport(PHONE);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(address({ lang: 'sv', view: '4.6/62.5/16.5' }), { waitUntil: 'domcontentloaded' });
  let count = '';
  for (let t0 = Date.now(); Date.now() - t0 < 45000 && !count; await sleep(500)) count = await page.evaluate(() => document.getElementById('disruptions-count')?.textContent ?? '').catch(() => '');
  if (!count) { fails.push('the disruptions never loaded (no key, or Trafikverket not answering)'); throw new Error('stop'); }
  await sleep(2500);
  // isWork (src/disruptions.js, read in the page: it needs the page's settings).
  const w = await page.evaluate(async () => { const { isWork } = await import('/src/disruptions.js');
    return [isWork({ work: true }), isWork({ work: false, kind: 'Banarbete/transport' }), isWork({ kind: 'Banarbete/transport (Vid överskriden tid eller annat oförutsett)' }), isWork({ kind: 'Spårväxel' })]; });
  expect(w[0] && !w[1], 'isWork: the type code decides when given');
  expect(w[2] && !w[3], 'isWork: an older file\'s name "Banarbete…" without a code');

  // ---- The list ----
  await page.evaluate(() => document.getElementById('open-disruptions').click());
  await sleep(700);
  // (the rail work rows are always there; shut, they sit in a box with no height: only open ones count as shown)
  const list = () => page.evaluate(() => ({ rows: [...document.querySelectorAll('#disruptions-body .dis-row')].filter(r => !r.closest('.dis-works:not(.open)')).map(r => r.querySelector('.dis-ic')?.classList.contains('work')),
    fold: document.querySelector('#disruptions-body .dis-fold')?.textContent ?? null, open: document.querySelector('#disruptions-body .dis-fold')?.getAttribute('aria-expanded') }));
  let l = await list();
  const shownProblems = l.rows.filter(w => !w).length, works = Number(/\((\d+)\)/.exec(l.fold ?? '')?.[1] ?? 0);
  expect(count === String(shownProblems), `the menu counts problems only: "${count}", the list has ${shownProblems} problem(s)${works ? ` and ${works} rail work(s) folded` : ''}`);
  expect(l.rows.every((w, i) => !w || l.rows.slice(i).every(Boolean)), 'the problems come first, rail work after');
  if (works) {
    const wasOpen = l.open === 'true';
    // the fold glides (Max, 2026-11-20): the box's height measured while it moves lies between shut and open
    const heights = await page.evaluate(async () => {
      const box = document.querySelector('#disruptions-body .dis-works'), hs = [box.getBoundingClientRect().height];
      document.querySelector('#disruptions-body .dis-fold').click();
      for (let i = 0; i < 6; i++) { await new Promise(r => setTimeout(r, 40)); hs.push(box.getBoundingClientRect().height); }
      await new Promise(r => setTimeout(r, 300));
      hs.push(box.getBoundingClientRect().height);
      return hs;
    });
    const lo = Math.min(heights[0], heights.at(-1)), hi = Math.max(heights[0], heights.at(-1));
    expect(heights.slice(1, -1).filter(h => h > lo + 2 && h < hi - 2).length >= 2, `the fold glides (heights ${heights.map(Math.round).join(' → ')} px)`);
    l = await list();
    const workRows = l.rows.filter(Boolean).length;
    expect(wasOpen ? workRows === 0 : workRows === works, `"Banarbeten (${works})" ${wasOpen ? 'folds' : 'unfolds'}: ${workRows} rail work row(s) shown, each with a cone`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    for (let t0 = Date.now(); Date.now() - t0 < 45000; await sleep(500)) if (await page.evaluate(() => document.getElementById('disruptions-count')?.textContent).catch(() => '')) break;
    await sleep(1500);
    await page.evaluate(() => document.getElementById('open-disruptions').click()); await sleep(700);
    const again = await list();
    expect(again.open === String(!wasOpen), `the fold is remembered after a reload (${again.open})`);
    if (again.open === 'true') { await page.evaluate(() => document.querySelector('#disruptions-body .dis-fold').click()); await sleep(300); }
  } else notes.push('no rail work in force now: the fold not checked');
  // A disruption opened from the list has a back arrow, back to the list where it was (Max, 2026-11-20); one opened
  // from the map has none.
  const visibleRows = () => page.evaluate(() => [...document.querySelectorAll('#disruptions-body .dis-row')].filter(r => !r.closest('.dis-works:not(.open)')).length);
  const problemsShown = await visibleRows();
  if (problemsShown || works) {
    if (!problemsShown) { await page.evaluate(() => document.querySelector('#disruptions-body .dis-fold').click()); await sleep(400); }
    const at = await page.evaluate(() => { const b = document.getElementById('disruptions-body'); b.scrollTop = 40; return b.scrollTop; });
    await page.evaluate(() => [...document.querySelectorAll('#disruptions-body .dis-row')].find(r => !r.closest('.dis-works:not(.open)'))?.click());
    await sleep(600);
    const card = await page.evaluate(() => ({ open: !document.getElementById('disruption').hidden, back: Boolean(document.querySelector('#disruption .panel-back')) }));
    expect(card.open && card.back, `a disruption from the list: its card, with a back arrow (${JSON.stringify(card)})`);
    await page.evaluate(() => document.querySelector('#disruption .panel-back')?.click());
    await sleep(600);
    const backAt = await page.evaluate(() => ({ list: !document.getElementById('disruptions-page').hidden, card: !document.getElementById('disruption').hidden,
      top: document.getElementById('disruptions-body').scrollTop }));
    expect(backAt.list && !backAt.card && Math.abs(backAt.top - at) < 2, `the back arrow: the list again, scrolled where it was (${backAt.top} of ${at} px), the card closed`);
    if (!problemsShown) { await page.evaluate(() => document.querySelector('#disruptions-body .dis-fold').click()); await sleep(300); }
    await page.evaluate(() => window.__map.jumpTo({ center: [16.5, 62.5], zoom: 4.6, bearing: 0, pitch: 0 }));   // (opening it flew the map there)
    await sleep(1200);
  }
  await page.evaluate(() => document.querySelector('#disruptions-page .panel-close')?.click());
  await sleep(500);

  // ---- The map, with each setting ----
  const onMap = () => page.evaluate(() => {
    const fs = window.__map.queryRenderedFeatures({ layers: ['disruption-lines', 'disruption-works', 'disruption-rings', 'disruption-icons'] });
    return { all: fs.length, work: fs.filter(f => f.properties.work === 1).length, icons: fs.filter(f => f.layer.id === 'disruption-icons').length,
      dotted: fs.filter(f => f.layer.id === 'disruption-works').length };
  });
  const choose = v => page.evaluate(v => document.querySelector(`#settings .seg[data-key="disruptionsMap"] button[data-v="${v}"]`).click(), v);
  let m = await onMap();
  expect(m.icons > 0 && (works ? m.work > 0 : true), `All (the default): ${m.all} map features, ${m.icons} icon(s), ${m.work} of rail work${m.dotted ? ` (${m.dotted} dotted line parts)` : ''}`);
  await choose('problems'); await sleep(800);
  m = await onMap();
  expect(m.work === 0, `Problems: no rail work on the map (${m.all} features left)`);
  await choose('off'); await sleep(800);
  m = await onMap();
  expect(m.all === 0, `Off: nothing on the map (${m.all})`);
  await choose('all'); await sleep(800);
  m = await onMap();
  expect(m.icons > 0, `All again: ${m.all} features`);
  expect(!errors.length, `page errors: ${errors.slice(0, 3).join(' | ') || 'none'}`);
} catch (e) { if (e.message !== 'stop') throw e; } finally { await browser.close(); }

for (const n of notes) console.log(`  ok   ${n}`);
for (const f of fails) console.log(`  FAIL ${f}`);
console.log(fails.length ? `disruption-check: ${fails.length} failed` : 'disruption-check ok: problems counted and listed first, rail work folded and dotted, the map setting works');
process.exit(fails.length ? 1 : 0);
