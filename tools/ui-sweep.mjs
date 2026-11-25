// The UI sweep (Max, 2026-11-25: "There are a lot of edge cases like the pixel jump and bad padding. And the strange
// expansion transitions. Do a full sweep of the UI for similar"). It plays the sheet's transitions on a phone and a
// computer and records every frame: the place, size and visibility of every text, icon and button on the page. It
// flags four kinds of motion problem:
//   stray    something visible during a transition that shows neither before nor after it ("a red number element
//            swipe by, that is not present in either relevant cards")
//   jump     something that has come to rest and moves again, or turns back ("a vertical jump of a few pixels before
//            settling")
//   redrawn  a card growing or shrinking on the same page: what was on screen moves against the sheet's top, or slides
//            in ("Only the new part should be revealed through the expanding card, not all of it slide in")
//   pop      the same: something changes place or size in one frame while the rest glides ("top buttons should
//            animate into the new layout, not just pop")
// and one of the look: padding, the gaps between a page's cards and the room inside them, against the page's usual gap
// ("Pic 1: Bad padding").
//   node tools/ui-sweep.mjs [--only <name part>] [--size phone|pc] [--shots <folder>] [--report]
// --report lists every find and exits 0; without it the finds not in the accepted list (ACCEPT below) fail the run.
// Two pages per size: the replay the screens check plays (its trains have their stops) and, for Home's disruptions
// (live only), the live map. In Swedish, as Max uses it. The page: PAGE (tools/lib/browser.mjs).
import { launch, sleep, PHONE, CARD_HOUR } from './lib/browser.mjs';
import { waitForMap, until, toRest, openMenu, openSearch, HOME } from './lib/screen.mjs';

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const TRACE = opt('--trace'), ONLY = opt('--only'), SIZE = opt('--size'), SHOTS = opt('--shots'), REPORT = args.includes('--report');
const SIZES = { phone: PHONE, pc: { width: 1400, height: 900, deviceScaleFactor: 1 } };

