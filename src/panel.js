// The panel that opens when a train is tapped: where it runs and every stop, planned and actual.
// Compact (Max, 2026-11-15, sketch C): the number, two tiles (the lateness now; the minutes to a stop, the end station
// unless another is picked from the stops ahead) and the trip as one line. "All stops", or a drag up on a phone, opens
// it full (class "full", src/sheet.js): the star, Trafikverket's notes and the timeline of every stop. On the full card
// "i" next to the star (class "info"; Max, 2026-11-20) swaps the notes and the stops for the train's own numbers
// (src/train-info.js, drawn by options.info each second while shown); "i" again brings the stops back.
// "All places" above the stops on the full card (Max, 2026-11-21, sketch C) puts every place the train passes without
// stopping between them (options.places, src/places-ahead.js): passed with Trafikverket's times, ahead names only.
import { fetchRoute } from './trafikverket.js';
import { lateClass } from './lateness.js';
import { minutesText } from './tag.js';
import { roll, arrive, flash, reduceMotion } from './motion.js';
import { stateHtml } from './state.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { hhmm, now } from './clock.js';
import { settings } from './settings.js';
import { glide } from './sheet.js';
import { abroadEnds, flagSvg } from './abroad.js';

import { esc } from './html.js';

const time = t => (t ? hhmm(t) : '');

// The favourite star (☆ / ★), used by the train panel and the station board.
export const star = on => `<button class="panel-star" type="button" aria-pressed="${on}" aria-label="${t(on ? 'starOn' : 'starOff')}">${icon(on ? 'starFilled' : 'star')}</button>`;

// Trafikverket's notes on the full card fold under one line (Max, 2026-11-16: they "sometimes take a lot of space";
// folded by default (Max, 2026-11-16: "change default to collapsed"), problems fold too, with a red ⚠ and their count on the
// line). Remembered on this device (a new name for the memory: choices made while open was the default start over).
const NOTES_KEY = 'notesShown';
let notesOpen = false;
try { notesOpen = localStorage.getItem(NOTES_KEY) === 'true'; } catch { /* storage blocked: folded */ }
const remember = on => { try { localStorage.setItem(NOTES_KEY, String(on)); } catch { /* used now, not remembered */ } };
// "All places": Settings → All places since 2026-11-22 (settings.allPlaces; a switch on the card until then).
// Open: the notes, with only a small ⌃ at the top right to fold them (Max, 2026-11-16: no ⚠ or "Notes (3)" then).
const notesBox = (lines, problems) => (notesOpen
  ? `<div class="tv-box open"><button type="button" class="tv-toggle tv-fold" aria-expanded="true" aria-label="${t('foldNotes')}">${icon('chevronUp', 15)}</button>` +
    `<div class="panel-tvnotes">${lines.join('')}</div></div>`
  : `<div class="tv-box"><button type="button" class="tv-toggle" aria-expanded="false">` +
    (problems ? `<span class="tv-warn">${icon('warning', 15)}${problems}</span>` : '') +
    `<span>${t('notesCount', lines.length)}</span>${icon('chevronDown', 15)}</button></div>`);

