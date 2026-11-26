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
//   peeks    ☰'s card showing over the sheet, through its corners or past its edge (2026-11-26)
//   under    a leaving page's copy under the search box while the box shows (2026-11-26)
//   pop      the same: something changes place or size in one frame while the rest glides ("top buttons should
//            animate into the new layout, not just pop")
// and one of the look: padding, the gaps between a page's cards and the room inside them, against the page's usual gap
// ("Pic 1: Bad padding").
//   node tools/ui-sweep.mjs [--only <name part>] [--size phone|pc] [--shots <folder>] [--report]
// --report lists every find and exits 0; without it the finds not in the accepted list (ACCEPT below) fail the run.
// Two pages per size: the replay the screens check plays (its trains have their stops) and, for the disruptions (live
// only; the chip Störningar), the live map. In Swedish, as Max uses it. The page: PAGE (tools/lib/browser.mjs).
import { launch, sleep, PHONE, CARD_HOUR } from './lib/browser.mjs';
import { waitForMap, until, toRest, openMenu, openSearch, openChip, openFromMenu, openDisruptions, pageSel } from './lib/screen.mjs';

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
    return { pg, el: `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`, text, bottom: Boolean(el.closest('.sh-grab, .sh-more')), btn: Boolean(el.closest('.sh-btns, .panel-buttons')), search: Boolean(el.closest('.sh-search')),
      roll: Boolean(el.closest('.cd-late, .roll, .st-odo')) };   // (numbers that roll on purpose, src/motion.js roll; Statistik's odometer wheels, in sight at half on its own card since 2026-11-25)
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
    // (☰'s card: the part of it that shows, inside its window (src/nav-menu.js #nav-window); parked under a page: none)
    const nv = document.getElementById('nav'), win = document.getElementById('nav-window');
    let nav = null;
    if (nv && !nv.hidden && !nv.classList.contains('under') && getComputedStyle(nv).visibility !== 'hidden' && Number(getComputedStyle(nv).opacity) >= 0.05) {
      const r = nv.getBoundingClientRect(), w = win ? win.getBoundingClientRect() : { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
      nav = [Math.max(r.left, w.left), Math.max(r.top, w.top), Math.min(r.right, w.right), Math.min(r.bottom, w.bottom)];
      if (nav[2] - nav[0] < 1 || nav[3] - nav[1] < 1) nav = null;
    }
    return { nav, sheetBox: [sheet.left, sheet.top, sheet.right, sheet.bottom], home, t: performance.now(), scroll: pgTop ? Math.round(pgTop.scrollTop) : null, lvl: window.__stack.level, cls: document.getElementById('panel').className, sheetTop: Math.round(sheet.top * 10) / 10, sheetH: Math.round(sheet.height * 10) / 10, top: window.__stack.top(), els: out };
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
  // (its digits aside: a number on the page is redrawn each second, so the copy can hold a newer value than the frame
  // before; Statistik's numbers in its leaving copy, 2026-11-26)
  const sig = e => `${e[7].replace(/^ghost:/, '')}|${meta[e[0]].el}|${meta[e[0]].text.replace(/\d/g, '#')}`;
  const shownBefore = new Set([...b.values()].map(sig));
  // (by height only: the copy is already sliding sideways in its first frame)
  // (in the sheet: the sheet itself may be moving)
  const placeBefore = new Set([...b.values()].map(e => `${e[7]}|${meta[e[0]].el}|${Math.round((e[2] - before.sheetTop) / 4)}`));
  const firstAt = new Map();
  for (const f of frames) for (const e of f.els) if (!firstAt.has(e[0])) firstAt.set(e[0], [e, f.sheetTop]);
  const samePlace = (e) => { const [g, top] = firstAt.get(e[0]); return placeBefore.has(`${g[7].replace(/^ghost:/, '')}|${meta[g[0]].el}|${Math.round((g[2] - top) / 4)}`); };
  const seen = new Map();
  // (the shared top buttons in a copy count as they were: the snapshot can miss them mid-move)
  for (const f of frames) for (const e of f.els) if (!(b.has(e[0]) && !e[7].startsWith('ghost:')) && !a.has(e[0]) && e[7] !== after.top && !(e[7].startsWith('ghost:') && (shownBefore.has(sig(e)) || samePlace(e) || meta[e[0]].btn))) { const s = seen.get(e[0]) ?? { n: 0, at: e }; s.n++; seen.set(e[0], s); }
  for (const [id, s] of seen) {
    if (meta[id].pg === 'screen' && /maplibregl/.test(meta[id].el)) continue;
    if (process.env.SWEEP_DEBUG && s.at[7].startsWith('ghost:')) { const [g, top] = firstAt.get(id); console.log('   ghost', meta[id].el, 'first', Math.round(g[2] - top), 'before:', [...b.values()].filter(e => meta[e[0]].el === meta[id].el).map(e => `${e[7]}@${Math.round(e[2] - before.sheetTop)}`).join(' ')); }
    finds.push({ kind: 'stray', id, what: `${s.at[7]} ${say(id).replace(/^\S+ /, '')}`, info: `seen in ${s.n} frame(s) at ${Math.round(s.at[1])},${Math.round(s.at[2])} ${Math.round(s.at[3])}×${Math.round(s.at[4])}` });
  }
  // the series of each element seen in the end
  const series = new Map();
  frames.forEach((f, i) => { for (const e of f.els) { let s = series.get(e[0]); if (!s) series.set(e[0], s = []); s.push({ i, t: f.t, x: e[1], y: e[2], w: e[3], h: e[4], rel: e[2] - f.sheetTop, o: e[5] }); } });
  for (const [id, s] of series) {
    if (!a.has(id) || s.length < 4) continue;
    if (meta[id].pg === 'screen' && !/status|map-btn|sh-/.test(meta[id].el)) continue;
    if (meta[id].bottom || meta[id].roll) continue;   // (the sheet's bottom band, "Mer ⌄": it rides the bottom edge; a rolling number)
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
        // (its size changed in the same frame: new words in it, not a move; Settings' "Positions arriving", "–" to its
        // numbers a second after the page, right-aligned so its left edge went 231 px; 2026-11-26)
        if (Math.abs(s[k].w - s[k - 1].w) > 2 || Math.abs(s[k].h - s[k - 1].h) > 2) { rest[ax] = 0; continue; }
        if (rested[ax] && Math.abs(d) >= 2 && !jumped) jumped = { k, d, kind: `moved again after rest (${ax === 'y' ? 'up/down in the sheet' : 'sideways'})` };
        if (dir[ax] && Math.sign(d) !== dir[ax] && Math.abs(d) >= 2 && !jumped) jumped = { k, d, kind: `turned back (${ax})` };
        dir[ax] = Math.sign(d); rest[ax] = 0; moved[ax] = true;
      }
    }
    // fold: a lurch, the same way, at the end of a glide: a step of 3 px or more, three times as fast as the step before,
    // once the glide had slowed to a quarter of its top speed (a box glided too tall dropped to its height in one frame,
    // 22 px, still moving 0.7 px a frame: neither a rest nor a turn; Home's filter card until 2026-11-25)
    if (kind === 'fold' && !jumped) {
      // (only once the glide is under way, 4 moving frames in: at its start a busy PC's late first frames looked like a
      // lurch, the round's check 2026-11-25, 'pc home → filter more' at frame 3; alone it never did)
      let top = 0, prev = 0, going = 0;
      for (let k = 1; k < s.length && !jumped; k++) {
        // (steps one frame long only, 40 ms at most: on a busy PC a late frame held a smooth glide's last stretch, a
        // 9 px 'lurch' that a film at a quarter of the CPU's speed showed smooth; 'pc filter fewer', 2026-11-26)
        if (s[k].i !== s[k - 1].i + 1 || s[k].t - s[k - 1].t > 40) { prev = 0; continue; }
        const d = s[k].rel - s[k - 1].rel, v = Math.abs(d) / Math.max(1, s[k].t - s[k - 1].t);
        if (Math.abs(d) >= 0.5) going++;
        if (going > 4 && prev && prev < top / 4 && Math.abs(d) >= 3 && v > 3 * prev) jumped = { k, d, kind: 'lurched at the end of its glide (up/down in the sheet)' };
        top = Math.max(top, v); prev = v;
      }
    }
    if (jumped && kind !== 'reveal') finds.push({ kind: 'jump', id, what: say(id), info: `${jumped.kind}: ${jumped.d.toFixed(1)} px at frame ${s[jumped.k].i} of ${frames.length}` });
    // grow: the same page, a taller or shorter sheet; what is shown stays still against the sheet's top
    // (fold: a card opening or shutting in the page, what is under it moves with it: as reveal, but a jump counts)
    if (kind === 'grow' || kind === 'reveal' || kind === 'fold') {
      const rel = s.map(p => p.rel), lo = Math.min(...rel), hi = Math.max(...rel);
      if (hi - lo >= 3) {   // (under 3 px: a text's own settling, not a card's move)
        let big = 0;
        // (a step counts only as long as one frame: on a busy PC one sample 100 ms after the last held a smooth glide's
        // whole way, 'station messages fold' in a round's check, 2026-11-26; alone it never did)
        for (let k = 1; k < s.length; k++) if (s[k].i === s[k - 1].i + 1 && s[k].t - s[k - 1].t <= 40) big = Math.max(big, Math.abs(s[k].rel - s[k - 1].rel));
        const total = Math.abs(rel.at(-1) - rel[0]);
        const pop = total >= 3 && big >= total * 0.8 && frames.length >= 6;
        // (a card's top buttons glide to their new places on purpose: only a one-frame pop of theirs counts)
        if (!pop && (meta[id].btn || kind === 'reveal' || kind === 'fold')) continue;
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
  // fold: the sheet's own edges move once, in one direction, and stand (Max, 2026-11-25: "When expanding and compacting
  // the filters the bottom jumps a few pixels": a second move after the first had ended, or one turning back)
  if (kind === 'fold') {
    for (const [name, at] of [['top', f => f.sheetTop], ['bottom', f => f.sheetTop + f.sheetH]]) {
      let dir = 0, rest = 0, rested = false, jumped = null, top = 0, prev = 0, going = 0;
      for (let k = 1; k < frames.length && !jumped; k++) {
        const d = at(frames[k]) - at(frames[k - 1]), v = Math.abs(d) / Math.max(1, frames[k].t - frames[k - 1].t);
        if (Math.abs(d) < 0.5) { if (++rest >= 3) rested = true; prev = v; continue; }
        if (rested && Math.abs(d) >= 1) jumped = `moved again after rest: ${d.toFixed(1)} px at frame ${k}`;
        else if (dir && Math.sign(d) !== dir && Math.abs(d) >= 1) jumped = `turned back: ${d.toFixed(1)} px at frame ${k}`;
        // (the lurch only between steps one frame long each, 40 ms at most: a late frame's speed, its move spread over
        // its long wait, looked like a slowed glide and the next frame like a lurch; 'pc filter more', 2026-11-26)
        else if (++going > 4 && prev && prev < top / 4 && Math.abs(d) >= 3 && v > 3 * prev && frames[k].t - frames[k - 1].t <= 40 && frames[k - 1].t - (frames[k - 2]?.t ?? 0) <= 40) jumped = `lurched at the end of its glide: ${d.toFixed(1)} px at frame ${k}`;
        dir = Math.sign(d); rest = 0; top = Math.max(top, v); prev = frames[k].t - frames[k - 1].t <= 40 ? v : 0;
      }
      if (jumped) finds.push({ kind: 'jump', id: 0, what: `the sheet's ${name} edge`, info: `${jumped} of ${frames.length}` });
    }
  }
  // under: a leaving page's copy seen under the search box while it shows (Max, 2026-11-26: "still buggy animations when
  // closing out cards on the search bar": the card's rows slid under the search box fading in). A computer only: the
  // phone kept its sideways slide (his plan: "the phone stays as it is"), where the leaving ‹ shows under the box for
  // 5-6 frames (TODO 75, asked)
  if (rec.dev === 'pc') {
    let n = 0, at = null;
    for (const f of frames) {
      const sb = f.els.filter(e => meta[e[0]].search && e[5] >= 0.05);
      if (!sb.length) continue;
      const box = [Math.min(...sb.map(e => e[1])), Math.min(...sb.map(e => e[2])), Math.max(...sb.map(e => e[1] + e[3])), Math.max(...sb.map(e => e[2] + e[4]))];
      const g = f.els.find(e => e[7].startsWith('ghost:') && e[5] >= 0.05 && e[1] < box[2] && e[1] + e[3] > box[0] && e[2] < box[3] && e[2] + e[4] > box[1]);
      if (g) { n++; at ??= g; }
    }
    if (n) finds.push({ kind: 'under', id: at[0], what: `${at[7]} ${meta[at[0]].el}${meta[at[0]].text ? ` "${meta[at[0]].text}"` : ''}`, info: `under the search box as it shows, ${n} frame(s)` });
  }
  // peeks: ☰'s card showing over the sheet (it lies under it: what shows there shows through the box's rounded corners or
  // past its edge; Max, 2026-11-26: "Calling Hamburger menu shows its corner in the top right of the search bar")
  {
    let n = 0, at = null;
    for (const f of frames) {
      if (!f.nav || !f.sheetBox) continue;
      const [l, t, r, b] = f.nav, [sl, st, sr, sb] = f.sheetBox;
      const w = Math.min(r, sr) - Math.max(l, sl), h = Math.min(b, sb) - Math.max(t, st);
      if (w > 2 && h > 2) { n++; at ??= `${Math.round(w)}×${Math.round(h)} px at ${Math.round(Math.max(l, sl))},${Math.round(Math.max(t, st))}`; }
    }
    if (n) finds.push({ kind: 'peeks', id: 0, what: 'the menu', info: `over the sheet in ${n} frame(s), first ${at}` });
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

// ---- empty room and the menu's place, after each transition ----
// Empty room: the page on top at full ends at most 24 px above where it can end (its bottom when it doesn't scroll, its
// scroll end when it does). Its content is what shows: text, buttons, pictures, fields; an empty box (a spacer) is not
// content (Max, 2026-11-25, New trip: "soooo much empty space. I asked you to remove ALL these kinds of issues").
// The menu's place: open, its card hangs from the box (a computer: under the sheet, right edge with the sheet's; a phone:
// above the sheet or under the bar, right edge with ☰'s), 6 to 16 px off it (Max, 2026-11-25: "Menu NOT aligned";
// back from Settings it stood elsewhere).
// Not counted: a phone's room for its keyboard (data-spacer, and the search, full screen on a phone by design: the
// keyboard covers its lower half; this browser has none); a scrolled page's end may have up to 32 px (its last card's
// bottom room and the page's own).
async function placeChecks(page) {
  return page.evaluate(() => {
    const out = [];
    const sh = document.getElementById('sheet').getBoundingClientRect();
    const wide = innerWidth >= 440;
    if (window.__stack.level === 2 && !(window.__stack.searching && !wide)) {
      const pg = window.__stack.searching ? document.getElementById('search-results') : document.querySelector(`#sheet .pg[data-key="${CSS.escape(window.__stack.top())}"]`);
      if (pg) {
        const top = pg.getBoundingClientRect().top - pg.scrollTop;
        let end = 0;
        const real = pg.querySelectorAll('button, input, img, svg, canvas, textarea, select');
        for (const e of real) if (e.offsetHeight) end = Math.max(end, e.getBoundingClientRect().bottom - top);
        // (a part drawn as a card, its own background: the card's padding under its last line is the card, not empty
        // room; Sparade at full on a computer counted 14 px of it, 2026-11-26)
        for (const c of pg.querySelectorAll(':scope > *, :scope > * > *')) {
          if (!c.offsetHeight || c.closest('[data-spacer]')) continue;
          const cs = getComputedStyle(c);
          if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') end = Math.max(end, c.getBoundingClientRect().bottom - top);
        }
        const w = document.createTreeWalker(pg, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          if (!n.textContent.trim() || !n.parentElement.offsetHeight) continue;
          const r = document.createRange(); r.selectNodeContents(n);
          for (const q of r.getClientRects()) end = Math.max(end, q.bottom - top);
        }
        const scrolls = pg.scrollHeight > pg.clientHeight + 1;
        const g = document.querySelector('#sheet .sh-grab'), gr = g?.offsetHeight ? g.getBoundingClientRect() : null;
        const spacers = [...pg.querySelectorAll('[data-spacer]')].reduce((h, e) => h + e.offsetHeight, 0);
        const limit = scrolls ? pg.scrollHeight - spacers : Math.min(sh.bottom, innerHeight) - (gr && gr.top >= end + top - 1 ? gr.height : 0) - top;
        if (end && limit - end > (scrolls ? 32 : 24)) out.push({ kind: 'room', what: window.__stack.searching ? 'search' : window.__stack.top(), info: `${Math.round(limit - end)} px empty under its content${scrolls ? ' (scrolled to its end)' : ''} (want 24 at most)` });
      }
    }
    const nav = document.getElementById('nav');
    // (parked under a page the menu opened: covered by it, not placed by the box; src/nav-menu.js fromMenu)
    if (nav && !nav.hidden && !nav.classList.contains('under') && !nav.getAnimations().length && getComputedStyle(nav).visibility !== 'hidden') {
      const r = nav.getBoundingClientRect(), b = document.getElementById('nav-button').getBoundingClientRect();
      const right = wide ? sh.right : b.right;
      const off = r.top >= sh.top ? r.top - (wide && window.__stack.level === 0 ? sh.bottom : b.bottom) : sh.top - r.bottom;
      if (Math.abs(r.right - right) > 1 || off < 6 || off > 16) out.push({ kind: 'place', what: 'menu', info: `its right edge ${Math.round(r.right - right)} px off, ${Math.round(off)} px from the box (want 0 and 6 to 16)` });
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
  // (a page that won't cover the menu, a computer's Filter: the menu fades where it is; Max, 2026-11-26)
  { name: 'menu → filter', setup: async (p) => { await toRest(p); await openMenu(p); }, act: p => click(p, '#open-filter') },
  { name: 'about → back', setup: async (p) => { await toRest(p); await openMenu(p); await click(p, '#help-button'); await settle(p); }, act: esc },
  // ('menu → arrow' gone: Home has no handle or arrow since the start chips, 2026-11-25, and ☰ over a chip's card closes it first)
  { name: 'new trip typing', setup: async (p) => { await toRest(p); await p.evaluate(() => window.__stack.open('newtrip', { go: true })); await until(p, () => Boolean(document.querySelector('#sheet .nt-stop'))); await settle(p); },
    act: p => p.evaluate(() => { const q = document.querySelector('#sheet .nt-q'); if (q) { q.focus(); return true; } const b = [...document.querySelectorAll('#sheet .nt-stop [data-nt]')].at(-1); b?.click(); return Boolean(b); }) },
  { name: 'menu → rewind', setup: async (p) => { await toRest(p); await openMenu(p); }, act: p => click(p, '#open-day') },
  // (Home has no heights since the start chips, 2026-11-25: Home's rest → half → full → rest are a chip's card's now,
  // Statistik: opened by its chip, raised, lowered, closed by its lit chip)
  { name: 'chip → statistik', setup: toRest, act: p => click(p, '#chips [data-chip="stats"]') },
  { name: 'statistik half → full', kind: 'grow', setup: async (p) => { await openChip(p, 'stats'); await p.evaluate(() => window.__stack.setLevel(1)); await settle(p); }, act: p => p.evaluate(() => window.__stack.setLevel(2)) },
  { name: 'statistik full → half', kind: 'grow', setup: async (p) => { await openChip(p, 'stats'); await p.evaluate(() => window.__stack.setLevel(2)); await settle(p); }, act: p => p.evaluate(() => window.__stack.setLevel(1)) },
  { name: 'statistik → closed by its chip', setup: async (p) => { await openChip(p, 'stats'); await settle(p); }, act: p => click(p, '#sheet .sh-chips [data-chip="stats"]') },
  { name: 'statistik → sparade', setup: async (p) => { await openChip(p, 'stats'); await settle(p); }, act: p => click(p, '#sheet .sh-chips [data-chip="saved"]') },
  // (fold: what is under the card moves down as it grows, up as it shuts: strays, pops and jumps count, the sheet's
  // edges too; Max, 2026-11-25: "When expanding and compacting the filters the bottom jumps a few pixels"; the Filter
  // page from ☰ since the start chips, Home's filter card until then)
  { name: 'filter more', kind: 'fold', setup: async (p) => { await openFromMenu(p, 'filter'); await until(p, s => Boolean(document.querySelector(`${s} [data-act="comore"]:not([hidden])`)), 20000, pageSel('filter')); await settle(p); }, act: p => click(p, `${pageSel('filter')} [data-act="comore"]`) },
  { name: 'filter fewer', kind: 'fold', setup: async (p) => { await openFromMenu(p, 'filter'); await until(p, s => Boolean(document.querySelector(`${s} [data-act="comore"]:not([hidden])`)), 20000, pageSel('filter')); await settle(p); await click(p, `${pageSel('filter')} [data-act="comore"]`); await settle(p); }, act: p => click(p, `${pageSel('filter')} [data-act="comore"]`) },
  { name: 'filter → back', setup: async (p) => { await openFromMenu(p, 'filter'); await settle(p); }, act: esc },
  // (the list of disruptions by the chip Störningar since 2026-11-25; Home's "Alla störningar" row until then)
  { name: 'chip → störningar', live: true, setup: async (p) => { await toRest(p); await until(p, () => Boolean(document.querySelector('#chips [data-chip="dislist"] .ct-n')), 30000); await settle(p); }, act: p => click(p, '#chips [data-chip="dislist"]') },
  { name: 'störningar → back', live: true, setup: async (p) => { if (!(await openDisruptions(p, { wait: 30000 }))) return; await settle(p); }, act: esc },
  { name: 'home → connection', setup: toRest, act: p => click(p, '#status') },
  { name: 'search open', setup: toRest, act: p => p.evaluate(() => document.querySelector('#sheet .sh-field input, #sheet .sh-field')?.click()) },
  { name: 'search close', setup: async (p) => { await toRest(p); await openSearch(p); await settle(p); }, act: esc },
  // (a card from the map, its title in the page, closed by a click on the map's empty ground: a computer at once to Home,
  // the card fading where it is and nothing under the search box as it shows; Max, 2026-11-26: "still buggy animations
  // when closing out cards on the search bar", "a click on the map with a card open should close it out")
  { name: 'map station → map click', setup: async (p) => { await toRest(p); await resetView(p); await p.evaluate(() => window.__stack.open('station:Cst', { go: true, fromMap: true })); await settle(p); },
    act: async (p) => { const q = await p.evaluate(() => { for (const [x, y] of [[innerWidth - 160, 140], [innerWidth - 260, 220], [innerWidth / 2, 120]]) {
      if (document.elementFromPoint(x, y)?.tagName === 'CANVAS' && !window.__map.queryRenderedFeatures([[x - 20, y - 20], [x + 20, y + 20]]).some(f => f.layer.type === 'symbol' || /train|station/.test(f.layer.id))) return { x, y }; } return null; });
      if (q) await p.mouse.click(q.x, q.y); } },
  { name: 'train from nothing', setup: async (p) => { await toRest(p); await resetView(p); p.__lone = await loneTrain(p); }, act: async (p) => { if (p.__lone) await p.mouse.click(p.__lone.x, p.__lone.y); } },
  { name: 'train more', kind: 'grow', setup: async (p) => { p.__t = await openTrainFromMap(p); }, act: p => click(p, moreBtn) },
  { name: 'train less', kind: 'grow', setup: async (p) => { p.__t = await openTrainFromMap(p); await click(p, moreBtn); await settle(p); }, act: p => click(p, moreBtn) },
  { name: 'train notes fold', kind: 'reveal', setup: async (p) => { p.__t = await openTrainFromMap(p); await click(p, moreBtn); await settle(p); }, act: p => click(p, '#panel .board-msgs-toggle') },
  { name: 'train → train', setup: async (p) => { p.__t = await openTrainFromMap(p); p.__lone = p.__t && await loneTrain(p, p.__t.id); }, act: async (p) => { if (p.__lone) await p.mouse.click(p.__lone.x, p.__lone.y); } },
  { name: 'train → station', setup: async (p) => { p.__t = await openTrainFromMap(p); await click(p, moreBtn); await settle(p); }, act: p => p.evaluate(() => { const r = [...document.querySelectorAll('#panel .tl-row[data-sig]')].find(e => e.offsetHeight); r?.click(); return Boolean(r); }) },
  // (reveal: on a computer a long train card scrolled down can slide down up to 70 px as the sheet grows back, its
  // scroll pulled in; known, TODO 73: only strays and pops count here for now)
  { name: 'station → back to train', kind: 'reveal', setup: async (p) => { p.__t = await openTrainFromMap(p); await click(p, moreBtn); await settle(p); await p.evaluate(() => { const r = [...document.querySelectorAll('#panel .tl-row[data-sig]')].find(e => e.offsetHeight); r?.click(); }); await settle(p); }, act: esc },
  { name: 'station → train', setup: async (p) => { await toRest(p); await p.evaluate(() => window.__stack.open('station:Cst')); await until(p, () => Boolean(document.querySelector('#board .bd-row')), 20000); await settle(p); }, act: p => p.evaluate(() => { const r = [...document.querySelectorAll('#board .bd-row')].find(e => e.offsetHeight); r?.click(); return Boolean(r); }) },
  { name: 'station messages fold', live: true, kind: 'reveal', setup: async (p) => {
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
      const finds = analyse({ frames, meta, before, after, dev }, tr.kind);
      if (TRACE) {   // (--trace <words>: the frames of the elements whose text has them)
        const ids = Object.keys(meta).filter(k => `${meta[k].el} ${meta[k].text}`.includes(TRACE)).map(Number);
        frames.forEach((f, i) => { const e = f.els.find(x => ids.includes(x[0]) && (!finds.length || finds.some(d => d.id === x[0]))); console.log(`  ${String(i).padStart(3)} t${Math.round(f.t - frames[0].t)} sheet ${f.sheetTop}/${f.sheetH} lvl ${f.lvl} scroll ${f.scroll} [${f.cls}] {${f.home}} ${e ? `x ${e[1]} y ${e[2]} rel ${(e[2] - f.sheetTop).toFixed(1)} w ${e[3]} ${meta[e[0]].el}<${e[7]}` : '–'}`); });
      }
      finds.push(...await placeChecks(page));
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