// ---- the recorder, in the page ----
function recorder() {
  const R = window.__rec = { frames: [], ids: new WeakMap(), n: 0, meta: {}, on: false };
  const skip = el => el.ownerSVGElement || el.closest('.maplibregl-canvas-container, .maplibregl-marker, .maplibregl-ctrl-attrib, #splash, script, style, template, #page-holder');
  const own = el => { for (const c of el.childNodes) if (c.nodeType === 3 && c.textContent.trim()) return true; return false; };
  const want = el => !skip(el) && (own(el) || /^(BUTTON|svg|IMG|INPUT|I)$/.test(el.tagName) || el.classList.contains('dot'));
  const describe = (el) => {
    const pg = (el.closest('.pg-ghost') ? 'ghost:' : '') + (el.closest('.pg')?.dataset.key ?? (el.closest('#nav') ? 'menu' : el.closest('#sheet') ? 'sheet' : 'screen'));
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    let text = '';
    for (const c of el.childNodes) if (c.nodeType === 3) text += c.textContent;
    text = text.trim().replace(/\s+/g, ' ').slice(0, 40) || el.getAttribute('aria-label') || '';
    return { pg, el: `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`, text, bottom: Boolean(el.closest('.sh-grab, .sh-more')), btn: Boolean(el.closest('.sh-btns, .panel-buttons')) };
  };
  const idOf = (el) => { let id = R.ids.get(el); if (!id) { id = ++R.n; R.ids.set(el, id); R.meta[id] = describe(el); } return id; };
  R.snap = () => {
    const clip = new Map(), op = new Map();
    const clipOf = (el) => {
      const p = el.parentElement;
      if (!p) return [0, 0, innerWidth, innerHeight];
      if (clip.has(p)) return clip.get(p);
      let c = clipOf(p);
      const cs = getComputedStyle(p);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || cs.clipPath !== 'none') {
        const r = p.getBoundingClientRect();
        // (a leaving page clipped to its top part: inset(0 0 calc(100% - Npx) 0), src/stack.js clipLeaving)
        const m = /calc\(100% - ([\d.]+)px\)/.exec(p.style.clipPath);   // (its own words: computed, 100% - 0px reads 100%)
        const bottom = m ? Math.min(r.bottom, r.top + Number(m[1])) : r.bottom;
        c = [Math.max(c[0], r.left), Math.max(c[1], r.top), Math.min(c[2], r.right), Math.min(c[3], bottom)];
      }
      clip.set(p, c);
      return c;
    };
    const opOf = (el) => {
      if (!el || el === document.documentElement) return 1;
      if (op.has(el)) return op.get(el);
      const v = opOf(el.parentElement) * Number(getComputedStyle(el).opacity);
      op.set(el, v);
      return v;
    };
    const sheet = document.getElementById('sheet').getBoundingClientRect();
    const out = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (!want(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const c = clipOf(el);
      const vw = Math.min(r.right, c[2]) - Math.max(r.left, c[0]), vh = Math.min(r.bottom, c[3]) - Math.max(r.top, c[1]);
      if (vw < 2 || vh < 2) continue;
      const o = opOf(el);
      if (o < 0.05) continue;
      const pgEl = el.closest('.pg');   // (its page now: a shared button moves between pages)
      out.push([idOf(el), Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10, Math.round(o * 100) / 100, Math.round(vh),
        (pgEl?.classList.contains('pg-ghost') ? 'ghost:' : '') + (pgEl?.dataset.key ?? R.meta[idOf(el)].pg)]);
    }
    const pgTop = document.querySelector(`#sheet .pg[data-key="${CSS.escape(window.__stack.top())}"]`);
    const hp = document.querySelector('#sheet .pg[data-key="home"]');
    const home = hp ? `${hp.isConnected ? '' : 'gone '}${hp.className} clip(${hp.style.clipPath}) vis ${getComputedStyle(hp).visibility} top ${Math.round(hp.getBoundingClientRect().top)}` : 'no home';
    return { home, t: performance.now(), scroll: pgTop ? Math.round(pgTop.scrollTop) : null, lvl: window.__stack.level, cls: document.getElementById('panel').className, sheetTop: Math.round(sheet.top * 10) / 10, sheetH: Math.round(sheet.height * 10) / 10, top: window.__stack.top(), els: out };
  };
  R.start = () => { R.frames = []; R.on = true; const f = () => { if (!R.on) return; R.frames.push(R.snap()); requestAnimationFrame(f); }; requestAnimationFrame(f); };
  R.stop = () => { R.on = false; };
}

