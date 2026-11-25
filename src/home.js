// The start (Max's pick C, 2026-11-25: "C. With störningar, started and stats pills. Rest under the Hamburger menu.
// Search bar strict for searching"): Home is the search bar alone, the sheet's bottom page with nothing in it; what it
// held until then is in pages of its own (createStart), opened by the chips above the bar (src/start-chips.js) or ☰:
//   'saved'   Sparade (a chip): the saved trips and changes, the starred trains and stations; under it Near you, only
//             while My location is on,
//   'stats'   Statistik (a chip): Sweden right now, its tiles and today's graph (src/stats-page.js), the kinds of train
//             and the companies (a tap opens the group's page), most late, fastest, the busiest stations, "for fun",
//   'filter'  Filter (☰): the lateness bar (a tap on a colour lights only those trains, the others leave the map until
//             tapped again) and the companies on the map.
// The chip Störningar opens the list of disruptions (src/pages/disruptions.js; its count and colour: disChip here).
// Also the group pages (a company, a kind, "late now", "standing still": only its trains on the map while it is
// open; "Show only" keeps that after it closes, through src/filter.js) and the rows every page and the search share.
// Every row is a door: data-go carries the stack key it opens (src/stack.js); src/main.js listens for them.
import { t } from './i18n.js';
import { settings } from './settings.js';
import { glideHeight } from './motion.js';
import { isWide } from './layout.js';
import { esc } from './html.js';
import { icon, titleIcon, titleChip, titleAttrs } from './icons.js';
import { tagHtml } from './tag.js';
import { lateClass } from './lateness.js';
import { brandColour } from './stats.js';
import { kindOf, KINDS } from './train-kinds.js';
import { createStatsPage } from './stats-page.js';
import { isWork, levelName } from './disruptions.js';

const dot = c => `<i class="dot" style="background:${c}"></i>`;
export const groupName = (type, v) => (type === 'kind' ? t(`kind_${v}`) : v || t('stNoCompany'));

// ---------- rows ----------
// A train: { id, number, brand, minutes (null: not known), sub (words under it) }.
export function trainRow({ id, number, brand, minutes, sub = '', go = null }) {
  return `<button type="button" class="row" data-go="${esc(go ?? `train:${id}`)}"><b class="r-num">${esc(number)}</b>` +
    `<span class="r-main"><b>${brand ? dot(brandColour(brand)) : ''}${esc(brand || t('train'))}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>` +
    `${minutes === null || minutes === undefined ? '' : tagHtml(minutes)}</button>`;
}
export function stationRow({ sig, name, sub = '', lead = '<i class="ring"></i>', cls = '' }) {
  return `<button type="button" class="row" data-go="station:${esc(sig)}"><span class="r-ic ${cls}">${lead}</span>` +
    `<span class="r-main"><b>${esc(name)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>${icon('chevron', 18)}</button>`;
}
export function groupRow({ key, name, sub, colour = null }) {
  return `<button type="button" class="row" data-go="${esc(key)}"><span class="r-ic">${colour ? dot(colour) : '<i class="ring sq"></i>'}</span>` +
    `<span class="r-main"><b>${esc(name)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>${icon('chevron', 18)}</button>`;
}
// The starred trains and stations as rows (Home's Saved, the empty search). onMap(number) -> { id, brand, minutes } of
// that train on the map, or null: its row then opens its run now, the next one, or the latest (data-act="favtrain").
export function starredRows({ favourites, stations, onMap }) {
  const trains = favourites.trains.map((n) => {
    const x = onMap(n);
    return x ? trainRow({ id: x.id, number: n, brand: x.brand, minutes: x.minutes, sub: t('onMap') })
      : `<button type="button" class="row" data-act="favtrain" data-n="${esc(n)}"><b class="r-num">${esc(n)}</b><span class="r-main"><b>${esc(t('train'))}</b><small>${esc(t('notOnMapNow'))}</small></span></button>`;
  });
  const places = favourites.stations.map(sig => stations.get(sig)).filter(Boolean)
    .map(st => stationRow({ sig: st.sig, name: st.name, lead: icon('starFilled', 18), cls: 'star' }));
  return { trains, stations: places };
}

