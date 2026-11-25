// Home, the sheet's bottom page (Max's pick A, 2026-11-22, without the chips): pulled up, one scroll of
//   1. the lateness bar: a tap on a colour lights only those trains (the others leave the map until tapped again),
//   2. Saved (Mine until 2026-11-23): the saved trips and changes, the starred trains and stations,
//   3. Near you: only while My location is on,
//   4. Disruptions (the problems; all of them, rail work too, one tap further),
//   5. Sweden right now: Statistik's Sweden, its tiles and today's graph (src/stats-page.js),
//   6. Kinds of train and Companies: a tap opens the group's page,
//   7. Most late and Fastest, then the busiest stations and "for fun" (Statistik's, kept).
// Also the group pages (a company, a kind, "late now", "standing still": only its trains on the map while it is
// open; "Show only" keeps that after it closes, through src/filter.js) and the rows every page and the search share.
// Every row is a door: data-go carries the stack key it opens (src/stack.js); src/main.js listens for them.
import { t } from './i18n.js';
import { settings } from './settings.js';
import { glideHeight } from './motion.js';
import { isWide } from './layout.js';
import { esc } from './html.js';
import { icon } from './icons.js';
import { tagHtml } from './tag.js';
import { lateClass } from './lateness.js';
import { brandColour } from './stats.js';
import { kindOf, KINDS } from './train-kinds.js';
import { createStatsPage } from './stats-page.js';
import { rowHtml as disRowHtml, isWork } from './disruptions.js';

const dot = c => `<i class="dot" style="background:${c}"></i>`;
const plural = (n, one, many) => (n === 1 ? one : many);
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
// attrs: more attributes for the button (trusted HTML: escape what goes in them)
export const chip = (key, html, n, attrs = '') => `<button type="button" class="chip" data-go="${esc(key)}"${attrs}>${html}${n === undefined ? '' : ` <b>${n}</b>`}</button>`;

// A small helper for a page made of parts: each part is a div drawn again only when its words changed.
export function parts(el) {
  const secs = new Map();
  return (key, html, cls = '') => {
    let s = secs.get(key);
    if (!s) { s = document.createElement('div'); s.className = `sec ${cls}`; secs.set(key, s); el.append(s); }
    if (s._h !== html) { s.innerHTML = html; s._h = html; }
    s.hidden = !html;
    return s;
  };
}