// ---- reading a recording ----
const els = f => new Map(f.els.map(e => [e[0], e]));
// The recording's finds: before = the frame before the act, after = the frame once all has settled.
function analyse(rec, kind) {
  const { frames, meta, before, after } = rec;
  const b = els(before), a = els(after), finds = [];
  const say = id => `${meta[id].pg} ${meta[id].el}${meta[id].text ? ` "${meta[id].text}"` : ''}`;
  // stray
  // (a leaving page's still copy, src/stack.js ghostOf: its part counts as seen when the same part, look and words, of
  // its page was shown before)
  const sig = e => `${e[7].replace(/^ghost:/, '')}|${meta[e[0]].el}|${meta[e[0]].text}`;
  const shownBefore = new Set([...b.values()].map(sig));
  const seen = new Map();
  for (const f of frames) for (const e of f.els) if (!(b.has(e[0]) && !e[7].startsWith('ghost:')) && !a.has(e[0]) && e[7] !== after.top && !(e[7].startsWith('ghost:') && shownBefore.has(sig(e)))) { const s = seen.get(e[0]) ?? { n: 0, at: e }; s.n++; seen.set(e[0], s); }
  for (const [id, s] of seen) {
    if (meta[id].pg === 'screen' && /maplibregl/.test(meta[id].el)) continue;
    finds.push({ kind: 'stray', id, what: `${s.at[7]} ${say(id).replace(/^\S+ /, '')}`, info: `seen in ${s.n} frame(s) at ${Math.round(s.at[1])},${Math.round(s.at[2])} ${Math.round(s.at[3])}×${Math.round(s.at[4])}` });
  }
  // the series of each element seen in the end
  const series = new Map();
  frames.forEach((f, i) => { for (const e of f.els) { let s = series.get(e[0]); if (!s) series.set(e[0], s = []); s.push({ i, x: e[1], y: e[2], w: e[3], h: e[4], rel: e[2] - f.sheetTop, o: e[5] }); } });
  for (const [id, s] of series) {
    if (!a.has(id) || s.length < 4) continue;
    if (meta[id].pg === 'screen' && !/status|map-btn|sh-/.test(meta[id].el)) continue;
    if (meta[id].bottom) continue;   // (the sheet's bottom band, "Mer ⌄": it rides the bottom edge)
    // jump: at rest (3 frames within 0.5 px) then moving 1 px or more again; or turning back by 2 px or more
    // (each axis on its own: a page sliding in sideways while the sheet rises is two smooth motions)
    // (at rest on one axis while it moves on the other counts: a title sliding in sideways, still in height, then
    // jumping up 10 px when the slide ends; Settings from ☰ on a computer, 2026-11-25)
    let jumped = null;
    const dir = { x: 0, y: 0 }, rest = { x: 0, y: 0 }, rested = { x: false, y: false }, moved = { x: false, y: false };
    for (let k = 1; k < s.length; k++) {
      if (s[k].i !== s[k - 1].i + 1) { for (const ax of ['x', 'y']) { rest[ax] = 0; dir[ax] = 0; } continue; }
      for (const ax of ['x', 'y']) {
        // (against the sheet's top for y: the sheet itself glides)
        const d = ax === 'y' ? s[k].rel - s[k - 1].rel : s[k].x - s[k - 1].x;
        if (Math.abs(d) < 0.5) { rest[ax]++; if (rest[ax] >= 3) rested[ax] = true; continue; }
        if (rested[ax] && Math.abs(d) >= 1 && !jumped) jumped = { k, d, kind: `moved again after rest (${ax === 'y' ? 'up/down in the sheet' : 'sideways'})` };
        if (dir[ax] && Math.sign(d) !== dir[ax] && Math.abs(d) >= 2 && !jumped) jumped = { k, d, kind: `turned back (${ax})` };
        dir[ax] = Math.sign(d); rest[ax] = 0; moved[ax] = true;
      }
    }
    if (jumped) finds.push({ kind: 'jump', id, what: say(id), info: `${jumped.kind}: ${jumped.d.toFixed(1)} px at frame ${s[jumped.k].i} of ${frames.length}` });
    // grow: the same page, a taller or shorter sheet; what is shown stays still against the sheet's top
    if (kind === 'grow') {
      const rel = s.map(p => p.rel), lo = Math.min(...rel), hi = Math.max(...rel);
      if (hi - lo >= 1.5) {
        let big = 0;
        for (let k = 1; k < s.length; k++) if (s[k].i === s[k - 1].i + 1) big = Math.max(big, Math.abs(s[k].rel - s[k - 1].rel));
        const total = Math.abs(rel.at(-1) - rel[0]);
        const pop = total >= 3 && big >= total * 0.8 && frames.length >= 6;
        // (a card's top buttons glide to their new places on purpose: only a one-frame pop of theirs counts)
        if (!pop && meta[id].btn) continue;
        finds.push({ kind: pop ? 'pop' : 'redrawn', id, what: say(id), info: `moved ${lo.toFixed(0)}…${hi.toFixed(0)} px under the sheet's top (start ${rel[0].toFixed(0)}, end ${rel.at(-1).toFixed(0)}, biggest step ${big.toFixed(1)})` });
      }
      const ws = s.map(p => p.w), wd = Math.abs(ws.at(-1) - ws[0]);
      if (wd >= 3) {
        let big = 0;
        for (let k = 1; k < s.length; k++) big = Math.max(big, Math.abs(ws[k] - ws[k - 1]));
        if (big >= wd * 0.8) finds.push({ kind: 'pop', id, what: say(id), info: `width ${ws[0]} → ${ws.at(-1)} in one frame` });
      }
    }
  }
  return finds;
}

