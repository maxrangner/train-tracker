// The day's timetable in the fetcher's memory, for taps from files (plan step 4, 2026-11-17): every TrainAnnouncement
// of yesterday's trains still running, today's, and from the evening tomorrow's, kept up to date by one more live
// stream of changes (corrections, delays, tracks, cancellations, new and deleted trains); and every station's monitor
// messages. From it fetcher/main.mjs makes the tap files (src/tap-files.js is their format):
//   card-NN   the rows of the trains whose number is in group NN (a train's card; the number search)
//   board-NN  the stations in group NN: each one's next trains not yet gone, per direction (a station's board)
//   day-NN    the stations in group NN: every advertised train there today, both directions (the search on a
//             station's board; Max, 2026-11-21: "Search for all day"; added 2026-11-21)
//   taps-add  every row changed since the oldest card or board file now in use, at its newest state
//   taps-index  internal number -> public number (a card asked by internal number finds its group)
//   messages  every station's monitor messages in force or coming
// Trafikverket is asked: a whole day in 6-hour slices of planned time (halved while an answer is too big; measured
// 2026-11-17: 7 questions, 21 s, 94k rows), one question a second; a day at start, at the day's turn, tomorrow at 18:00
// and today again at 03:30 (a clean copy); the changes stream (one stream); messages every 2 minutes.
import { ask, follow, boardGone } from '../src/trafikverket.js';
import { swedishDay, swedishParts, midnightOf, addDays } from '../src/clock.js';
import { TAP_FIELDS, GROUPS, groupOf, words, encodeRow, decodeRow, rowKey, BOARD_BACK_MS } from '../src/tap-files.js';

const MIN = 60000, HOUR = 60 * MIN;
// Yesterday's trains are kept whole while any of their stops is planned less than KEEP_RUNNING_MS ago (or ahead); at
// the start yesterday is loaded from YESTERDAY_BACK_MS back (no train in Sweden runs 24 hours). Until 2026-11-22 each
// row went on its own when planned more than 6 h ago, so a night train's card and green route started mid-trip (the
// code review of 2026-11-21, finding 2; on 17-18 Nov all 83 trains still running after midnight: tools/night-trains-check.mjs).
const KEEP_RUNNING_MS = 6 * HOUR, YESTERDAY_BACK_MS = 24 * HOUR;
const CARD_AHEAD_MS = 12 * HOUR;   // tomorrow's trains in the cards: those with a stop within this
const tripOf = x => `${x.r[1] || x.r[0]}|${x.day}`;   // a train's trip: its public number (all its pieces) and day
// A board file holds per station and direction its next BOARD_ROWS trains not yet gone (src/trafikverket.js
// boardGone), planned from BOARD_BACK_MS ago on (a very late train still counts). Until 2026-11-19 it held the first
// 120 rows from 90 minutes back, gone or not (Codex's beta review point 2). Measured on the day of 17 Nov: a board of
// 40 (the most a page shows) read 25 minutes after its file was made needs at most 59 such rows (Göteborg C arrivals,
// 07:30); the old rule left it short 11 times in 7,027 station-quarter-hours, this one 0.
const BOARD_ROWS = 80;
const CHANGES_BACK_MS = 15 * MIN;     // the changes stream starts from changes in the last 15 minutes
const FIELDS = TAP_FIELDS.map(f => `<INCLUDE>${f}</INCLUDE>`).join('');
const Q = filter => `<QUERY objecttype="TrainAnnouncement" namespace="rail.trafficinfo" schemaversion="1.9"><FILTER>${filter}</FILTER>${FIELDS}</QUERY>`;
const wait = ms => new Promise(r => setTimeout(r, ms));
// A moment's Swedish day, remembered per hour (Sweden's offset from UTC is whole hours, so the day turns on an hour):
// a full round of tap files asked it for every row, 4.6 of its 6 s (measured 2026-11-22 on the saved day of 17 Nov).
const dayByHour = new Map();
function dayOf(ms) {
  const h = Math.floor(ms / HOUR);
  let d = dayByHour.get(h);
  if (d === undefined) { d = swedishDay(h * HOUR); if (dayByHour.size > 2000) dayByHour.clear(); dayByHour.set(h, d); }
  return d;
}
// The rows in memory; any change counts up `version`, so the rows by group (below) are sorted out again only then.
class Rows extends Map {
  version = 0;
  set(k, v) { this.version++; return super.set(k, v); }
  delete(k) { this.version++; return super.delete(k); }
}

