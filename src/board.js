// A station's board: the next departures or arrivals (settings.boardRows of them), opened by tapping a station on
// the map or picking it in the search. It sits where the train panel does; tapping a row opens that train.
// load(sig, activity) -> Promise of rows (trafikverket.js fetchBoard); stationName(sig) -> name.
// onPickTrain({ id, operational, date, number }); onClose(). isStarred(sig) / onStar(sig) -> starred now: the ☆.
const time = t => (t ? new Date(t).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '');
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const REFRESH_MS = 30000;

import { star } from './panel.js';

export function createBoard(el, { load, stationName, onPickTrain, onClose, isStarred, onStar }) {
  let station = null;     // { sig, name }
  let activity = 'Avgang';
  let timer = null;
  let asked = 0;

  function close() {
    if (!station) return;
    station = null;
    clearInterval(timer);
    el.hidden = true;
    el.innerHTML = '';
    onClose?.();
  }

  function frame(body) {
    const dep = activity === 'Avgang';
    el.innerHTML =
      `<div class="panel-head"><strong>${esc(station.name)}</strong><span class="panel-buttons">` +
      (isStarred ? star(isStarred(station.sig)) : '') +
      `<button class="panel-close" type="button" aria-label="Close">×</button></span></div>` +
      `<div class="board-tabs" role="group" aria-label="Departures or arrivals">` +
      `<button type="button" data-act="Avgang" aria-pressed="${dep}">Departures</button>` +
      `<button type="button" data-act="Ankomst" aria-pressed="${!dep}">Arrivals</button></div>` + body;
    el.querySelector('.panel-close').onclick = close;
    const s = el.querySelector('.panel-star');
    if (s) s.onclick = () => { const on = onStar(station.sig); s.outerHTML = star(on); frameWire(); };
    for (const b of el.querySelectorAll('[data-act]')) b.onclick = () => { if (b.dataset.act !== activity) { activity = b.dataset.act; refresh(true); } };
  }

  function frameWire() {
    const s = el.querySelector('.panel-star');
    if (s) s.onclick = () => { const on = onStar(station.sig); s.outerHTML = star(on); frameWire(); };
  }

  async function refresh(showLoading = false) {
    if (!station) return;
    const n = ++asked;
    if (showLoading) frame('<p class="panel-note">Loading…</p>');
    let rows;
    try {
      rows = await load(station.sig, activity);
    } catch (e) {
      if (n === asked && station) frame(`<p class="panel-note">Couldn't load the board: ${esc(e.message)}</p>`);
      return;
    }
    if (n !== asked || !station) return;
    const dep = activity === 'Avgang';
    const scroll = el.querySelector('.panel-table')?.scrollTop ?? 0;
    if (!rows.length) { frame(`<p class="panel-note">No ${dep ? 'departures' : 'arrivals'} in the next hours.</p>`); return; }
    const body = rows.map((r, i) => {
      const seen = r.actual ?? r.estimated;
      const late = seen ? Math.round((seen - r.planned) / 60000) : 0;
      const when = r.canceled ? '<span class="late">Cancelled</span>'
        : late > 0 ? `<span class="late">${time(seen)}</span>` : '';
      const place = dep ? r.to : r.from;
      return `<tr data-i="${i}" class="${r.canceled ? 'canceled' : ''}"><td class="t">${time(r.planned)}${when ? `<br>${when}` : ''}</td>` +
        `<td class="st">${esc(place ? stationName(place) : '')}<div class="sub">${esc(r.number)} ${esc(r.product ?? '')}</div></td>` +
        `<td class="trk">${esc(r.track)}</td></tr>`;
    }).join('');
    frame(`<div class="panel-table"><table class="board"><thead><tr><th>Time</th><th>${dep ? 'To' : 'From'}</th><th>Track</th></tr></thead>` +
      `<tbody>${body}</tbody></table></div>`);
    const box = el.querySelector('.panel-table');
    box.scrollTop = scroll;
    for (const tr of el.querySelectorAll('tr[data-i]')) {
      const r = rows[Number(tr.dataset.i)];
      tr.onclick = () => onPickTrain({ id: r.key, operational: r.operational, date: r.date, number: r.number });
    }
  }

  function open(st) {
    station = { sig: st.sig, name: st.name };
    activity = 'Avgang';
    el.hidden = false;
    refresh(true);
    clearInterval(timer);
    timer = setInterval(refresh, REFRESH_MS);
  }

  return { open, close, get openSig() { return station?.sig ?? null; } };
}
