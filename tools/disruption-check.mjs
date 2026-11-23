// Disruptions: rail work told apart from real problems (2026-11-18, Max: the list as C, the map as B, the count
// problems only, Settings → Disruptions on the map: Off / Problems / All, default All). On the live page (disruptions
// are live only), so what is checked depends on what is in force: said when a kind is missing.
// Since the one sheet (2026-11-22): the count is on Home (its Disruptions part, "All disruptions": n problems · m rail
// work), the list is the page `dislist` (.dis-body), a disruption the page `dis:<id>` over it; back (Esc, Android's
// back) gives the list again, scrolled where it was (the page scrolls itself at full); the back chip says Home (since
// 2026-11-23).
// node tools/disruption-check.mjs (with npm run dev and the key; PAGE= for another port).
import { launch, sleep } from './lib/browser.mjs';
import { waitForMap, until, setLevel, toRest, back, sheetState, openFromMenu, openDisruptions, HOME, pageSel } from './lib/screen.mjs';

const fails = [], notes = [];
const expect = (ok, what) => { (ok ? notes : fails).push(what); };
const LIST = pageSel('dislist');
let railWorks = 0;   // rail work in force (the list's fold)

const browser = await launch();
try {
  const page = await waitForMap(browser, { lang: 'sv', view: '4.6/62.5/16.5', wait: 45000 });
  // Home's Disruptions part: drawn once they are in (src/home.js disHtml)
  const loaded = () => until(page, h => Boolean(document.querySelector(`${h} .dis-list`)), 45000, HOME);
  if (!(await loaded())) { fails.push('the disruptions never loaded (no key, or Trafikverket not answering)'); throw new Error('stop'); }
  await sleep(2500);
  // isWork (src/disruptions.js, read in the page: it needs the page's settings).
  const w = await page.evaluate(async () => { const { isWork } = await import('/src/disruptions.js');
    return [isWork({ work: true }), isWork({ work: false, kind: 'Banarbete/transport' }), isWork({ kind: 'Banarbete/transport (Vid överskriden tid eller annat oförutsett)' }), isWork({ kind: 'Spårväxel' })]; });
  expect(w[0] && !w[1], 'isWork: the type code decides when given');
  expect(w[2] && !w[3], 'isWork: an older file\'s name "Banarbete…" without a code');

  // ---- Home's count, then the list ----
  const count = await page.evaluate(h => document.querySelector(`${h} [data-go="dislist"] small`)?.textContent ?? '', HOME);
  const openList = async () => { await openDisruptions(page); await sleep(200); };
  if (!count) notes.push('no disruption in force at all: Home has no "All disruptions" row, the list not checked');
  else {
    await openList();
    // (the rail work rows are always there; shut, they sit in a box with no height: only open ones count as shown)
    const list = () => page.evaluate(l => ({ rows: [...document.querySelectorAll(`${l} .dis-body .dis-row`)].filter(r => !r.closest('.dis-works:not(.open)')).map(r => r.querySelector('.dis-ic')?.classList.contains('work')),
      fold: document.querySelector(`${l} .dis-fold`)?.textContent ?? null, open: document.querySelector(`${l} .dis-fold`)?.getAttribute('aria-expanded') }), LIST);
    let l = await list();
    const shownProblems = l.rows.filter(x => !x).length, works = Number(/\((\d+)\)/.exec(l.fold ?? '')?.[1] ?? 0);
    railWorks = works;
    const said = /^(\d+)/.exec(count)?.[1];
    expect(said === String(shownProblems) && (works ? count.includes(String(works)) : !/banarbete/.test(count)),
      `Home counts problems apart: "${count}", the list has ${shownProblems} problem(s)${works ? ` and ${works} rail work(s) folded` : ''}`);
    expect(l.rows.every((x, i) => !x || l.rows.slice(i).every(Boolean)), 'the problems come first, rail work after');
    if (works) {
      const wasOpen = l.open === 'true';
      // the fold glides (Max, 2026-11-20): the box's height measured while it moves lies between shut and open
      const heights = await page.evaluate(async (L) => {
        const box = document.querySelector(`${L} .dis-works`), hs = [box.getBoundingClientRect().height];
        document.querySelector(`${L} .dis-fold`).click();
        for (let i = 0; i < 6; i++) { await new Promise(r => setTimeout(r, 40)); hs.push(box.getBoundingClientRect().height); }
        await new Promise(r => setTimeout(r, 300));
        hs.push(box.getBoundingClientRect().height);
        return hs;
      }, LIST);
      const lo = Math.min(heights[0], heights.at(-1)), hi = Math.max(heights[0], heights.at(-1));
      expect(heights.slice(1, -1).filter(h => h > lo + 2 && h < hi - 2).length >= 2, `the fold glides (heights ${heights.map(Math.round).join(' → ')} px)`);
      l = await list();
      const workRows = l.rows.filter(Boolean).length;
      expect(wasOpen ? workRows === 0 : workRows === works, `"Banarbeten (${works})" ${wasOpen ? 'folds' : 'unfolds'}: ${workRows} rail work row(s) shown, each with a cone`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await until(page, () => Boolean(window.__stack?.top()), 20000);
      await loaded();
      await sleep(1500);
      await openList();
      const again = await list();
      expect(again.open === String(!wasOpen), `the fold is remembered after a reload (${again.open})`);
      if (again.open === 'true') { await page.evaluate(L => document.querySelector(`${L} .dis-fold`).click(), LIST); await sleep(300); }
    } else notes.push('no rail work in force now: the fold not checked');
    // A disruption opened from the list: its page over the list, the back chip says Home (2026-11-23), back (Esc):
    // the list again, scrolled where it was.
    const visibleRows = () => page.evaluate(L => [...document.querySelectorAll(`${L} .dis-body .dis-row`)].filter(r => !r.closest('.dis-works:not(.open)')).length, LIST);
    const problemsShown = await visibleRows();
    if (problemsShown || works) {
      if (!problemsShown) { await page.evaluate(L => document.querySelector(`${L} .dis-fold`).click(), LIST); await sleep(400); }
      await setLevel(page, 2);   // (the page scrolls itself at full height)
      const at = await page.evaluate((L) => { const b = document.querySelector(L); b.scrollTop = 40; return b.scrollTop; }, LIST);
      await sleep(300);
      const id = await page.evaluate(L => { const r = [...document.querySelectorAll(`${L} .dis-row`)].find(x => !x.closest('.dis-works:not(.open)')); r?.click(); return r?.dataset.id; }, LIST);
      await sleep(800);
      const s = await sheetState(page);
      const card = await page.evaluate(() => Boolean(document.querySelector('#sheet .pg #disruption')));
      expect(s.key === `dis:${id}` && card && s.back === 'Hem', `a disruption from the list: its page ${s.key} (${card ? 'drawn' : 'empty'}) over ${s.keys.join(' > ')}, the back chip "${s.back}"`);
      const after = await back(page);
      await sleep(300);
      const backAt = await page.evaluate(L => ({ top: document.querySelector(L)?.scrollTop ?? -1 }), LIST);
      expect(after === 'dislist' && Math.abs(backAt.top - at) < 2, `back: ${after} again, scrolled where it was (${backAt.top} of ${at} px)`);
      if (!problemsShown) { await page.evaluate(L => document.querySelector(`${L} .dis-fold`).click(), LIST); await sleep(300); }
      // One opened from the map has Home under it (the chip says so)
      await toRest(page);
      await page.evaluate(i => window.__stack.open(`dis:${i}`), id);
      await sleep(600);
      const fromMap = await sheetState(page);
      expect(fromMap.back === 'Hem', `a disruption opened alone: the back chip "${fromMap.back}" (Home under it)`);
      await toRest(page);
      await page.evaluate(() => window.__map.jumpTo({ center: [16.5, 62.5], zoom: 4.6, bearing: 0, pitch: 0 }));   // (opening it flew the map there)
      await sleep(1200);
    }
  }

  // ---- The map, with each setting ----
  const onMap = () => page.evaluate(() => {
    const fs = window.__map.queryRenderedFeatures({ layers: ['disruption-lines', 'disruption-works', 'disruption-rings', 'disruption-icons'] });
    return { all: fs.length, work: fs.filter(f => f.properties.work === 1).length, icons: fs.filter(f => f.layer.id === 'disruption-icons').length,
      dotted: fs.filter(f => f.layer.id === 'disruption-works').length };
  });
  const choose = async (v) => {
    await openFromMenu(page, 'settings');
    await page.evaluate(x => document.querySelector(`#settings .seg[data-key="disruptionsMap"] button[data-v="${x}"]`).click(), v);
    await toRest(page);
    await sleep(800);
  };
  let m = await onMap();
  expect(m.icons > 0 && (railWorks ? m.work > 0 : true), `All (the default): ${m.all} map features, ${m.icons} icon(s), ${m.work} of rail work${m.dotted ? ` (${m.dotted} dotted line parts)` : ''}`);
  await choose('problems');
  m = await onMap();
  expect(m.work === 0, `Problems: no rail work on the map (${m.all} features left)`);
  await choose('off');
  m = await onMap();
  expect(m.all === 0, `Off: nothing on the map (${m.all})`);
  await choose('all');
  m = await onMap();
  expect(m.icons > 0, `All again: ${m.all} features`);
  expect(!page.errors.length, `page errors: ${page.errors.slice(0, 3).join(' | ') || 'none'}`);
} catch (e) { if (e.message !== 'stop') throw e; } finally { await browser.close(); }

for (const n of notes) console.log(`  ok   ${n}`);
for (const f of fails) console.log(`  FAIL ${f}`);
console.log(fails.length ? `disruption-check: ${fails.length} failed` : 'disruption-check ok: problems counted and listed first, rail work folded and dotted, a disruption over its list and back, the map setting works');
process.exit(fails.length ? 1 : 0);
