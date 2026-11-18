// Is the view kept out of the address, and not remembered? (Max, 2026-11-18: "Is that possible to hide?" → yes; then
// "It should start with Sweden zoomed out like before": the last place no longer kept.) Opens a #view link: the map
// must open there and the address must lose #view (but keep the rest, here #nothing=1). Then moves the map, reloads
// without a #view: the map must open at the middle of Sweden, not where it was left. A place saved by the older version
// (localStorage "view") is forgotten. Then a fresh browser: the middle of Sweden. The bug mail must still name the view.
// Run (with `npm run dev` going): node tools/view-check.mjs
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH, PAGE } from './lib/browser.mjs';

const sleep = s => new Promise(r => setTimeout(r, s * 1000));
const fails = [], notes = [];
const browser = await puppeteer.launch({ executablePath: BROWSER_PATH, headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const open = async (ctx, hash) => {
  const page = await ctx.newPage();
  await page.setViewport({ width: 400, height: 800, deviceScaleFactor: 1 });
  page.on('pageerror', e => fails.push(`page error: ${e.message}`));
  await page.goto(`${PAGE}${hash}`, { waitUntil: 'domcontentloaded' });
  await sleep(6);
  return page;
};
const viewIn = async page => {
  const body = new URLSearchParams((await page.evaluate(() => window.__bugMail())).split('?')[1]).get('body') ?? '';
  return /#view=([^\s]+)/.exec(body)?.[1] ?? null;
};
const near = (got, want) => {
  const g = got?.split('/').map(Number), w = want.split('/').map(Number);
  return g && w.every((v, i) => Math.abs(v - (g[i] ?? 0)) < (i === 0 ? 0.05 : 0.01));
};

try {
  const ctx = await browser.createBrowserContext();
  const page = await open(ctx, '#view=11/59.33/18.06/20/40&nothing=1');
  const hash = await page.evaluate(() => location.hash);
  notes.push(`opened #view=11/59.33/18.06/20/40&nothing=1, the address now ends "${hash}"`);
  if (hash.includes('view')) fails.push('the address still shows the view');
  if (hash !== '#nothing=1') fails.push('the rest of the address was not kept');
  const v1 = await viewIn(page);
  notes.push(`the bug mail names #view=${v1}`);
  if (!near(v1, '11/59.33/18.06/20/40')) fails.push(`the map did not open at the link's view (${v1})`);

  await page.mouse.move(200, 400); await page.mouse.down(); await page.mouse.move(120, 300, { steps: 8 }); await page.mouse.up();
  await sleep(2);
  const moved = await viewIn(page);
  const hash2 = await page.evaluate(() => location.hash);
  notes.push(`after a drag: view ${moved}, address "${hash2}"`);
  if (hash2.includes('view')) fails.push('a drag put the view in the address');
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' }); await sleep(6);
  const back = await viewIn(page);
  notes.push(`opened again without #view: ${back}`);
  if (!near(back, '4.3/62.5/16.5')) fails.push(`the map did not open at the middle of Sweden (${back}, left at ${moved})`);
  // A place an older version saved: forgotten.
  await page.evaluate(() => localStorage.setItem('view', '11/59.33/18.06'));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' }); await sleep(6);
  const old = await viewIn(page), kept = await page.evaluate(() => localStorage.getItem('view'));
  notes.push(`with an older version's saved place: opens at ${old}, the saved place now ${kept}`);
  if (!near(old, '4.3/62.5/16.5') || kept !== null) fails.push(`an older saved place was used or kept (${old}, ${kept})`);
  await ctx.close();

  const fresh = await browser.createBrowserContext();
  const p2 = await open(fresh, '');
  const first = await viewIn(p2);
  notes.push(`a fresh browser opens at ${first}`);
  if (!near(first, '4.3/62.5/16.5')) fails.push(`a fresh browser did not open at the middle of Sweden (${first})`);
  await fresh.close();
} finally { await browser.close(); }

for (const n of notes) console.log(`  ${n}`);
console.log(fails.length ? `FAIL\n  ${fails.join('\n  ')}` : 'OK: the view stays out of the address; the map always starts at the middle of Sweden (or a link\'s #view)');
process.exit(fails.length ? 1 : 0);
