// My trains (build plan part 3, ideas 11; Max, 2026-11-22: "today only"; the line above the bar when a trip is saved).
// - A saved trip from -> to (and an optional "via", a change on the way): its page 'trip:<key>' lists today's trains
//   (time, expected time, track, lateness, cancelled ones crossed out), "If it fails: next is 17:08", or "No direct
//   train today"; with a via the pairs with the minutes to change and both tracks, tight in yellow, lost in red.
// - "+ New trip" (Home's Saved, under Trips) and "Save a trip from here" (a board): the page 'newtrip' /
//   'newtrip:<from>' shows the trip as a route (Max's pick A, 2026-11-23): its stations on a line, each a pill (From,
//   a Change, To), dragged up or down by their dots; a tap on a pill makes it the station search, in place. A saved
//   trip's page has Edit ('edittrip:<key>': the same form, filled in) and Delete (two taps), no star.
// - "Add my change" (a train's page): 'addchange:<train id>' picks a later stop of the train, then a train leaving
//   there; the pair is pinned as 'change:<key>' (today only). Its page is a trip's ("My trip"; Max, 2026-11-23) with
//   Edit ('editchange:<key>': the same two steps again, from train 1) and Delete.
// - The line above the bar ('trip', priority 20): the next train of the saved trip (or pinned change) whose next train
//   leaves soonest, "16:52 → Stockholm C · track 4 · +3"; a tap opens it.
// The rows: src/trafikverket.js fetchStationDay (whole-day boards, the files' day kind), each kept a minute; the trains
// matched by src/trips.js. Refreshed about every minute while shown (the line, a trip's page), not while the page is
// hidden.
import { direct, nextTwo, withChange, change, when, lateAt } from './trips.js';
import { favourites, tripKey } from './favourites.js';
import { fetchStationDay, fetchRoute, boardGone } from './trafikverket.js';
import { now, hhmm, swedishDay } from './clock.js';
import { t } from './i18n.js';
import { esc } from './html.js';
import { icon } from './icons.js';
import { tagHtml } from './tag.js';
import { stateHtml } from './state.js';
import { isWide } from './layout.js';

const FRESH_MS = 60 * 1000;     // a station's day is asked again after this
const RETRY_MS = 15 * 1000;     // after a failure
const LIST_MAX = 14;            // trains on a trip's page

