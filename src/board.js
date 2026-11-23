// A station's board: the next departures or arrivals (settings.boardRows of them), opened by tapping a station on
// the map or picking it in the search. It sits where the train panel does; tapping a row opens that train.
// load(sig, activity) -> Promise of rows (trafikverket.js fetchBoard); stationName(sig) -> name.
// onPickTrain({ id, operational, date, number }); onClose(). isStarred(sig) / onStar(sig) -> starred now: the ☆.
// messages(sig) -> Promise of the station's own messages [{ text }] (what its monitors show; trafikverket.js
// fetchStationMessages), shown above the departures; asked when the board opens and every MESSAGES_MS while open.
// loadDay(sig, activity) -> Promise of the station's whole day (trafikverket.js fetchStationDay): the search beside
// Departures / Arrivals (Max, 2026-11-21: "Search for all day, numbers, destinations, maybe not time, that the user can
// scroll to"): the card goes full, the whole day in a list scrolled to now (gone trains dimmed), a train number or a
// destination (arrivals: where it comes from) typed narrows it; the search button again closes it.
const time = t => (t ? hhmm(t) : '');
import { esc } from './html.js';
import { arrive } from './motion.js';
const REFRESH_MS = 30000;
const MESSAGES_MS = 5 * 60 * 1000;

import { star } from './panel.js';
import { tagHtml } from './tag.js';
import { stateHtml } from './state.js';
import { lateClass } from './lateness.js';
import { icon } from './icons.js';
import { hhmm, now } from './clock.js';
import { t } from './i18n.js';
import { glide } from './sheet.js';