// ---- the padding of the page on top, at rest ----
async function padding(page) {
  return page.evaluate(() => {
    const key = window.__stack.top();
    const pg = document.querySelector(`#sheet .pg[data-key="${CSS.escape(key)}"]`);
    if (!pg) return [];
    const out = [];
    const shown = el => el.offsetHeight > 0 && getComputedStyle(el).visibility !== 'hidden';
    const card = (el) => { const cs = getComputedStyle(el); return cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && parseFloat(cs.borderTopLeftRadius) >= 8; };
    // the blocks of the page, one level below the page (or its one wrapper)
    let root = pg;
    while (root.children.length === 1 && root.firstElementChild.children.length) root = root.firstElementChild;
    const blocks = [...root.children].filter(shown);
    for (let i = 1; i < blocks.length; i++) {
      const a = blocks[i - 1].getBoundingClientRect(), b = blocks[i].getBoundingClientRect();
      if (b.top < a.bottom - 1) continue;   // side by side
      const name = el => `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).slice(0, 2).join('.')}`;
      out.push({ type: 'gap', a: name(blocks[i - 1]), b: name(blocks[i]), px: Math.round(b.top - a.bottom), cards: card(blocks[i - 1]) && card(blocks[i]) });
    }
    // the room inside each card: from its edge to its first and last text
    for (const el of pg.querySelectorAll('*')) {
      if (!shown(el) || !card(el) || el.tagName === 'BUTTON' && el.offsetHeight < 50) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 30) continue;
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let top = Infinity, bottom = -Infinity, left = Infinity;
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (!n.textContent.trim() || !n.parentElement.offsetHeight) continue;
        const range = document.createRange(); range.selectNodeContents(n);
        for (const q of range.getClientRects()) { top = Math.min(top, q.top); bottom = Math.max(bottom, q.bottom); left = Math.min(left, q.left); }
      }
      if (!Number.isFinite(top)) continue;
      out.push({ type: 'inside', el: `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).slice(0, 2).join('.')}`, top: Math.round(top - r.top), bottom: Math.round(r.bottom - bottom), left: Math.round(left - r.left) });
    }
    return out;
  });
}