// deps: { stack, line, stationName(sig), findStations(text) -> [{ sig, name }], openTrain({ key, operational, date,
//   number }), trainInfo(id) -> { number, operational, date, route } | null, redrawHome() }
// showStation(sig): the map shows that station above the sheet (a change tapped: Max, 2026-11-23, "the map should show
// where it is").
// showTrip({ sigs, trains }): a trip's page shown: the map on its stations (in order), its next train(s) by their ids.
export function createMyTrains({ stack, line, stationName, findStations, openTrain, trainInfo, redrawHome, showStation = () => {}, showTrip = () => {} }) {
  // ---------- the stations' days, kept a minute ----------
  const cache = new Map();   // 'sig|act' -> { at, rows, p }
  function day(sig, act) {
    const k = `${sig}|${act}`, c = cache.get(k);
    if (c?.p) return c.p;
    if (c?.rows && Date.now() - c.at < FRESH_MS) return Promise.resolve(c.rows);
    const p = fetchStationDay(sig, act, now()).then((rows) => { cache.set(k, { at: Date.now(), rows, p: null }); return rows; },
      (e) => { cache.set(k, { at: Date.now() - FRESH_MS + RETRY_MS, rows: c?.rows ?? null, p: null }); throw e; });
    cache.set(k, { at: c?.at ?? 0, rows: c?.rows ?? null, p });
    return p;
  }
  const stale = sig => ['Avgang', 'Ankomst'].some(a => { const c = cache.get(`${sig}|${a}`); return !c || (!c.p && Date.now() - c.at >= FRESH_MS); });

  // ---------- a trip's trains ----------
  const parse = (key) => {
    const p = String(key).split('>');
    return p.length === 3 ? { key, from: p[0], via: p[1], to: p[2] } : p.length === 2 ? { key, from: p[0], via: null, to: p[1] } : null;
  };
  const tripOf = key => favourites.trip(key) ?? parse(key);
  const results = new Map();   // trip key -> { trains } or { pairs }, or { error }
  // Not gone from the board now (left, arrived, cancelled long ago), so the list starts at the next train.
  const notGone = x => !boardGone(x.dep, now());
  const byLeaving = (a, b) => when(a.dep) - when(b.dep);
  async function load(trip) {
    try {
      if (!trip.via) {
        const [a, b] = await Promise.all([day(trip.from, 'Avgang'), day(trip.to, 'Ankomst')]);
        results.set(trip.key, { trains: direct(a, b), partial: [a, b].some(x => x.partial) });
      } else {
        const [a, c1, c2, b] = await Promise.all([day(trip.from, 'Avgang'), day(trip.via, 'Ankomst'), day(trip.via, 'Avgang'), day(trip.to, 'Ankomst')]);
        results.set(trip.key, { pairs: withChange(a, c1, c2, b), partial: [a, c1, c2, b].some(x => x.partial) });
      }
    } catch (e) {
      console.warn('my trains:', e.message);
      if (!results.get(trip.key)?.trains && !results.get(trip.key)?.pairs) results.set(trip.key, { error: e.message });
    }
    return results.get(trip.key);
  }
  const due = trip => [trip.from, trip.via, trip.to].filter(Boolean).some(stale) || !results.has(trip.key);
  // The trip's next train: { number, dep, late, track, arr, pair? }, or null; and the one after it.
  function nextOf(trip) {
    const r = results.get(trip.key);
    if (!r) return { loading: true };
    if (r.error) return { error: r.error };
    if (r.trains) {
      // (by when they leave: a train 69 min late is not the next one when another leaves in 6 minutes)
      const { next, after } = nextTwo(r.trains.filter(notGone).sort(byLeaving), now());
      return { next, after, none: !r.trains.length, partial: r.partial };
    }
    const pairs = r.pairs.filter(p => notGone(p.first));
    const { next, after } = nextTwo(pairs.map(p => p.first).sort(byLeaving), now());
    return { next, after, pair: pairs.find(p => p.first === next) ?? null, none: !r.pairs.length, partial: r.partial };
  }

  // ---------- a pinned change ----------
  const changeRows = new Map();   // change key -> { arr, dep } (the first train's arrival, the second's departure at the station)
  async function loadChange(c) {
    try {
      const [arrs, deps] = await Promise.all([day(c.at, 'Ankomst'), day(c.at, 'Avgang')]);
      const arr = arrs.find(r => String(r.number) === String(c.a.number) && r.date === c.a.date) ?? null;
      const dep = deps.find(r => String(r.number) === String(c.b.number) && r.date === c.b.date) ?? null;
      changeRows.set(c.key, { arr, dep });
    } catch (e) { console.warn('my change:', e.message); }
    return changeRows.get(c.key);
  }
  const todayChanges = () => favourites.changes(swedishDay(now()));

  // ---------- words ----------
  const trackText = tr => (tr ? t('trackN', tr) : '');
  const late = r => (r && !r.canceled ? lateAt(r) : 0);
  const lateTag = r => (r?.canceled ? `<span class="tag late">${t('cancelled')}</span>` : late(r) > 0 ? tagHtml(late(r), { short: true }) : '');
  // "16:52" with the expected time under it when late.
  const timeHtml = r => `${hhmm(r.planned)}${!r.canceled && late(r) > 0 ? `<small class="m ${late(r) >= 6 ? 'late' : 'some'}">${hhmm(when(r))}</small>` : ''}`;
  const tripName = trip => `${stationName(trip.from)} → ${stationName(trip.to)}`;
  const changeClass = ch => (!ch ? '' : ch.lost ? 'lost' : ch.tight ? 'tight' : 'ok');
  const changeWords = ch => (ch.lost ? t('changeLost') : t('changeMin', ch.minutes)) +
    (ch.tracks[0] || ch.tracks[1] ? ` · ${t('trackShort')} ${ch.tracks[0] ?? '–'} → ${ch.tracks[1] ?? '–'}` : '');
  // What to say when no train is found. Only part of the day known (the site's files held only the stations' next
  // hours: a server without day files, its first minute after a start, a day file that didn't come): later trains not
  // known yet, never "no train today" (Max, 2026-11-24: Stockholm C → Malmö C via Göteborg C said "No train onward
  // today" all morning; "more descriptive error messages").
  const noTrainWords = (trip, n) => t(n.partial ? 'tripLaterUnknown' : n.none ? (trip.via ? 'noTripToday' : 'noDirectToday') : 'noMoreToday');
  // A short line for Saved and the line above the bar.
  function summary(trip) {
    const n = nextOf(trip);
    if (n.loading) return { text: t('loading'), at: null };
    if (n.error) return { text: t('tripNoAnswer'), at: null };
    if (!n.next) return { text: noTrainWords(trip, n), at: null };
    const d = n.next.dep;
    return { at: when(d), dep: d, number: n.next.number, track: d.track || null, late: late(d), pair: n.pair,
      text: [`${hhmm(d.planned)} ${n.next.number}`, trackText(d.track), n.pair?.change ? changeWords(n.pair.change) : ''].filter(Boolean).join(' · ') };
  }
  function changeSummary(c) {
    const r = changeRows.get(c.key);
    if (!r) return { text: t('loading'), at: null };
    if (!r.dep) return { text: t('tripNoAnswer'), at: null };
    if (r.dep.actual && r.dep.actual < now()) return { text: t('changeDone'), at: null, done: true };
    const ch = r.arr ? change(r.arr, r.dep) : null;
    return { at: when(r.dep), ch, dep: r.dep, text: [t('changeAt', stationName(c.at)), ch ? changeWords(ch) : trackText(r.dep.track)].filter(Boolean).join(' · ') };
  }

  // ---------- Saved (src/home.js), under Trips: the trips, the pinned changes, "+ New trip" ----------
  function mineHtml() {
    const trips = favourites.trips.map((trip) => {
      const s = summary(trip);
      return `<button type="button" class="row trip-row" data-go="trip:${esc(trip.key)}"><span class="r-ic trip">${icon('trip', 18)}</span>` +
        `<span class="r-main"><b>${esc(tripName(trip))}${trip.via ? ` <i class="via">${esc(t('viaShort', stationName(trip.via)))}</i>` : ''}</b><small>${esc(s.text)}</small></span>` +
        `${s.dep ? lateTag(s.dep) : ''}${icon('chevron', 18)}</button>`;
    });
    const changes = todayChanges().map((c) => {
      const s = changeSummary(c);
      return `<button type="button" class="row trip-row" data-go="change:${esc(c.key)}"><span class="r-ic trip ${changeClass(s.ch)}">${icon('change', 18)}</span>` +
        `<span class="r-main"><b>${esc(`${c.a.number} → ${c.b.number}`)}</b><small>${esc(s.text)}</small></span>${icon('chevron', 18)}</button>`;
    });
    const add = `<button type="button" class="row add-row" data-go="newtrip"><span class="r-ic">${icon('plus', 18)}</span><span class="r-main"><b>${esc(t('newTrip'))}</b>` +
      `<small>${esc(t('newTripSub'))}</small></span></button>`;
    return { rows: [...trips, ...changes], add };
  }

  // ---------- the line above the bar: no trip pill (Max, 2026-11-23: "Remove the trip pill"; a saved trip is on Home's
  // Saved and its own page) ----------
  function drawLine() { line.clear('trip'); }
  let busy = false;
  async function refreshAll() {
    if (busy || document.hidden) return;
    busy = true;
    try {
      await Promise.all([...favourites.trips.filter(due).map(load), ...todayChanges().filter(c => stale(c.at) || !changeRows.has(c.key)).map(loadChange)]);
    } finally { busy = false; }
    drawLine();
    redrawHome();
  }
  setInterval(refreshAll, 20 * 1000);   // (asks only what is a minute old)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshAll(); });
  setTimeout(refreshAll, 3000);

  // ---------- pages ----------
  const openRow = (el) => {
    el.addEventListener('click', (e) => {
      const at = e.target.closest('[data-at]');
      if (at) { showStation(at.dataset.at); return; }
      const b = e.target.closest('[data-train]');
      if (!b) return;
      const [key, operational, date, number] = JSON.parse(b.dataset.train);
      openTrain({ key, operational, date, number });
    });
  };
  const trainAttr = r => esc(JSON.stringify([r.key, r.operational, r.date, r.number]));
  // A train's row: its time at the first station (expected under it), where it goes and when it gets there, its number
  // and kind, the lateness, the track. In the board's style.
  function legRow(leg, toSig, { dim = false } = {}) {
    const d = leg.dep, a = leg.arr, gone = leg.canceled;
    return `<button type="button" class="bd-row${gone ? ' canceled' : ''}${dim ? ' gone' : ''}" data-train="${trainAttr(d)}"><span class="bd-time">${timeHtml(d)}</span>` +
      `<span class="bd-name"><b>${esc(`→ ${stationName(toSig)} ${hhmm(when(a))}`)}</b><small>${esc(`${d.number} ${d.product ?? ''}`)}</small></span>` +
      `<span class="bd-tag">${lateTag(gone ? { canceled: true } : d)}</span><span class="tl-trk">${esc(d.track || '')}</span></button>`;
  }
  const chgAt = at => (at ? ` data-at="${esc(at)}" role="button" tabindex="0"` : '');
  // (partial: only part of the day known, the onward train may come later: said so, not "none today")
  const chgBox = (ch, second, rescue = null, at = null, partial = false) => (!second ? `<div class="trip-chg ${partial ? 'unknown' : 'lost'}"${chgAt(at)}>${icon('change', 16)}<span>${esc(t(partial ? 'onwardUnknown' : 'noOnward'))}</span></div>`
    : `<div class="trip-chg ${changeClass(ch)}"${chgAt(at)}>${icon('change', 16)}<span>${esc(changeWords(ch))}</span></div>` +
      (ch?.lost && rescue ? `<div class="trip-chg rescue">${icon('change', 16)}<span>${esc(t('changeRescue', hhmm(when(rescue.second.dep)), rescue.second.number, rescue.change.tracks[1]))}</span></div>` : ''));

  // Edit and Delete of a saved trip or a pinned change (Max, 2026-11-23: saved trips "can't be edited or deleted"; the
  // star "is not relevant here, it's either edit or delete"): a pencil and a bin in the sheet's head (def.acts/act,
  // src/stack.js). Delete takes two taps: the first turns it red, "Tap again to delete", for DELETE_ARMED_MS; a second
  // tap sooner than DELETE_GAP_MS (a double tap, a finger bouncing) doesn't count.
  // pageKey: the page they sit on; editKey: the page the pencil opens; remove(): forgets the trip or change.
  const DELETE_ARMED_MS = 4000, DELETE_GAP_MS = 450;
  function editDelete(pageKey, editKey, remove) {
    let armedAt = 0, disarm = 0;
    const armed = () => performance.now() - armedAt < DELETE_ARMED_MS;
    return {
      acts: () => [{ id: 'edit', icon: 'edit', label: t('tripEdit') },
        { id: 'del', icon: 'trash', label: t(armed() ? 'tripDeleteAgain' : 'tripDelete'), armed: armed() }],
      act(what) {
        if (what === 'edit') { stack.open(editKey); return; }
        const since = performance.now() - armedAt;
        if (since < DELETE_GAP_MS) return;
        if (since < DELETE_ARMED_MS) {
          clearTimeout(disarm);
          remove();
          drawLine();
          redrawHome();
          stack.close(pageKey);
          return;
        }
        armedAt = performance.now();
        stack.refreshBar();
        clearTimeout(disarm);
        disarm = setTimeout(() => { if (stack.top() === pageKey) stack.refreshBar(); }, DELETE_ARMED_MS + 50);
      },
      reset() { armedAt = 0; },
      stop() { clearTimeout(disarm); },
    };
  }

  function tripPage(key) {
    const trip = tripOf(key);
    if (!trip) return null;
    let el = null;
    const ed = editDelete(`trip:${trip.key}`, `edittrip:${trip.key}`, () => { favourites.removeTrip(trip.key); results.delete(trip.key); });
    const onMap = () => {
      const n = nextOf(trip);
      showTrip({ sigs: [trip.from, trip.via, trip.to].filter(Boolean), trains: [n.next?.dep?.key, n.pair?.second?.dep?.key].filter(Boolean) });
    };
    function draw() {
      if (!el) return;
      const r = results.get(trip.key), n = nextOf(trip);
      const head = `<div class="g-head"><span class="r-ic trip">${icon('trip', 18)}</span><b class="ttl">${esc(tripName(trip)).replace(/ (?!→)(?<!→ )/g, " ")}</b></div>` +
        `<p class="sub">${esc(trip.via ? t('tripVia', stationName(trip.via)) : t('tripToday'))}</p>`;
      let body;
      if (!r) body = stateHtml('loading', t('loading'));
      else if (r.error) body = stateHtml('error', t('tripNoAnswer'));
      else if (!n.next) body = stateHtml('empty', noTrainWords(trip, n));
      else {
        // The next train: a button to its card (on the map too), with its company and where and when it gets there; with a
        // change, the change and the train after it below (Max, 2026-11-24: "This is not very informative. Needs operator,
        // and able to click on train to see more info. Show on map as well"). The list under it: the trains after it
        // ("shows the same train again. Maybe 'more departures'").
        const d = n.next.dep, a = n.next.arr, stop = trip.via ?? trip.to;
        const big = `<button type="button" class="trip-next" data-train="${trainAttr(d)}"><small>${esc(t('nextTrain'))}</small>` +
          `<b>${hhmm(d.planned)}${late(d) > 0 ? ` <span class="m ${late(d) >= 6 ? 'late' : 'some'}">${hhmm(when(d))}</span>` : ''}</b>` +
          `<span>${esc([`${n.next.number} ${d.product ?? ''}`.trim(), trackText(d.track)].filter(Boolean).join(' · '))}</span>` +
          `<span class="tn-to">${esc(`→ ${stationName(stop)} ${hhmm(when(a))}`)}</span>${lateTag(d)}<span class="tn-go">${icon('chevron', 20)}</span></button>` +
          (n.pair ? `<div class="trip-next-chg">${chgBox(n.pair.change, n.pair.second, n.pair.rescue, trip.via, r.partial)}${n.pair.second ? legRow(n.pair.second, trip.to) : ''}</div>` : '') +
          (n.after ? `<p class="trip-fails">${esc(t('ifItFails', hhmm(when(n.after.dep))))}</p>` : `<p class="trip-fails">${esc(t('lastToday'))}</p>`);
        let list;
        if (r.trains) {
          list = r.trains.filter(notGone).filter(x => x !== n.next).slice(0, LIST_MAX).map(x => legRow(x, trip.to)).join('');
        } else {
          list = r.pairs.filter(p => notGone(p.first) && p.first !== n.next).slice(0, LIST_MAX / 2).map(p => `<div class="trip-pair">${legRow(p.first, trip.via)}${chgBox(p.change, p.second, p.rescue, trip.via, r.partial)}` +
            `${p.second ? legRow(p.second, trip.to) : ''}</div>`).join('');
        }
        body = big + (list ? `<h4 class="lab">${esc(t('moreDepartures'))}</h4><div class="bd trip-list">${list}</div>` : '');
      }
      const html = head + body;
      if (el._h !== html) { el.innerHTML = html; el._h = html; }
    }
    return {
      name: () => tripName(trip), kind: 'trip',
      mount(page) { el = page; openRow(el); },
      acts: () => (favourites.trip(trip.key) ? ed.acts() : []),
      act: ed.act,
      // the pencil and the bin beside its name (Max, 2026-11-23: "placed awkwardly. Move them")
      barIn: () => el?.querySelector('.g-head') ?? null,
      // On the map too (Max, 2026-11-23: "Clicking a saved trip should show it on the map"): its stations at once, its
      // next train once today's trains are in (still its page on top then).
      show() {
        ed.reset(); draw(); onMap();
        load(trip).then(() => { draw(); drawLine(); stack.refreshBar(); if (stack.top() === `trip:${trip.key}`) onMap(); });
      },
      every() { if (due(trip)) load(trip).then(draw); else draw(); },
      unmount() { ed.stop(); },
      redraw: () => { if (el) el._h = ''; draw(); },
    };
  }

  // A pinned change is a trip (Max, 2026-11-23: "Shouldn't this be 'My trip' instead of 'mitt byte'? And all info and
  // options of that"): a trip's page, "My trip", with the pencil (the change picked again, from train 1) and the bin,
  // and on the map (its station named, its two trains lit). It tells only what the change knows: train 1, the station,
  // train 2; not where you got on or where you are going.
  function changePage(key) {
    const c = favourites.change(key);
    if (!c) return null;
    let el = null;
    const ed = editDelete(`change:${c.key}`, `editchange:${c.key}`, () => { favourites.removeChange(c.key); changeRows.delete(c.key); });
    const onMap = () => { const r = changeRows.get(c.key); showTrip({ sigs: [c.at], trains: [r?.arr?.key, r?.dep?.key].filter(Boolean) }); };
    function draw() {
      if (!el) return;
      const r = changeRows.get(c.key);
      const head = `<div class="g-head"><span class="r-ic trip">${icon('trip', 18)}</span><b class="ttl">${esc(t('myTrip'))}</b></div>` +
        `<p class="sub">${esc(t('changeTripSub', c.a.number, c.b.number, stationName(c.at)))}</p>`;
      let body;
      if (!r) body = stateHtml('loading', t('loading'));
      else if (!r.arr || !r.dep) body = stateHtml('empty', t('tripNoAnswer'));
      else {
        const ch = change(r.arr, r.dep);
        const row = (x, words) => `<button type="button" class="bd-row${x.canceled ? ' canceled' : ''}" data-train="${trainAttr(x)}"><span class="bd-time">${timeHtml(x)}</span>` +
          `<span class="bd-name"><b>${esc(words)}</b><small>${esc(`${x.number} ${x.product ?? ''}`)}</small></span>` +
          `<span class="bd-tag">${lateTag(x)}</span><span class="tl-trk">${esc(x.track || '')}</span></button>`;
        body = `<div class="trip-next ${changeClass(ch)}"><small>${esc(t('toChangeAt', stationName(c.at)))}</small><b>${ch.lost ? esc(t('changeLost')) : esc(t('minutesN', ch.minutes))}</b>` +
          `<span>${esc(`${t('trackShort')} ${ch.tracks[0] ?? '–'} → ${ch.tracks[1] ?? '–'}`)}</span></div>` +
          (ch.tight && !ch.lost ? `<p class="trip-fails">${esc(t('changeTight'))}</p>` : '') +
          `<h4 class="lab">${esc(t('todaysTrains'))}</h4>` +
          `<div class="bd trip-list trip-pair">${row(r.arr, t('arrivesAt', stationName(c.at)))}${chgBox(ch, r.dep, null, c.at)}${row(r.dep, t('leavesFrom', stationName(c.at), r.dep.to ? stationName(r.dep.to) : ''))}</div>`;
      }
      const html = head + body;
      if (el._h !== html) { el.innerHTML = html; el._h = html; }
    }
    return {
      name: () => t('myTrip'), kind: 'trip',
      mount(page) { el = page; openRow(el); },
      acts: () => (favourites.change(c.key) ? ed.acts() : []),
      act: ed.act,
      barIn: () => el?.querySelector('.g-head') ?? null,
      show(_, { dir } = {}) {
        ed.reset();
        if (dir !== 0) showStation(c.at);
        draw(); onMap();
        loadChange(c).then(() => { draw(); drawLine(); stack.refreshBar(); if (stack.top() === `change:${c.key}`) onMap(); });
      },
      every() { if (stale(c.at)) loadChange(c).then(draw); else draw(); },
      unmount() { ed.stop(); },
      redraw: () => { if (el) el._h = ''; draw(); },
    };
  }

  // ---------- a new trip as a route (Max's pick A, 2026-11-23) ----------
  // Its stations in order on a line, each a pill: the first is where you start (From, a grey dot), the last where you go
  // (To: big, in the accent colour, a filled dot), one between a change (Change: a yellow dot and a × to take it away).
  // At most one change for now (Max: several is a later, bigger build). Each pill is dragged up or down by its six dots
  // (pointer events: a finger or a mouse; the pill lifts, its new place dashed); after a drag the first is From, the last
  // To, the middle the Change. A tap on a pill makes that pill the station search, in place, its results right under it
  // (Max's note 11: "many fields that look the same appear and reappear").
  // edit: a saved trip ('edittrip:<key>', its page's Edit): the stations filled in; saving puts them in its place.
  function newTripPage(key, edit = null) {
    const from0 = !edit && key.includes(':') ? key.slice(key.indexOf(':') + 1) : null;
    // stops: the station signatures in order (null: not picked yet); editing: the pill that is the search now (-1: none)
    const st = { stops: edit ? [edit.from, edit.via, edit.to].filter(Boolean) : [from0, null], editing: edit ? -1 : from0 ? 1 : 0 };
    let el = null, drag = null;
    const role = i => (i === 0 ? 'from' : i === st.stops.length - 1 ? 'to' : 'via');
    const label = i => t({ from: 'tripFrom', to: 'tripTo', via: 'tripViaLabel' }[role(i)]);
    function pillHtml(i) {
      const sig = st.stops[i], name = sig ? stationName(sig) : t('chooseStation');
      return st.editing === i
        ? `<label class="nt-pill on"><small>${esc(label(i))}</small><input class="nt-q" type="search" placeholder="${esc(name)}" autocomplete="off" spellcheck="false" enterkeyhint="search"></label>`
        : `<button type="button" class="nt-pill${sig ? '' : ' none'}" data-nt="stop" data-i="${i}"><small>${esc(label(i))}</small><b>${esc(name)}</b></button>`;
    }
    const stopHtml = i => `<div class="nt-stop ${role(i)}${st.editing === i ? ' editing' : ''}" data-i="${i}"><i class="nt-dot"></i>${pillHtml(i)}` +
      (role(i) === 'via' ? `<button type="button" class="nt-x" data-nt="novia" aria-label="${esc(t('removeVia'))}">${icon('close', 18)}</button>` : '<span></span>') +
      `<span class="nt-grip" data-grip="${i}" title="${esc(t('dragStop'))}">${icon('grip', 24)}</span></div>` +
      (st.editing === i ? '<div class="rows nt-res"></div>' : '');
    function found(q) {
      const list = q ? findStations(q).slice(0, 8) : [];
      return list.map(s => `<button type="button" class="row" data-pick="${esc(s.sig)}"><span class="r-ic"><i class="ring"></i></span><span class="r-main"><b>${esc(s.name)}</b></span></button>`).join('')
        || (q ? `<p class="empty">${esc(t('noStationFound'))}</p>` : '');
    }
    // The line through the dots, from the first to the last (results under a pill push the ones below it down).
    function line() {
      const route = el?.querySelector('.nt-route'), dots = route?.querySelectorAll('.nt-dot');
      if (!dots || dots.length < 2) return;
      const top = route.getBoundingClientRect().top, mid = d => { const b = d.getBoundingClientRect(); return b.top + b.height / 2 - top; };
      route.style.setProperty('--l0', `${mid(dots[0])}px`);
      route.style.setProperty('--l1', `${mid(dots[dots.length - 1])}px`);
    }
    // While typing, the pill being filled goes to the top of the sheet (at full) and its results right under it, above
    // the keyboard (the keyboard shrinks the page: interactive-widget=resizes-content; visualViewport for a phone that
    // lays it over the page). The room under the results lets the page scroll that far (.nt-room).
    // (only when the pill sits low: one high up stays where it is, the title and its line in view; Max, 2026-11-23:
    // "clicking the search field just removes the long explanatory text")
    const toTop = () => {
      const f = el?.querySelector('.nt-stop.editing');
      if (!f || stack.level < 2 || stack.top() !== key) return;
      const at = f.getBoundingClientRect().top - el.getBoundingClientRect().top;
      if (at > el.clientHeight * 0.4) el.scrollTop += at - el.clientHeight * 0.25;
    };
    const typing = () => { const q = el?.querySelector('.nt-q'); return Boolean(q && document.activeElement === q); };
    const onResize = () => { line(); if (typing()) { toTop(); setTimeout(toTop, 250); } };
    function draw() {
      const n = st.stops.length, from = st.stops[0], to = st.stops[n - 1];
      const can = from && to && from !== to;
      el.innerHTML = `<div class="g-head"><b class="ttl">${esc(t(edit ? 'editTrip' : 'newTrip'))}</b></div><p class="sub">${esc(t(edit ? 'editTripLong' : 'newTripLong'))}</p>` +
        `<div class="nt-route">` +
        st.stops.map((_, i) => stopHtml(i) + (i === 0 && n === 2 ? `<button type="button" class="nt-add" data-nt="addvia">${icon('plus', 16)}${esc(t('addVia'))}</button>` : '')).join('') +
        `</div><button type="button" class="show-only nt-save" data-nt="save"${can ? '' : ' disabled'}>${icon('check', 18)}<span>${esc(t('saveTrip'))}</span></button><i class="nt-room" data-spacer hidden></i>`;
      line();
      const q = el.querySelector('.nt-q'), room = el.querySelector('.nt-room');
      if (q) {
        q.oninput = () => { el.querySelector('.nt-res').innerHTML = found(q.value.trim()); line(); };
        q.onfocus = () => {
          room.hidden = isWide();   // (only where a phone's keyboard may come up: a computer's sheet showed it as empty room)
          if (stack.level < 2) stack.setLevel(2);
          toTop();
          requestAnimationFrame(toTop);
        };
        // Left empty (a tap elsewhere): the pill again, only it (a tap on another pill or its × keeps its target).
        // (Kept while it holds text: a tap on a result blurs the field first, and the room going then would move the
        // result from under the finger.)
        q.onblur = () => {
          if (q.value) return;
          room.hidden = true;
          const i = st.editing;
          setTimeout(() => {
            if (st.editing !== i || !q.isConnected || document.activeElement === q || q.value) return;
            st.editing = -1;
            const s = el.querySelector(`.nt-stop[data-i="${i}"]`);
            s.classList.remove('editing');
            s.querySelector('.nt-pill').outerHTML = pillHtml(i);
            s.nextElementSibling?.classList.contains('nt-res') && s.nextElementSibling.remove();
            line();
          }, 0);
        };
      }
    }
    function save() {
      const n = st.stops.length, from = st.stops[0], to = st.stops[n - 1], mid = n === 3 ? st.stops[1] : null;
      if (!(from && to && from !== to)) return;
      const via = mid && mid !== from && mid !== to ? mid : null;
      const k = edit ? favourites.replaceTrip(edit.key, from, to, via) : favourites.addTrip(from, to, via);
      if (edit && k !== edit.key) { results.delete(edit.key); stack.close(`trip:${edit.key}`); }
      refreshAll();
      if (stack.has(`trip:${k}`)) stack.open(`trip:${k}`);   // (edited: back to its page, drawn again)
      else stack.replace(`trip:${k}`);
    }
    // ---- a pill dragged by its dots: it follows the finger, the others make room (the dashed place) ----
    function dragStart(e) {
      const g = e.target.closest('[data-grip]');
      if (!g || drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      e.stopPropagation();   // (not the sheet's own pull: src/stack.js)
      const i = Number(g.dataset.grip);
      if (st.editing >= 0) { st.editing = -1; draw(); }
      const route = el.querySelector('.nt-route'), s = route.querySelector(`.nt-stop[data-i="${i}"]`);
      route.classList.add('dragging');   // ("Add a change" steps aside meanwhile)
      const rr = route.getBoundingClientRect(), r0 = s.getBoundingClientRect();
      const gap = Object.assign(document.createElement('div'), { className: 'nt-gap' });
      gap.style.height = `${r0.height}px`;
      s.before(gap);
      s.classList.add('lifted');
      Object.assign(s.style, { position: 'absolute', left: '0', right: '0', top: `${r0.top - rr.top}px` });
      drag = { i, s, gap, route, id: e.pointerId, y0: e.clientY, top0: r0.top - rr.top, to: i };
    }
    function dragMove(e) {
      if (!drag || e.pointerId !== drag.id) return;
      if (e.cancelable) e.preventDefault();
      const { s, gap, route } = drag;
      const room = route.clientHeight - s.offsetHeight;
      s.style.top = `${Math.max(-24, Math.min(room + 24, drag.top0 + e.clientY - drag.y0))}px`;
      const b = s.getBoundingClientRect(), mid = b.top + b.height / 2;
      const others = [...route.querySelectorAll('.nt-stop')].filter(x => x !== s);
      let to = others.findIndex((x) => { const r = x.getBoundingClientRect(); return mid < r.top + r.height / 2; });
      if (to < 0) to = others.length;
      if (to !== drag.to) {
        drag.to = to;
        if (to < others.length) others[to].before(gap); else others[others.length - 1].after(gap);
      }
    }
    function dragEnd(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const { i, to } = drag;
      drag = null;
      if (e.type === 'pointerup' && to !== i) { const [x] = st.stops.splice(i, 1); st.stops.splice(to, 0, x); }
      draw();
    }
    const noSheetPull = (e) => { if (e.target.closest('[data-grip]')) e.stopPropagation(); };
    return {
      name: () => t(edit ? 'editTrip' : 'newTrip'), kind: 'newtrip',
      startLevel: 2,   // (opens full: its fields in view, not cut off at half; Max's phone, 2026-11-23)
      // (a phone typing: the screen's full, the room under the results to scroll the field up; the room itself isn't
      // content, src/stack.js data-spacer)
      full: () => (el?.querySelector('.nt-room')?.hidden === false ? Infinity : null),
      mount(page) {
        el = page;
        addEventListener('resize', onResize);
        visualViewport?.addEventListener('resize', onResize);
        el.addEventListener('pointerdown', dragStart);
        el.addEventListener('touchstart', noSheetPull, { passive: true });
        addEventListener('pointermove', dragMove, { passive: false });
        addEventListener('pointerup', dragEnd);
        addEventListener('pointercancel', dragEnd);
        el.addEventListener('click', (e) => {
          const pick = e.target.closest('[data-pick]'), b = e.target.closest('[data-nt]');
          if (pick) {
            if (st.editing < 0) return;
            st.stops[st.editing] = pick.dataset.pick;
            st.editing = st.stops.findIndex(s => !s);
            draw();
            return;
          }
          if (!b) return;
          const f = b.dataset.nt;
          if (f === 'save') { save(); return; }
          // (an added change can be taken away again: Max, 2026-11-23)
          if (f === 'novia') { st.stops.splice(Number(b.closest('.nt-stop').dataset.i), 1); st.editing = -1; draw(); return; }
          if (f === 'addvia') { if (st.stops.length < 3) st.stops.splice(1, 0, null); st.editing = 1; } else st.editing = Number(b.dataset.i);
          draw();
          if (st.editing >= 0) el.querySelector('.nt-q')?.focus({ preventScroll: true });
        });
      },
      show() { draw(); },
      unmount() {
        removeEventListener('resize', onResize); visualViewport?.removeEventListener('resize', onResize);
        removeEventListener('pointermove', dragMove); removeEventListener('pointerup', dragEnd); removeEventListener('pointercancel', dragEnd);
      },
      redraw: () => draw(),
    };
  }

  // ---------- "Add my change": a later stop of the train, then a train leaving there ----------
  // edit: a pinned change ('editchange:<key>', its page's pencil): the same two steps from its first train (its stops
  // asked for here: the train's own page need not be open); the new pair takes the old one's place.
  function addChangePage(key, edit = null) {
    let info = edit ? { number: String(edit.a.number), operational: edit.a.operational, date: edit.a.date, route: null } : trainInfo(key.slice(key.indexOf(':') + 1));
    if (!edit && !info?.route) return null;
    let el = null, at = null, deps = null, failed = false;
    // The stops still ahead where the train arrives (not its first, not cancelled).
    const stops = () => (info.route?.stops ?? []).filter((s, i) => i > 0 && s.advertised && s.activity === 'Ankomst' && !s.canceled && !s.actual);
    const arrAt = sig => { const s = stops().find(x => x.station === sig); return s ? { ...s, number: info.number } : null; };
    function draw() {
      if (!el) return;
      let body;
      if (!info.route) body = stateHtml(failed ? 'error' : 'loading', t(failed ? 'tripNoAnswer' : 'loading'));
      else if (!at) {
        body = `<h4 class="lab">${esc(t('changeWhere'))}</h4><div class="bd">` + (stops().map(s => `<button type="button" class="bd-row" data-stop="${esc(s.station)}"><span class="bd-time">${timeHtml(s)}</span>` +
          `<span class="bd-name"><b>${esc(stationName(s.station))}</b><small>${esc(t('arrives'))}</small></span><span class="bd-tag"></span><span class="tl-trk">${esc(s.track || '')}</span></button>`).join('')
          || `<p class="empty">${esc(t('noStopsAhead'))}</p>`) + '</div>';
      } else {
        const a = arrAt(at);
        const list = deps === null ? stateHtml('loading', t('loading'))
          : deps.filter(d => String(d.number) !== String(info.number) && !boardGone(d, now()) && when(d) >= when(a) - 5 * 60000).slice(0, 16).map((d) => {
            const ch = change(a, d);
            return `<button type="button" class="bd-row${d.canceled ? ' canceled' : ''}" data-dep="${esc(d.key)}"><span class="bd-time">${timeHtml(d)}</span>` +
              `<span class="bd-name"><b>${esc(d.to ? stationName(d.to) : '')}</b><small>${esc(`${d.number} ${d.product ?? ''}`)}</small></span>` +
              `<span class="bd-tag"><span class="chg-min ${changeClass(ch)}">${esc(ch.lost ? t('lostShort') : t('minutesN', ch.minutes))}</span></span><span class="tl-trk">${esc(d.track || '')}</span></button>`;
          }).join('') || `<p class="empty">${esc(t('noDepartures'))}</p>`;
        body = `<p class="sub">${esc(t('arrivesAtTime', stationName(at), hhmm(when(a)), a.track || '–'))}</p><h4 class="lab">${esc(t('changeTo'))}</h4><div class="bd">${list}</div>`;
      }
      el.innerHTML = `<div class="g-head"><span class="r-ic trip">${icon('change', 18)}</span><b class="ttl">${esc(t(edit ? 'editTrip' : 'addChange'))}</b></div>` +
        `<p class="sub">${esc(t('addChangeSub', info.number))}</p>` + body;
    }
    function pinned(item) {
      changeRows.delete(item.key);
      if (!edit) { favourites.addChange(item); refreshAll(); stack.replace(`change:${item.key}`); return; }
      const k = favourites.replaceChange(edit.key, item);
      changeRows.delete(edit.key);
      if (k !== edit.key) stack.close(`change:${edit.key}`);
      refreshAll();
      if (stack.has(`change:${k}`)) stack.open(`change:${k}`);   // (the same pair again: back to its page)
      else stack.replace(`change:${k}`);
    }
    return {
      name: () => t(edit ? 'editTrip' : 'addChange'), kind: 'addchange',
      mount(page) {
        el = page;
        el.addEventListener('click', (e) => {
          const s = e.target.closest('[data-stop]'), d = e.target.closest('[data-dep]');
          if (s) {
            at = s.dataset.stop; deps = null; draw();
            showStation(at);
            day(at, 'Avgang').then((rows) => { deps = rows; draw(); }).catch(() => { deps = []; draw(); });
            return;
          }
          if (d && deps) {
            const row = deps.find(x => x.key === d.dataset.dep);
            if (!row) return;
            const dayNow = swedishDay(now());
            pinned({ key: `${info.number}@${at}>${row.number}/${dayNow}`, day: dayNow, at,
              a: { number: String(info.number), operational: info.operational, date: info.date }, b: { number: String(row.number), operational: row.operational, date: row.date } });
          }
        });
      },
      show() {
        draw();
        if (!info.route && !failed) {
          fetchRoute(info.operational, info.date, info.number).then((route) => { info = { ...info, route }; draw(); }, (e) => { console.warn('my change:', e.message); failed = true; draw(); });
        }
      },
      redraw: () => draw(),
    };
  }

  // define(key) for these kinds, or undefined when the key isn't one of them.
  function define(key) {
    const type = key.split(':')[0];
    if (type === 'trip') return tripPage(key.slice(5));
    if (type === 'change') return changePage(key.slice(7));
    if (type === 'newtrip') return newTripPage(key);
    if (type === 'edittrip') { const trip = favourites.trip(key.slice(9)); return trip ? newTripPage(key, { ...trip }) : null; }
    if (type === 'addchange') return addChangePage(key);
    if (type === 'editchange') { const c = favourites.change(key.slice(11)); return c ? addChangePage(key, { ...c }) : null; }
    return undefined;
  }
  return { define, mineHtml, refresh: refreshAll, drawLine, tripKey };
}
