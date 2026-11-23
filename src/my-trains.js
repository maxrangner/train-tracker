// My trains (build plan part 3, ideas 11; Max, 2026-11-22: "today only"; the line above the bar when a trip is saved).
// - A saved trip from -> to (and an optional "via", a change on the way): its page 'trip:<key>' lists today's trains
//   (time, expected time, track, lateness, cancelled ones crossed out), "If it fails: next is 17:08", or "No direct
//   train today"; with a via the pairs with the minutes to change and both tracks, tight in yellow, lost in red.
// - "+ New trip" (Home's Mine) and "Save a trip from here" (a board): the page 'newtrip' / 'newtrip:<from>' picks the
//   stations with a station search. A saved trip's page has Edit ('edittrip:<key>': the same form, filled in) and
//   Delete (two taps).
// - "Add my change" (a train's page): 'addchange:<train id>' picks a later stop of the train, then a train leaving
//   there; the pair is pinned as 'change:<key>' (today only).
// - The line above the bar ('trip', priority 20): the next train of the saved trip (or pinned change) whose next train
//   leaves soonest, "16:52 → Stockholm C · track 4 · +3"; a tap opens it.
// The rows: src/trafikverket.js fetchStationDay (whole-day boards, the files' day kind), each kept a minute; the trains
// matched by src/trips.js. Refreshed about every minute while shown (the line, a trip's page), not while the page is
// hidden.
import { direct, nextTwo, withChange, change, when, lateAt } from './trips.js';
import { favourites, tripKey } from './favourites.js';
import { fetchStationDay, boardGone } from './trafikverket.js';
import { now, hhmm, swedishDay } from './clock.js';
import { t } from './i18n.js';
import { esc } from './html.js';
import { icon } from './icons.js';
import { tagHtml } from './tag.js';
import { stateHtml } from './state.js';

const FRESH_MS = 60 * 1000;     // a station's day is asked again after this
const RETRY_MS = 15 * 1000;     // after a failure
const LIST_MAX = 14;            // trains on a trip's page