// ---- the transitions ----
const click = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); e?.click(); return Boolean(e); }, sel);
const esc = page => page.keyboard.press('Escape');
const settle = async (page) => { await sleep(300); await until(page, () => !document.getAnimations().some(a => a.playState === 'running' && a.effect?.target?.closest?.('#sheet, #nav')), 2500); await sleep(300); };
async function resetView(page) {
  await page.evaluate(() => window.__map.jumpTo({ center: [18.06, 59.33], zoom: 11, bearing: 0, pitch: 0 }));
  await sleep(1500);
  await until(page, () => window.__map.queryRenderedFeatures({ layers: ['train-dots'] }).length > 3, 20000);
}
const loneTrain = (page, exclude) => page.evaluate((ex) => {
  const m = window.__map, wide = innerWidth >= 440, shown = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-shown')) || 120;
  for (const f of m.queryRenderedFeatures({ layers: ['train-dots'] })) {
    if (f.properties.id === ex) continue;
    const q = m.project(f.geometry.coordinates);
    if (q.y < 90 || q.x < (wide ? 480 : 20) || q.x > innerWidth - 90 || q.y > (wide ? innerHeight - 40 : innerHeight - shown - 50)) continue;
    if (m.queryRenderedFeatures([[q.x - 30, q.y - 30], [q.x + 30, q.y + 30]], { layers: ['train-dots'] }).length !== 1) continue;
    if (m.queryRenderedFeatures([[q.x - 20, q.y - 20], [q.x + 20, q.y + 20]], { layers: ['station-dots', 'station-names'] }).length) continue;
    if (document.elementFromPoint(q.x, q.y)?.tagName !== 'CANVAS') continue;
    return { id: f.properties.id, x: q.x, y: q.y };
  }
  return null;
}, exclude ?? null);
async function openTrainFromMap(page) {
  let t = null;
  for (let k = 0; k < 4 && !/^train:/.test(await page.evaluate(() => window.__stack.top())); k++) {   // (a train moves on)
    await toRest(page); await resetView(page);
    t = await loneTrain(page);
    if (!t) continue;
    await page.mouse.click(t.x, t.y);
    await until(page, () => /^train:/.test(window.__stack.top()), 3000);
  }
  if (!t) return null;
  await until(page, () => Boolean(document.querySelector('#panel .panel-more')?.offsetHeight), 15000);
  await settle(page);
  return t;
}
const moreBtn = '#panel .panel-more';
const T = [
  { name: 'menu open', setup: toRest, act: p => click(p, '#nav-button') },
  { name: 'menu close', setup: async (p) => { await toRest(p); await openMenu(p); }, act: p => click(p, '#nav-button') },
  { name: 'menu → settings', setup: async (p) => { await toRest(p); await openMenu(p); }, act: p => click(p, '#open-settings') },
  { name: 'settings → back', setup: async (p) => { await toRest(p); await openMenu(p); await click(p, '#open-settings'); await settle(p); }, act: esc },
  { name: 'menu → about', setup: async (p) => { await toRest(p); await openMenu(p); }, act: p => click(p, '#help-button') },
  { name: 'about → back', setup: async (p) => { await toRest(p); await openMenu(p); await click(p, '#help-button'); await settle(p); }, act: esc },
  { name: 'menu → rewind', setup: async (p) => { await toRest(p); await openMenu(p); }, act: p => click(p, '#open-day') },
  { name: 'home rest → half', kind: 'grow', setup: toRest, act: p => p.evaluate(() => window.__stack.setLevel(1)) },
  { name: 'home half → full', kind: 'grow', setup: async (p) => { await toRest(p); await p.evaluate(() => window.__stack.setLevel(1)); await settle(p); }, act: p => p.evaluate(() => window.__stack.setLevel(2)) },
  { name: 'home full → rest', kind: 'grow', setup: async (p) => { await toRest(p); await p.evaluate(() => window.__stack.setLevel(2)); await settle(p); }, act: p => p.evaluate(() => window.__stack.setLevel(0)) },
  { name: 'home → filter more', live: true, kind: 'grow', setup: async (p) => { await toRest(p); await p.evaluate(() => window.__stack.setLevel(1)); await until(p, () => Boolean(document.querySelector('[data-act="comore"]')), 20000); await settle(p); }, act: p => click(p, `${HOME} [data-act="comore"]`) },
  { name: 'home → all disruptions', live: true, setup: async (p) => { await toRest(p); await p.evaluate(() => window.__stack.setLevel(1)); await until(p, () => Boolean(document.querySelector('[data-go="dislist"]')), 30000); await settle(p); }, act: p => click(p, `${HOME} [data-go="dislist"]`) },
  { name: 'all disruptions → back', live: true, setup: async (p) => { await toRest(p); await p.evaluate(() => window.__stack.setLevel(1)); await until(p, () => Boolean(document.querySelector('[data-go="dislist"]')), 30000); await click(p, `${HOME} [data-go="dislist"]`); await settle(p); }, act: esc },
  { name: 'home → connection', setup: toRest, act: p => click(p, '#status') },
  { name: 'search open', setup: toRest, act: p => p.evaluate(() => document.querySelector('#sheet .sh-field input, #sheet .sh-field')?.click()) },
  { name: 'search close', setup: async (p) => { await toRest(p); await openSearch(p); await settle(p); }, act: esc },
  { name: 'train from nothing', setup: async (p) => { await toRest(p); await resetView(p); p.__lone = await loneTrain(p); }, act: async (p) => { if (p.__lone) await p.mouse.click(p.__lone.x, p.__lone.y); } },
  { name: 'train more', kind: 'grow', setup: async (p) => { p.__t = await openTrainFromMap(p); }, act: p => click(p, moreBtn) },
  { name: 'train less', kind: 'grow', setup: async (p) => { p.__t = await openTrainFromMap(p); await click(p, moreBtn); await settle(p); }, act: p => click(p, moreBtn) },
  { name: 'train notes fold', kind: 'grow', setup: async (p) => { p.__t = await openTrainFromMap(p); await click(p, moreBtn); await settle(p); }, act: p => click(p, '#panel .board-msgs-toggle') },
  { name: 'train → train', setup: async (p) => { p.__t = await openTrainFromMap(p); p.__lone = p.__t && await loneTrain(p, p.__t.id); }, act: async (p) => { if (p.__lone) await p.mouse.click(p.__lone.x, p.__lone.y); } },
  { name: 'train → station', setup: async (p) => { p.__t = await openTrainFromMap(p); await click(p, moreBtn); await settle(p); }, act: p => p.evaluate(() => { const r = [...document.querySelectorAll('#panel .tl-row[data-sig]')].find(e => e.offsetHeight); r?.click(); return Boolean(r); }) },
  { name: 'station → back to train', setup: async (p) => { p.__t = await openTrainFromMap(p); await click(p, moreBtn); await settle(p); await p.evaluate(() => { const r = [...document.querySelectorAll('#panel .tl-row[data-sig]')].find(e => e.offsetHeight); r?.click(); }); await settle(p); }, act: esc },
  { name: 'station → train', setup: async (p) => { await toRest(p); await p.evaluate(() => window.__stack.open('station:Cst')); await until(p, () => Boolean(document.querySelector('#board .bd-row')), 20000); await settle(p); }, act: p => p.evaluate(() => { const r = [...document.querySelectorAll('#board .bd-row')].find(e => e.offsetHeight); r?.click(); return Boolean(r); }) },
  { name: 'station messages fold', kind: 'grow', setup: async (p) => {
    await toRest(p);
    for (const sig of ['Cst', 'Sci', 'Sod', 'Flb', 'Sub', 'Upv', 'Kn', 'Sta']) {
      await p.evaluate(k => window.__stack.open(`station:${k}`), sig);
      if (await until(p, () => Boolean(document.querySelector('#board .board-msgs-toggle')), 6000)) break;
    }
    await settle(p);
  }, act: p => click(p, '#board .board-msgs-toggle') },
];

