// The search, in the one sheet's head (Max's pick A, 2026-11-22; until then a card dropping from the top bar). Tapping
// the field raises the sheet to full height (src/stack.js openSearch), so the field ends up high, clear of the phone's
// keyboard. Every result row is a door: data-go carries the stack key it opens (src/main.js opens it).
//   - Nothing typed: Recent (the last 5 pages opened), Starred, and "Show only" chips (late now, standing still, the
//     kinds, the companies on the map): each opens its group's page.
//   - Typed: trains (a number: those on the map whose number starts with it, then today's timetable for that exact
//     number), stations, companies and kinds, disruptions.
//
// findTrains(digits) -> trains on the map whose number starts with them: [{ id, number, company, time (latest report) }]
// findStations(text) -> passenger stations whose name matches: [{ sig, name }]
// searchTimetable(number) -> Promise of today's trips with exactly this number: [{ key, operational, date, number,
//   product, from, to, keys }] (from/to as names; keys: every piece of the trip, src/trip.js tripsOf). One row per
//   trip (Max 2026-11-16): a trip with a piece on the map is that piece's row; two pieces of one trip on the map at
//   once (at the handover) become one row, the newest report's.
// groups() -> { late, still, kinds: [[k, n]], brands: [[brand, n]] } (the trains on the map now)
// findDisruptions(text) -> [{ id, header, sub }]
// recent() -> the page keys opened lately (src/stack.js); rowOf(key) -> a row's HTML for one, or ''
// starred() -> HTML rows of the starred trains and stations
// remember(train): a train found in the timetable (not on the map), so its key can be opened.
import { t } from './i18n.js';
import { icon } from './icons.js';
import { stateHtml } from './state.js';
import { esc } from './html.js';
import { arrive } from './motion.js';
import { chip, groupRow } from './home.js';
import { brandColour } from './stats.js';