// An element's inside drawn again only when its words changed; true when it was. (What a draw changes after this, as
// the filter's one-row fit, is done again by its caller after every redraw: the words kept here are only what was put.)
const drawnHtml = new WeakMap();
export function swap(el, html) {
  if (drawnHtml.get(el) === html) return false;
  el.innerHTML = html;
  drawnHtml.set(el, html);
  return true;
}
// A small helper for a page made of parts: each part is a div drawn again only when its words changed.
// put(key, html, cls) -> { sec: the part, drew: it was drawn again now }
export function parts(el) {
  const secs = new Map();
  return (key, html, cls = '') => {
    let s = secs.get(key);
    if (!s) { s = document.createElement('div'); s.className = `sec ${cls}`; secs.set(key, s); el.append(s); }
    const drew = swap(s, html);
    s.hidden = !html;
    return { sec: s, drew };
  };
}

// ---------- the start: Home and its pages ----------
// d: { frame() -> the trains drawn now ([{ id, lon, lat, v, stale, brand }]), lateOf(id) -> minutes or null,
//   numberOf(id), favourites, stations() -> Map, location() -> { lon, lat } or null, disruptions() -> list or null,
//   stationName(sig), snapshot() -> src/stats.js snapshot of all trains, legend: { get(), set(k) }, statsActions,
//   filter, myTrains() -> { rows, add }, reveal(el), unreveal(), onShow() (Statistik shown: its day's numbers asked) }
// createStart(d) -> { home (Home's page: nothing in it), define(key) (a start page: 'saved', 'stats', 'filter'; else
//   null), page(key) (that page's def while it is made, else null: Filter's toggleCo), redraw() (each start page that
//   is made), savedCount(), disChip() -> { n, colour } }
export function createStart(d) {
  const made = new Map();   // key -> the def of that page while it is made (mount .. unmount)
  const kinds = { saved: savedPage, stats: statsPage, filter: filterPage };
  function define(key) {
    const make = kinds[key];
    if (!make) return null;
    const def = make(d);
    const { mount, unmount } = def;
    def.mount = (el, pg) => { made.set(key, def); mount(el, pg); };
    def.unmount = () => { if (made.get(key) === def) made.delete(key); unmount?.(); };
    return def;
  }
  return {
    home: { name: () => t('home'), kind: 'home' },
    define,
    page: key => made.get(key) ?? null,
    redraw() { for (const def of made.values()) def.redraw(); },
    savedCount: () => savedCount(d),
    disChip: () => disChip(d.disruptions()),
  };
}

// Sparade's number: what is saved, the trips and today's changes, the trains, the stations (its title's chip and the
// start's chip)
function savedCount(d) {
  const mt = d.myTrains?.() ?? { rows: [] }, stations = d.stations();
  return mt.rows.length + d.favourites.trains.length + d.favourites.stations.filter(sig => stations.get(sig)).length;
}
// Störningar's number and colour: all of them, as the list counts; the colour of the worst problem shown first (the
// list comes worst first), rail work alone or nothing grey. null: not loaded.
export function disChip(list) {
  if (!list) return null;
  const problems = list.filter(x => !isWork(x));
  return { n: list.length, problems: problems.length,
    colour: problems.length ? `var(--dis-${{ red: 3, orange: 2, yellow: 1 }[levelName(problems[0].level)]})` : 'var(--muted)' };
}