// ---- running ----
const browser = await launch();
const all = [];
const notes = [];
let shotN = 0;
for (const [dev, size] of Object.entries(SIZES)) {
  if (SIZE && SIZE !== dev) continue;
  const pages = {};
  for (const tr of T) {
    if (ONLY && !ONLY.split(',').some(o => tr.name.includes(o))) continue;
    const src = tr.live ? 'live' : 'replay';
    if (!pages[src]) {
      pages[src] = await waitForMap(browser, { size, lang: 'sv', view: '11/59.33/18.06', ...(tr.live ? { wait: 20000 } : { replay: CARD_HOUR }) });
      await pages[src].evaluate(recorder);
      if (!tr.live) { await openTrainFromMap(pages[src]); await toRest(pages[src]); }   // (the first tap after the start went unanswered on the phone)
    }
    const page = pages[src];
    await page.bringToFront();   // (a tab behind another draws no frames)
    try {
      await tr.setup(page);
      await settle(page);
      const before = await page.evaluate(() => window.__rec.snap());
      await page.evaluate(() => window.__rec.start());
      const acted = await tr.act(page);
      if (acted === false) { notes.push(`${dev} ${tr.name}: nothing to tap (not checked; ${JSON.stringify(await page.evaluate(() => ({ top: window.__stack.top(), lvl: window.__stack.level, more: Boolean(document.querySelector('#panel .panel-more')) })))})`); await page.evaluate(() => window.__rec.stop()); continue; }
      await sleep(1400);
      await page.evaluate(() => window.__rec.stop());
      await settle(page);
      const after = await page.evaluate(() => window.__rec.snap());
      const { frames, meta } = await page.evaluate(() => ({ frames: window.__rec.frames, meta: window.__rec.meta }));
      const finds = analyse({ frames, meta, before, after }, tr.kind);
      if (TRACE) {   // (--trace <words>: the frames of the elements whose text has them)
        const ids = Object.keys(meta).filter(k => `${meta[k].el} ${meta[k].text}`.includes(TRACE)).map(Number);
        frames.forEach((f, i) => { const e = f.els.find(x => ids.includes(x[0]) && (!finds.length || finds.some(d => d.id === x[0]))); console.log(`  ${String(i).padStart(3)} t${Math.round(f.t - frames[0].t)} sheet ${f.sheetTop}/${f.sheetH} lvl ${f.lvl} scroll ${f.scroll} [${f.cls}] {${f.home}} ${e ? `y ${e[2]} rel ${(e[2] - f.sheetTop).toFixed(1)} w ${e[3]}` : '–'}`); });
      }
      const pad = (await padding(page)).filter(x => x.type === 'gap' ? x.px > 0 : true);
      all.push({ dev, name: tr.name, frames: frames.length, finds, pad, top: after.top });
      console.log(`${dev} ${tr.name}: ${frames.length} frames, ${finds.length} find(s) → ${after.top}`);
      for (const f of finds.slice(0, 12)) console.log(`   ${f.kind.padEnd(7)} ${f.what}: ${f.info}`);
      if (finds.length > 12) console.log(`   … ${finds.length - 12} more`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/sweep-${dev}-${String(++shotN).padStart(2, '0')}.png` });
    } catch (e) {
      notes.push(`${dev} ${tr.name}: failed to play (${e.message.split('\n')[0]})`);
      await page.evaluate(() => window.__rec?.stop()).catch(() => {});
    }
  }
  for (const [src, page] of Object.entries(pages)) {
    if (page.errors.length) notes.push(`${dev} ${src}: page errors: ${page.errors.slice(0, 3).join(' | ')}`);
    await page.close();
  }
}
await browser.close();

// padding: per page the usual gap between cards, and those off it
console.log('\npadding (page on top after each transition):');
const seenPg = new Set();
for (const r of all) {
  const key = `${r.dev} ${r.top}`;
  if (seenPg.has(key) || !r.pad.length) continue;
  seenPg.add(key);
  const gaps = r.pad.filter(x => x.type === 'gap').map(x => `${x.a}→${x.b} ${x.px}`);
  const inside = r.pad.filter(x => x.type === 'inside').map(x => `${x.el} t${x.top} b${x.bottom} l${x.left}`);
  console.log(`  ${key}\n    gaps: ${gaps.join(', ') || '–'}\n    inside: ${inside.slice(0, 14).join(', ') || '–'}`);
}
for (const n of notes) console.log(`note: ${n}`);
const total = all.reduce((s, r) => s + r.finds.length, 0);
console.log(`\n${total} motion find(s) in ${all.length} transitions`);
if (process.env.SWEEP_JSON) (await import('node:fs')).writeFileSync(process.env.SWEEP_JSON, JSON.stringify(all, null, 1));
process.exit(REPORT || total === 0 ? 0 : 1);
