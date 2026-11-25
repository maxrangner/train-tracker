// A train's page in the sheet: its card (src/panel.js, one #panel moved into whichever train page shows), the camera
// following it, its head buttons gliding to a new layout, and under its tiles "Why are we standing?", "Add my change"
// and Share's note. Also opening a train from the map, the search, a board or a star.
//
// createTrainPages({ trains, panel, panelEl, map, route, frame, speedLog, stations, disruptions, live, lateOf,
//   minutesOf, labelFor, buzz, follow, holder, favourites, stack, net, now, drawDelay }) -> { define(id), open(id, opts), pick(t),
//   pickFavourite(number), remember(t), metaOf(id), extras(id), info(box, c), trainInfo(id), handover(), why(id),
//   stoodFor(id) }; stack is a getter.
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { esc } from '../html.js';
import { hhmm } from '../clock.js';
import { isWide } from '../layout.js';
import { reduceMotion, easing, speed } from '../motion.js';
import { drawInfo } from '../train-info.js';
import { shareTrain } from '../share.js';
import { whyStanding, whyLate, LATE_MIN, WHY_AFTER_MS } from '../why-standing.js';
import { STAND_SPEED } from '../trains.js';
import { fetchRunsByNumber, pickRun } from '../trafikverket.js';

const HEAD_BTNS = '#panel .panel-head :is(.panel-info, .sh-act, .sh-star, .sh-follow)';
const HEAD_GLIDE_MS = 280;
const CARD_GAP = 4;            // under "More" (20, then 10 were too much on Max's phone)
const SHARE_NOTE_MS = 6000;    // "Link copied" goes after this
const STILL_KMH = 2, STILL_M = 40;   // a train stands while its reports are slower than this, or this close (no speed sent)

// Where the card's head buttons are (each from the head's top; ic: where its icon sits in it).
function headPlaces(panelEl) {
  const head = panelEl.querySelector('.panel-head');
  if (!head) return null;
  const top = head.getBoundingClientRect().top, was = new Map();
  for (const b of panelEl.querySelectorAll(HEAD_BTNS)) {
    const r = b.getBoundingClientRect();
    const ic = b.querySelector('svg')?.getBoundingClientRect().left;
    if (r.width) was.set(b, { x: r.left, y: r.top - top, w: r.width, ic: ic === undefined ? 0 : ic - r.left });
  }
  return was;
}
// The head's buttons glide to where the new height puts them: each from where it was; Follow narrows into its icon and
// widens back (src/css/train-card.css .sh-follow.morph); one that comes grows in, one that goes shrinks away where it was.
function glideHead(panelEl, was) {
  const now = headPlaces(panelEl);
  if (!now || reduceMotion()) return;
  const timing = { duration: HEAD_GLIDE_MS * speed(), easing: easing('ui') };
  const head = panelEl.querySelector('.panel-head'), hb = head.getBoundingClientRect();
  for (const [b, from] of was) {
    if (now.has(b) || !b.isConnected) continue;
    b.classList.add('leaving');
    b.style.left = `${from.x - hb.left}px`; b.style.top = `${from.y}px`;
    b.animate([{ scale: 1 }, { scale: 0 }], timing).finished.catch(() => {}).then(() => { b.classList.remove('leaving'); b.style.left = ''; b.style.top = ''; });
  }
  for (const [b, to] of now) {
    const from = was.get(b);
    b.getAnimations().forEach(a => a.cancel());
    if (!from) { b.animate([{ scale: 0 }, { scale: 1 }], timing); continue; }
    const dx = from.x - to.x, dy = from.y - to.y;
    if (b.classList.contains('sh-follow') && Math.abs(from.w - to.w) > 1) {
      // (its width changes while its place in the row keeps its new width: the buttons beside it don't move twice)
      b.classList.add('morph');
      const a = b.animate([
        { width: `${from.w}px`, marginLeft: `${to.w - from.w}px`, paddingLeft: `${from.ic}px` },
        { width: `${to.w}px`, marginLeft: '0px', paddingLeft: `${to.ic}px` },
      ], timing);
      a.finished.catch(() => {}).then(() => b.classList.remove('morph'));
      continue;
    }
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) b.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], timing);
  }
}