// Sparade ("Mina" until 2026-11-23, Max: "Sparade", with small headings for what it holds): Trips (the saved trips and
// pinned changes, src/my-trains.js, then "+ New trip"), Trains (starred), Stations (starred); a heading only when it
// has something. Under it Near you.
function savedPage(d) {
  let put = null;
  function mineHtml(frame) {
    const byNumber = new Map(frame.map(x => [String(d.numberOf(x.id)), x]));
    const { trains, stations } = starredRows({ favourites: d.favourites, stations: d.stations(), onMap(n) {
      const x = byNumber.get(n);
      return x ? { id: x.id, brand: x.brand, minutes: d.lateOf(x.id) } : null;
    } });
    const mt = d.myTrains?.() ?? { rows: [], add: '' };
    const group = (k, rows) => (rows.length ? `<h5 class="lab2" data-saved="${k}">${t({ trips: 'savedTrips', trains: 'savedTrains', stations: 'savedStations' }[k])}</h5><div class="rows">${rows.join('')}</div>` : '');
    return `<h4 ${titleAttrs('lab')}>${titleIcon('star')}${t('mine')}${titleChip(savedCount(d))}</h4>` +
      (trains.length || stations.length ? '' : `<p class="empty">${t('favouritesHint')}</p>`) +
      `${group('trips', [...mt.rows, mt.add].filter(Boolean))}${group('trains', trains)}${group('stations', stations)}`;
  }
  function nearHtml() {
    const here = d.location();
    if (!here) return '';
    const k = Math.cos(here.lat * Math.PI / 180);
    const near = [...d.stations().values()].filter(st => st.advertised && st.lon !== null)
      .map(st => ({ st, km: Math.hypot((st.lon - here.lon) * k, st.lat - here.lat) * 111.2 })).sort((a, b) => a.km - b.km).slice(0, 3);
    if (!near.length) return '';
    return `<h4 ${titleAttrs('lab')}>${titleIcon('locate')}${t('nearYou')}</h4><div class="rows">${near.map(({ st, km }) => stationRow({ sig: st.sig, name: st.name,
      sub: km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`, lead: icon('locate', 18), cls: 'here' })).join('')}</div>`;
  }
  function draw() {
    if (!put) return;
    put('mine', mineHtml(d.frame()));
    put('near', nearHtml());
  }
  return {
    name: () => t('mine'), kind: 'saved',
    mount(el) { put = parts(el); put('mine', ''); put('near', ''); },
    unmount() { put = null; },
    show: () => draw(), every: () => draw(), redraw: () => draw(),
  };
}

// Statistik: Sweden right now and the statistics' cards (src/stats-page.js), Most late among them. Its day's numbers
// and the cancelled trains are asked for while it shows (d.onShow; src/main.js statsShown).
function statsPage(d) {
  let stats = null, mostLate = null, page = null;
  function mostLateHtml(frame) {
    const late = frame.map(x => ({ x, m: d.lateOf(x.id) })).filter(o => o.m > 0).sort((a, b) => b.m - a.m).slice(0, 5);
    return `<h4 ${titleAttrs('lab', 'var(--c-late)')}>${titleIcon('day')}${t('mostLate')}${titleChip(late.length ? `+${late[0].m}` : '')}</h4><div class="rows">${late.map(({ x, m }) => trainRow({ id: x.id, number: d.numberOf(x.id), brand: x.brand, minutes: m,
      sub: t(`kind_${kindOf(x.brand)}`) })).join('') || `<p class="empty">${t('stNoneYet')}</p>`}</div>`;
  }
  function draw(first = false) {
    if (!stats) return;
    swap(mostLate, mostLateHtml(d.frame()));
    stats.update(d.snapshot(), { first });
  }
  return {
    name: () => t('navStats'), kind: 'stats',
    // Its half: its title and Sweden right now whole (src/stack.js half(); without it the half stopped under the title:
    // no clean edge between a third and a half of the screen, Sweden's map is taller than that)
    half() {
      const se = page?.querySelector('.home-stats > .st-se');
      if (!se?.offsetHeight) return null;
      return Math.round(se.getBoundingClientRect().bottom - page.getBoundingClientRect().top + page.scrollTop + 14 + (isWide() ? 12 : 40));
    },
    mount(el) {
      page = el;
      const box = document.createElement('div');
      box.className = 'sec home-stats';
      el.append(box);
      // (its words in a span of their own: a change of language writes them, src/i18n.js data-t, the icon stays)
      const head = Object.assign(document.createElement('h3'), { className: 'big ct' });
      head.innerHTML = `${titleIcon('train')}<span data-t="swedenNow">${esc(t('swedenNow'))}</span>`;
      mostLate = Object.assign(document.createElement('section'), { className: 'st-sec most-late' });
      stats = createStatsPage(box, { ...d.statsActions, filter: d.filter, redraw: () => draw(), groups: true, icons: true,
        parts: [head, 'sweden', 'duo', 'punctuality', 'kinds', 'companies', mostLate, 'fastest', 'busiest', 'fun', 'data'] });
    },
    unmount() { stats = null; mostLate = null; page = null; },
    show() { draw(true); d.onShow?.(); },
    every: () => draw(),
    redraw: () => draw(true),
  };
}

// Filter (Max, 2026-11-24: "Sektions titel: Filter. Ett sätt att expandera för att se alla andra operatörer"; a page of
// ☰'s since 2026-11-25): the lateness bar, and under it the companies on the map now, most trains first: the first
// CO_SHOWN and any picked one, "N more ⌄" for the rest. A tap turns a company on or off right here (src/filter.js; its
// pill above the bar, src/main.js data-cofilter).
const LG = ['ontime', 'some', 'late', 'unknown'];
const CO_SHOWN = 5;
function filterPage(d) {
  let put = null, el = null;
  let coOpen = false;   // the companies all shown ("N more" tapped)
  function companiesHtml(frame) {
    const n = new Map();
    for (const x of frame) if (x.brand) n.set(x.brand, (n.get(x.brand) ?? 0) + 1);
    const all = [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'sv')).map(([b]) => b);
    if (!all.length) return '';
    const on = b => d.filter.has('brand', b);
    const shown = coOpen ? all : all.filter((b, i) => i < CO_SHOWN || on(b));
    const rest = all.length - shown.length;
    // (folded, "N more" is always there, hidden when nothing is left over: on a computer fitCoRow may leave some out)
    const more = coOpen ? `<button type="button" class="chip co-more" data-act="comore" aria-expanded="true">${esc(t('coFewer'))}${icon('chevronUp', 16)}</button>`
      : `<button type="button" class="chip co-more" data-act="comore" aria-expanded="false"${rest > 0 ? '' : ' hidden'}>${esc(t('coMore', rest))}${icon('chevronDown', 16)}</button>`;
    return `<div class="co-filter" data-total="${all.length}">${shown.map(b => `<button type="button" class="chip co-f${on(b) ? ' on' : ''}" data-cofilter="${esc(b)}" aria-pressed="${on(b)}">` +
      `<i class="dot" style="background:${brandColour(b)}"></i>${esc(b)}</button>`).join('')}${more}</div>`;
  }
  // A computer: the companies and "N more" on one row (Max, 2026-11-25: "Filter operators including 'n till' should only
  // be one row"): the last companies that don't fit go into "N more" (a picked one always stays). Part of drawing the
  // card: every time it is drawn again (drew), and when its width changed, all its candidates are shown, measured once
  // and the last ones hidden, in the same task (nothing shows in between). A phone: all candidates, no fitting.
  // fitAt: a row of companies -> the width it was fitted at (a redrawn row is a new element; nothing else is kept).
  const fitAt = new WeakMap();
  function fitCoRow(box, drew) {
    if (!box || coOpen) return;
    const w = isWide() ? box.clientWidth : -1;
    if (w === 0) return;   // (not laid out now: fitted by the draw that shows it)
    if (!drew && fitAt.get(box) === w) return;
    fitAt.set(box, w);
    const chips = [...box.querySelectorAll('.co-f')], more = box.querySelector('.co-more'), total = Number(box.dataset.total);
    const say = (gone) => {
      const rest = total - (chips.length - gone);
      more.hidden = rest <= 0;
      more.innerHTML = `${esc(t('coMore', rest))}${icon('chevronDown', 16)}`;
    };
    for (const c of chips) c.hidden = false;
    say(0);
    if (w < 0) return;
    const top0 = (chips[0] ?? more).offsetTop;
    const wraps = () => [...box.children].some(c => !c.hidden && c.offsetTop > top0 + 2);
    let gone = 0;
    for (let i = chips.length - 1; i >= 0 && wraps(); i--) {
      if (chips[i].classList.contains('on')) continue;
      chips[i].hidden = true;
      say(++gone);
    }
  }
  function counts(frame) {
    const c = { ontime: 0, some: 0, late: 0, unknown: 0 };
    for (const x of frame) c[x.stale ? 'unknown' : lateClass(d.lateOf(x.id))]++;
    return c;
  }
  function legendHtml(c) {
    const on = d.legend.get(), total = LG.reduce((a, k) => a + c[k], 0);
    if (!total) return '';
    const words = { ontime: t('onTime'), some: t('stKeySome'), late: t('stKeyLate'), unknown: t('stNoNews') };
    // (no line of words over it since 2026-11-24, Max: 'Remove the "just nu tryck..." line'; a lit colour shows as its pill)
    return `<div class="lg"${on ? ' data-on' : ''}>${LG.filter(k => c[k] > 0).map(k => `<button type="button" class="lg-p t-${k}${on === k ? ' on' : ''}" ` +
      `style="flex-grow:${c[k]}" data-legend="${k}" aria-pressed="${on === k}" aria-label="${esc(`${c[k]} · ${words[k]}`)}"><i></i>` +
      `${k === 'ontime' ? `<span>${esc(words.ontime)}</span>` : ''}<b>${c[k]}</b></button>`).join('')}</div>`;
  }
  function filterHtml(frame) {
    const co = companiesHtml(frame), lg = settings.homeLegend ? legendHtml(counts(frame)) : '';
    return co || lg ? `${lg}${co}` : `<p class="empty">${esc(t('noneOnMap'))}</p>`;
  }
  let head = null;
  function draw() {
    if (!put) return;
    // (the title as Settings' and About's, the page's ‹ beside it (src/stack.js headOf); its number: the filters on now,
    // the companies and kinds picked and a lateness colour lit, src/filter.js)
    swap(head, `<strong ${titleAttrs('')}>${titleIcon('funnel')}${esc(t('filterHead'))}${titleChip(d.filter.list().length)}</strong>`);
    const f = put('filter', filterHtml(d.frame()), 'filter-card');
    fitCoRow(f.sec.querySelector('.co-filter'), f.drew);
  }
  return {
    name: () => t('filterHead'), kind: 'filter',
    // (the card's class at once: src/css/page.css .sec.filter-card; a part's class is given when it is made)
    mount(page) {
      el = page;
      head = Object.assign(document.createElement('div'), { className: 'panel-head' });
      el.append(head);
      put = parts(el);
      put('filter', '', 'filter-card');
    },
    unmount() { put = null; el = null; head = null; },
    show: () => draw(), every: () => draw(), redraw: () => draw(),
    // (opened: the sheet grows until the whole card shows; folded: back to where it was; Max, 2026-11-24: "Expanding
    // filters list in main card should expand that card to view all filters")
    toggleCo() {
      const card = () => el?.querySelector('.co-filter')?.closest('.sec');
      const h0 = card()?.offsetHeight;
      coOpen = !coOpen;
      draw();   // (the card now stands in its new look and height: its one-row fit is part of drawing it)
      const c = card();
      if (!c) return;
      // The sheet first, its heights measured from the page as it will stand; then the card's height glides from where
      // it was, in the sheet's time and curve: the card and the sheet's edge one move, what is under the card moving
      // with it (ui-sweep 'filter more' and 'filter fewer', 2026-11-25; Max: "the bottom jumps a few pixels")
      if (coOpen) d.reveal?.(c); else d.unreveal?.();
      glideHeight(c, h0, c.offsetHeight, { time: 'glide', curve: '' });
    },
  };
}

// ---------- a group: a company, a kind, "late now", "standing still" ----------
// key 'co:<brand>' ('co:' alone: no company known), 'kind:<k>', 'late', 'still'. test(x): one of its trains.
export function groupOf(key, still) {
  const i = key.indexOf(':'), type = i < 0 ? key : key.slice(0, i), v = i < 0 ? '' : key.slice(i + 1);
  if (type === 'co') return { type: 'brand', v, name: () => groupName('brand', v), sub: () => t(`kind_${kindOf(v)}`), colour: v ? brandColour(v) : 'var(--c-unknown)', test: x => (x.brand ?? '') === v };
  if (type === 'kind' && KINDS.includes(v)) return { type: 'kind', v, name: () => groupName('kind', v), sub: () => t('kindOfTrain'), test: x => kindOf(x.brand) === v };
  if (type === 'late') return { type: 'late', name: () => t('lateNow6'), sub: () => t('lateNowSub'), test: (x, m) => lateClass(m) === 'late' && !x.stale, noPct: true };
  if (type === 'still') return { type: 'still', name: () => t('standingStill'), sub: () => t('standingSub'), test: x => !x.stale && x.v < still };
  return null;
}
// d: as Home's, plus snapshot(brand), filter, onLight(test or null): only these trains on the map.
export function groupPage(key, d) {
  const g = groupOf(key, d.still);
  if (!g) return null;
  let put = null, stats = null;
  const mine = () => d.frame().filter(x => g.test(x, d.lateOf(x.id)));
  function draw(first = false) {
    const all = mine().map(x => ({ x, m: d.lateOf(x.id) })).sort((a, b) => (b.m ?? -99) - (a.m ?? -99));
    const c = { ontime: 0, some: 0, late: 0, unknown: 0 };
    for (const { x, m } of all) c[x.stale ? 'unknown' : lateClass(m)]++;
    const n = all.length, known = n - c.unknown, pct = known ? Math.round(c.ontime / known * 100) : 0, worst = all.find(o => o.m !== null && o.m !== undefined);
    const can = g.type === 'brand' || g.type === 'kind', on = can && d.filter.has(g.type, g.v);
    put('head', `<div class="g-head">${g.colour ? dot(g.colour) : '<i class="ring sq"></i>'}<b class="ttl">${esc(g.name())}</b></div>` +
      `<p class="sub">${esc(g.sub())}</p>` +
      // (what the page does to the map, right under its heading, as every part's words: Max, 2026-11-24)
      (can ? `<p class="src">${t(on ? 'groupOnly' : 'groupLit')}</p>` : '') +
      (can ? `<button type="button" class="show-only" data-act="showonly" aria-pressed="${on}">${icon(on ? 'check' : 'eye', 18)}<span>${t(on ? 'shownOnly' : 'showOnly')}</span></button>` : ''));
    put('tiles', `<div class="tiles"><div class="tile"><b>${n}</b><small>${t('onMapNow')}</small></div>` +
      (g.noPct ? `<div class="tile t-late"><b>${worst ? `+${worst.m} min` : '–'}</b><small>${t('stMostLate')}</small></div>`
        : `<div class="tile t-${pct >= 85 ? 'ontime' : pct >= 70 ? 'some' : 'late'}"><b>${known ? `${pct} %` : '–'}</b><small>${t('stKeyOnTime')}</small></div>`) + '</div>' +
      (n ? `<div class="mini">${['ontime', 'some', 'late', 'unknown'].filter(k => c[k]).map(k => `<i class="m-${k}" style="flex-grow:${c[k]}"></i>`).join('')}</div>` : ''));
    put('list', `<h4 class="lab">${t('itsTrains')}</h4><div class="rows">${all.slice(0, 80).map(({ x, m }) => trainRow({ id: x.id, number: d.numberOf(x.id), brand: x.brand, minutes: m,
      sub: g.type === 'brand' ? '' : t(`kind_${kindOf(x.brand)}`) })).join('') || `<p class="empty">${t('noneOnMap')}</p>`}</div>`);
    if (stats) stats.update(d.snapshot(g.v), { first });
  }
  return {
    name: () => g.name(), kind: 'group', group: g,
    mount(el) {
      put = parts(el);
      put('head', ''); put('tiles', '');
      // a company: Statistik's company page too (its tiles, punctuality and today's graph, its fastest, its busiest)
      if (g.type === 'brand') {
        const box = document.createElement('div');
        box.className = 'sec';
        el.append(box);
        stats = createStatsPage(box, { ...d.statsActions, filter: d.filter, redraw: () => draw(), company: g.v, parts: ['duo', 'punctuality', 'fastest', 'busiest'] });
      }
      put('list', '');
    },
    show(el, { dir }) {
      d.onLight(x => g.test(x, d.lateOf(x.id)));
      draw(true);
      if (dir >= 0) d.fit(mine());
      d.onShow?.(g);
    },
    // (which trains are lit is the page on top's: main.js stack onChange. A group taken down after back had lit nothing
    // again, after Home had lit its lateness colour: the bar said "On time" while the map showed all; Max, 2026-11-23)
    every: () => draw(),
    toggleShowOnly() { if (g.type === 'brand' || g.type === 'kind') { d.filter.toggle(g.type, g.v); draw(); } },
    redraw: () => draw(true),
  };
}
