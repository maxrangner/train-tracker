// The panel that opens when a train is tapped: where it runs and every stop, planned and actual.
// Compact (Max, 2026-11-15, sketch C): the number, two tiles (the lateness now; the minutes to a stop, the end station
// unless another is picked from the stops ahead) and the trip as one line. "All stops", or a drag up on a phone, opens
// it full (class "full", src/sheet.js): the star, Trafikverket's notes and the timeline of every stop.
import { fetchRoute } from './trafikverket.js';
import { lateClass } from './lateness.js';
import { minutesText } from './tag.js';
import { stateHtml } from './state.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { hhmm, now } from './clock.js';
import { settings } from './settings.js';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const time = t => (t ? hhmm(t) : '');

// The favourite star (☆ / ★), used by the train panel and the station board.
export const star = on => `<button class="panel-star" type="button" aria-pressed="${on}" aria-label="${t(on ? 'starOn' : 'starOff')}">${icon(on ? 'starFilled' : 'star')}</button>`;

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
export function createPanel(el, { stationName, onSelect, onFollow, onRoute, isStarred, onStar, lateOf }) {
  let openId = null;
  let following = false;
  let canFollow = true;   // false for a train that isn't on the map
  let number = null;      // the open train's public number (for the star)
  let shown = null;       // { train, route, stops }: what the panel shows, to redraw it in another language
  let target = null;      // the station counted down to (null: the end station); kept while the card is open
  let picking = false;    // the list of stops to count down to is open

  // The top line: the train's number and company, then the star (shown only when full), Follow and × (only on a wide
  // screen; on a phone a drag down or a tap on the map closes it: Max, 2026-11-15).
  const head = (train, company) =>
    `<div class="panel-head"><span class="panel-title"><strong>${esc(train.number ?? train.label)}</strong>` +
    (company ? `<span class="panel-co">${esc(company)}</span>` : '') + `</span><span class="panel-buttons">` +
    (number && isStarred ? star(isStarred(number)) : '') +
    (canFollow ? `<button class="panel-follow" type="button" aria-pressed="${following}">${icon('follow', 15)}<span>${t(following ? 'following' : 'follow')}</span></button>` : '') +
    `<button class="panel-close" type="button" aria-label="${t('close')}">${icon('close')}</button></span></div>`;
  function wireHead() {
    el.querySelector('.panel-close').onclick = close;
    const f = el.querySelector('.panel-follow');
    if (f) f.onclick = () => { setFollowing(!following); onFollow?.(openId, following); };
    const s = el.querySelector('.panel-star');
    if (s) s.onclick = () => { const on = onStar(number); s.outerHTML = star(on); wireHead(); };
  }
  function setFollowing(on) {
    following = on;
    const b = el.querySelector('.panel-follow span');
    if (b) { b.parentElement.setAttribute('aria-pressed', String(on)); b.textContent = t(on ? 'following' : 'follow'); }
  }

  // While a card is open its times are asked for again every minute (Max, 2026-11-14: they came only once, when
  // it opened, so new actual times never showed). The table keeps where it was scrolled to.
  const REFRESH_MS = 60000;
  let refreshTimer = null;
  function refreshLater(train) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      if (openId !== train.id) return;
      try {
        const route = await fetchRoute(train.operational, train.date, train.number);
        if (openId !== train.id) return;
        const first = !shown?.route;
        shown = { train, route };
        if (first) onRoute?.(train.id, route);   // the first try had failed: its path too
        draw(train, route, { keepScroll: !first });
      } catch (e) {
        console.warn('route refresh:', e.message);
      }
      refreshLater(train);
    }, REFRESH_MS);
  }

  function close() {
    clearTimeout(refreshTimer);
    openId = null;
    el.hidden = true;
    el.innerHTML = '';
    onSelect?.(null);
  }

  // follow: false for a train that isn't on the map (picked from the timetable search).
  async function open(train, { follow = true } = {}) {
    openId = train.id;
    number = train.number ?? null;
    following = follow;   // opening a train on the map starts following it (main.js)
    canFollow = follow;
    target = null;
    picking = false;
    onSelect?.(train.id);
    el.hidden = false;
    el.classList.toggle('full', settings.trainCard === 'expanded');   // Settings → Train card
    shown = { train, route: null };
    el.innerHTML = head(train) + stateHtml('loading', t('loadingRoute'));
    wireHead();

    let route;
    try {
      route = await fetchRoute(train.operational, train.date, train.number);
    } catch (e) {
      if (openId === train.id) { el.querySelector('.state').outerHTML = stateHtml('error', t('routeFailed', e.message)); refreshLater(train); }
      return;
    }
    if (openId !== train.id) return;   // another train was tapped meanwhile
    onRoute?.(train.id, route);
    shown = { train, route };
    draw(train, route);
    refreshLater(train);
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
    const stopTile = `<button class="cd-stop tile" type="button" aria-expanded="${picking}">` +
      `<b${(g.mark + g.inn).length > 8 ? ' class="long"' : ''}>${g.mark}${g.inn}</b><small><span>${esc(t(g.here ? 'cdAt' : 'cdTo', stationName(goal.s.station)))}` +
      `${g.w.kind === 'planned' ? ` · ${t('planned')}` : ''}</span>${icon(picking ? 'chevronUp' : 'chevronDown', 14)}</small></button>`;
    const list = picking ? `<div class="cd-pick"><p>${t('countDownTo')}</p><div class="cd-list">${ahead.map(a => {
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
      `<div class="cd-names"><span>${esc(stationName(stops[0].station))}</span>` +
      `<b class="${goal.i === nextIdx ? 'goal' : ''}">${esc(nextName)}</b>` +
      `<span class="${isEnd ? 'goal' : ''}">${esc(stationName(stops.at(-1).station))}</span></div></div>`;
    // The timeline's line where the train is: "In 4 min" to the next stop; standing there, "Leaves in 2 min".
    const nx = row({ s: next, i: nextIdx }), soon = nx.w.at - tNow < 30000;
    const nowLine = soon ? t(nx.here ? 'leavesNow' : 'arrivesNow')
      : t(`${nx.here ? 'leaves' : 'arrives'}${nx.mark ? 'About' : 'In'}`, inText(nx.w.at - tNow));
    return { tiles: lateTile + stopTile, list, trip, nowLine };
  }
  function wireGlance() {
    const b = el.querySelector('.cd-stop');
    if (b?.tagName === 'BUTTON') b.onclick = () => { picking = !picking; showGlance(); };
    for (const r of el.querySelectorAll('.cd-row')) r.onclick = () => { target = r.dataset.sig; picking = false; showGlance(); };
  }
  let glanceSeen = '';
  function showGlance() {
    const stops = shown?.stops;
    const box = el.querySelector('.cd');
    if (!box || !stops?.length) return;
    const g = glance(stops, nextOf(stops));
    const line = el.querySelector('.tl-now-text');
    if (line && g.nowLine && line.textContent !== g.nowLine) line.textContent = g.nowLine;
    const html = `<div class="cd-tiles">${g.tiles}</div>${g.list}${g.trip}`;
    el.classList.toggle('picking', Boolean(g.list));   // the card grows while the stops ahead are listed
    if (html === glanceSeen) return;   // each second: only when something on it changed
    glanceSeen = html;
    const scrolled = box.querySelector('.cd-list')?.scrollTop;
    box.innerHTML = html;
    const list = box.querySelector('.cd-list');
    if (list) {
      if (scrolled !== undefined) list.scrollTop = scrolled;
      else list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
    }
    wireGlance();
  }

  // The card for a train whose route has loaded.
  // keepScroll: a refresh; the table stays where it was scrolled to (otherwise it scrolls to the next stop).
  function draw(train, route, { keepScroll = false } = {}) {
    const scrolled = keepScroll ? el.querySelector('.panel-table')?.scrollTop : undefined;
    const status = el.querySelector('.panel-status')?.textContent ?? '';
    const stops = stopsOf(route);
    shown.stops = stops;
    const nextIdx = nextOf(stops);

    // The trip as a timeline (the Soft look, 2026-11-15): the planned time with the minutes off under it (in their
    // colour; "est." while only expected), a dot on a line (passed: ✓; next: a ring), the station (arrival under it
    // when the train stands a while), its track; "Now · next stop X" where the train is.
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
      const now = i === nextIdx && i > 0
        ? `<div class="tl-now"><span></span><span class="tl-node"><span class="tl-train">${icon('train', 17)}</span></span><span class="tl-now-text"></span></div>` : '';
      return now + `<div class="tl-row ${state}"><span class="tl-time">${time(main.planned)}${offText}</span>` +
        `<span class="tl-node">${dot}</span><span class="tl-name">${stationName(s.station)}${dwell}</span>` +
        `<span class="tl-trk">${esc(d?.track || a?.track || '')}</span></div>`;
    }).join('');

    // Trafikverket's notes (Max, 2026-11-13): problems first, then the rest. Each once; when it holds for only some
    // stops, they are named: "(Göteborg C)", "(from Alingsås)", "(Herrljunga, Vårgårda +3)". Only on the full card.
    const noteLines = [];
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
      (stops.length
        ? `<div class="cd"></div>` +
          `<button class="panel-more" type="button"><span class="more">${t('allStops')}${icon('chevronUp', 16)}</span><span class="less">${t('fewerStops')}${icon('chevronDown', 16)}</span></button>` +
          (noteLines.length ? `<div class="panel-tvnotes">${noteLines.join('')}</div>` : '') +
          `<div class="panel-table tl"><div class="tl-head"><span></span><span></span><span></span><span>${t('track')}</span></div>${rows}</div>`
        : stateHtml('empty', t('noStops')));
    wireHead();
    const more = el.querySelector('.panel-more');
    if (more) more.onclick = () => el.classList.toggle('full');
    showGlance();
    if (status) setStatus(status);   // the line on how its place is known stays (main.js updates it each second)
    if (scrolled !== undefined) { const box = el.querySelector('.panel-table'); if (box) box.scrollTop = scrolled; } else toNext();
  }
  // Scroll the timeline (only it) so the train's place is in view; it shows only on the full card.
  function toNext() {
    const box = el.querySelector('.panel-table'), next = el.querySelector('.tl-now') ?? el.querySelector('.tl-row.next');
    if (box && next && box.clientHeight) box.scrollTop = next.offsetTop - box.clientHeight / 2;
  }
  let wasFull = el.classList.contains('full');
  new MutationObserver(() => {
    const full = el.classList.contains('full');
    if (full && !wasFull) requestAnimationFrame(toNext);
    wasFull = full;
  }).observe(el, { attributes: true, attributeFilter: ['class'] });

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

  return { open, close, setFollowing, setStatus, relabel, get openId() { return openId; } };
}
