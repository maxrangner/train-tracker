// Do two builds of the page look the same? For a cleanup that must change nothing on screen (2026-11-25, Max: "Do a
// major code review and fix to bring the code in line"). Two pages, the one being changed (PAGE, default the 5181
// page) and an untouched copy (BASE, default http://localhost:5182/, a worktree of the commit before the change), are
// opened at the same moment on the same replay, so they show the same trains and numbers. Then the same steps go to
// both, screen by screen, on a phone and a computer, and each screen's sheet (plus ☰'s card when open) is compared
// pixel by pixel: a pixel counts as changed when a colour channel differs by more than 48 of 255; a screen differs when
// more than 0.2 % of its pixels changed, or its sheet's size or place moved. The map itself is not compared (its trains
// move). A changed screen gets its two pictures and a picture of the changes under shots/look-diff/.
// node tools/look-diff.mjs [--only <names,...>] [--size phone|pc]   exit 0: all the same; 1: a difference
// Not seen here: motion (tools/ui-sweep.mjs compares that), hover, a real phone.
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, sleep, PHONE, CARD_HOUR } from './lib/browser.mjs';

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const ONLY = opt('--only'), SIZE = opt('--size');
const NEW = (process.env.PAGE ?? 'http://localhost:5181/').replace(/\/?$/, '/');
const BASE = (process.env.BASE ?? 'http://localhost:5182/').replace(/\/?$/, '/');
const OUT = 'shots/look-diff';
mkdirSync(OUT, { recursive: true });
const PC = { width: 1400, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false };

// The screens: a name and the steps that lead there from a fresh page (run in the page; ctx carries a train id picked
// once, the same for both pages).
const SCREENS = [
  ['home rest', async () => {}],
  ['home half', async p => setLevel(p, 1)],
  ['home full', async p => setLevel(p, 2)],
  ['filter more', async p => { await setLevel(p, 1); await p.evaluate(() => document.querySelector('#sheet [data-act="comore"]')?.click()); await sleep(900); }],
  ['filter fewer', async p => { await setLevel(p, 1); for (let i = 0; i < 2; i++) { await p.evaluate(() => document.querySelector('#sheet [data-act="comore"]')?.click()); await sleep(900); } }],
  ['search empty', async p => { await p.click('#search'); await sleep(1000); }],
  ['search typed', async p => { await p.click('#search'); await sleep(600); await p.type('#search', 'Stockholm', { delay: 10 }); await sleep(1500); }],
  ['menu', async p => { await p.click('#nav-button'); await sleep(900); }],
  ['train', async (p, ctx) => { await p.evaluate(id => window.__stack.open(`train:${id}`, { go: true }), ctx.train); await sleep(2200); }],
  ['train full', async (p, ctx) => { await p.evaluate(id => window.__stack.open(`train:${id}`, { go: true }), ctx.train); await sleep(1500); await setLevel(p, 2); await sleep(800); }],
  ['station', async p => { await p.evaluate(() => window.__stack.open('station:Cst', { go: true })); await sleep(2500); }],
  ['settings', async p => { await p.evaluate(() => window.__stack.open('page:settings', { go: true })); await sleep(1200); }],
  ['about', async p => { await p.evaluate(() => window.__stack.open('page:help', { go: true })); await sleep(1500); }],
  ['connection', async p => { await p.evaluate(() => window.__stack.open('page:conn', { go: true })); await sleep(1200); }],
  ['new trip', async p => { await p.evaluate(() => window.__stack.open('newtrip', { go: true })); await sleep(1500); }],
  ['company', async p => { await p.evaluate(() => window.__stack.open('co:SL Pendeltåg', { go: true })); await sleep(1500); }],
];
async function setLevel(p, i) { await p.evaluate(n => window.__stack.setLevel(n), i); await sleep(900); }

// What a screen shows: the sheet's box, ☰'s card's box when open, and a picture of their union.
async function capture(p, size) {
  await p.mouse.move(size.width - 5, size.height - 5);   // (no hover on anything)
  await sleep(300);
  const r = await p.evaluate(() => {
    const box = el => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
    const sheet = box(document.getElementById('sheet')), nav = document.getElementById('nav');
    const menu = nav && !nav.hidden ? box(nav) : null;
    const u = [sheet, menu].filter(Boolean);
    const x0 = Math.max(0, Math.min(...u.map(b => b.x))), y0 = Math.max(0, Math.min(...u.map(b => b.y)));
    const x1 = Math.min(innerWidth, Math.max(...u.map(b => b.x + b.w))), y1 = Math.min(innerHeight, Math.max(...u.map(b => b.y + b.h)));
    return { sheet, menu, clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } };
  });
  const png = await p.screenshot({ clip: r.clip, encoding: 'base64' });
  return { ...r, png };
}