// deps: { stack, line, stationName(sig), findStations(text) -> [{ sig, name }], openTrain({ key, operational, date,
//   number }), trainInfo(id) -> { number, operational, date, route } | null, redrawHome() }
export function createMyTrains({ stack, line, stationName, findStations, openTrain, trainInfo, redrawHome }) {
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
        results.set(trip.key, { trains: direct(a, b) });
      } else {
        const [a, c1, c2, b] = await Promise.all([day(trip.from, 'Avgang'), day(trip.via, 'Ankomst'), day(trip.via, 'Avgang'), day(trip.to, 'Ankomst')]);
        results.set(trip.key, { pairs: withChange(a, c1, c2, b) });
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
      return { next, after, none: !r.trains.length };
    }
    const pairs = r.pairs.filter(p => notGone(p.first));
    const { next, after } = nextTwo(pairs.map(p => p.first).sort(byLeaving), now());
    return { next, after, pair: pairs.find(p => p.first === next) ?? null, none: !r.pairs.length };
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
  // A short line for Mine and the line above the bar.
  function summary(trip) {
    const n = nextOf(trip);
    if (n.loading) return { text: t('loading'), at: null };
    if (n.error) return { text: t('tripNoAnswer'), at: null };
    if (!n.next) return { text: t(n.none ? (trip.via ? 'noTripToday' : 'noDirectToday') : 'noMoreToday'), at: null };
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

  // ---------- Mine (src/home.js): the trips, the pinned changes, "+ New trip" ----------
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

  // ---------- the line above the bar ----------
  function drawLine() {
    let best = null;
    for (const trip of favourites.trips) {
      const s = summary(trip);
      if (s.at !== null && (!best || s.at < best.s.at)) best = { key: `trip:${trip.key}`, s, trip };
    }
    for (const c of todayChanges()) {
      const s = changeSummary(c);
      if (s.at !== null && (!best || s.at < best.s.at)) best = { key: `change:${c.key}`, s, c };
    }
    if (!best) { line.clear('trip'); return; }
    const { s } = best;
    const words = best.trip
      ? [`${hhmm(s.dep.planned)} → ${stationName(best.trip.to)}`, trackText(s.track)].filter(Boolean).join(' · ')
      : s.text;
    line.set('trip', { priority: 20, html: `<span class="ln-ic${best.c ? ` ${changeClass(s.ch)}` : ''}">${icon(best.c ? 'change' : 'trip', 16)}</span><span>${esc(words)}</span>` +
      `${s.late > 0 ? tagHtml(s.late, { short: true }) : ''}`, onTap: () => stack.open(best.key) });
  }
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
  const chgBox = (ch, second, rescue = null) => (!second ? `<div class="trip-chg lost">${icon('change', 16)}<span>${esc(t('noOnward'))}</span></div>`
    : `<div class="trip-chg ${changeClass(ch)}">${icon('change', 16)}<span>${esc(changeWords(ch))}</span></div>` +
      (ch?.lost && rescue ? `<div class="trip-chg rescue">${icon('change', 16)}<span>${esc(t('changeRescue', hhmm(when(rescue.second.dep)), rescue.second.number, rescue.change.tracks[1]))}</span></div>` : ''));

  // A saved trip's Edit and Delete (Max, 2026-11-23: saved trips "can't be edited or deleted"). Delete takes two taps:
  // the first turns it red, "Tap again to delete", for DELETE_ARMED_MS; a second tap sooner than DELETE_GAP_MS (a
  // double tap, a finger bouncing) doesn't count.
  const DELETE_ARMED_MS = 4000, DELETE_GAP_MS = 450;
  function tripPage(key) {
    const trip = tripOf(key);
    if (!trip) return null;
    let el = null, armedAt = 0, disarm = 0;
    const armed = () => performance.now() - armedAt < DELETE_ARMED_MS;
    function act(e) {
      const b = e.target.closest('[data-trip]');
      if (!b) return;
      if (b.dataset.trip === 'edit') { stack.open(`edittrip:${trip.key}`); return; }
      const since = performance.now() - armedAt;
      if (since < DELETE_GAP_MS) return;
      if (since < DELETE_ARMED_MS) {
        clearTimeout(disarm);
        favourites.removeTrip(trip.key);
        results.delete(trip.key);
        drawLine();
        redrawHome();
        stack.close(`trip:${trip.key}`);
        return;
      }
      armedAt = performance.now();
      draw();
      clearTimeout(disarm);
      disarm = setTimeout(draw, DELETE_ARMED_MS + 50);
    }
    function draw() {
      if (!el) return;
      const r = results.get(trip.key), n = nextOf(trip);
      const acts = favourites.trip(trip.key) ? `<div class="trip-acts"><button type="button" class="chip" data-trip="edit">${icon('edit', 16)}<span>${esc(t('tripEdit'))}</span></button>` +
        `<button type="button" class="chip trip-del${armed() ? ' armed' : ''}" data-trip="del">${icon('trash', 16)}<span>${esc(t(armed() ? 'tripDeleteAgain' : 'tripDelete'))}</span></button></div>` : '';
      const head = `<div class="g-head"><span class="r-ic trip">${icon('trip', 18)}</span><b class="ttl">${esc(tripName(trip))}</b></div>` +
        `<p class="sub">${esc(trip.via ? t('tripVia', stationName(trip.via)) : t('tripToday'))}</p>${acts}`;
      let body;
      if (!r) body = stateHtml('loading', t('loading'));
      else if (r.error) body = stateHtml('error', t('tripNoAnswer'));
      else if (!n.next) body = stateHtml('empty', t(n.none ? (trip.via ? 'noTripToday' : 'noDirectToday') : 'noMoreToday'));
      else {
        const d = n.next.dep;
        const big = `<div class="trip-next"><small>${esc(t('nextTrain'))}</small><b>${hhmm(d.planned)}${late(d) > 0 ? ` <span class="m ${late(d) >= 6 ? 'late' : 'some'}">${hhmm(when(d))}</span>` : ''}</b>` +
          `<span>${esc([n.next.number, trackText(d.track)].filter(Boolean).join(' · '))}</span>${lateTag(d)}</div>` +
          (n.after ? `<p class="trip-fails">${esc(t('ifItFails', hhmm(when(n.after.dep))))}</p>` : `<p class="trip-fails">${esc(t('lastToday'))}</p>`);
        let list;
        if (r.trains) {
          list = r.trains.filter(notGone).slice(0, LIST_MAX).map(x => legRow(x, trip.to)).join('');
        } else {
          list = r.pairs.filter(p => notGone(p.first)).slice(0, LIST_MAX / 2).map(p => `<div class="trip-pair">${legRow(p.first, trip.via)}${chgBox(p.change, p.second, p.rescue)}` +
            `${p.second ? legRow(p.second, trip.to) : ''}</div>`).join('');
        }
        body = big + `<h4 class="lab">${esc(t('todaysTrains'))}</h4><div class="bd trip-list">${list}</div>`;
      }
      const html = head + body;
      if (el._h !== html) { el.innerHTML = html; el._h = html; }
    }
    return {
      name: () => tripName(trip), kind: 'trip',
      mount(page) { el = page; openRow(el); el.addEventListener('click', act); },
      show() { armedAt = 0; draw(); load(trip).then(() => { draw(); drawLine(); }); },
      every() { if (due(trip)) load(trip).then(draw); else draw(); },
      unmount() { clearTimeout(disarm); },
      star: { on: () => Boolean(favourites.trip(trip.key)),
        toggle: () => { if (favourites.trip(trip.key)) favourites.removeTrip(trip.key); else favourites.addTrip(trip.from, trip.to, trip.via); drawLine(); redrawHome(); draw(); } },
      redraw: () => { if (el) el._h = ''; draw(); },
    };
  }

  function changePage(key) {
    const c = favourites.change(key);
    if (!c) return null;
    let el = null;
    function draw() {
      if (!el) return;
      const r = changeRows.get(c.key);
      const head = `<div class="g-head"><span class="r-ic trip">${icon('change', 18)}</span><b class="ttl">${esc(t('myChange'))}</b></div>` +
        `<p class="sub">${esc(t('changeAt', stationName(c.at)))}</p>`;
      let body;
      if (!r) body = stateHtml('loading', t('loading'));
      else if (!r.arr || !r.dep) body = stateHtml('empty', t('tripNoAnswer'));
      else {
        const ch = change(r.arr, r.dep);
        const row = (x, words) => `<button type="button" class="bd-row${x.canceled ? ' canceled' : ''}" data-train="${trainAttr(x)}"><span class="bd-time">${timeHtml(x)}</span>` +
          `<span class="bd-name"><b>${esc(words)}</b><small>${esc(`${x.number} ${x.product ?? ''}`)}</small></span>` +
          `<span class="bd-tag">${lateTag(x)}</span><span class="tl-trk">${esc(x.track || '')}</span></button>`;
        body = `<div class="trip-next ${changeClass(ch)}"><small>${esc(t('toChange'))}</small><b>${ch.lost ? esc(t('changeLost')) : esc(t('minutesN', ch.minutes))}</b>` +
          `<span>${esc(`${t('trackShort')} ${ch.tracks[0] ?? '–'} → ${ch.tracks[1] ?? '–'}`)}</span></div>` +
          (ch.tight && !ch.lost ? `<p class="trip-fails">${esc(t('changeTight'))}</p>` : '') +
          `<div class="bd trip-list trip-pair">${row(r.arr, t('arrivesAt', stationName(c.at)))}${chgBox(ch, r.dep)}${row(r.dep, t('leavesFrom', stationName(c.at), r.dep.to ? stationName(r.dep.to) : ''))}</div>`;
      }
      const html = head + body;
      if (el._h !== html) { el.innerHTML = html; el._h = html; }
    }
    return {
      name: () => `${c.a.number} → ${c.b.number}`, kind: 'trip',
      mount(page) { el = page; openRow(el); },
      show() { draw(); loadChange(c).then(() => { draw(); drawLine(); }); },
      every() { if (stale(c.at)) loadChange(c).then(draw); else draw(); },
      star: { on: () => Boolean(favourites.change(c.key)),
        toggle: () => { if (favourites.change(c.key)) favourites.removeChange(c.key); else favourites.addChange(c); drawLine(); redrawHome(); } },
      redraw: () => { if (el) el._h = ''; draw(); },
    };
  }

  // ---------- a new trip: From, To and an optional Via, each picked with a station search ----------
  // edit: a saved trip ('edittrip:<key>', its page's Edit): the form filled in; saving puts the new stations in its place.
  function newTripPage(key, edit = null) {
    const from0 = !edit && key.includes(':') ? key.slice(key.indexOf(':') + 1) : null;
    const st = edit ? { from: edit.from, to: edit.to, via: edit.via ?? null, editing: null, wantVia: Boolean(edit.via) }
      : { from: from0, to: null, via: null, editing: from0 ? 'to' : 'from', wantVia: false };
    let el = null;
    // The station search sits right under the field it fills (Max's phone, 2026-11-23: under all the fields it was a
    // tall pill, and the keyboard covered its results).
    const search = `<input class="nt-q board-q" type="search" placeholder="${esc(t('stationPh'))}" autocomplete="off" spellcheck="false" enterkeyhint="search"><div class="rows nt-res"></div>`;
    const field = (f, label) => `<button type="button" class="nt-field${st.editing === f ? ' on' : ''}" data-nt="${f}"><small>${esc(label)}</small>` +
      `<b>${esc(st[f] ? stationName(st[f]) : t('chooseStation'))}</b></button>${st.editing === f ? search : ''}`;
    function found(q) {
      const list = q ? findStations(q).slice(0, 8) : [];
      return list.map(s => `<button type="button" class="row" data-pick="${esc(s.sig)}"><span class="r-ic"><i class="ring"></i></span><span class="r-main"><b>${esc(s.name)}</b></span></button>`).join('')
        || (q ? `<p class="empty">${esc(t('noStationFound'))}</p>` : '');
    }
    // While typing, the field being filled goes to the top of the sheet (at full) and its results right under it, above
    // the keyboard (the keyboard shrinks the page: interactive-widget=resizes-content; visualViewport for a phone that
    // lays it over the page). The room under the results lets the page scroll that far (.nt-room).
    const toTop = () => {
      const f = el?.querySelector('.nt-field.on');
      if (!f || stack.level < 2 || stack.top() !== key) return;
      el.scrollTop += f.getBoundingClientRect().top - el.getBoundingClientRect().top - 6;
    };
    const typing = () => { const q = el?.querySelector('.nt-q'); return Boolean(q && document.activeElement === q); };
    const onResize = () => { if (typing()) { toTop(); setTimeout(toTop, 250); } };
    function draw() {
      const can = st.from && st.to && st.from !== st.to;
      el.innerHTML = `<b class="ttl">${esc(t(edit ? 'editTrip' : 'newTrip'))}</b><p class="sub">${esc(t(edit ? 'editTripLong' : 'newTripLong'))}</p><div class="nt-fields">` +
        field('from', t('tripFrom')) + field('to', t('tripTo')) +
        (st.wantVia || st.via ? field('via', t('tripViaLabel')) : `<button type="button" class="chip nt-addvia" data-nt="addvia">${icon('plus', 16)}${esc(t('addVia'))}</button>`) + '</div>' +
        `<button type="button" class="show-only nt-save" data-nt="save"${can ? '' : ' disabled'}>${icon('check', 18)}<span>${esc(t('saveTrip'))}</span></button><i class="nt-room" hidden></i>`;
      const q = el.querySelector('.nt-q'), room = el.querySelector('.nt-room');
      if (q) {
        q.oninput = () => { el.querySelector('.nt-res').innerHTML = found(q.value.trim()); };
        q.onfocus = () => {
          room.hidden = false;
          if (stack.level < 2) stack.setLevel(2);
          toTop();
          requestAnimationFrame(toTop);
        };
        // (kept while it holds text: a tap on a result blurs the field first, and the room going then would move the
        // result from under the finger)
        q.onblur = () => { if (!q.value) room.hidden = true; };
      }
    }
    function save() {
      if (!(st.from && st.to && st.from !== st.to)) return;
      const via = st.via && st.via !== st.from && st.via !== st.to ? st.via : null;
      const k = edit ? favourites.replaceTrip(edit.key, st.from, st.to, via) : favourites.addTrip(st.from, st.to, via);
      if (edit && k !== edit.key) { results.delete(edit.key); stack.close(`trip:${edit.key}`); }
      refreshAll();
      if (stack.has(`trip:${k}`)) stack.open(`trip:${k}`);   // (edited: back to its page, drawn again)
      else stack.replace(`trip:${k}`);
    }
    return {
      name: () => t(edit ? 'editTrip' : 'newTrip'), kind: 'newtrip',
      mount(page) {
        el = page;
        addEventListener('resize', onResize);
        visualViewport?.addEventListener('resize', onResize);
        el.addEventListener('click', (e) => {
          const pick = e.target.closest('[data-pick]'), b = e.target.closest('[data-nt]');
          if (pick) {
            st[st.editing] = pick.dataset.pick;
            st.editing = !st.from ? 'from' : !st.to ? 'to' : null;
            draw();
            return;
          }
          if (!b) return;
          const f = b.dataset.nt;
          if (f === 'save') { save(); return; }
          if (f === 'addvia') { st.wantVia = true; st.editing = 'via'; } else st.editing = st.editing === f ? null : f;
          draw();
          if (st.editing) el.querySelector('.nt-q')?.focus({ preventScroll: true });
        });
      },
      show() { draw(); },
      unmount() { removeEventListener('resize', onResize); visualViewport?.removeEventListener('resize', onResize); },
      redraw: () => draw(),
    };
  }

  // ---------- "Add my change": a later stop of the train, then a train leaving there ----------
  function addChangePage(key) {
    const id = key.slice(key.indexOf(':') + 1), info = trainInfo(id);
    if (!info?.route) return null;
    let el = null, at = null, deps = null;
    // The stops still ahead where the train arrives (not its first, not cancelled).
    const stops = info.route.stops.filter((s, i) => i > 0 && s.advertised && s.activity === 'Ankomst' && !s.canceled && !s.actual);
    const arrAt = sig => { const s = stops.find(x => x.station === sig); return s ? { ...s, number: info.number } : null; };
    function draw() {
      let body;
      if (!at) {
        body = `<h4 class="lab">${esc(t('changeWhere'))}</h4><div class="bd">` + (stops.map(s => `<button type="button" class="bd-row" data-stop="${esc(s.station)}"><span class="bd-time">${timeHtml(s)}</span>` +
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
      el.innerHTML = `<div class="g-head"><span class="r-ic trip">${icon('change', 18)}</span><b class="ttl">${esc(t('addChange'))}</b></div>` +
        `<p class="sub">${esc(t('addChangeSub', info.number))}</p>` + body;
    }
    return {
      name: () => t('addChange'), kind: 'addchange',
      mount(page) {
        el = page;
        el.addEventListener('click', (e) => {
          const s = e.target.closest('[data-stop]'), d = e.target.closest('[data-dep]');
          if (s) {
            at = s.dataset.stop; deps = null; draw();
            day(at, 'Avgang').then((rows) => { deps = rows; draw(); }).catch(() => { deps = []; draw(); });
            return;
          }
          if (d && deps) {
            const row = deps.find(x => x.key === d.dataset.dep);
            if (!row) return;
            const dayNow = swedishDay(now());
            const item = { key: `${info.number}@${at}>${row.number}/${dayNow}`, day: dayNow, at,
              a: { number: String(info.number), operational: info.operational, date: info.date }, b: { number: String(row.number), operational: row.operational, date: row.date } };
            favourites.addChange(item);
            changeRows.delete(item.key);
            refreshAll();
            stack.replace(`change:${item.key}`);
          }
        });
      },
      show() { draw(); },
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
    return undefined;
  }
  return { define, mineHtml, refresh: refreshAll, drawLine, tripKey };
}