// onCloseTap(): what its × does in the one sheet (src/stack.js: the page goes; the × is hidden, kept for the tools).
export function createBoard(el, { load, loadDay = null, stationName, onPickTrain, onClose, onCloseTap, isStarred, onStar, messages = null }) {
  let station = null;     // { sig, name }
  let activity = 'Avgang';
  let rowsSeen = new Set();   // the rows shown since the board or its tab opened (their trains' keys)
  let timer = null, msgTimer = null;
  let asked = 0;
  let msgs = [];          // the station's own messages
  let msgsOpen = false;   // they are folded into one line (Max, 2026-11-15: they pushed the departures out of sight)
  let finding = false, query = '', dayRows = null, dayFor = '', dayAt = 0;   // the search (see the top)
  let closingFind = null;   // the search closed: the board's rows, once in, glide the card back in one go ({ full })
  // The card's size before its messages or the search made it full: closing them returns there (Max, 2026-11-21: "if
  // cancelling search then the card contracts even though it was manually expanded before"; the messages the same).
  let ownFull = false;
  const forced = () => msgsOpen || finding;
  const backTo = () => el.classList.contains('full') && ownFull;   // (compacted by hand meanwhile: stays compact)
  const DAY_MS = 2 * 60 * 1000;   // the whole day asked again at most this often while searching (Stockholm C: ~400 kB)
  const msgsHtml = () => (msgs.length ? `<div class="board-msgs"><button type="button" class="board-msgs-toggle" aria-expanded="${msgsOpen}">` +
    `${icon('warning', 17)}<span>${t('messagesCount', msgs.length)}</span>${icon(msgsOpen ? 'chevronUp' : 'chevronDown', 16)}</button>` +
    `<div class="board-msg-list"${msgsOpen ? '' : ' hidden'}>${msgs.map(m => `<div class="board-msg">${esc(m.text)}</div>`).join('')}</div></div>` : '');
  function wireMsgs() {
    const b = el.querySelector('.board-msgs-toggle');
    // Opened, the card goes full height so departures still show under them; folded again, back to its size.
    if (b) b.onclick = () => {
      if (!forced()) ownFull = el.classList.contains('full');
      const full = !msgsOpen || finding || backTo();
      glide(el, () => { msgsOpen = !msgsOpen; el.classList.toggle('full', full); el.querySelector('.board-msgs').outerHTML = msgsHtml(); wireMsgs(); });
    };
  }
  async function askMessages() {
    if (!station || !messages) return;
    const sig = station.sig;
    try {
      const got = await messages(sig);
      if (station?.sig !== sig) return;
      msgs = got;
      const box = el.querySelector('.board-msgs');
      if (box) box.outerHTML = msgsHtml() || '<div class="board-msgs" hidden></div>';
      else if (msgs.length) el.querySelector('.panel-head')?.insertAdjacentHTML('afterend', msgsHtml());
      wireMsgs();
    } catch (e) { console.warn('station messages:', e.message); }
  }

  function close() {
    if (!station) return;
    station = null;
    finding = false; dayRows = null;
    hold(false);
    el.classList.remove('finding');
    msgs = [];
    clearInterval(timer);
    clearInterval(msgTimer);
    el.hidden = true;
    el.innerHTML = '';
    onClose?.();
  }

  function frame(body) {
    const dep = activity === 'Avgang';
    el.innerHTML =
      `<div class="panel-head"><strong>${esc(station.name)}</strong><span class="panel-buttons">` +
      (isStarred ? star(isStarred(station.sig)) : '') +
      `<button class="panel-close" type="button" aria-label="${t('close')}">${icon('close')}</button></span></div>` + msgsHtml() +
      `<div class="seg board-tabs" role="group" aria-label="${t('depOrArr')}">` +
      `<button type="button" data-act="Avgang" aria-pressed="${dep}">${t('departures')}</button>` +
      `<button type="button" data-act="Ankomst" aria-pressed="${!dep}">${t('arrivals')}</button></div>` + body;
    if (loadDay) {   // the search button beside the tabs
      const tabs = el.querySelector('.board-tabs');
      tabs.insertAdjacentHTML('afterend', `<button type="button" class="board-find" aria-pressed="${finding}" aria-label="${t(finding ? 'boardFindClose' : 'boardFind')}">${icon(finding ? 'close' : 'search', 18)}</button>`);
      const row = document.createElement('div');
      row.className = 'board-tabrow';
      tabs.before(row);
      row.append(tabs, el.querySelector('.board-find'));
      el.querySelector('.board-find').onclick = () => (finding ? stopFind() : startFind());
    }
    el.querySelector('.panel-close').onclick = () => (onCloseTap ? onCloseTap() : close());
    const s = el.querySelector('.panel-star');
    if (s) s.onclick = () => { const on = onStar(station.sig); s.outerHTML = star(on); frameWire(); };
    // Departures ⇄ Arrivals: the old rows stay, dimmed, until the new ones are there (Max, 2026-11-15: emptied to
    // "Loading…" and filled again, the card flickered).
    for (const b of el.querySelectorAll('[data-act]')) b.onclick = () => {
      if (b.dataset.act === activity) return;
      activity = b.dataset.act;
      rowsSeen = new Set();
      for (const x of el.querySelectorAll('[data-act]')) x.setAttribute('aria-pressed', String(x.dataset.act === activity));
      el.querySelector('.panel-table, .state')?.classList.add('busy');
      if (finding) { dayRows = null; findRefresh({ toNow: true }); return; }
      refresh(false, { top: true });
    };
    wireMsgs();
  }

  function frameWire() {
    const s = el.querySelector('.panel-star');
    if (s) s.onclick = () => { const on = onStar(station.sig); s.outerHTML = star(on); frameWire(); };
  }

  // top: start at the top of the list (a switch to the other tab).
  async function refresh(showLoading = false, { top = false } = {}) {
    if (!station) return;
    if (finding) { if (Date.now() - dayAt > DAY_MS) findRefresh(); return; }
    const n = ++asked;
    if (showLoading) frame(stateHtml('loading', t('loading')));
    // The search just closed: the card keeps the day (dimmed) until the board's rows are in, then glides to them once
    // (Max, 2026-11-21: it "jumps around": it shrank to "Laddar…", then jumped up and glided again).
    const paint = (fn) => {
      if (!closingFind) { fn(); return; }
      const { full } = closingFind;
      closingFind = null;
      glide(el, () => { el.classList.remove('finding'); el.classList.toggle('full', full); fn(); });
    };
    let rows;
    try {
      rows = await load(station.sig, activity);
    } catch (e) {
      if (n === asked && station) paint(() => frame(stateHtml('error', t('boardFailed', e.message))));
      return;
    }
    if (n !== asked || !station) return;
    const dep = activity === 'Avgang';
    const scroll = top ? 0 : el.querySelector('.panel-table')?.scrollTop ?? 0;
    if (!rows.length) { paint(() => frame(stateHtml('empty', t(dep ? 'noDepartures' : 'noArrivals')))); return; }
    // One row per train, in the train card's style (round 4, 2026-11-15): the planned time (the new one under it in
    // the lateness colour), where it goes (or comes from) with its number and kind, the lateness tag, the track.
    const body = rows.map((r, i) => rowHtml(r, i, dep)).join('');
    // From files more than 2 minutes old (home down, plan step 4; Max 2026-11-17: yes): when they were made.
    const stale = rows.asOf && now() - rows.asOf > 2 * 60000 ? `<p class="panel-note">${t('updatedAt', hhmm(rows.asOf))}</p>` : '';
    paint(() => frame(stale + `<div class="bd-head"><span>${t('time')}</span><span>${t(dep ? 'to' : 'from')}</span><span>${t('track')}</span></div>` +
      `<div class="panel-table bd">${body}</div>`));
    const box = el.querySelector('.panel-table');
    box.scrollTop = scroll;
    for (const b of el.querySelectorAll('.bd-row')) {
      const r = rows[Number(b.dataset.i)];
      b.onclick = () => onPickTrain({ id: r.key, operational: r.operational, date: r.date, number: r.number });
    }
    // Rows that weren't on the board before come in one after another (Max's pick 6, 2026-11-20): the refresh each
    // minute moves only new trains. rowsSeen: since the board (or its tab) opened.
    arrive(el.querySelectorAll('.bd-row'), rowsSeen, b => rows[Number(b.dataset.i)].key ?? b.textContent);
  }

  // ---- The search: the station's whole day ----
  // Opened: the station's messages fold (the field stays above the phone's keyboard; Max, 2026-11-21), the card goes
  // full in one glide, the board's rows stay (dimmed) until the day is in: nothing empties to "Laddar…" on the way.
  // While the day comes, the card keeps at least the height it had (2026-11-23, sheet-moves-check: with its messages
  // open the card went 1004 → 938 px as they folded, then 11528 px with the day: a dip, then up). Let go once the day is
  // drawn (or failed, or the search closed).
  const hold = (on) => { el.style.minHeight = on ? `${Math.round(el.getBoundingClientRect().height)}px` : ''; };
  function startFind() {
    if (!forced()) ownFull = el.classList.contains('full');
    finding = true; query = ''; closingFind = null;
    const old = el.querySelector('.bd-head') ? `<div class="busy">${el.querySelector('.bd-head').outerHTML}${el.querySelector('.panel-table')?.outerHTML ?? ''}</div>` : '';
    msgsOpen = false;
    hold(true);
    glide(el, () => { el.classList.add('full', 'finding'); frame(findHtml(old || stateHtml('loading', t('loading')))); wireFind(); });
    el.querySelector('.board-q')?.focus();
    findRefresh({ toNow: true });
  }
  // Closed: the day stays (dimmed) until the board's rows are in, then one glide back (refresh's paint).
  function stopFind() {
    hold(false);
    closingFind = { full: backTo() };
    finding = false; dayRows = null;
    el.querySelector('.board-qrow')?.remove();
    el.querySelector('.board-found')?.classList.add('busy');
    const b = el.querySelector('.board-find');
    if (b) { b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', t('boardFind')); b.innerHTML = icon('search', 18); }
    refresh(false, { top: true });
  }
  const findHtml = list => `<div class="board-qrow"><input class="board-q" type="search" enterkeyhint="search" autocomplete="off" ` +
    `placeholder="${t(activity === 'Avgang' ? 'boardFindPh' : 'boardFindPhArr')}" aria-label="${t('boardFind')}" value="${esc(query)}"></div>` +
    `<div class="board-found">${list}</div>`;
  function wireFind() {
    const q = el.querySelector('.board-q');
    if (q) q.oninput = () => { query = q.value; drawFound({ toNow: true }); };
  }
  // The day asked again each time the board would refresh (30 s); the list keeps where it was scrolled.
  async function findRefresh({ toNow = false } = {}) {
    const sig = station?.sig, act = activity, n = ++asked;
    try {
      const rows = await loadDay(sig, act);
      if (n !== asked || !finding || station?.sig !== sig || act !== activity) return;
      dayRows = rows; dayFor = `${sig}|${act}`; dayAt = Date.now();
    } catch (e) {
      if (n === asked && finding) { hold(false); const f = el.querySelector('.board-found'); if (f) f.innerHTML = stateHtml('error', t('boardFailed', e.message)); }
      return;
    }
    if (!el.querySelector('.board-q')) { frame(findHtml('')); wireFind(); }
    el.querySelector('.board-found')?.classList.remove('busy');
    drawFound({ toNow });
    hold(false);
  }
  // A train number (its start) or a destination's name (any part; arrivals: where it comes from).
  function drawFound({ toNow = false } = {}) {
    const box = el.querySelector('.board-found');
    if (!box || !dayRows) return;
    const dep = activity === 'Avgang', q = query.trim().toLocaleLowerCase('sv');
    const digits = /^\d+$/.test(q);
    const list = dayRows.map((r, i) => [r, i]).filter(([r]) => !q || (digits ? String(r.number ?? '').startsWith(q)
      : stationName((dep ? r.to : r.from) ?? '').toLocaleLowerCase('sv').includes(q)));
    const old = box.querySelector('.panel-table')?.scrollTop ?? 0;
    box.innerHTML = list.length ? (dayRows.partial ? `<p class="panel-note">${t('boardFindPartial')}</p>` : '') +
      `<div class="bd-head"><span>${t('time')}</span><span>${t(dep ? 'to' : 'from')}</span><span>${t('track')}</span></div>` +
      `<div class="panel-table bd">${list.map(([r, i]) => rowHtml(r, i, dep, r.gone)).join('')}</div>`
      : stateHtml('empty', t('boardFindNone'));
    for (const b of box.querySelectorAll('.bd-row')) {
      const r = dayRows[Number(b.dataset.i)];
      b.onclick = () => onPickTrain({ id: r.key, operational: r.operational, date: r.date, number: r.number });
    }
    const table = box.querySelector('.panel-table');
    if (!table) return;
    if (toNow) {   // the first train not gone at the top
      const next = table.querySelector('.bd-row:not(.gone)');
      table.scrollTop = next ? next.offsetTop : table.scrollHeight;   // (the table is the rows' offsetParent)
      // In the one sheet (2026-11-22) the table doesn't scroll itself: its page does (src/stack.js, at full height).
      // (2026-11-23, stats-board-check: the search opened at the day's first trains, the next one far below.)
      const page = table.scrollHeight <= table.clientHeight + 1 ? table.closest('.pg') : null;
      if (page && next) page.scrollTop += next.getBoundingClientRect().top - page.getBoundingClientRect().top - 4;
    } else table.scrollTop = old;
  }

  // One row, in the train card's style (round 4, 2026-11-15): the planned time (the new one under it in the lateness
  // colour), where it goes (or comes from) with its number and kind, the lateness tag, the track. gone: dimmed (the search).
  function rowHtml(r, i, dep, gone = false) {
    const seen = r.actual ?? r.estimated;
    const late = seen ? Math.round((seen - r.planned) / 60000) : 0;
    const when = r.canceled ? '' : late > 0 ? `<small class="m ${lateClass(late)}">${time(seen)}</small>` : '';
    const place = dep ? r.to : r.from;
    return `<button type="button" data-i="${i}" class="bd-row${r.canceled ? ' canceled' : ''}${gone ? ' gone' : ''}"><span class="bd-time">${time(r.planned)}${when}</span>` +
      `<span class="bd-name"><b>${esc(place ? stationName(place) : '')}</b><small>${esc(r.number)} ${esc(r.product ?? '')}</small></span>` +
      `<span class="bd-tag">${r.canceled ? `<span class="tag late">${t('cancelled')}</span>` : late > 0 ? tagHtml(late, { short: true }) : ''}</span>` +
      `<span class="tl-trk">${esc(r.track)}</span></button>`;
  }

  function open(st) {
    station = { sig: st.sig, name: st.name };
    finding = false; query = ''; dayRows = null; closingFind = null; ownFull = false;
    hold(false);
    // (opened anew it is compact: a 'full' left from the last station's search raised the sheet to full on the way back
    // from a train, and again on any later change of the card's classes, also during a pull down: 2026-11-23)
    el.classList.remove('finding', 'full');
    activity = 'Avgang';
    rowsSeen = new Set();
    msgs = [];
    msgsOpen = false;
    el.hidden = false;
    refresh(true);
    clearInterval(timer);
    // Not while the page is hidden (another app in front, the phone locked; Codex's beta review point 6): wake() then.
    timer = setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
    askMessages();
    clearInterval(msgTimer);
    if (messages) msgTimer = setInterval(() => { if (!document.hidden) askMessages(); }, MESSAGES_MS);
  }

  // Load and draw it again (Settings: language or number of rows changed).
  const relabel = () => { if (station) refresh(); };
  // Back in front (src/main.js visibilitychange): the open board at once, not at its next refresh.
  const wake = relabel;

  return { open, close, relabel, wake, get openSig() { return station?.sig ?? null; } };
}