// seed (checks and replays: tools/board-check.mjs, fetcher/main.mjs --replay): { days, rows, messages (optional,
// Trafikverket's TrainStationMessage shape) } put in at once; nothing asked, no stream, no timers.
export function createTimetable({ log, onChange = () => {}, onLoaded = () => {}, seed = null }) {
  const w = words();                  // one word list for everything in memory
  const rows = new Rows();            // rowKey -> { r (base 0: times in seconds since 1970), mod (ms), day }
  const days = new Set(seed?.days ?? []);   // days loaded (YYYY-MM-DD)
  let messages = [], messagesAt = null, lastChange = Date.now(), stopped = false, loading = null;
  const again = new Set();            // days held but to be asked again (03:30, a stream gap)
  const counts = { asks: 0, loads: 0, changes: 0, rows: 0 };

  // A row in; never over a newer version of it (a change that came while its day was loading). loading: days being
  // loaded, whose changes are kept meanwhile (measured 2026-11-17: rows changed during the 16 s of a load were lost).
  const loadingDays = new Set();
  function put(a) {
    const day = (a.ScheduledDepartureDateTime ?? '').slice(0, 10);
    if (!a.LocationSignature || !a.AdvertisedTimeAtLocation || !(days.has(day) || loadingDays.has(day))) return false;
    const r = encodeRow(a, w, 0), k = rowKey(r), mod = Date.parse(a.ModifiedTime ?? '') || Date.now();
    const had = rows.get(k);
    if (had && had.mod > mod) return false;
    rows.set(k, { r, mod, day });
    return true;
  }

  // One day's rows, in slices of planned time from 6 h before to 36 h after its start (overnight trains), halved
  // while Trafikverket says the answer would be too big; one question a second.
  async function loadDay(day, from = null) {
    const start = midnightOf(day);   // (the real Swedish midnight; until 2026-11-22 winter time all year)
    const all = [];
    async function slice(a, b) {
      await wait(1000);
      counts.asks++;
      try {
        all.push(...(await ask(Q(`<EQ name="ScheduledDepartureDateTime" value="${day}"/>` +
          `<GTE name="AdvertisedTimeAtLocation" value="${new Date(a).toISOString()}"/><LT name="AdvertisedTimeAtLocation" value="${new Date(b).toISOString()}"/>`))).TrainAnnouncement ?? []);
      } catch (e) {
        if (!/Maximum response size/.test(e.message) || b - a <= 15 * MIN) throw e;
        const mid = Math.round((a + b) / 2);
        await slice(a, mid); await slice(mid, b);
      }
    }
    const t0 = Date.now();
    loadingDays.add(day);
    try {
      for (let h = Math.max(start - 6 * HOUR, from ?? -Infinity); h < start + 36 * HOUR; h += 6 * HOUR) await slice(h, Math.min(h + 6 * HOUR, start + 36 * HOUR));
    } finally { loadingDays.delete(day); }
    days.add(day);
    let n = 0;
    const got = new Set();
    for (const a of all) { if (put(a)) n++; got.add(rowKey(encodeRow(a, w, 0))); }
    // A clean copy: rows of the day no longer in Trafikverket's answer go, unless changed since the load began.
    for (const [k, x] of rows) if (x.day === day && (from === null || x.r[6] * 1000 >= from) && !got.has(k) && x.mod < t0) rows.delete(k);
    counts.loads++;
    log(`timetable: ${day} loaded, ${n} rows (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    onLoaded(day);   // every card and board file made again (a loaded day's rows are older than the changes file)
  }

  // Which days to hold now: yesterday (only trains with a stop planned in the last 6 h, whole), today, and tomorrow
  // from 18:00. Today first: the tap files wait for it (ready()).
  async function keepDays() {
    if (loading) return loading;
    loading = (async () => {
      // By the calendar: until 2026-11-22 now ± 24 h, which around the clock changes named the wrong days (28 Mar from
      // 23:00 tomorrow was 30 Mar: the boards lost every train after midnight; 30 Mar 00-01 yesterday was 28 Mar: every
      // night train vanished for an hour; TODO 62).
      const now = Date.now(), { day: today, hour } = swedishParts(now), yesterday = addDays(today, -1), tomorrow = addDays(today, 1);
      const want = [today, yesterday, ...(hour >= 18 ? [tomorrow] : [])];
      for (const d of [...days]) if (!want.includes(d)) { days.delete(d); for (const [k, x] of rows) if (x.day === d) rows.delete(k); }
      // A day asked again (03:30, a stream gap) stays in memory while its new copy comes (loadDay's clean copy removes
      // what Trafikverket no longer has): until 2026-11-22 it was taken out first, so no tap files were made meanwhile
      // (~21 s a night; for the whole outage if Trafikverket was down at 03:30).
      // A failed load asks again next minute (until 2026-11-24 the flag went first, so a failed 03:30 or after-outage
      // copy waited until the next 03:30; the hang review, finding 6).
      for (const d of want) if (!days.has(d) || again.has(d)) {
        const was = again.delete(d);
        try { await loadDay(d, d === yesterday ? now - YESTERDAY_BACK_MS : null); } catch (e) { if (was) again.add(d); throw e; }
      }
      const running = new Set(), cut = Date.now() - KEEP_RUNNING_MS;   // (the time after the loads)
      for (const x of rows.values()) if (x.day === yesterday && x.r[6] * 1000 >= cut) running.add(tripOf(x));
      for (const [k, x] of rows) if (x.day === yesterday && !running.has(tripOf(x))) rows.delete(k);
    })().catch(e => log(`timetable: loading failed: ${e.message}; tried again in a minute`)).finally(() => { loading = null; });
    return loading;
  }

  // Changes: one live stream of every TrainAnnouncement changed from 15 minutes ago on. After a break longer than
  // that, today is loaded again (a change could have been missed).
  if (seed) for (const a of seed.rows) put(a);
  if (seed?.messages) { messages = seed.messages; messagesAt = Date.now(); }
  const stream = seed ? () => {} : follow({
    makeQuery: ({ changeId, stream: s }) => `<QUERY objecttype="TrainAnnouncement" namespace="rail.trafficinfo" schemaversion="1.9" ${s ? 'sseurl="true" ' : ''}changeid="${changeId ?? 0}">` +
      `<FILTER><GT name="ModifiedTime" value="${new Date(Date.now() - CHANGES_BACK_MS).toISOString()}"/></FILTER>${FIELDS}</QUERY>`,
    // Any answer after a gap of nearly the 15 minutes the question reaches back: today again (until 2026-11-19 only when
    // the gap came at the start, so a later break lost the changes before its last 15 minutes until 03:30; TODO 31,
    // Codex's beta review point 7). A quiet stream is opened again after 3 minutes (silentMs), so a gap means a break.
    onResult: (r) => {
      const gap = Date.now() - lastChange;
      lastChange = Date.now();
      let n = 0;
      for (const a of r.TrainAnnouncement ?? []) if (put(a)) n++;
      counts.changes += n;
      if (gap > CHANGES_BACK_MS - MIN && days.size) { log(`timetable: changes missed for ${Math.round(gap / MIN)} min: every day held loaded again`); for (const d of days) again.add(d); keepDays(); }   // (every day: until 2026-11-22 only today, so yesterday's night trains and tomorrow kept what they missed)
      if (n) onChange();
    },
    onStatus: s => { if (s.error) log(`timetable changes: ${s.mode}: ${s.error}`); },
    silentMs: 180000,
  });

  async function loadMessages() {
    const now = new Date(Date.now()).toISOString();   // (Date.now: a faked clock reaches it)
    try {
      counts.asks++;
      const r = await ask(`<QUERY objecttype="TrainStationMessage" namespace="rail.trafficinfo" schemaversion="1">` +
        `<FILTER><EQ name="MediaType" value="Monitor"/><GT name="EndDateTime" value="${now}"/></FILTER>` +
        ['LocationCode', 'FreeText', 'StartDateTime', 'EndDateTime', 'Status'].map(f => `<INCLUDE>${f}</INCLUDE>`).join('') + `</QUERY>`);
      messages = r.TrainStationMessage ?? []; messagesAt = Date.now();
    } catch (e) { log(`timetable: station messages: ${e.message}`); }
  }

  // Timers: the days every minute (cheap when nothing is due), today again at 03:30, messages every 2 minutes.
  let resyncDay = swedishDay(Date.now());   // today is loaded fresh at start: the clean copy is from tomorrow 03:30 on
  const dayTimer = seed ? null : setInterval(() => {
    const hm = new Date(Date.now()).toLocaleTimeString('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit' });
    const today = swedishDay(Date.now());
    if (hm >= '03:30' && resyncDay !== today && days.has(today)) { resyncDay = today; again.add(today); }
    keepDays();
  }, MIN);
  const msgTimer = seed ? null : setInterval(loadMessages, 2 * MIN);
  if (!seed) { keepDays(); loadMessages(); }

  // ---------- the files' contents ----------
  const out = (list, extra) => {   // rows from memory (base 0, the memory's words) -> a file body
    const fw = words();
    const b = list.reduce((m, x) => (x.r[6] !== null && x.r[6] < m ? x.r[6] : m), Math.floor(Date.now() / 1000));   // seconds
    const r = list.map(x => { const a = decodeRow(x.r, w.list, 0); return encodeRow(a, fw, b); });
    return { ...extra, b, d: fw.list, r };
  };
  const all = () => [...rows.values()];
  // The rows by group, of the train (its public number, else its internal one) and of the station: made once while
  // nothing changes (a round of 96 files went through all 94k rows for each file; 2026-11-22).
  let groups = null;
  const byGroup = () => {
    if (groups?.version === rows.version) return groups;
    groups = { version: rows.version, train: new Map(), station: new Map() };
    const push = (m, g, x) => { let l = m.get(g); if (!l) m.set(g, l = []); l.push(x); };
    for (const x of rows.values()) { push(groups.train, groupOf(x.r[1] || x.r[0]), x); push(groups.station, groupOf(x.r[3]), x); }
    return groups;
  };
  const ofTrains = g => byGroup().train.get(g) ?? [], ofStations = g => byGroup().station.get(g) ?? [];
  return {
    ready: () => Boolean(seed) || days.has(swedishDay(Date.now())),   // seeded: all there is, at once
    // Cards: yesterday's trains still running, today's, and tomorrow's that start within CARD_AHEAD_MS (whole: a train
    // with any stop that soon). Until 2026-11-22 tomorrow's were only on boards, so in the late evening a tap on a
    // train after midnight got an empty card (TODO 62); all of tomorrow would double the files from 18:00.
    card: (g, t) => {
      const today = swedishDay(t), tomorrow = addDays(today, 1), list = ofTrains(g), soon = new Set();
      for (const x of list) if (x.day === tomorrow && x.r[6] !== null && x.r[6] * 1000 < t + CARD_AHEAD_MS) soon.add(tripOf(x));
      return out(list.filter(x => x.day <= today || (x.day === tomorrow && soon.has(tripOf(x)))), { kind: `card-${g}`, t });
    },
    // Boards: per station and direction its next BOARD_ROWS advertised trains not gone at t (above). (Memory rows have
    // base 0: their times are seconds since 1970.)
    board: (g, t) => {
      const by = new Map();
      const ms = v => (v === null || v === undefined ? null : v * 1000);
      for (const x of ofStations(g)) {
        if (!(x.r[5] & 1) || (x.r[5] & 4) || x.r[6] * 1000 < t - BOARD_BACK_MS) continue;
        if (boardGone({ planned: x.r[6] * 1000, estimated: ms(x.r[7]), actual: ms(x.r[8]), canceled: Boolean(x.r[5] & 2) }, t)) continue;
        const k = x.r[3] + x.r[4];
        if (!by.has(k)) by.set(k, []);
        by.get(k).push(x);
      }
      return out([...by.values()].flatMap(l => l.sort((a, b) => a.r[6] - b.r[6]).slice(0, BOARD_ROWS)), { kind: `board-${g}`, t });
    },
    // A station's whole day: every advertised row (not deleted) at the group's stations planned on t's Swedish day.
    day: (g, t) => {
      const today = swedishDay(t);
      return out(ofStations(g).filter(x => (x.r[5] & 1) && !(x.r[5] & 4) && x.r[6] !== null && dayOf(x.r[6] * 1000) === today)
        .sort((a, b) => a.r[6] - b.r[6]), { kind: `day-${g}`, t });
    },
    // Rows as they come (a replay's later rows, fetcher/replay.mjs): put in like the changes stream's.
    add(list) { let n = 0; for (const a of list) if (put(a)) n++; if (n) onChange(); return n; },
    changes: (since, t) => out(all().filter(x => x.mod >= since), { kind: 'taps-add', t, since }),
    index: t => { const ops = {}; for (const x of rows.values()) if (x.r[1]) ops[x.r[0]] = x.r[1]; return { kind: 'taps-index', t, groups: GROUPS, ops }; },
    messages: t => ({ kind: 'messages', t, at: messagesAt, messages: messages.map(m => [m.LocationCode, m.FreeText, m.StartDateTime ?? null, m.EndDateTime ?? null, m.Status ?? null]) }),
    stats: () => ({ ...counts, rows: rows.size, days: [...days], words: w.list.length, messages: messages.length, lastChangeAgo: Math.round((Date.now() - lastChange) / 1000) }),
    stop() { stopped = true; clearInterval(dayTimer); clearInterval(msgTimer); stream(); },
  };
}
