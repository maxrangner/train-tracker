// The disruptions' pages (live only; the data: src/disruptions.js): the list (the start's chip Störningar, a root page:
// src/start-chips.js; the problems, then the rail work folded
// under "Rail work (n)", ending soonest first; open or folded remembered on this device) and one disruption (its words;
// opened, the map shows all of its stretches).
//
// createDisruptionPages({ disruptions, stationName, map, stack, now }) -> { list(), one(id), open(id), onData() };
// stack is a getter.
import { rowHtml, cardHtml, isWork } from '../disruptions.js';
import { stateHtml } from '../state.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { arrive } from '../motion.js';

const WORKS_KEY = 'railWorksOpen';
const STATION_ZOOM = 9;   // a disruption at one station: the map flies there

export function createDisruptionPages(ctx) {
  const { disruptions, stationName, map, now } = ctx;
  let worksOpen = false;
  try { worksOpen = localStorage.getItem(WORKS_KEY) === 'true'; } catch { /* folded */ }

  function list() {
    let el = null, seen = new Set();
    function draw() {
      const all = disruptions.list, problems = all.filter(d => !isWork(d));
      const works = all.filter(isWork).sort((a, b) => (a.until ?? Infinity) - (b.until ?? Infinity));
      const row = d => rowHtml(d, stationName, now());
      el.innerHTML = `<div class="panel-head"><strong>${t('disruptions')}</strong></div><div class="dis-body">` + (!disruptions.loaded ? stateHtml('loading', t('loading'))
        : !all.length ? stateHtml('empty', t('noDisruptions'))
        : `<p class="panel-note">${t(problems.length ? 'disruptionsNote' : 'noProblemsNow')}</p>`) +
        problems.map(row).join('') +
        (works.length ? `<button type="button" class="dis-fold" aria-expanded="${worksOpen}"><span class="dis-ic work" aria-hidden="true">${icon('cone', 16)}</span>` +
          `<span>${t('railWorks')} (${works.length})</span>${icon('chevronDown', 16)}</button>` +
          `<div class="dis-works${worksOpen ? ' open' : ''}"${worksOpen ? '' : ' inert'}><div class="dis-works-in">${works.map(row).join('')}</div></div>` : '') + '</div>';
      arrive(el.querySelectorAll('.dis-body > .dis-row, .dis-body > .dis-fold'), seen, r => r.dataset.id ?? 'fold');
      // (the fold glides open and shut: the rows are always there, in a box whose height goes from none to all; shut
      // ones out of reach, inert)
      const fold = el.querySelector('.dis-fold'), box = el.querySelector('.dis-works');
      if (fold) fold.onclick = () => {
        worksOpen = !worksOpen;
        try { localStorage.setItem(WORKS_KEY, String(worksOpen)); } catch { /* not kept */ }
        fold.setAttribute('aria-expanded', String(worksOpen));
        box.classList.toggle('open', worksOpen);
        box.inert = !worksOpen;
        if (worksOpen) arrive(box.querySelectorAll('.dis-row'), new Set(), r => r.dataset.id);
        // (the sheet shows the opened list at once: its end is where the glide will take it)
        const inner = box.firstElementChild;
        if (worksOpen) ctx.stack.reveal(fold, fold.getBoundingClientRect().bottom + 6 + (inner?.scrollHeight ?? 0));
        else ctx.stack.unreveal();
      };
    }
    return { name: () => t('disruptions'), kind: 'dislist', mount(page) { el = page; }, show(page, { dir }) { if (dir > 0) seen = new Set(); draw(); }, redraw: () => draw() };
  }
  function one(id) {
    if (!disruptions.byId(id)) return null;
    let el = null;
    const draw = () => {
      const d = disruptions.byId(id);
      if (!d) return;
      el.innerHTML = `<div id="disruption">${cardHtml(d, stationName, now())}</div>`;
    };
    return {
      name: () => disruptions.byId(id)?.header ?? t('disruptions'), kind: 'dis',
      mount(page) { el = page; },
      show(page, { dir }) {
        draw();
        if (dir <= 0) return;   // (come back to, not opened: the map stays)
        const d = disruptions.byId(id), box = disruptions.boundsOf(d), p = !box && disruptions.placeOf(d);
        map.unfollow();
        if (box) map.fitBox(box);
        else if (p) map.goTo(p, STATION_ZOOM);
      },
      redraw: draw,
    };
  }
  return {
    list, one,
    open: (id, opts) => ctx.stack.open(`dis:${id}`, opts),
    // New data: the list or the disruption on top drawn again (one that ended closes).
    onData() {
      const stack = ctx.stack, top = stack?.top() ?? '';
      if (top === 'dislist') stack.pageDef(top).redraw();
      if (top.startsWith('dis:')) { if (disruptions.byId(top.slice(4))) stack.pageDef(top).redraw(); else stack.close(top); }
    },
  };
}
