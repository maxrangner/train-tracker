// The connection screen (Max's pick Y, 2026-11-18; the sketch: docs/menu-1118/): opened from the live pill. What the
// pill's colour means right now in plain words, Sweden with every train that reports (each blinks when its new position
// arrives), a ring counting down to the next update (the public page reads a new file every 5 s), a heartbeat of new
// positions, the chain from Trafikverket to this phone with each link's state, three numbers, and what the colours and
// grey trains mean.
// createConnection(el, { getTrains, reportTimeOf }) -> { update(info), onBatch(count), isOpen }
//   getTrains() -> [{ id, lon, lat, stale }] (the map's trains this frame); reportTimeOf(id) -> its newest report's time.
//   update(info), once a second (src/main.js): { state: 'live' | 'slow' | 'bad' | 'replay', title, text,
//     chain: [{ icon, name, sub, st: 'ok' | 'slow' | 'bad' | 'unknown' }] (empty in a replay), trains, fresh (trains with
//     a new position in the last minute), behindS (how far behind real time the map is drawn), nextAt (Date.now() of
//     the next file, or null when the data streams) }
//   onBatch(count): a batch of new positions came (a file, or the stream's next message).
// Animations run only while the page is open, and none when the phone asks for less motion.
import { t } from './i18n.js';
import { icon } from './icons.js';
import OUTLINE from './sweden-outline.json';
import './connection.css';

