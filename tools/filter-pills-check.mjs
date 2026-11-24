// Two filters, two pills (Max, 2026-11-24: "separate pills for separate filters. Allow more than one."): Home's
// lateness lit and a company tapped show two pills above the bar (the company's first), both hold together (that
// company's late trains), each × lets go of its own; phone and computer. Replay CARD_HOUR, Swedish.
// node tools/filter-pills-check.mjs (with npm run dev; PAGE= for another port).
import { launch, sleep, CARD_HOUR } from './lib/browser.mjs';
import * as S from './lib/screen.mjs';
const browser = await launch();
const fails = [];
const ok = (c, w) => { console.log(c ? 'ok  ' : 'FAIL', w); if (!c) fails.push(w); };
for (const pc of [false, true]) {
  const page = await S.waitForMap(browser, { replay: CARD_HOUR, theme: 'dark', lang: 'sv', ...(pc ? { size: { width: 1280, height: 800 } } : {}) });
  await sleep(3500);
  const pills = () => page.evaluate(() => [...document.querySelectorAll('#line .ln-pill')].map(p => `${p.dataset.ln}=${p.textContent.trim()}`));
  const drawn = () => page.evaluate(() => window.__last3d.length);
  const all = await drawn();
  await page.evaluate(() => document.querySelector('#sheet .lg-p.t-late')?.click());
  await S.setLevel(page, 2); await sleep(600);
  const co = await page.evaluate(() => { const bs = [...document.querySelectorAll('#sheet .st-brow[data-filter="brand"]')].filter(x => x.dataset.v && x.offsetParent); const b = bs.find(x => /^SJ/.test(x.dataset.v)) ?? bs[0]; b?.click(); return b?.dataset.v; });
  await sleep(1200);
  await page.evaluate(() => window.__stack.home(1)); await sleep(1200);
  const both = await pills(), nBoth = await drawn();
  ok(both.length === 2 && both[0].startsWith('filter=') && both[0].includes(co) && both[1].startsWith('filter-late=') && /sena 6\+/.test(both[1]), `${pc ? 'PC' : 'phone'}: two pills ${JSON.stringify(both)}`);
  // × on the lateness: the company stays
  await page.evaluate(() => document.querySelector('#line [data-ln="filter-late"] .line-x').click()); await sleep(1200);
  const coOnly = await pills(), nCo = await drawn();
  ok(coOnly.length === 1 && coOnly[0].startsWith('filter=') && nCo >= nBoth && nCo < all, `× on the lateness: ${JSON.stringify(coOnly)}, drawn ${nBoth} -> ${nCo} (all ${all})`);
  // late again, × on the company: the lateness stays
  await page.evaluate(() => document.querySelector('#sheet .lg-p.t-late')?.click()); await sleep(1200);
  await page.evaluate(() => document.querySelector('#line [data-ln="filter"] .line-x').click()); await sleep(1200);
  const lateOnly = await pills(), nLate = await drawn();
  ok(lateOnly.length === 1 && lateOnly[0].startsWith('filter-late=') && nLate < all, `× on the company: ${JSON.stringify(lateOnly)}, drawn ${nLate} (all ${all})`);
  await page.evaluate(() => document.querySelector('#line [data-ln="filter-late"] .line-x').click()); await sleep(800);
  ok((await pills()).length === 0 && (await drawn()) >= all - 5, 'both off: no pill, every train');
  // Home's filter card (Max, 2026-11-24: "Sektions titel: Filter. Ett sätt att expandera"): the companies under the
  // lateness bar, five and "N till ⌄"; one from the rest tapped: ringed, its pill, Home stays, and still in sight once
  // folded again; × lets go of it and its ring
  await page.evaluate(() => window.__stack.home(1)); await sleep(1200);
  const card = () => page.evaluate(() => ({ head: document.querySelector('#sheet .co-filter')?.closest('.sec')?.querySelector('h4.lab')?.textContent,
    shown: [...document.querySelectorAll('#sheet .co-filter .co-f')].map(c => c.dataset.cofilter), on: [...document.querySelectorAll('#sheet .co-filter .co-f.on')].map(c => c.dataset.cofilter),
    more: document.querySelector('#sheet .co-filter .co-more')?.textContent ?? '', top: window.__stack.top() }));
  const f0 = await card();
  ok(f0.head === 'Filter' && f0.shown.length >= 1 && f0.shown.length <= 5 && (f0.shown.length < 5 || /^\d+ till$/.test(f0.more)), `the card "${f0.head}": ${f0.shown.length} companies, "${f0.more}"`);
  if (f0.more) {
    await page.evaluate(() => document.querySelector('#sheet .co-filter .co-more').click()); await sleep(600);
    const f1 = await card();
    ok(f1.shown.length > f0.shown.length && f1.more === 'Färre', `"${f0.more}" tapped: ${f1.shown.length} companies, "${f1.more}"`);
    const pick = f1.shown.at(-1);
    await page.evaluate(v => [...document.querySelectorAll('#sheet .co-filter .co-f')].find(c => c.dataset.cofilter === v).click(), pick); await sleep(800);
    await page.evaluate(() => document.querySelector('#sheet .co-filter .co-more').click()); await sleep(600);
    const f2 = await card(), p2 = await pills();
    ok(f2.on.join() === pick && f2.shown.includes(pick) && f2.top === 'home' && p2.length === 1 && p2[0].includes(pick),
      `${pick} tapped, folded again: ringed ${JSON.stringify(f2.on)}, in sight ${f2.shown.includes(pick)}, page ${f2.top}, pills ${JSON.stringify(p2)}`);
    await page.evaluate(() => document.querySelector('#line [data-ln="filter"] .line-x').click()); await sleep(1000);
    const f3 = await card();
    ok(!f3.on.length && !(await pills()).length && !f3.shown.includes(pick), `× on its pill: no ring (${JSON.stringify(f3.on)}), no pill, ${pick} back among the rest`);
  }
  await page.close();
}
await browser.close();
console.log(fails.length ? `filter-pills-check: ${fails.length} failed` : 'filter-pills-check ok: two filters, two pills, each × its own');
process.exit(fails.length ? 1 : 0);
