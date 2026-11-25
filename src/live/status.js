// How the live data is doing, in words: the status pill at the top, the connection screen behind it (a page in the
// sheet, src/connection.js), the open card's line on how its train's place is known, Settings → Debug's rate line.
//
// createStatus({ feeds, trains, stations, stats, panel, mode: { replay, fromFiles }, drawDelay, now }) -> { conn,
//   connPage, showConn(), lineOf(id), onBatch(n), tick(t) }
import { t } from '../i18n.js';
import { hhmm } from '../clock.js';
import { createConnection, pillText } from '../connection.js';

const BEAT_MS = 10000;          // the live dot pulses for fresh data at most this often
const FRESH_MS = 60000;         // the connection screen's "fresh" trains: a report within this
const QUIET_GPS_S = 60;         // the card says "no GPS for …" after this many seconds
const PASSED_SHOWN_MS = 3 * 3600000;   // a passing older than this isn't named on the card
const clock = hhmm;             // Swedish time, wherever the phone is (src/clock.js)
const mins = sec => `${Math.max(1, Math.floor(sec / 60))} min`;
const modeText = m => t('mode')[m] ?? m;

export function createStatus({ feeds, trains, stations, stats, panel, frame, mode: { replay, fromFiles }, drawDelay, now }) {
  const connPage = document.getElementById('conn-page');
  const conn = createConnection(connPage, { getTrains: () => frame.all, reportTimeOf: id => trains.get(id)?.time ?? null });
  const statusEl = document.getElementById('status'), statusCount = statusEl.querySelector('.count');
  const settingsPage = document.getElementById('settings-page');
  const debugDataEl = document.getElementById('set-data');   // Settings → Debug: the positions' rate and age
  const { state } = feeds;
  let beatSeen = null, beatAt = 0;

  // How things stand at t: worked out once, for the pill, the connection screen and the card.
  function situation(tNow = now()) {
    return { tNow, noData: feeds.noData(tNow), paused: state.positions === 'paused' && state.pausedSince !== null,
      outdated: state.positions === 'outdated', error: feeds.error() };
  }
  // The card's line for a train's state (trains.stateOf): '' when it simply follows its GPS.
  function statusLine(st, noData) {
    if (!st) return t('notOnMap');
    if (noData) return t('noDataFromTrv', clock(feeds.lastDataAt));
    if (st.syncing) return t('catchingUp');
    const quiet = st.gpsSilentFor >= QUIET_GPS_S ? t('noGpsFor', mins(st.gpsSilentFor)) : null;
    const passed = st.lastPassing && st.lastPassing.time > now() - PASSED_SHOWN_MS
      ? t('lastPassed', stations.name(st.lastPassing.sig), clock(st.lastPassing.time)) : '';
    const q = quiet ?? t('noNewPosition');
    if (st.stale) return t('silentFor', mins(st.silentFor));
    if (st.mode === 'stood') return quiet ? t('stoodStill', quiet, passed) : '';
    if (st.mode === 'waiting' && st.lastPassing?.sig === st.waitingFor && st.lastPassing.activity === 'Ankomst')
      return t('atStation', q, stations.name(st.waitingFor), clock(st.lastPassing.time));
    if (st.mode === 'waiting' && st.waitingAt) return t('waitingAt', q, stations.name(st.waitingFor), passed);
    if (st.mode === 'waiting') return t('waitingBefore', q, stations.name(st.waitingFor), passed);
    if (st.mode === 'timetable') return t('byTimetable', q, passed);
    if (st.mode === 'coasted out') return t('stoppedLastSeen', q, passed);
    return '';
  }
  // The connection screen: the state in words, the chain from Trafikverket to this phone, three numbers.
  function showConn(s = situation()) {
    const { tNow, noData, paused, outdated, error } = s;
    const m = state.positions;
    const [st, title, text] = replay ? ['replay', t('connReplay'), t('connReplayText', hhmm(tNow))]
      : outdated ? ['bad', t('needsUpdate'), t('connOutdatedText')]
      : paused ? ['bad', t('livePausedSince', clock(state.pausedSince)), t('connPausedText')]
      : noData ? ['bad', t('connNoData', clock(feeds.lastDataAt)), t('connNoDataText')]
      : error ? ['bad', t('connProblem'), error]
      : m === 'starting' ? ['slow', modeText(m), t('connStartText')]
      : m !== 'stream' ? ['slow', modeText(m), t('connSlowText')]
      : ['live', t('connLive'), t('connLiveText')];
    const fresh = trains.reports().filter(r => r.time >= tNow - FRESH_MS).length;
    const online = navigator.onLine !== false;
    const trv = { icon: 'train', name: t('connTrv'), sub: noData ? t('connSilent') : m === 'stream' ? t('connStream') : t('connEvery10'),
      st: noData ? 'bad' : m === 'stream' ? 'ok' : 'slow' };
    const lastFileAt = feeds.lastFileAt;
    const you = { icon: 'phone', name: t('connYou'), st: online ? 'ok' : 'bad',
      sub: !online ? t('connOffline') : fromFiles && lastFileAt ? t('connAgo', Math.max(0, Math.round((Date.now() - lastFileAt) / 1000))) : t('connOnline') };
    // (the public page: Trafikverket → our server → the website → you; files stopping can't tell the server from the
    // website: the website is marked, the server "not known")
    const chain = replay ? [] : fromFiles ? [trv,
      { icon: 'server', name: t('connServer'), sub: paused ? t('connUnknown') : t('connListening'), st: paused || !online ? 'unknown' : 'ok' },
      { icon: 'globe', name: t('connWeb'), sub: t('connEvery5'), st: !online ? 'unknown' : paused ? 'bad' : 'ok' }, you] : [trv, you];
    conn.update({ state: st, title, text, chain, trains: trains.count, fresh, behindS: drawDelay / 1000,
      nextAt: fromFiles && !replay ? feeds.nextAt() : null });
  }
  const lineOf = (id, s = situation()) => statusLine(trains.stateOf(id, s.tNow - drawDelay), s.noData);

  return {
    conn, connPage, showConn, lineOf,
    onBatch: n => conn.onBatch(n),
    relabel() { conn.relabel(); showConn(); },
    // Each second: the pill (two or three words; the whole line its label and title), the connection screen while
    // open, Settings → Debug's line, the open card's line.
    tick(tNow) {
      const s = situation(tNow), { noData, paused, outdated, error } = s;
      const m = `${modeText(state.positions)}${replay ? ` ${hhmm(tNow)}` : ''}`;
      const said = outdated ? t('needsUpdate') : paused ? t('livePausedSince', clock(state.pausedSince)) : noData ? t('noDataSince', clock(feeds.lastDataAt)) : error ?? m;
      const short = `${t('trainsCount', trains.count)} · ${said}`;
      statusCount.textContent = pillText({ mode: state.positions, replayAt: replay ? hhmm(tNow) : null, outdated,
        pausedSince: paused ? clock(state.pausedSince) : null, noDataSince: noData ? clock(feeds.lastDataAt) : null, error: Boolean(error) });
      statusEl.title = short;
      statusEl.ariaLabel = short;
      // (yellow when not streaming: every 10 s, reconnecting, starting; streaming is 'stream', shown as "live")
      statusEl.classList.toggle('slow', state.positions !== 'stream' && !replay);
      if (trains.lastReport && trains.lastReport !== beatSeen && tNow - beatAt > BEAT_MS && !noData && !error) {
        beatSeen = trains.lastReport; beatAt = tNow;
        statusEl.classList.remove('beat'); void statusEl.offsetWidth; statusEl.classList.add('beat');
      }
      statusEl.classList.toggle('problem', Boolean(error) || noData || paused || outdated);
      if (!connPage.hidden) showConn(s);
      if (!settingsPage.hidden) {
        const r = stats.rate(tNow);
        debugDataEl.textContent = r ? t('stDebugRate', r.perSecond.toFixed(0), r.ageS.toFixed(0)) : '–';
      }
      if (panel.openId) panel.setStatus(lineOf(panel.openId, s));
    },
  };
}