const MAX_ROWS = 200;   // all matches are listed (Max, 2026-11-12: "2" matches 66 trains at rush hour); the list scrolls
const fold = s => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function createMenu({ input, list, findTrains, findStations, searchTimetable, groups, findDisruptions, recent, rowOf, starred, remember }) {
  let asked = 0, timer = null;
  let seen = new Set();   // rows shown since the search opened: new ones come in one after another (Max's pick 6, 2026-11-20)
  const rowsIn = () => arrive([...list.querySelectorAll('.row, .chip')], seen, r => r.dataset.go ?? r.textContent);
  const lab = text => `<h4 class="lab">${esc(text)}</h4>`;

  function empty() {
    const g = groups(), lately = recent().map(rowOf).filter(Boolean), star = starred();
    // (no counts on them: Max, 2026-11-23, 'Not clear what the numbers represent.. Maybe just remove')
    const scopes = [chip('late', esc(t('lateNow6'))), chip('still', esc(t('standingStill'))),
      ...g.kinds.filter(([k]) => k !== 'unknown' && k !== 'other').map(([k]) => chip(`kind:${k}`, esc(t(`kind_${k}`)))),
      ...g.brands.filter(([b]) => b).map(([b]) => chip(`co:${b}`, `<i class="dot" style="background:${brandColour(b)}"></i>${esc(b)}`))];
    return (lately.length ? `${lab(t('recent'))}<div class="rows">${lately.join('')}</div>` : '') +
      (star ? `${lab(t('favourites'))}<div class="rows">${star}</div>` : `<p class="empty">${esc(t('favouritesHint'))}</p>`) +
      `${lab(t('showOnly'))}<div class="scopes">${scopes.join('')}</div>`;
  }
  function trainRowHtml(tr) {
    return `<button type="button" class="row" data-go="train:${esc(tr.id)}"><b class="r-num">${esc(tr.number)}</b><span class="r-main">` +
      `<b>${tr.company ? `<i class="dot" style="background:${brandColour(tr.company)}"></i>` : ''}${esc(tr.company || t('train'))}</b><small>${esc(tr.sub)}</small></span></button>`;
  }
  function show(q) {
    const n = ++asked;
    clearTimeout(timer);
    if (!q) { list.innerHTML = empty(); return; }
    const digits = /^\d+$/.test(q), f = fold(q);
    const trains = digits ? findTrains(q).slice(0, MAX_ROWS) : [];
    const stations = digits ? [] : findStations(q).slice(0, MAX_ROWS);
    const g = groups();
    const hit = name => { const x = fold(name); return x.startsWith(f) || x.split(/[\s\-–]+/).some(w => w.startsWith(f)) || (f.length >= 3 && x.includes(f)); };
    const cos = digits ? [] : [...g.brands.filter(([b]) => b && hit(b)).map(([b, k]) => groupRow({ key: `co:${b}`, name: b, sub: t('trainsN', k), colour: brandColour(b) })),
      ...g.kinds.filter(([k]) => hit(t(`kind_${k}`))).map(([k, c]) => groupRow({ key: `kind:${k}`, name: t(`kind_${k}`), sub: t('trainsN', c) }))];
    const dis = !digits && q.length >= 3 ? findDisruptions(q) : [];
    list.innerHTML =
      (trains.length ? `${lab(t('trainsWord'))}<div class="rows search-trains">${trains.map(tr => trainRowHtml({ ...tr, sub: t('onMap') })).join('')}</div>` : '') +
      (digits ? `<div class="rows search-more">${stateHtml('loading', t('lookingTimetable'))}</div>` : '') +
      (stations.length ? `${lab(t('stationsWord'))}<div class="rows">${stations.map(st => `<button type="button" class="row" data-go="station:${esc(st.sig)}"><span class="r-ic"><i class="ring"></i></span><span class="r-main"><b>${esc(st.name)}</b><small>${esc(t('station'))}</small></span></button>`).join('')}</div>` : '') +
      (cos.length ? `${lab(t('companiesKinds'))}<div class="rows">${cos.join('')}</div>` : '') +
      (dis.length ? `${lab(t('disruptions'))}<div class="rows">${dis.map(x => `<button type="button" class="row" data-go="dis:${esc(x.id)}"><span class="r-ic warn">${icon('warning', 18)}</span><span class="r-main"><b>${esc(x.header)}</b><small>${esc(x.sub)}</small></span></button>`).join('')}</div>` : '') +
      (!digits && !stations.length && !cos.length && !dis.length ? stateHtml('empty', t('nothingFound', q)) : '');
    if (!digits) return;
    // A whole number: also today's timetable, for trains that aren't on the map (not started yet, or done).
    timer = setTimeout(async () => {
      let found;
      const box = () => list.querySelector('.search-more');
      try { found = await searchTimetable(q); } catch (e) { if (n === asked && box()) box().innerHTML = stateHtml('error', t('timetableFailed', e.message)); return; }
      if (n !== asked || !box()) return;
      const onMap = new Map(trains.map(tr => [tr.id, tr]));
      // Two pieces of one trip on the map: keep the newest report's row (the same time: the later piece's).
      for (const trip of found) {
        const here = trip.keys.filter(k => onMap.has(k));
        if (here.length < 2) continue;
        const keep = here.reduce((a, k) => ((onMap.get(k).time ?? 0) >= (onMap.get(a).time ?? 0) ? k : a));
        for (const k of here) if (k !== keep) list.querySelector(`.search-trains [data-go="train:${CSS.escape(k)}"]`)?.remove();
      }
      const more = found.filter(tr => !tr.keys.some(k => onMap.has(k))).slice(0, MAX_ROWS);
      for (const tr of more) remember({ id: tr.key, operational: tr.operational, date: tr.date, number: tr.number });
      // (two runs of the number, e.g. last night's still running after midnight and today's: each with its start time)
      box().innerHTML = more.map(tr => trainRowHtml({ id: tr.key, number: tr.number, company: tr.product,
        sub: [tr.at, tr.from && tr.to ? `${tr.from} → ${tr.to}` : '', t('notOnMapNow')].filter(Boolean).join(' · ') })).join('') +
        (!trains.length && !more.length ? stateHtml('empty', t('noTrainToday', q)) : '');
      rowsIn();
    }, 350);
  }
  input.addEventListener('input', () => { show(input.value.trim()); rowsIn(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') list.querySelector('[data-go]')?.click(); });
  return {
    open() { seen = new Set(); show(input.value.trim()); rowsIn(); },
    // Show the results again (Settings → Language changed).
    refresh() { if (!list.hidden) show(input.value.trim()); },
  };
}