export function createTrainPages(ctx) {
  const { trains, panel, panelEl, map, route, frame, speedLog, stations, disruptions, live, lateOf, minutesOf, labelFor, buzz, follow, holder, favourites, now, drawDelay } = ctx;
  const trainMeta = new Map();   // trains opened that aren't on the map (the timetable, a board): id -> { operational, date, number }
  let headWas = null;
  let shareNote = null;          // { id, how: 'copied' | 'shown', url, at }: under the buttons, in the card
  const extrasEl = Object.assign(document.createElement('div'), { className: 'tr-extras' });

  function trainPage(id) {
    const meta = () => {
      const r = trains.get(id);
      if (r) return { id: r.id, operational: r.operational, date: r.date, number: r.number, label: labelFor(r), onMap: true };
      const m = trainMeta.get(id);
      return m ? { ...m, id, label: String(m.number), onMap: false } : null;
    };
    const m0 = meta();
    if (!m0) return null;
    let myEl = null;   // this train's page: the card goes back to the holder only from here
    let wantHalf = 0, wantLow = 0;   // the card's half and low, last measured while compact
    const number = () => String(meta()?.number ?? m0.number);
    // (its content in: "More", or an empty or error state; until then null, the sheet waits where it is: no bounce)
    const cardIn = () => Boolean(panelEl.querySelector('.panel-more, .state.empty, .state.error'));
    // How far down the card goes (px from the page's top edge): whole, to "More", or condensed (its head line).
    function cardTo(whole) {
      const pg = panelEl.parentElement;
      if (panel.openId !== id || !pg?.classList.contains('pg') || panelEl.classList.contains('full')) return whole ? wantHalf : wantLow;
      const top = pg.getBoundingClientRect().top - pg.scrollTop;
      const below = el => (el && el.offsetParent ? el.getBoundingClientRect().bottom - top : 0);
      if (whole && !cardIn()) return null;
      if (!whole) {
        const b = below(panelEl.querySelector('.panel-head'));
        if (b > 0) wantLow = Math.ceil(b + 12);
        return wantLow;
      }
      const b = below(panelEl.querySelector('.panel-more')) || below(panelEl);
      if (b > 0) wantHalf = Math.ceil((b + CARD_GAP) / 4) * 4;
      return wantHalf;
    }
    return {
      name: number, kind: 'train',
      show(el, { prev, dir, go = false, again = false, level }) {
        const stack = ctx.stack;
        myEl = el;
        el.append(panelEl);
        const m = meta() ?? m0;
        if (panel.openId !== id) panel.open(m, { follow: m.onMap });
        else if (panel.hidden) panel.show();
        // (a train just opened starts compact; back to it: the height it comes back at, not the sheet's yet)
        panelEl.classList.toggle('full', dir <= 0 && (dir < 0 && level !== undefined ? level : stack.level) === 2);
        if (!m.onMap) { map.unfollow(); return; }
        buzz();
        panel.setFollowing(true);
        // Back from (or over from) a station on its route: the camera rides its line there, then follows it.
        const p = frame.placeNow(id);
        const riding = !again && prev?.kind === 'station' ? route.ride(id, prev.key.slice(8), p) : null;
        if (riding) { riding.then((ok) => { if (ok && stack.top() === `train:${id}`) follow(id); }); return; }
        const following = follow(id);
        if ((go || dir < 0) && p) following.then(() => map.goTo(p, go ? 13 : map.camera().z, true));
      },
      // (the card goes back to the holder, only from this page: a train opened earlier keeps its card)
      hide() {
        if (shareNote?.id === id) shareNote = null;
        if (panel.openId === id) { route.keep(); panel.close(); route.release(); }
        if (panelEl.parentElement === myEl) holder.append(panelEl);
      },
      unmount() { if (panel.openId === id) panel.close(); if (panelEl.parentElement === myEl && myEl) holder.append(panelEl); },
      beforeLevel() { headWas = panel.openId === id ? headPlaces(panelEl) : null; },
      level(i) {
        if (panel.openId !== id) return;
        panelEl.classList.toggle('full', i === 2);
        if (headWas) { glideHead(panelEl, headWas); headWas = null; }
      },
      // (its content at full measured with its full look on for that moment: src/stack.js fullOf)
      atFull(measure) {
        if (panel.openId !== id || panelEl.classList.contains('full')) return measure();
        panelEl.classList.add('full');
        const end = measure();
        panelEl.classList.remove('full');
        return end;
      },
      // Half: down to "More" with room under it (measured only while compact; no "More" yet: what the card shows).
      half: () => cardTo(true),
      // Low: a computer's the whole card to "More" (low and half one); a phone's the condensed card.
      low: () => cardTo(isWide()),
      every() { if (panel.openId === id) drawExtras(id); },
      fit: { box: panelEl, ready: cardIn },   // (the card changed its size: the sheet follows at once; src/stack.js)
      dismiss() { if (panel.openId === id) panel.closePick(); },   // (a map tap shuts the "to …" chooser: R1)
      star: { on: () => favourites.has('train', number()), toggle: () => favourites.toggle('train', number()) },
      acts: () => [{ id: 'share', icon: 'share', label: t('share') }],
      act: (what) => { if (what === 'share') shareOpen(); },
      // (share, star and Follow in the card's top line beside the number: the sheet has no bar over a train)
      barIn: () => (panel.openId === id && panelEl.parentElement === myEl ? panelEl.querySelector('.panel-buttons') : null),
      // (‹ only when opened from another page: not over Home, nor from train to train on the map)
      noUp: () => { const below = ctx.stack.keys().at(-2) ?? 'home'; return below === 'home' || below.startsWith('train:'); },
      follow: { can: () => panel.openId === id && panel.canFollow, on: () => panel.following, toggle: () => panel.toggleFollow() },
      redraw: () => panel.relabel(),
    };
  }

  // How long the train has stood still (ms) by its reported speeds (src/speed-log.js); silent since its last report:
  // standing since then.
  function stoodFor(id, at) {
    const list = speedLog.of(id, at);
    const last = list.at(-1);
    if (!last) { const rep = trains.get(id); return rep?.time ? Math.max(0, at - rep.time) : 0; }
    const m = (a, b) => Math.hypot((a.lon - b.lon) * Math.cos(a.lat * Math.PI / 180), a.lat - b.lat) * 111195;
    let since = last.time;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (e.speed !== null ? e.speed >= STILL_KMH : m(e, last) > STILL_M) break;
      since = e.time;
    }
    return at - since;
  }
  // Only a train LATE_MIN or more late, and only with an answer: why it stands (stood WHY_AFTER_MS), else why it is late.
  function whyFor(id) {
    const x = frame.byId.get(id), r = panel.openId === id ? panel.route : null;
    if (!x || x.stale || !r) return null;
    const known = { train: x, route: r, station: stations.get, disruptions: live && disruptions.loaded ? disruptions.list : [],
      lines: d => disruptions.stretchesOf(d), now: now() };
    if ((lateOf(id) ?? 0) < LATE_MIN) return null;
    const w = (x.v ?? 0) < STAND_SPEED && stoodFor(id, now()) >= WHY_AFTER_MS ? { ...whyStanding(known), title: 'whyTitle' } : { ...whyLate(known), title: 'whyLateTitle' };
    return w.kind === 'none' || w.kind === 'stop' ? null : w;
  }
  function whyHtml(w) {
    if (!w || w.kind === 'stop') return '';
    const text = w.kind === 'disruption' ? t('whyDisruption', w.header) : w.kind === 'note' ? t('whyNote', w.text)
      : w.kind === 'waiting' ? t('whyWaiting', w.station, hhmm(w.planned)) : t('whyNone');
    const inner = `<small>${esc(t(w.title ?? 'whyTitle'))}</small><span>${esc(text)}</span>`;
    return w.kind === 'disruption' ? `<button type="button" class="why dis" data-go="dis:${esc(w.id)}">${icon('warning', 17)}<span class="why-t">${inner}</span>${icon('chevron', 16)}</button>`
      : `<div class="why ${w.kind}">${icon(w.kind === 'none' ? 'info' : 'warning', 17)}<span class="why-t">${inner}</span></div>`;
  }
  // (no share sheet and no copying, an http address: the link shown to copy by hand until the card closes)
  function shareNoteHtml(id) {
    const n = shareNote;
    if (!n || n.id !== id || (n.how === 'copied' && Date.now() - n.at > SHARE_NOTE_MS)) return '';
    return `<p class="share-note" role="status">${icon(n.how === 'copied' ? 'check' : 'share', 16)}<span>${esc(t(n.how === 'copied' ? 'linkCopiedShort' : 'linkShownShort'))}` +
      `<span class="share-url">${esc(n.url)}</span></span></p>`;
  }
  function drawExtras(id) {
    const r = panel.openId === id ? panel.route : null;
    const ahead = (r?.stops ?? []).some((s, i) => i > 0 && s.advertised && s.activity === 'Ankomst' && !s.canceled && !s.actual);
    // ("Add a change" only on the expanded card, src/css/train-card.css)
    const html = whyHtml(whyFor(id)) + '<div class="tr-acts">' +
      (ahead ? `<button type="button" class="chip" data-go="addchange:${esc(id)}">${icon('change', 17)}${esc(t('addChange'))}</button>` : '') + '</div>' + shareNoteHtml(id);
    if (extrasEl._h !== html) { extrasEl.innerHTML = html; extrasEl._h = html; }
  }
  function shareOpen() {
    if (!panel.openId) return;
    const n = panel.number ?? trains.get(panel.openId)?.number;
    if (!n) return;
    const id = panel.openId;
    shareTrain({ number: n, title: t('shareTitle', n), text: t('shareText', n),
      note: (how, url) => { shareNote = { id, how, url, at: Date.now() }; drawExtras(id); } });
  }

  // Open a train on the map: its page, the camera follows it. go: also fly there, zoomed in to the toys.
  function open(id, { go = false } = {}) {
    if (!id || !trains.get(id)) return false;
    return ctx.stack.open(`train:${id}`, { go });
  }
  // Picked in the search or on a board: on the map, fly there and follow it; otherwise its stops.
  function pick(tr) {
    if (tr.onMap && open(tr.id, { go: true })) return;
    trainMeta.set(tr.id, { operational: tr.operational, date: tr.date, number: tr.number });
    ctx.stack.open(`train:${tr.id}`, { go: true });
  }
  // A starred (or shared) train: on the map, fly there; otherwise its run now, the next one, or the latest.
  async function pickFavourite(number) {
    const r = trains.reports().find(x => String(x.number) === number);
    if (r) return pick({ id: r.id, operational: r.operational, date: r.date, number: r.number, onMap: true });
    try {
      const run = pickRun(await fetchRunsByNumber(number, now()), now());
      if (run) pick({ id: run.key, operational: run.operational, date: run.date, number: run.number, onMap: false });
    } catch (e) { console.warn('favourite:', e.message); }
  }

  return {
    define: trainPage, open, pick, pickFavourite,
    remember: tr => trainMeta.set(tr.id, { operational: tr.operational, date: tr.date, number: tr.number }),
    metaOf: id => trainMeta.get(id),
    extras(id) { drawExtras(id); return extrasEl; },
    // The train's own numbers ("i" on the full card, src/train-info.js), each second while shown.
    info(box, c) {
      const r = trains.get(c.id);
      drawInfo(box, { ...c, t: now() - drawDelay, now: now(), log: speedLog, net: ctx.net(), stationName: stations.name, station: stations.get,
        path: route.pathOf(c.id), place: frame.byId.get(c.id) ?? null, late: r ? minutesOf(c.id) : null });
    },
    // What a page of the sheet's ideas needs to know about a train: its numbers (and its route, while its card has it).
    trainInfo(id) {
      const r = trains.get(id), m = trainMeta.get(id), x = r ?? m;
      if (!x) return null;
      return { number: String(x.number), operational: x.operational, date: x.date, route: panel.openId === id ? panel.route : null };
    },
    // The open train's trip handed on to its next internal number (trains.prune): the card and the camera go with it.
    handover() {
      const to = panel.openId && !trains.get(panel.openId) ? trains.handedTo(panel.openId) : null;
      if (!to) return;
      const stack = ctx.stack, wasFollowing = map.following, key = `train:${panel.openId}`;
      if (stack.top() === key) stack.replace(`train:${to}`);
      else stack.close(key);
      if (!wasFollowing && panel.openId === to) { map.unfollow(); panel.setFollowing(false); }
    },
    why: whyFor,
    stoodFor: id => stoodFor(id, now()),
  };
}