// ---------- Home ----------
// d: { frame() -> the trains drawn now ([{ id, lon, lat, v, stale, brand }]), lateOf(id) -> minutes or null,
//   numberOf(id), favourites, stations() -> Map, location() -> { lon, lat } or null, disruptions() -> list or null,
//   stationName(sig), snapshot() -> src/stats.js snapshot of all trains, legend: { get(), set(k) }, statsActions,
//   filter, still (m/s under which a train stands) }
export function homePage(d) {
  let put = null, stats = null, mostLate = null, el = null, up = 0;   // up: the height Home last rested at
  let coOpen = false;   // the filter card's companies all shown ("N more" tapped)
  const LG = ['ontime', 'some', 'late', 'unknown'];
  // The filter card (Max, 2026-11-24: "Sektions titel: Filter. Ett sätt att expandera för att se alla andra
  // operatörer"; until then "Show only" in the search, which looked like it filtered the search): the lateness bar, and
  // under it the companies on the map now, most trains first: the first CO_SHOWN and any picked one, "N more ⌄" for the
  // rest. A tap turns a company on or off right here (src/filter.js; its pill above the bar, src/main.js data-cofilter).
  const CO_SHOWN = 5;
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
  // be one row"): the last companies that don't fit go into "N more" (a picked one always stays). Measured when the
  // card's words or width changed.
  function fitCoRow(sec) {
    const box = sec?.querySelector('.co-filter');
    if (!box || coOpen || !isWide() || !sec.offsetParent || !box.clientWidth) return;
    if (sec._fit === sec._h && sec._fitW === box.clientWidth) return;
    sec._fit = sec._h; sec._fitW = box.clientWidth;
    const chips = [...box.querySelectorAll('.co-f')], more = box.querySelector('.co-more');
    const top0 = (chips[0] ?? more).offsetTop;
    const wraps = () => [...box.children].some(c => !c.hidden && c.offsetTop > top0 + 2);
    let gone = 0;
    for (let i = chips.length - 1; i >= 0 && wraps(); i--) {
      if (chips[i].classList.contains('on')) continue;
      chips[i].hidden = true; gone++;
      const rest = Number(box.dataset.total) - (chips.length - gone);
      more.hidden = false;
      more.innerHTML = `${esc(t('coMore', rest))}${icon('chevronDown', 16)}`;
    }
  }
  function filterHtml(frame) {
    const co = companiesHtml(frame), lg = settings.homeLegend ? legendHtml(counts(frame)) : '';
    return co || lg ? `<h4 class="lab">${esc(t('filterHead'))}</h4>${lg}${co}` : '';
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
  // Saved ("Mina" until 2026-11-23, Max: "Sparade", with small headings for what it holds): Trips (the saved trips and
  // pinned changes, src/my-trains.js, then "+ New trip"), Trains (starred), Stations (starred); a heading only when it
  // has something.
  function mineHtml(frame) {
    const byNumber = new Map(frame.map(x => [String(d.numberOf(x.id)), x]));
    const { trains, stations } = starredRows({ favourites: d.favourites, stations: d.stations(), onMap(n) {
      const x = byNumber.get(n);
      return x ? { id: x.id, brand: x.brand, minutes: d.lateOf(x.id) } : null;
    } });
    const mt = d.myTrains?.() ?? { rows: [], add: '' };
    const group = (k, rows) => (rows.length ? `<h5 class="lab2" data-saved="${k}">${t({ trips: 'savedTrips', trains: 'savedTrains', stations: 'savedStations' }[k])}</h5><div class="rows">${rows.join('')}</div>` : '');
    return `<h4 class="lab">${t('mine')}</h4>` + (trains.length || stations.length ? '' : `<p class="empty">${t('favouritesHint')}</p>`) +
      `${group('trips', [...mt.rows, mt.add].filter(Boolean))}${group('trains', trains)}${group('stations', stations)}`;
  }
  function nearHtml() {
    const here = d.location();
    if (!here) return '';
    const k = Math.cos(here.lat * Math.PI / 180);
    const near = [...d.stations().values()].filter(st => st.advertised && st.lon !== null)
      .map(st => ({ st, km: Math.hypot((st.lon - here.lon) * k, st.lat - here.lat) * 111.2 })).sort((a, b) => a.km - b.km).slice(0, 3);
    if (!near.length) return '';
    return `<h4 class="lab">${t('nearYou')}</h4><div class="rows">${near.map(({ st, km }) => stationRow({ sig: st.sig, name: st.name,
      sub: km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`, lead: icon('locate', 18), cls: 'here' })).join('')}</div>`;
  }
  function disHtml() {
    const list = d.disruptions();
    if (!list) return '';
    const problems = list.filter(x => !isWork(x));
    return `<h4 class="lab">${t('disruptions')}</h4><div class="dis-list">${problems.slice(0, 3).map(x => disRowHtml(x, d.stationName, Date.now())).join('')}` +
      (!problems.length ? `<p class="empty">${t(list.length ? 'noProblemsNow' : 'noDisruptions')}</p>` : '') +
      // ("All disruptions" a row of the same list: its icon box the same size, in the same column, grey (a way on, not a
      // disruption), its › at the end; Max, 2026-11-24: "The icons dont align")
      (list.length ? `<button type="button" class="dis-row dis-all" data-go="dislist"><span class="dis-ic work" aria-hidden="true">${icon('warning', 16)}</span>` +
        `<span><b>${t('allDisruptions')}</b><span class="dis-sub">${esc(t('disCount', problems.length, list.length - problems.length))}</span></span>${icon('chevron', 18)}</button>` : '') + '</div>';
  }
  function mostLateHtml(frame) {
    const late = frame.map(x => ({ x, m: d.lateOf(x.id) })).filter(o => o.m > 0).sort((a, b) => b.m - a.m).slice(0, 5);
    return `<h4 class="lab">${t('mostLate')}</h4><div class="rows">${late.map(({ x, m }) => trainRow({ id: x.id, number: d.numberOf(x.id), brand: x.brand, minutes: m,
      sub: t(`kind_${kindOf(x.brand)}`) })).join('') || `<p class="empty">${t('stNoneYet')}</p>`}</div>`;
  }
  function counts(frame) {
    const c = { ontime: 0, some: 0, late: 0, unknown: 0 };
    for (const x of frame) c[x.stale ? 'unknown' : lateClass(d.lateOf(x.id))]++;
    return c;
  }
  function draw(first = false) {
    const frame = d.frame();
    fitCoRow(put('legend', filterHtml(frame), 'filter-card'));   // (the lateness bar: Debug can turn it off, Max 2026-11-23)
    put('mine', mineHtml(frame));
    put('near', nearHtml());
    put('dis', disHtml());
    const ml = mostLate;
    const html = mostLateHtml(frame);
    if (ml._h !== html) { ml.innerHTML = html; ml._h = html; }
    stats.update(d.snapshot(), { first });
  }
  return {
    name: () => t('home'), kind: 'home',
    mount(page) {
      el = page;
      put = parts(el);
      // (the filter card's class at once: index.html .sec.filter-card; a part's class is given when it is made)
      put('legend', '', 'filter-card');
      for (const k of ['mine', 'near', 'dis']) put(k, '');
      const box = document.createElement('div');
      box.className = 'sec home-stats';
      el.append(box);
      const head = Object.assign(document.createElement('h3'), { className: 'big' });
      head.dataset.t = 'swedenNow';
      head.textContent = t('swedenNow');
      mostLate = Object.assign(document.createElement('section'), { className: 'st-sec most-late' });
      stats = createStatsPage(box, { ...d.statsActions, filter: d.filter, redraw: () => draw(), groups: true,
        parts: [head, 'sweden', 'duo', 'punctuality', 'kinds', 'companies', mostLate, 'fastest', 'busiest', 'fun', 'data'] });
    },
    // Statistik's day and cancelled numbers are asked for once Home is pulled up from rest, not while it rests as the
    // search bar alone (2026-11-23, stats-board-check: they were asked at every start, and "Laddar…" never showed).
    show() { up = 0; draw(true); },
    level(i) { if (i > 0 && !up) d.onShow?.(); up = i; if (i > 0) draw(); },
    every(i) { if (i > 0) draw(); },
    redraw: () => draw(true),
    // (opened: the sheet grows until the whole card shows; folded: back to where it was; Max, 2026-11-24: "Expanding
    // filters list in main card should expand that card to view all filters")
    toggleCo() {
      // (the filter card's height glides, so what is under it moves down with it, not in one jump: ui-sweep, 2026-11-25)
      const card = () => el?.querySelector('.co-filter')?.closest('.sec');
      const h0 = card()?.offsetHeight;
      coOpen = !coOpen;
      draw();
      glideHeight(card(), h0);
      if (coOpen) d.reveal?.(el?.querySelector('.co-filter')?.closest('.sec')); else d.unreveal?.();
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