// Two pictures compared in a page of the test browser (no image library needed): changed pixels, and a picture of them.
async function compare(browser, a, b) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(async (a, b) => {
      const load = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = `data:image/png;base64,${src}`; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height);
      const px = (img) => { const c = new OffscreenCanvas(w, h), g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, w, h).data; };
      const da = px(ia), db = px(ib);
      const c = new OffscreenCanvas(w, h), g = c.getContext('2d'), out = g.createImageData(w, h);
      let changed = 0;
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
        const hit = d > 48;
        if (hit) changed++;
        out.data[i] = hit ? 255 : db[i] * 0.3; out.data[i + 1] = hit ? 0 : db[i + 1] * 0.3; out.data[i + 2] = hit ? 0 : db[i + 2] * 0.3; out.data[i + 3] = 255;
      }
      g.putImageData(out, 0, 0);
      const blob = await c.convertToBlob({ type: 'image/png' });
      const diff = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
      return { changed, total: w * h, sameSize: ia.width === ib.width && ia.height === ib.height, diff };
    }, a, b);
  } finally { await page.close(); }
}

// (one test browser per page: two tabs in one browser leave one in the background, where it draws nothing)
const [bA, bB] = await Promise.all([launch(), launch()]);
const browser = bB;
let differ = 0, checked = 0;
try {
  for (const [tag, size] of [['phone', PHONE], ['pc', PC]]) {
    if (SIZE && SIZE !== tag) continue;
    let ctx = null;
    for (const [name, steps] of SCREENS) {
      if (ONLY && !ONLY.split(',').some(o => name.includes(o))) continue;
      // both pages opened together, so their replays stand at the same moment
      const [pa, pb] = await Promise.all([[bA, BASE], [bB, NEW]].map(async ([b, url]) => {
        const p = (await b.pages())[0] ?? await b.newPage();
        await p.setViewport(size);
        await p.goto(`${url}#shop=false&replay=${CARD_HOUR}&lang=sv`, { waitUntil: 'domcontentloaded' });
        return p;
      }));
      const ready = p => p.waitForFunction(() => (window.__trains?.count ?? 0) > 20 && window.__stack?.top() === 'home' && window.__map?.loaded(), { timeout: 40000 });
      await Promise.all([ready(pa), ready(pb)]);
      await sleep(2500);
      // (one train for the train screens, the same for both: one with a card on this replay)
      if (!ctx) ctx = { train: await pa.evaluate(() => window.__trains.reports().map(r => r.id).filter(Boolean)[8]) };
      await Promise.all([steps(pa, ctx), steps(pb, ctx)]);
      const [ca, cb] = await Promise.all([capture(pa, size), capture(pb, size)]);
      const cmp = await compare(browser, ca.png, cb.png);
      const moved = JSON.stringify([ca.sheet, ca.menu]) !== JSON.stringify([cb.sheet, cb.menu]);
      const pct = 100 * cmp.changed / cmp.total;
      const bad = moved || !cmp.sameSize || pct > 0.2;
      checked++;
      const file = `${tag}-${name.replace(/\W+/g, '-')}`;
      if (bad) {
        differ++;
        writeFileSync(`${OUT}/${file}-base.png`, Buffer.from(ca.png, 'base64'));
        writeFileSync(`${OUT}/${file}-new.png`, Buffer.from(cb.png, 'base64'));
        writeFileSync(`${OUT}/${file}-diff.png`, Buffer.from(cmp.diff, 'base64'));
      }
      console.log(`${bad ? 'DIFF' : 'same'} ${tag} ${name}: ${pct.toFixed(3)} % of pixels changed${moved ? `; sheet/menu moved: base ${JSON.stringify([ca.sheet, ca.menu])} new ${JSON.stringify([cb.sheet, cb.menu])}` : ''}${cmp.sameSize ? '' : '; picture size differs'}${bad ? ` (pictures: ${OUT}/${file}-*.png)` : ''}`);
      await Promise.all([pa.goto('about:blank'), pb.goto('about:blank')]);
    }
  }
} finally { await Promise.all([bA.close(), bB.close()]); }
console.log(differ ? `look-diff: ${differ} of ${checked} screens differ` : `look-diff: all ${checked} screens look the same`);
process.exit(differ ? 1 : 0);
