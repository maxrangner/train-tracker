// A station's board: the next departures or arrivals (settings.boardRows of them), opened by tapping a station on
// the map or picking it in the search. It sits where the train panel does; tapping a row opens that train.
// load(sig, activity) -> Promise of rows (trafikverket.js fetchBoard); stationName(sig) -> name.
// onPickTrain({ id, operational, date, number }); onClose(). isStarred(sig) / onStar(sig) -> starred now: the ☆.
// messages(sig) -> Promise of the station's own messages [{ text }] (what its monitors show; trafikverket.js
// fetchStationMessages), shown above the departures; asked when the board opens and every MESSAGES_MS while open.
const time = t => (t ? hhmm(t) : '');
import { esc } from './html.js';
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

export function createBoard(el, { load, stationName, onPickTrain, onClose, isStarred, onStar, messages = null }) {
  let station = null;     // { sig, name }
  let activity = 'Avgang';
  let timer = null, msgTimer = null;
  let asked = 0;
  let msgs = [];          // the station's own messages
  let msgsOpen = false;   // they are folded into one line (Max, 2026-11-15: they pushed the departures out of sight)
  const msgsHtml = () => (msgs.length ? `<div class="board-msgs"><button type="button" class="board-msgs-toggle" aria-expanded="${msgsOpen}">` +
    `${icon('warning', 17)}<span>${t('messagesCount', msgs.length)}</span>${icon(msgsOpen ? 'chevronUp' : 'chevronDown', 16)}</button>` +
    `<div class="board-msg-list"${msgsOpen ? '' : ' hidden'}>${msgs.map(m => `<div class="board-msg">${esc(m.text)}</div>`).join('')}</div></div>` : '');
  function wireMsgs() {
    const b = el.querySelector('.board-msgs-toggle');
    // Opened, the card goes full height so departures still show under them; folded again, back to its size.
    if (b) b.onclick = () => glide(el, () => { msgsOpen = !msgsOpen; el.classList.toggle('full', msgsOpen); el.querySelector('.board-msgs').outerHTML = msgsHtml(); wireMsgs(); });
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
    el.querySelector('.panel-close').onclick = close;
    const s = el.querySelector('.panel-star');
    if (s) s.onclick = () => { const on = onStar(station.sig); s.outerHTML = star(on); frameWire(); };
    // Departures ⇄ Arrivals: the old rows stay, dimmed, until the new ones are there (Max, 2026-11-15: emptied to
    // "Loading…" and filled again, the card flickered).
    for (const b of el.querySelectorAll('[data-act]')) b.onclick = () => {
      if (b.dataset.act === activity) return;
      activity = b.dataset.act;
      for (const x of el.querySelectorAll('[data-act]')) x.setAttribute('aria-pressed', String(x.dataset.act === activity));
      el.querySelector('.panel-table, .state')?.classList.add('busy');
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
    const n = ++asked;
    if (showLoading) frame(stateHtml('loading', t('loading')));
    let rows;
    try {
      rows = await load(station.sig, activity);
    } catch (e) {
      if (n === asked && station) frame(stateHtml('error', t('boardFailed', e.message)));
      return;
    }
    if (n !== asked || !station) return;
    const dep = activity === 'Avgang';
    const scroll = top ? 0 : el.querySelector('.panel-table')?.scrollTop ?? 0;
    if (!rows.length) { frame(stateHtml('empty', t(dep ? 'noDepartures' : 'noArrivals'))); return; }
    // One row per train, in the train card's style (round 4, 2026-11-15): the planned time (the new one under it in
    // the lateness colour), where it goes (or comes from) with its number and kind, the lateness tag, the track.
    const body = rows.map((r, i) => {
      const seen = r.actual ?? r.estimated;
      const late = seen ? Math.round((seen - r.planned) / 60000) : 0;
      const when = r.canceled ? '' : late > 0 ? `<small class="m ${lateClass(late)}">${time(seen)}</small>` : '';
      const place = dep ? r.to : r.from;
      return `<button type="button" data-i="${i}" class="bd-row${r.canceled ? ' canceled' : ''}"><span class="bd-time">${time(r.planned)}${when}</span>` +
        `<span class="bd-name"><b>${esc(place ? stationName(place) : '')}</b><small>${esc(r.number)} ${esc(r.product ?? '')}</small></span>` +
        `<span class="bd-tag">${r.canceled ? `<span class="tag late">${t('cancelled')}</span>` : late > 0 ? tagHtml(late, { short: true }) : ''}</span>` +
        `<span class="tl-trk">${esc(r.track)}</span></button>`;
    }).join('');
    // From files more than 2 minutes old (home down, plan step 4; Max 2026-11-17: yes): when they were made.
    const stale = rows.asOf && now() - rows.asOf > 2 * 60000 ? `<p class="panel-note">${t('updatedAt', hhmm(rows.asOf))}</p>` : '';
    frame(stale + `<div class="bd-head"><span>${t('time')}</span><span>${t(dep ? 'to' : 'from')}</span><span>${t('track')}</span></div>` +
      `<div class="panel-table bd">${body}</div>`);
    const box = el.querySelector('.panel-table');
    box.scrollTop = scroll;
    for (const b of el.querySelectorAll('.bd-row')) {
      const r = rows[Number(b.dataset.i)];
      b.onclick = () => onPickTrain({ id: r.key, operational: r.operational, date: r.date, number: r.number });
    }
  }

  function open(st) {
    station = { sig: st.sig, name: st.name };
    activity = 'Avgang';
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