const BLINK_MS = 900;          // a train's blink when its new position comes
const ECG_SPAN_MS = 60 * 1000; // the heartbeat shows the last minute
const BEAT_MS = 500;           // one beat's width
const PERIOD_MS = 5000;        // the public page's files: one every 5 s
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function createConnection(el, { getTrains, reportTimeOf }) {
  const body = el.querySelector('#conn-body');
  let info = null, raf = 0;
  const batches = [];               // [{ at (performance.now()), n }]
  const heard = new Map();          // train id -> { t (its report's time), at (when we saw it change) }

  function build() {
    body.innerHTML = `
      <div class="conn-card conn-hero"><span class="conn-dot"><i></i></span><span><b class="conn-title"></b><p class="conn-text"></p></span></div>
      <div class="conn-card conn-live">
        <h4>${esc(t('connSweden'))}</h4>
        <div class="conn-map"><canvas></canvas><div class="conn-lab"><b class="conn-n"></b><small>${esc(t('connReporting'))}</small></div>
          <svg class="conn-ring" viewBox="0 0 54 54" aria-hidden="true"><circle cx="27" cy="27" r="22" class="track"/><circle cx="27" cy="27" r="22" class="arc" transform="rotate(-90 27 27)"/><text x="27" y="31" text-anchor="middle"></text></svg></div>
        <h4>${esc(t('connPulse'))}</h4>
        <div class="conn-ecg"><canvas></canvas></div>
        <div class="conn-chain"></div>
      </div>
      <div class="conn-card"><h4>${esc(t('connNumbers'))}</h4>
        <div class="conn-nums"><div><b class="n-trains"></b><small>${esc(t('connOnMap'))}</small></div><div><b class="n-fresh"></b><small>${esc(t('connFresh'))}</small></div><div><b class="n-behind"></b><small>${esc(t('connBehind'))}</small></div></div>
        <p class="conn-note conn-behind-note"></p></div>
      <div class="conn-card"><h4>${esc(t('connMeaning'))}</h4>
        <ul class="conn-legend">
          <li><span class="conn-tag ok"><i></i>${esc(t('mode').stream)}</span><span>${esc(t('connLegendLive'))}</span></li>
          <li><span class="conn-tag slow"><i></i>${esc(t('mode').polling)}</span><span>${esc(t('connLegendSlow'))}</span></li>
          <li><span class="conn-tag bad"><i></i>${esc(t('connPausedTag'))}</span><span>${esc(t('connLegendPaused'))}</span></li>
          <li><span class="conn-tag grey"><i></i>${esc(t('connGreyTag'))}</span><span>${esc(t('connLegendGrey'))}</span></li>
        </ul></div>`;
    if (info) show();
  }

  // The words and numbers, once a second.
  function show() {
    const $ = s => body.querySelector(s);
    if (!$('.conn-hero')) return;
    $('.conn-hero').dataset.state = info.state;
    $('.conn-title').textContent = info.title;
    $('.conn-text').textContent = info.text;
    $('.conn-n').textContent = info.fresh;
    $('.n-trains').textContent = info.trains;
    $('.n-fresh').textContent = info.fresh;
    $('.n-behind').textContent = `~${Math.round(info.behindS)} s`;
    $('.conn-behind-note').textContent = t('connBehindNote', Math.round(info.behindS));
    $('.conn-ring').style.display = info.nextAt ? '' : 'none';
    const chain = $('.conn-chain');
    chain.hidden = !info.chain.length;
    chain.innerHTML = info.chain.map(c => `<div class="link ${c.st}"><i>${icon(c.icon, 18)}</i><b>${esc(c.name)}</b><small>${esc(c.sub)}</small></div>`).join('');
  }

  // Sweden: the outline and every train, blinking when its report is new.
  let project = null, projectedFor = '';
  function projection(w, h) {
    if (projectedFor === `${w}x${h}`) return project;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const r of OUTLINE) for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); }
    const k = Math.cos(62 * Math.PI / 180), pad = 12 * (w / 300), s = Math.min((w - 2 * pad) / ((x1 - x0) * k), (h - 2 * pad) / (y1 - y0));
    const ox = (w - (x1 - x0) * k * s) / 2, oy = (h - (y1 - y0) * s) / 2;
    project = (lon, lat) => [ox + (lon - x0) * k * s, oy + (y1 - lat) * s];
    projectedFor = `${w}x${h}`;
    return project;
  }
  const fit = (cv) => {
    const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return dpr;
  };
  function drawMap(now) {
    const cv = body.querySelector('.conn-map canvas');
    if (!cv) return;
    const dpr = fit(cv), w = cv.width, h = cv.height, g = cv.getContext('2d'), P = projection(w, h);
    g.clearRect(0, 0, w, h);
    g.lineWidth = 1.2 * dpr; g.strokeStyle = css('--line'); g.fillStyle = css('--hover');
    for (const r of OUTLINE) {
      g.beginPath();
      for (let i = 0; i < r.length; i += 2) { const [x, y] = P(r[i], r[i + 1]); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.closePath(); g.fill(); g.stroke();
    }
    const accent = css('--accent'), grey = css('--c-unknown'), fresh = css('--c-ontime'), calm = still();
    for (const tr of getTrains()) {
      const rt = reportTimeOf(tr.id), seen = heard.get(tr.id);
      if (!seen) heard.set(tr.id, { t: rt, at: -Infinity });
      else if (rt && rt !== seen.t) { seen.t = rt; seen.at = now; }
      const [x, y] = P(tr.lon, tr.lat);
      const flash = !calm && seen ? Math.max(0, 1 - (now - seen.at) / BLINK_MS) : 0;
      g.fillStyle = tr.stale ? grey : accent;
      g.globalAlpha = tr.stale ? 0.6 : 1;
      g.beginPath(); g.arc(x, y, (1.6 + flash * 2) * dpr, 0, Math.PI * 2); g.fill();
      if (flash > 0) {
        g.globalAlpha = flash * 0.55; g.strokeStyle = fresh; g.lineWidth = 1.5 * dpr;
        g.beginPath(); g.arc(x, y, (3 + (1 - flash) * 8) * dpr, 0, Math.PI * 2); g.stroke();
      }
      g.globalAlpha = 1;
    }
    // The countdown to the next file.
    if (info?.nextAt) {
      const left = Math.max(0, Math.min(1, (info.nextAt - Date.now()) / PERIOD_MS));
      const ring = body.querySelector('.conn-ring');
      ring.querySelector('.arc').style.strokeDashoffset = String(138.2 * (1 - left));
      ring.querySelector('text').textContent = `${Math.max(0, Math.ceil(left * PERIOD_MS / 1000))} s`;
    }
  }
  // The heartbeat: a beat for each batch of new positions, as tall as the batch is big, the newest at the right.
  function drawEcg(now) {
    const cv = body.querySelector('.conn-ecg canvas');
    if (!cv) return;
    const dpr = fit(cv), w = cv.width, h = cv.height, g = cv.getContext('2d');
    g.clearRect(0, 0, w, h);
    while (batches.length && batches[0].at < now - ECG_SPAN_MS - BEAT_MS) batches.shift();
    const top = Math.max(10, ...batches.map(b => b.n)), mid = h * 0.64, px = w / ECG_SPAN_MS;
    g.strokeStyle = css('--accent'); g.lineWidth = 2 * dpr; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(0, mid);
    for (const b of batches) {
      const x = w - (now - b.at) * px, amp = (0.15 + 0.85 * b.n / top) * h * 0.55, bw = BEAT_MS * px;
      g.lineTo(x, mid); g.lineTo(x + bw * 0.15, mid - amp); g.lineTo(x + bw * 0.3, mid + amp * 0.3); g.lineTo(x + bw * 0.45, mid);
    }
    g.lineTo(w, mid); g.stroke();
  }
  function frame(now) {
    raf = 0;
    if (el.hidden || document.hidden) return;
    drawMap(now);
    drawEcg(now);
    if (!still()) raf = requestAnimationFrame(frame);
  }
  const start = () => { if (!raf) raf = requestAnimationFrame(frame); };
  // Open: draw (and keep drawing); hidden again: stop.
  new MutationObserver(() => { if (!el.hidden) start(); }).observe(el, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !el.hidden) start(); });

  build();
  return {
    update(next) { info = next; show(); if (!el.hidden && still()) start(); },
    onBatch(count) { if (count > 0) batches.push({ at: performance.now(), n: count }); },
    relabel: build,
    get isOpen() { return !el.hidden; },
  };
}