// "12 min", "1 h 5 min" (both languages: "tim" made the tile overflow, Max 2026-11-15); 0 or less: "Now".
const inText = ms => {
  const m = Math.round(ms / 60000);
  if (m <= 0) return t('cdNow');
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

// The stops a passenger sees, one per station: arrival and departure at the same station merged (they can come in
// either order when both have the same planned minute).
function stopsOf(route) {
  const stops = [];
  for (const s of route.stops.filter(x => x.advertised)) {
    const slot = s.activity === 'Avgang' ? 'dep' : 'arr';
    const last = stops.at(-1);
    if (last && last.station === s.station && !last[slot]) { last[slot] = s; continue; }
    stops.push({ station: s.station, [slot]: s });
  }
  return stops;
}
// The next stop: the first with no actual time that isn't cancelled (a cancelled stop never gets one, so every
// stop after it stayed "not passed": 1141 on 13 Nov, Ronneby cancelled, Max's note). -1: arrived.
const nextOf = stops => stops.findIndex(s => { const m = s.dep ?? s.arr; return !m.actual && !m.canceled; });
// Standing at stop s: arrived there, not left.
const standing = s => Boolean(s?.arr?.actual && s.dep && !s.dep.actual);
// The lateness the route tells (a train not on the map): the last actual time against its plan.
function routeLate(stops) {
  for (let i = stops.length - 1; i >= 0; i--) {
    for (const x of [stops[i].dep, stops[i].arr]) {
      if (x?.actual && x.planned) return Math.round((x.actual - x.planned) / 60000);
    }
  }
  return null;
}

// onSelect(id or null): a train was opened, or the panel closed. onFollow(id, on): the Follow button was pressed.
// onRoute(id, route): the open train's route has loaded (fetchRoute), e.g. to draw its path.
// isStarred(number) / onStar(number) -> starred now: the ☆ for favourites.
// lateOf(id): the train's minutes late now, as on the map (undefined: not on the map; null: not known).
// station(sig): the station ({ name, lon, lat, country }), for a trip's end abroad (src/abroad.js).
// What the map draws of a trip (src/main.js onRoute: the line, its stop names, the leg abroad), without the times:
// two routes with the same shape draw the same.
const tripShape = route => JSON.stringify([route?.from, route?.to, route?.pieces,
  (route?.stops ?? []).map(s => `${s.station}|${s.activity}|${s.advertised ? 1 : 0}|${s.canceled ? 1 : 0}`)]);

// places(id, route, stops): the places passed without stopping between the card's stops (src/places-ahead.js tripPlaces).
// In the one sheet (2026-11-22, src/stack.js): onCloseTap(id) is what its × does (the page goes; the × is hidden and
// stays for the tools); onMore(full) is what "All stops" / "Fewer" ask for (the sheet to full or half; the page then
// sets .full); onStop(sig): a stop in the timeline tapped (its station's page); onFold(open, box): its messages opened
// or shut (box: their part).
export function createPanel(el, { stationName, station = () => undefined, onSelect, onFollow, onRoute, isStarred, onStar, lateOf, info, places, statusOf, onCloseTap, onMore, onStop, onFold, extra = null }) {
  let openId = null;
  let following = false;
  let canFollow = true;   // false for a train that isn't on the map
  let number = null;      // the open train's public number (for the star)
  let shown = null;       // { train, route, stops }: what the panel shows, to redraw it in another language
  let target = null;      // the station counted down to (null: the end station); kept while the card is open
  let picking = false;    // the list of stops to count down to is open
  let opening = false, closing = false;   // it slides open (only when it opens, not at each redraw) and closed
  let infoOn = false;     // the train's own numbers instead of its stops ("i")

  // The top line: the train's number and company, then the star (shown only when full), Follow and × (only on a wide
  // screen; on a phone a drag down or a tap on the map closes it: Max, 2026-11-15).
  const head = (train, company) =>
    `<div class="panel-head"><span class="panel-title"><strong>${esc(train.number ?? train.label)}</strong>` +
    (company ? `<span class="panel-co">${esc(company)}</span>` : '') + `</span><span class="panel-buttons">` +
    (info ? `<button class="panel-info" type="button" aria-pressed="${infoOn}" aria-label="${t('tiButton')}">${icon('about')}</button>` : '') +
    (number && isStarred ? star(isStarred(number)) : '') +
    (canFollow ? `<button class="panel-follow" type="button" aria-pressed="${following}">${icon('follow', 15)}<span>${t(following ? 'following' : 'follow')}</span></button>` : '') +
    `<button class="panel-close" type="button" aria-label="${t('close')}">${icon('close')}</button></span></div>`;
  function wireHead() {
    el.querySelector('.panel-close').onclick = () => (onCloseTap ? onCloseTap(openId) : close());
    const f = el.querySelector('.panel-follow');
    if (f) f.onclick = () => { setFollowing(!following); onFollow?.(openId, following); };
    const s = el.querySelector('.panel-star');
    if (s) s.onclick = () => { const on = onStar(number); s.outerHTML = star(on); wireHead(); };
    const i = el.querySelector('.panel-info');
    if (i) i.onclick = () => setInfo(!infoOn);
  }
  function setInfo(on) {
    infoOn = on;
    el.classList.toggle('info', on);
    el.querySelector('.panel-info')?.setAttribute('aria-pressed', String(on));
    if (on) { const box = el.querySelector('.panel-info-box'); if (box) box.scrollTop = 0; drawInfo(); }
    else requestAnimationFrame(toNext);
  }
  const drawInfo = () => {
    if (!infoOn || !shown?.route || !el.classList.contains('full')) return;
    info?.(el.querySelector('.panel-info-box'), { id: openId, number, stops: shown.stops ?? [], route: shown.route });
  };
  function setFollowing(on) {
    following = on;
    const b = el.querySelector('.panel-follow span');
    if (b) { b.parentElement.setAttribute('aria-pressed', String(on)); b.textContent = t(on ? 'following' : 'follow'); }
  }

  // While a card is open its times are asked for again every minute (Max, 2026-11-14: they came only once, when
  // it opened, so new actual times never showed). The table keeps where it was scrolled to.
  // Not while the page is hidden (Codex's beta review point 6); wake() asks at once when it is back in front.
  // The map's line, its stop names and the leg abroad (onRoute) are drawn again when the trip itself changed: its
  // stops in order, which are stops, which are cancelled, its ends (point 12: they were drawn once, so a diversion
  // showed on the map only after reopening the card). Times alone don't redraw it (a new path search costs ~45 ms).
  const REFRESH_MS = 60000;
  let refreshTimer = null;
  function refreshLater(train, ms = REFRESH_MS) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      if (openId !== train.id) return;
      if (document.hidden) { refreshLater(train); return; }
      try {
        const route = await fetchRoute(train.operational, train.date, train.number);
        if (openId !== train.id) return;
        const first = !shown?.route;
        const changed = first || tripShape(shown.route) !== tripShape(route);
        shown = { train, route };
        if (changed) onRoute?.(train.id, route);
        draw(train, route, { keepScroll: !first });
      } catch (e) {
        console.warn('route refresh:', e.message);
      }
      refreshLater(train);
    }, ms);
  }
  const wake = () => { if (openId && shown?.train?.id === openId) refreshLater(shown.train, 0); };
  // The open train's route given to onRoute again (src/main.js gotStations: the stations came after the card opened).
  const reroute = () => { if (openId && shown?.route && shown.train?.id === openId) onRoute?.(openId, shown.route); };

  function close() {
    clearTimeout(refreshTimer);
    openId = null;
    el.hidden = true;
    el.innerHTML = '';
    onSelect?.(null);
  }

  // follow: false for a train that isn't on the map (picked from the timetable search).
  async function open(train, { follow = true } = {}) {
    // Card to card (Max's pick 5, 2026-11-20: "Make that numbers roll like the others"): another train picked while a
    // card shows one keeps the card; the number rolls at once, the rest (dimmed) stays until the new timetable is in,
    // then the lateness and the time to the stop roll to the new train's, changed words fade over, the trip bar glides.
    const swap = !el.hidden && openId !== null && openId !== train.id && !el.classList.contains('full') && el.querySelector('.cd .cd-late')
      && !reduceMotion() ? cardNumbers() : null;
    openId = train.id;
    lateSeen = null;   // (a card opening shows its lateness at once)
    number = train.number ?? null;
    following = follow;   // opening a train on the map starts following it (main.js)
    canFollow = follow;
    target = null;
    picking = false;
    onSelect?.(train.id);
    el.hidden = false;
    el.classList.remove('full');   // always opens compact (the Train card setting went, Max 2026-11-20)
    infoOn = false; el.classList.remove('info');
    shown = { train, route: null };
    if (swap) {
      const old = el.querySelector('.panel-head');
      old.outerHTML = head(train);
      const strong = el.querySelector('.panel-title strong'), to = Number(strong.textContent);
      if (Number.isInteger(swap.number) && Number.isInteger(to) && swap.number !== to) { strong._v = swap.number; roll(strong, to, 0, '', String); swap.rolling = strong; }
      if (el.querySelector('.panel-co')?.textContent !== swap.company) flash(el.querySelector('.panel-co'), 'fresh');
      for (const c of el.children) if (!c.classList.contains('panel-head')) c.classList.add('busy');
    } else el.innerHTML = head(train) + stateHtml('loading', t('loadingRoute'));
    wireHead();
    // The line on how its place is known, at once: it came with the next second's tick, after the timetable was in,
    // so the card stepped ~24-43 px taller after its glide (2026-11-21's sweep).
    putStatus(statusOf?.(train.id) ?? '');

    let route;
    try {
      route = await fetchRoute(train.operational, train.date, train.number);
    } catch (e) {
      if (openId === train.id) {
        if (swap) { el.innerHTML = head(train) + stateHtml('error', t('routeFailed', e.message)); wireHead(); }
        else el.querySelector('.state').outerHTML = stateHtml('error', t('routeFailed', e.message));
        refreshLater(train);
      }
      return;
    }
    if (openId !== train.id) return;   // another train was tapped meanwhile
    onRoute?.(train.id, route);
    shown = { train, route };
    if (swap) glide(el, () => { draw(train, route); rollIn(swap); });
    // From "Laddar…" to the timetable in one glide (a step of ~24 px, the map's buttons dipping with it; 2026-11-21's
    // sweep). Not under a finger: a glide turns the drag's own transitions back on.
    else if (el.classList.contains('dragging')) draw(train, route);
    else glide(el, () => draw(train, route));
    refreshLater(train);
  }
  // What the card shows now, as numbers (for the swap above): the train number, the minutes late, the minutes to the
  // stop, the trip bar's place, the words under the tiles and the stations.
  function cardNumbers() {
    const q = s => el.querySelector(s);
    const lateText = q('.cd-late b')?.textContent.trim() ?? '', stopText = q('.cd-stop b')?.textContent.trim() ?? '';
    const late = lateText === minutesText(0) ? 0 : (/^([+−-])(\d+) min$/.exec(lateText) ?? []);
    const stop = /^(?:(\d+) h )?(\d+) min$/.exec(stopText);
    return {
      number: Number(q('.panel-title strong')?.textContent), company: q('.panel-co')?.textContent ?? '',
      late: late === 0 ? 0 : late[2] ? (late[1] === '+' ? 1 : -1) * Number(late[2]) : null,
      stop: stop ? Number(stop[1] ?? 0) * 60 + Number(stop[2]) : null,
      done: q('.cd-done')?.style.width, at: q('.cd-train')?.style.left,
      words: [...el.querySelectorAll('.cd small, .cd-names > *')].map(x => x.textContent),
    };
  }
  // The new train's card just drawn: its numbers roll from the old train's, its bar glides from where the old one was.
  // (The tiles are not drawn again meanwhile: holdGlance.)
  function rollIn(old) {
    holdGlance = performance.now() + 750;
    // the head was drawn again with the timetable: the number still rolling stays
    const head = el.querySelector('.panel-title strong');
    if (old.rolling && head && head.textContent === String(old.rolling._v)) head.replaceWith(old.rolling);
    const late = el.querySelector('.cd-late b'), stop = el.querySelector('.cd-stop b');
    const now = cardNumbers();
    if (late && old.late !== null && now.late !== null) {
      const end = late.textContent;
      late._v = old.late;
      roll(late, now.late, 0, '', (n, last) => (last ? end : n === 0 ? '0 min' : minutesText(n)));
    }
    if (stop && old.stop !== null && now.stop !== null) {
      const end = stop.textContent;
      stop._v = old.stop;
      roll(stop, now.stop, 0, '', (n, last) => (last ? end : n < 60 ? `${n} min` : `${Math.floor(n / 60)} h ${n % 60} min`));
    }
    const done = el.querySelector('.cd-done'), train = el.querySelector('.cd-train');
    if (done && train && old.done && old.at) {
      const to = [done.style.width, train.style.left];
      done.style.width = old.done; train.style.left = old.at;
      void done.offsetWidth;
      done.classList.add('moving'); train.classList.add('moving');
      done.style.width = to[0]; train.style.left = to[1];
    }
    [...el.querySelectorAll('.cd small, .cd-names > *')].forEach((x, i) => { if (x.textContent !== old.words[i]) flash(x, 'fresh'); });
  }

  // The minutes late now: as on the map while the train is on it, else from its route.
  const lateNow = stops => { const m = lateOf?.(openId); return m === undefined ? routeLate(stops) : m; };

  // When the train is (expected) at stop s, counting down to it: { at, kind } with kind 'actual', 'est'
  // (Trafikverket's expected time), 'guess' (planned plus the lateness now: Max, 2026-11-15, 1B) or 'planned'
  // (Debug → "With no expected time: Planned"). here: it stands there now, so: when it leaves.
  function whenAt(s, late, here) {
    const x = here ? s.dep ?? s.arr : s.arr ?? s.dep;
    if (x.actual) return { at: x.actual, kind: 'actual' };
    if (x.estimated) return { at: x.estimated, kind: 'est' };
    if (settings.noEstimate === 'guess' && late > 0) return { at: x.planned + late * 60000, kind: 'guess' };
    return { at: x.planned, kind: 'planned' };
  }

  // The two tiles, the stop list and the trip line: everything that changes with the clock.
  function glance(stops, nextIdx) {
    const late = lateNow(stops);
    const lateTile = `<div class="cd-late tile ${lateClass(late)}"><b>${late === null ? '–' : minutesText(late)}</b>` +
      `<small>${t(late === null ? 'lateUnknown' : late > 0 ? 'lateNow' : late < 0 ? 'earlyNow' : 'rightNow')}</small></div>`;
    // Every known stop passed, but the trip's own end station (route.to) not reached, and the train still on the map:
    // a part of the trip is missing from the timetable (VR 2047, 2026-11-15: "Framme Herrljunga C" on the way to
    // Göteborg C). "To Göteborg C · time unknown" instead of "Arrived".
    const to = shown?.route?.to;
    if (nextIdx === -1 && to && lateOf?.(openId) !== undefined) {
      const e = stops.findLast(s => s.station === to), x = e && (e.arr ?? e.dep);
      if (!x?.actual && !x?.canceled) {
        const name = t('towardsEnd', stationName(to));
        return { tiles: lateTile + `<div class="cd-stop tile"><b class="wrap">${esc(name)}</b>` +
          `<small><span>${t('timeUnknown')}</span></small></div>`, list: '', trip: '' };
      }
    }
    if (nextIdx === -1) {   // arrived
      const end = stops.at(-1), x = end.arr ?? end.dep;
      return { tiles: lateTile + `<div class="cd-stop tile"><b>${t('arrived')}</b><small><span>${esc(stationName(end.station))} ${time(x.actual)}</span></small></div>`, list: '', trip: '' };
    }
    const ahead = stops.map((s, i) => ({ s, i })).filter(({ s, i }) => i >= nextIdx && !(s.dep ?? s.arr).canceled);
    if (!ahead.length) return { tiles: lateTile, list: '', trip: '' };
    if (!ahead.some(a => a.s.station === target)) target = null;   // passed (or gone): back to the end station
    const goal = ahead.find(a => a.s.station === target) ?? ahead.at(-1);
    const tNow = now();
    const row = ({ s, i }) => {
      const here = i === nextIdx && standing(s), w = whenAt(s, late, here);
      return { here, w, inn: here ? t('cdHere') : inText(w.at - tNow), mark: w.kind === 'guess' ? '≈ ' : '' };
    };
    const g = row(goal);
    // "planned" as a small tag beside the minutes (Max, 2026-11-21, option l C: "to Upplands Väsby · planned" wrapped);
    // beside, not inside, the minutes: their text rolls (rollIn).
    const minutesB = `<b${(g.mark + g.inn).length > 8 ? ' class="long"' : ''}>${g.mark}${g.inn}</b>`;
    const stopTile = `<button class="cd-stop tile" type="button" aria-expanded="${picking}">` +
      (g.w.kind === 'planned' ? `<span class="cd-top">${minutesB}<span class="cd-plan">${t('planned')}</span></span>` : minutesB) +
      `<small><span>${esc(t(g.here ? 'cdAt' : 'cdTo', stationName(goal.s.station)))}</span>${icon(picking ? 'chevronUp' : 'chevronDown', 14)}</small></button>`;
    const list = picking ? `<div class="cd-pick${opening ? ' opening' : ''}"><p>${t('countDownTo')}</p><div class="cd-list">${ahead.map(a => {
      const r = row(a), on = a === goal;
      const note = a.i === nextIdx ? t(r.here ? 'stopHere' : 'nextStop') : a === ahead.at(-1) ? t('endStation') : '';
      return `<button type="button" class="cd-row${on ? ' on' : ''}" data-sig="${esc(a.s.station)}"><span class="cd-name"><b>${esc(stationName(a.s.station))}</b>` +
        `${note ? ` <small>· ${note}</small>` : ''}</span><small>${r.mark}${time(r.w.at)}</small><span class="cd-in">${r.inn}</span>${on ? icon('check', 18) : '<i></i>'}</button>`;
    }).join('')}</div></div>` : '';

    // The trip as one line, by planned time: the first stop, the train now (its next stop named under it, or "At X"
    // while it stands there), and the end; a dot for the stop counted down to when it is neither.
    const t0 = (stops[0].dep ?? stops[0].arr).planned, t1 = (stops.at(-1).arr ?? stops.at(-1).dep).planned;
    const frac = at => (t1 > t0 ? Math.max(0, Math.min(1, (at - t0) / (t1 - t0))) : 0);
    const here = frac(tNow - Math.max(0, late ?? 0) * 60000);
    const next = stops[nextIdx];
    const nextName = standing(next) ? t('cdAt', stationName(next.station)) : stationName(next.station);
    const isEnd = goal === ahead.at(-1);
    const pct = f => `${(f * 100).toFixed(1)}%`;
    const trip = `<div class="cd-trip"><div class="cd-bar"><span class="cd-done" style="width:${pct(here)}"></span>` +
      `<i class="cd-first"></i>${!isEnd && goal.i !== nextIdx ? `<i class="cd-goal" style="left:${pct(frac((goal.s.arr ?? goal.s.dep).planned))}"></i>` : ''}` +
      `<i class="cd-train" style="left:${pct(here)}"></i><i class="cd-end${isEnd ? ' goal' : ''}"></i></div>` +
      `<div class="cd-names"><span class="cd-from"><em>${esc(stationName(stops[0].station))}</em></span>` +
      `<b class="cd-at${goal.i === nextIdx ? ' goal' : ''}" style="--at:${pct(here)}">${esc(nextName)}</b>` +
      `<span class="cd-to${isEnd ? ' goal' : ''}"><em>${esc(stationName(stops.at(-1).station))}</em></span></div></div>`;
    // The timeline's line where the train is: "In 4 min" to the next stop; standing there, "Leaves in 2 min".
    const nx = row({ s: next, i: nextIdx }), soon = nx.w.at - tNow < 30000;
    const nowLine = soon ? t(nx.here ? 'leavesNow' : 'arrivesNow')
      : t(`${nx.here ? 'leaves' : 'arrives'}${nx.mark ? 'About' : 'In'}`, inText(nx.w.at - tNow));
    return { tiles: lateTile + stopTile, list, trip, nowLine };
  }
  function wireGlance() {
    const b = el.querySelector('.cd-stop');
    // Closing: it slides shut first, then goes (a pick shows at once in the tile).
    const shut = () => {
      const p = el.querySelector('.cd-pick');
      if (!p || closing) { picking = false; showGlance(); return; }
      closing = true;
      p.classList.add('closing');
      setTimeout(() => { closing = false; picking = false; showGlance(); }, 180);
    };
    if (b?.tagName === 'BUTTON') b.onclick = () => { if (picking) shut(); else { picking = true; opening = true; showGlance(); opening = false; } };
    for (const r of el.querySelectorAll('.cd-row')) r.onclick = () => { target = r.dataset.sig; shut(); };
  }
  let glanceSeen = '';
  // The lateness tile (Max's picks 4 and 7, 2026-11-20): when the open train's minutes change, the number rolls to
  // the new ones and the tile pulses once. The tiles are drawn again each second something on them changes (the trip
  // bar moves often): a tile still rolling or pulsing is kept while its end state is what is drawn.
  let lateSeen = null;   // { id, m } the minutes last shown, and for which train
  function lateIn(box, oldTile, m) {
    const tile = box.querySelector('.cd-late'), b = tile?.querySelector('b');
    if (!tile) return;
    const drawn = tile.outerHTML;
    if (oldTile?._drawn === drawn) { tile.replaceWith(oldTile); return; }
    tile._drawn = drawn;
    const before = lateSeen?.id === openId ? lateSeen.m : undefined;
    lateSeen = { id: openId, m };
    if (typeof m !== 'number' || typeof before !== 'number' || before === m) return;
    b._v = before;
    const end = b.textContent;
    roll(b, m, 0, '', (n, last) => (last ? end : n === 0 ? '0 min' : minutesText(n)));
    flash(tile);
  }
  let holdGlance = 0;   // until then the tiles stay as they are (a card-to-card roll: rollIn)
  function showGlance() {
    if (closing || performance.now() < holdGlance) return;   // sliding shut: left as it is for those 0.18 s
    const stops = shown?.stops;
    const box = el.querySelector('.cd');
    if (!box || !stops?.length) return;
    const g = glance(stops, nextOf(stops));
    const late = lateNow(stops);
    const line = el.querySelector('.tl-now-text');
    if (line && g.nowLine && line.textContent !== g.nowLine) line.textContent = g.nowLine;
    // the trip line first, then the tiles (Max's card pick 3, 2026-11-23)
    const html = `${g.trip}<div class="cd-tiles">${g.tiles}</div>${g.list}`;
    el.classList.toggle('picking', Boolean(g.list));   // the card grows while the stops ahead are listed
    if (html === glanceSeen) return;   // each second: only when something on it changed
    glanceSeen = html;
    const scrolled = box.querySelector('.cd-list')?.scrollTop;
    const oldTile = box.querySelector('.cd-late');
    box.innerHTML = html;
    lateIn(box, oldTile, late);
    const list = box.querySelector('.cd-list');
    if (list) {
      if (scrolled !== undefined) list.scrollTop = scrolled;
      else list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
    }
    wireGlance();
  }

  // The row for a trip's end abroad (e: abroadEnds' to or from). The line to it counts as travelled once the train is
  // past the last Swedish stop (to) or past the first (from); while the train is out there and still on the map, it
  // rides on that line. The Swedish stop next to the border cancelled: the trip doesn't go there (a dotted line, the
  // reason from Trafikverket, the name crossed out).
  function abroadRow(e, nextIdx) {
    const to = e.dir === 'to', onMap = lateOf?.(openId) !== undefined;
    const done = !e.cut && (to ? nextIdx === -1 : nextIdx !== 0);
    const riding = !e.cut && onMap && (to ? nextIdx === -1 : nextIdx === 0);
    // The stretch: 48 px from the Swedish row's edge to the flag; the cuts 18 px from that edge, halfway between the
    // Swedish stop's dot and the flag.
    const H = 48, c = to ? 18 : H - 18;
    const stretch = e.cut
      ? `<svg class="ab-stretch" viewBox="0 0 30 ${H}" aria-hidden="true"><line class="ab-run" x1="15" y1="2" x2="15" y2="${H - 2}" stroke-dasharray="2 8"/></svg>`
      : `<svg class="ab-stretch" viewBox="0 0 30 ${H}" aria-hidden="true"><line class="ab-run" x1="15" y1="0" x2="15" y2="${c - 9}"/>` +
        `<line class="ab-run" x1="15" y1="${c + 9}" x2="15" y2="${H}"/><line class="ab-cut" x1="8" y1="${c - 2}" x2="22" y2="${c - 7}"/>` +
        `<line class="ab-cut" x1="8" y1="${c + 7}" x2="22" y2="${c + 2}"/></svg>`;   // (no little train slipping through: Max, 2026-11-18)
    const flag = flagSvg(e.country);
    const dot = flag ? `<span class="tl-flag">${flag}</span>` : '<span class="tl-dot"></span>';
    const sub = e.cut ? t('notRunning', (e.texts.length ? e.texts : [t('cancelledStop')]).join(' · ')) : `${t('country', e.country)} · ${t('timeUnknown')}`;
    return `<div class="tl-row abroad ${e.dir}${e.cut ? ' canceled' : ''}${done ? ' done' : ''}">` +
      `<span class="tl-time">${t(to ? 'abroadEnd' : 'abroadStart')}</span>` +
      `<span class="tl-node">${stretch}${dot}${riding ? `<span class="tl-train ab-rider">${icon('train', 17)}</span>` : ''}</span>` +
      `<span class="tl-name"><span class="ab-name">${esc(t(to ? 'towardsEnd' : 'fromStart', e.name))}</span><small>${esc(sub)}</small></span>` +
      `<span class="tl-trk"></span></div>`;
  }

  // The card for a train whose route has loaded.
  // keepScroll: a refresh; the table stays where it was scrolled to (otherwise it scrolls to the next stop).
  function draw(train, route, { keepScroll = false } = {}) {
    const scrolled = keepScroll ? el.querySelector('.panel-table')?.scrollTop : undefined;
    const infoScrolled = el.querySelector('.panel-info-box')?.scrollTop;
    const status = el.querySelector('.panel-status')?.textContent ?? '';
    const stops = stopsOf(route);
    shown.stops = stops;
    const nextIdx = nextOf(stops);

    // The trip as a timeline (the Soft look, 2026-11-15): the planned time with the minutes off under it (in their
    // colour; "est." while only expected), a dot on a line (passed: ✓; next: a ring), the station (arrival under it
    // when the train stands a while), its track; "Now · next stop X" where the train is.
    // "All places": the places between the stops, in soft boxes (one per run of passed or ahead places), a small dot on
    // the line beside each; passed ones with the planned time and the minutes off, ahead ones (worked out from the
    // route: Trafikverket lists them only once passed) the name only. The train's line goes between the two.
    const between = settings.allPlaces && places ? places(openId, route, stops) : null;
    const nowLine = `<div class="tl-now"><span></span><span class="tl-node"><span class="tl-train">${icon('train', 17)}</span></span><span class="tl-now-text"></span></div>`;
    const placeRows = (list, withNow) => {
      const parts = [];
      let run = [];
      const flush = () => {
        run.forEach((p, k) => {
          const r = p.row, m = r?.actual && r.planned ? Math.round((r.actual - r.planned) / 60000) : null;
          const edge = (k === 0 ? ' first' : '') + (k === run.length - 1 ? ' last' : '');
          parts.push(`<div class="tl-row place ${p.passed ? 'passed' : 'ahead'}${edge}"><span class="tl-time"></span>` +
            `<span class="tl-node"><span class="tl-dot"></span></span><span class="tl-pbox">` +
            (p.passed ? `<b>${r?.actual ? time(r.planned) : ''}</b>` : '') + `<span>${esc(stationName(p.sig))}</span>` +
            (p.passed ? (m ? `<small class="m ${lateClass(m)}">${m > 0 ? '+' : '−'}${Math.abs(m)}</small>` : '<small></small>') : '') + `</span></div>`);
        });
        run = [];
      };
      let nowDone = !withNow;
      for (const p of list) {
        if (!p.passed && !nowDone) { flush(); parts.push(nowLine); nowDone = true; }
        if (run.length && run[0].passed !== p.passed) flush();
        run.push(p);
      }
      flush();
      if (!nowDone) parts.push(nowLine);
      return parts.join('');
    };
    const rows = stops.map((s, i) => {
      const a = s.arr, d = s.dep;
      const main = d ?? a;
      const seen = main.actual ?? main.estimated;
      const state = main.canceled ? 'canceled' : i < nextIdx || nextIdx === -1 ? 'passed' : i === nextIdx ? 'next' : '';
      const m = seen && main.planned ? Math.round((seen - main.planned) / 60000) : null;
      // Passed: the minutes off ("+2"); ahead: the expected clock time (Max, 2026-11-15: "estimated time instead of +n
      // on upcoming stations"), both in the lateness colour.
      const offText = main.canceled ? `<small class="m late">${t('cancelledStop')}</small>`
        : !m ? '' : main.actual ? `<small class="m ${lateClass(m)}">${m > 0 ? '+' : '−'}${Math.abs(m)}</small>`
        : `<small class="m ${lateClass(m)}">${time(main.estimated)}</small>`;
      const dwell = a && d && time(a.planned) !== time(d.planned) ? `<small>${t('arr')} ${time(a.planned)}</small>` : '';
      // Passed: an accent ring with a green ✓; cancelled: a red ring with ✕ (Max, 2026-11-15).
      const dot = state === 'canceled' ? `<span class="tl-dot">${icon('close', 12, 3)}</span>`
        : state === 'passed' ? `<span class="tl-dot">${icon('check', 13, 3)}</span>` : '<span class="tl-dot"></span>';
      // Where the train is: the minutes to the next stop (or till it leaves the one it stands at), each second
      // (showGlance; Max, 2026-11-15: "Nu · nästa station X" said nothing new).
      const now = i === nextIdx && i > 0 && !between ? nowLine : '';
      return now + `<div class="tl-row ${state}" data-sig="${esc(s.station)}"><span class="tl-time">${time(main.planned)}${offText}</span>` +
        `<span class="tl-node">${dot}</span><span class="tl-name">${esc(stationName(s.station))}${dwell}</span>` +
        `<span class="tl-trk">${esc(d?.track || a?.track || '')}</span></div>` +
        (between ? placeRows(between[i], i === nextIdx - 1 && nextIdx > 0) : '');
    }).join('');
    // A trip that goes on abroad, or comes from there (src/abroad.js): one more row for that end, after the last stop
    // (before the first), the line to it broken by two cuts (Max's pick from the sketch, 2026-11-18: "B", the cuts
    // halfway between the two dots; "Just the cuts": nothing moving there), a round flag for its dot.
    const ends = abroadEnds(route, station);
    const tlRows = (ends.from ? abroadRow(ends.from, nextIdx) : '') + rows + (ends.to ? abroadRow(ends.to, nextIdx) : '');

    // Trafikverket's notes (Max, 2026-11-13): problems first, then the rest. Each once; when it holds for only some
    // stops, they are named: "(Göteborg C)", "(from Alingsås)", "(Herrljunga, Vårgårda +3)". Only on the full card.
    const noteLines = [];
    let problemCount = 0;
    for (const kind of ['problems', 'notes']) {
      const at = new Map();   // text -> indices of the stops it is given at
      stops.forEach((s, i) => {
        for (const x of [s.arr, s.dep]) for (const text of x?.[kind] ?? []) {
          if (!at.has(text)) at.set(text, new Set());
          at.get(text).add(i);
        }
      });
      for (const [text, set] of at) {
        const idx = [...set].sort((a, b) => a - b);
        const run = idx.at(-1) - idx[0] === idx.length - 1;   // one stretch of stops in a row
        const name = i => stationName(stops[i].station);
        const where = idx.length === stops.length ? ''
          : run && idx.length >= 3 && idx.at(-1) === stops.length - 1 ? t('noteFrom', name(idx[0]))
          : run && idx.length >= 3 && idx[0] === 0 ? t('noteUntil', name(idx.at(-1)))
          : idx.slice(0, 2).map(name).join(', ') + (idx.length > 2 ? ` +${idx.length - 2}` : '');
        if (kind === 'problems') problemCount++;
        noteLines.push(`<p class="panel-tvnote${kind === 'problems' ? ' problem' : ''}">${esc(text)}${where ? ` <span>(${esc(where)})</span>` : ''}</p>`);
      }
    }

    // On the small card, one red line with what matters for the rest of the trip (Max, 2026-11-15, VR 2047: "Ändrad
    // väg · Elfel · Alingsås inställt"): Trafikverket's problem notes at the stops not yet passed (the end station
    // too), each once, then every cancelled stop by name ("Inställt" itself is then said by the names). Problems at
    // passed stops ("Spårändrat" at Herrljunga) stay on the full card only, with everything else.
    const ahead = new Set();
    if (nextIdx !== -1) for (let i = nextIdx; i < stops.length; i++) {
      for (const x of [stops[i].arr, stops[i].dep]) for (const text of x?.problems ?? []) if (!/^inställ/i.test(text)) ahead.add(text);
    }
    const cancelled = stops.filter(s => (s.dep ?? s.arr).canceled).map(s => stationName(s.station));
    const alert = [...ahead, ...(cancelled.length ? [t('stopsCancelled', cancelled)] : [])].join(' · ');

    glanceSeen = '';
    el.innerHTML =
      head(train, route.product) +
      (alert ? `<p class="panel-alert">${esc(alert)}</p>` : '') +
      // From files more than 2 minutes old (home down, plan step 4; Max 2026-11-17: yes): when they were made.
      (route.asOf && now() - route.asOf > 2 * 60000 ? `<p class="panel-note">${t('updatedAt', hhmm(route.asOf))}</p>` : '') +
      (stops.length
        ? `<div class="cd"></div>` +
          `<button class="panel-more" type="button"><span class="more">${t('allStops')}${icon('chevronUp', 16)}</span><span class="less">${t('fewerStops')}${icon('chevronDown', 16)}</span></button>` +
          (noteLines.length ? notesBox(noteLines, problemCount) : '') +
          `<div class="panel-table tl"><div class="tl-head"><span></span><span></span>` +
          // ("All places" back on the card, left of "Track": Max, 2026-11-23; the same setting as Settings → All places)
          `<span class="tl-all"><button type="button" class="tl-places" data-act="allplaces" aria-pressed="${Boolean(settings.allPlaces)}">${icon(settings.allPlaces ? 'check' : 'plus', 14)}${esc(t('allPlaces'))}</button></span><span>${t('track')}</span></div>${tlRows}</div>` +
          (info ? '<div class="panel-info-box"></div>' : '')
        : stateHtml('empty', t('noStops')));
    wireHead();
    // The page's own parts under the tiles (src/main.js: why it stands, Share, Add my change; 2026-11-23)
    const x = stops.length ? extra?.(openId) : null;
    if (x) { const at = el.querySelector('.panel-more'); if (at) at.before(x); else el.append(x); }
    const more = el.querySelector('.panel-more');
    if (more) more.onclick = () => (onMore ? onMore(!el.classList.contains('full')) : glide(el, () => el.classList.toggle('full')));   // (glides: Max's phone test, 2026-11-17)
    const fold = el.querySelector('.tv-toggle');
    // (the row and its arrow: one button; the page is told, so the opened messages are shown at once: onFold)
    if (fold) fold.onclick = () => { notesOpen = !notesOpen; remember(notesOpen); draw(train, route, { keepScroll: true }); onFold?.(notesOpen, el.querySelector('.tv-box')); };
    if (onStop) for (const row of el.querySelectorAll('.tl-row[data-sig]')) row.onclick = () => onStop(row.dataset.sig);
    showGlance();
    drawInfo();
    if (infoScrolled) el.querySelector('.panel-info-box').scrollTop = infoScrolled;
    if (status) setStatus(status);   // the line on how its place is known stays (main.js updates it each second)
    if (scrolled !== undefined) { const box = el.querySelector('.panel-table'); if (box) box.scrollTop = scrolled; } else toNext();
  }
  // Scroll the timeline (only it) so the train's place is in view; it shows only on the full card.
  // The timeline's rows in view come in one after another as the card opens full (src/motion.js; Max's pick 6,
  // 2026-11-20). Its redraw each minute moves nothing (new rows, no .arrive).
  function rowsIn() {
    const box = el.querySelector('.panel-table');
    if (!box) return;
    const top = box.scrollTop - 60, bottom = box.scrollTop + window.innerHeight;
    arrive([...box.querySelectorAll('.tl-row, .tl-now')].filter(r => r.offsetTop > top && r.offsetTop < bottom), new Set());
  }
  function toNext() {
    const box = el.querySelector('.panel-table'), next = el.querySelector('.tl-now') ?? el.querySelector('.tl-row.next');
    if (!box || !next) return;
    // In the sheet the page scrolls, not the timeline (src/stack.js): the page, so the train's place is in its middle.
    const page = el.closest('.pg');
    // (only when the train's place is below the fold: the card's head and tiles stay in view when they can)
    if (page) {
      const at = next.getBoundingClientRect().top - page.getBoundingClientRect().top;
      if (page.clientHeight && el.classList.contains('full') && at > page.clientHeight - 60) page.scrollTop += at - page.clientHeight * 0.6;
      return;
    }
    if (box.clientHeight) box.scrollTop = next.offsetTop - box.clientHeight / 2;
  }
  let wasFull = el.classList.contains('full'), switchTimer = 0;
  new MutationObserver(() => {
    const full = el.classList.contains('full');
    if (full && !wasFull) requestAnimationFrame(() => { if (infoOn) drawInfo(); else { toNext(); rowsIn(); } });
    // compact ↔ full: the parts that come into view fade in (index.html "switching"; Max, 2026-11-21)
    if (full !== wasFull && !el.hidden) {
      el.classList.add('switching');
      clearTimeout(switchTimer);
      switchTimer = setTimeout(() => el.classList.remove('switching'), 320);
    }
    wasFull = full;
  }).observe(el, { attributes: true, attributeFilter: ['class'] });

  // The open train's route is drawn (main.js): with "All places" on, the places worked out from it come in.
  function placesReady(id) {
    if (settings.allPlaces && id === openId && shown?.route && shown.train?.id === openId) draw(shown.train, shown.route);
  }

  // Draw it again as it is (Settings → Language changed): no new request, the map stays as it is.
  function relabel() {
    if (!openId || !shown) return;
    if (shown.route) { draw(shown.train, shown.route, { keepScroll: true }); return; }
    el.innerHTML = head(shown.train) + stateHtml('loading', t('loadingRoute'));
    wireHead();
  }

  // Each second (main.js): a short line under the head saying how it stands with the train ('' for nothing), e.g.
  // "No report for 3 min"; and the tiles, when their minutes changed.
  function setStatus(text) {
    showGlance();
    drawInfo();
    putStatus(text);
  }
  function putStatus(text) {
    let line = el.querySelector('.panel-status');
    if (!text) { line?.remove(); return; }
    if (!line) {
      const head = el.querySelector('.panel-head');
      if (!head) return;
      line = Object.assign(document.createElement('p'), { className: 'panel-status' });
      head.after(line);
    }
    line.textContent = text;
  }

  // The card put away with the train still open (a screen over it, Settings → Debug → Screen over a train: 'follow'),
  // and shown again; it stays up to date meanwhile.
  const hide = () => { el.hidden = true; };
  const show = () => { if (openId) el.hidden = false; };
  // The "to …" chooser shut at once, with no glide (a map tap: the tap rules, src/stack.js).
  function closePick() {
    if (!picking && !closing) return;
    picking = false; closing = false; holdGlance = 0;
    showGlance();
  }
  const toggleFollow = () => { if (!openId || !canFollow) return; setFollowing(!following); onFollow?.(openId, following); };
  return { open, close, hide, show, setFollowing, toggleFollow, closePick, get following() { return following && canFollow; }, get canFollow() { return Boolean(openId) && canFollow; }, get number() { return number; }, get route() { return shown?.train?.id === openId ? shown.route ?? null : null; }, setStatus, relabel, wake, reroute, placesReady, get openId() { return openId; }, get hidden() { return el.hidden; } };
}
