import { summaryHtml } from './summary-mail.mjs';

// When the monitor mails Max (Max, 2026-11-16: "Mostly errors so I can act", plus a daily summary). A pure function of
// the minute rows (monitor/main.mjs makes them), so tools/monitor-check.mjs can feed made-up timelines.
//
// A row (one a minute; times in ms, ages in s):
//   t, day ('2026-11-16'), hour, minute (local time)
//   up (the fetcher answered this minute), upFor (s since the fetcher started), restarts (new fetcher processes seen)
//   asks, refused (Trafikverket "too many requests"), trvFailed, bytesIn, streamsOpened, feeds ('stream/stream')
//   uploads (uploading at all), upOk, upFailed, reconnects, bytesOut, upAgo (s since the last good upload, null: none)
//   reportAge (s since the newest position report, null: none yet), trains
//   one: { status: 200 | 404 | 429 | 'error' | 'off' (not set), age (s, null: no file found) }
//   offline (the monitor couldn't reach the internet: its read of one.com failed with no answer at all)
//   sizes { kind: gzip bytes }, memMB, cpuPct
// The home internet counts as out only when both ways out fail: the monitor gets no answer at all from one.com AND the
// running fetcher can't reach Trafikverket either (failed questions, or its streams not live: a dead stream is noticed
// within a minute). one.com alone not answering is one.com's trouble, judged by the other rules ("uploads failing").
export function isOffline(r) {
  return r.one?.status === 'error' && r.up && (r.trvFailed > 0 || r.feeds !== 'stream/stream');
}

export const LIMITS = {
  quietMs: 30 * 60000,     // at most one mail per problem in this time
  downRows: 2,             // the fetcher not answering for 2 minutes
  crashes: 3, crashRows: 15,   // 3 restarts within 15 minutes
  asksPerMin: 20, asksRows: 2, // more than 20 questions a minute, 2 minutes running (normal: 2-4; a start ~10)
  uploadS: 120,            // no good upload for 2 minutes
  fileS: 60,               // the newest file on one.com older than 60 s
  reportS: 600, dayFrom: 6, dayTo: 23,   // no new train report for 10 minutes, 06:00-23:00
  offlineRows: 3,          // an internet loss is mailed (afterwards) from 3 minutes
  settleRows: 3,           // after an internet loss, the network rules wait 3 minutes (streams come back after ~1)
  clearRows: 10,           // "too many requests" counts as over after 10 quiet minutes
  clockS: 30, clockRows: 3, // the Linux PC's clock more than 30 s off one.com's, 3 minutes running (over: within 10 s)
};

const hm = t => new Date(t).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Stockholm' });
const span = (a, b) => `${hm(a)}–${hm(b)}`;
const mins = ms => Math.max(1, Math.round(ms / 60000));
const LOOK = {
  fetcher: 'On the Linux PC: systemctl status sparat-fetcher, and journalctl -u sparat-fetcher --since "30 min ago"',
  network: 'Check the home internet; then journalctl -u sparat-fetcher --since "30 min ago"',
};

// The problems: key -> [test(row, history) true while it is a problem, test true when it is over, subject, what to do].
// A problem judged from what the fetcher tells (uploads, the file on one.com, reports) is over only while the fetcher
// answers (until 2026-11-22 a fetcher that stopped answering closed it with an "OK again": the code review of
// 2026-11-21, finding 5; "the fetcher is not running" has its own mail).
// history = the rows so far, newest last. "net" problems are not judged while the internet is out or just back.
const PROBLEMS = {
  'fetcher-down': { net: false,
    on: (r, h) => h.slice(-LIMITS.downRows).length === LIMITS.downRows && h.slice(-LIMITS.downRows).every(x => !x.up),
    off: r => r.up,
    subject: 'the fetcher is not running', ok: 'the fetcher runs', look: LOOK.fetcher },
  'crash-loop': { net: false,
    on: (r, h) => h.slice(-LIMITS.crashRows).reduce((n, x) => n + x.restarts, 0) >= LIMITS.crashes,
    off: (r, h) => h.slice(-LIMITS.crashRows).every(x => !x.restarts),
    subject: 'the fetcher keeps restarting', ok: 'the fetcher is stable', look: LOOK.fetcher },
  'trv-refused': { net: true,
    on: r => r.up && r.refused > 0,
    off: (r, h) => h.slice(-LIMITS.clearRows).every(x => !x.refused),
    subject: 'Trafikverket answers "too many requests"', ok: 'Trafikverket answers normally', look: 'The fetcher waits and tries again by itself. If it goes on: ' + LOOK.fetcher },
  'asking-too-much': { net: true,
    on: (r, h) => h.slice(-LIMITS.asksRows).length === LIMITS.asksRows && h.slice(-LIMITS.asksRows).every(x => x.up && x.asks > LIMITS.asksPerMin),
    off: (r, h) => h.slice(-5).every(x => x.asks <= LIMITS.asksPerMin),
    subject: 'the fetcher asks Trafikverket far more than normal', ok: 'the fetcher asks Trafikverket normally', look: 'Something may be looping (normal is 2-4 questions a minute). ' + LOOK.fetcher + '; stopping it: sudo systemctl stop sparat-fetcher' },
  'uploads-failing': { net: true,
    on: r => r.up && r.uploads && (r.upAgo === null ? r.upFor >= LIMITS.uploadS : r.upAgo >= LIMITS.uploadS),
    off: r => r.up && (!r.uploads || (r.upAgo !== null && r.upAgo < 30)),
    subject: 'uploads to one.com are failing', ok: 'uploads to one.com work', look: 'one.com may be down or refusing the login. ' + LOOK.network },
  'onecom-refused': { net: true,
    on: r => r.one.status === 429,
    off: (r, h) => h.slice(-LIMITS.clearRows).every(x => x.one.status !== 429),
    subject: 'one.com answers "too many requests"', ok: 'one.com answers normally', look: 'Viewers may be refused too. Nothing to do at home; tell Claude (it is one.com\'s limit).' },
  'stale-file': { net: true,
    // Two reads running found no file younger than 60 s (a 404 or an old one; a refused or failed read says nothing).
    on: (r, h) => h.slice(-2).length === 2 && h.slice(-2).every(x => x.up && x.upFor >= 180 && [200, 404].includes(x.one.status) && (x.one.age === null || x.one.age > LIMITS.fileS)),
    off: r => r.up && r.one.age !== null && r.one.age <= LIMITS.fileS,
    subject: 'the map\'s data on one.com is stale', ok: 'the map\'s data on one.com is fresh', look: 'Viewers see "live data paused". ' + LOOK.network },
  // The Linux PC's clock (2026-11-22, TODO 62): a clock 15 minutes fast left the live file empty; slow, the newest
  // reports looked old; every viewer's page sets its clock by the files. r.one.clockOff: seconds ahead of one.com's.
  'clock-off': { net: true,
    on: (r, h) => h.slice(-LIMITS.clockRows).length === LIMITS.clockRows && h.slice(-LIMITS.clockRows).every(x => x.one?.clockOff != null && Math.abs(x.one.clockOff) > LIMITS.clockS),
    off: (r, h) => h.slice(-LIMITS.clockRows).every(x => x.one?.clockOff != null && Math.abs(x.one.clockOff) <= 10),
    subject: "the Linux PC's clock is wrong", ok: "the Linux PC's clock is right",
    look: 'On the Linux PC: timedatectl (it should say "System clock synchronized: yes"). If it says no: sudo timedatectl set-ntp true (turns on setting the clock from the internet).' },
  'no-reports': { net: true,
    on: r => r.up && r.upFor >= LIMITS.reportS && r.hour >= LIMITS.dayFrom && r.hour < LIMITS.dayTo && (r.reportAge === null || r.reportAge > LIMITS.reportS),
    off: r => r.up && r.reportAge !== null && r.reportAge <= 120,
    subject: 'no new train positions from Trafikverket', ok: 'train positions arrive', look: 'Trafikverket\'s stream may be down (the fetcher retries every minute). ' + LOOK.fetcher },
};

// The rules' memory. step(row) takes the next minute and gives the mails to send now.
// context() (optional) gives what the summary needs beyond the rows: { version, versionText, days } (monitor/main.mjs).
export function createRules({ summaryAt = '07:00', context = () => ({}) } = {}) {
  const history = [];
  const open = new Map();        // key -> { since, mailed }
  const lastMail = new Map();    // key -> when its problem mail went
  const sent = [];               // every mail made (for the summary), newest last
  let offlineSince = null, offlineLast = null, settle = 0, summaryDay = null;

  function step(row) {
    history.push(row);
    if (history.length > 1440) history.shift();
    const out = [];
    const mail = m => { const x = { t: row.t, ...m }; out.push(x); sent.push(x); if (sent.length > 500) sent.shift(); };
    const problemMail = (key, p, r, since) => {
      lastMail.set(key, r.t);
      mail({ key, kind: 'problem', subject: p.subject, text: `${p.subject.startsWith('one.com') ? p.subject : p.subject[0].toUpperCase() + p.subject.slice(1)} (since about ${hm(since)}).\n\n${detail(key, r)}\n\nWhat to do: ${p.look}` });
    };

    // The internet: lost from the first offline row; mailed when it is back, if it lasted 3 minutes or more.
    if (row.offline) {
      offlineSince ??= row.t; offlineLast = row.t;
    } else if (offlineSince !== null) {
      const rows = history.filter(x => x.t >= offlineSince && x.t <= offlineLast);
      if (rows.length >= LIMITS.offlineRows) {
        const restarts = rows.reduce((n, x) => n + x.restarts, 0);
        mail({ key: 'offline', kind: 'offline', subject: `the internet was out ${span(offlineSince - 60000, row.t - 60000)} (${rows.length} min)`,
          text: [`From about ${hm(offlineSince - 60000)} to ${hm(row.t - 60000)} the monitor could not reach the internet (${rows.length} minutes).`,
            `During it the fetcher ${rows.every(x => x.up) ? 'kept running' : 'was not running for part of the time'}${restarts ? ` and restarted ${restarts} time(s)` : ''}.`,
            'Viewers saw "live data paused" for that time.',
            'If something is still wrong now that it is back, its own mail follows within a few minutes.'].join('\n') });
      }
      offlineSince = null; offlineLast = null; settle = LIMITS.settleRows;
    }
    const judgeNet = !row.offline && settle === 0;
    if (!row.offline && settle > 0) settle--;

    for (const [key, p] of Object.entries(PROBLEMS)) {
      if (p.net && !judgeNet) continue;
      const o = open.get(key);
      if (!o && p.on(row, history)) {
        const quiet = lastMail.has(key) && row.t - lastMail.get(key) < LIMITS.quietMs;
        open.set(key, { since: row.t, mailed: !quiet });
        if (!quiet) problemMail(key, p, row, row.t);
      } else if (o && p.off(row, history)) {
        open.delete(key);
        if (o.mailed) mail({ key, kind: 'ok', subject: `OK again: ${p.ok}`,
          text: `Over: ${p.subject} (${span(o.since, row.t)}, ${mins(row.t - o.since)} min).` });
      } else if (o && !o.mailed && row.t - lastMail.get(key) >= LIMITS.quietMs) {
        // Came back within the quiet time and still on when it ends: mailed now (until 2026-11-22 never, however long
        // it lasted: the code review of 2026-11-21, finding 1).
        o.mailed = true;
        problemMail(key, p, row, o.since);
      }
    }

    // The daily summary.
    // At or after its time, once a day, within two hours (until 2026-11-22 only at that very minute: a time in the hour
    // the clock goes back mailed twice, one in the hour skipped in March never).
    const [sh, sm] = summaryAt.split(':').map(Number), m = row.hour * 60 + row.minute, due = sh * 60 + sm;
    if (m >= due && m < due + 120 && summaryDay !== row.day) {
      summaryDay = row.day;
      const s = summary(history.filter(x => x.t > row.t - 24 * 3600000), sent.filter(x => x.t > row.t - 24 * 3600000 && x.kind !== 'summary'), [...open.keys()].map(k => PROBLEMS[k].subject), context());
      mail({ key: 'summary', kind: 'summary', subject: s.subject, text: s.text, html: s.html });
    }
    return out;
  }

  // Over a restart (2026-11-23; monitor/main.mjs keeps the rows and this snapshot in its folder): the history comes back
  // without judging it (no mails for minutes already judged), and the memory of what was mailed, so the day's summary
  // lists them, a problem still open gets its "OK again", and the summary isn't sent twice.
  function snapshot() {
    return { summaryDay, offlineSince, offlineLast, open: [...open], lastMail: [...lastMail], sent: sent.map(({ html, text, ...m }) => m) };
  }
  function restore(rows, snap) {
    history.length = 0;
    history.push(...rows.slice(-1440));
    if (!snap || typeof snap !== 'object') return;
    const t0 = (rows.at(-1)?.t ?? Date.now()) - 25 * 3600000;
    if (typeof snap.summaryDay === 'string') summaryDay = snap.summaryDay;
    for (const [k, o] of Array.isArray(snap.open) ? snap.open : []) if (PROBLEMS[k] && typeof o?.since === 'number') open.set(k, { since: o.since, mailed: o.mailed === true });
    for (const [k, t] of Array.isArray(snap.lastMail) ? snap.lastMail : []) if (typeof k === 'string' && typeof t === 'number') lastMail.set(k, t);
    for (const m of Array.isArray(snap.sent) ? snap.sent : []) if (m && typeof m.t === 'number' && m.t > t0 && typeof m.subject === 'string') sent.push(m);
    // An internet loss going on at the stop: its mail comes when it is back (the minutes in between count as out).
    if (typeof snap.offlineSince === 'number' && rows.length && rows.at(-1).offline) { offlineSince = snap.offlineSince; offlineLast = snap.offlineLast ?? snap.offlineSince; }
  }

  return { step, open: () => [...open].map(([key, o]) => ({ key, subject: PROBLEMS[key].subject, since: o.since })), sent: () => [...sent], snapshot, restore };
}

function detail(key, r) {
  switch (key) {
    case 'fetcher-down': return 'The fetcher has not answered the monitor for 2 minutes. Linux restarts it after a crash by itself; it has not come back.';
    case 'crash-loop': return 'The fetcher started again 3 or more times in 15 minutes: it is crashing.';
    case 'trv-refused': return `Trafikverket refused ${r.refused} question(s) in the last minute.`;
    case 'asking-too-much': return `${r.asks} questions to Trafikverket in the last minute.`;
    case 'uploads-failing': return `No file has reached one.com for ${r.upAgo === null ? r.upFor : r.upAgo} s (${r.upFailed} failed, ${r.reconnects} reconnects in the last minute).${r.upError ? ` The fetcher says: ${r.upError}` : ''}`;
    case 'onecom-refused': return 'one.com refused the monitor\'s read of the newest file.';
    case 'stale-file': return r.one.age === null ? 'No recent file is found on one.com.' : `The newest file on one.com is ${r.one.age} s old.`;
    case 'clock-off': return `The Linux PC's clock is ${Math.abs(r.one.clockOff)} s ${r.one.clockOff > 0 ? 'ahead of' : 'behind'} one.com's.`;
    case 'no-reports': return r.reportAge === null ? 'No position report since the fetcher started.' : `The newest position report is ${Math.round(r.reportAge / 60)} min old.`;
    default: return '';
  }
}

const med = a => { const s = a.filter(x => x !== null && x !== undefined).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const max = a => { const s = a.filter(x => x !== null && x !== undefined); return s.length ? Math.max(...s) : null; };
const sum = (rows, f) => rows.reduce((n, x) => n + (f(x) ?? 0), 0);
const kB = b => b < 1000 ? `${Math.round(b)} B` : `${(b / 1000).toFixed(1)} kB`;
const KIND_ORDER = ['live', 'passings', 'passings-add', 'planned', 'planned-add', 'disruptions', 'stats', 'arrivals', 'arrivals-add', 'stations'];
const MB = b => `${(b / 1e6).toFixed(1)} MB`;

// One day's (or the last 24 hours') numbers: for the summary mail and the day file.
export function dayNumbers(rows) {
  const n = rows.length;
  const kinds = [...new Set(rows.flatMap(x => Object.keys(x.sizes ?? {})))].sort((p, q) => KIND_ORDER.indexOf(p) - KIND_ORDER.indexOf(q));
  return {
    from: rows[0]?.t ?? null, to: rows.at(-1)?.t ?? null, minutes: n,
    upPct: n ? Math.round(1000 * rows.filter(x => x.up).length / n) / 10 : null,
    restarts: sum(rows, x => x.restarts), offlineMin: rows.filter(x => x.offline).length,
    asks: sum(rows, x => x.asks), asksMax: max(rows.map(x => x.asks)), refused: sum(rows, x => x.refused), trvFailed: sum(rows, x => x.trvFailed),
    bytesIn: sum(rows, x => x.bytesIn), streamsOpened: sum(rows, x => x.streamsOpened),
    upOk: sum(rows, x => x.upOk), upFailed: sum(rows, x => x.upFailed), reconnects: sum(rows, x => x.reconnects), bytesOut: sum(rows, x => x.bytesOut),
    fileAgeMed: med(rows.map(x => x.one?.age)), fileAgeMax: max(rows.map(x => x.one?.age)), oneRefused: rows.filter(x => x.one?.status === 429).length,
    fileMissingMin: rows.filter(x => x.one?.status === 404).length,
    reportAgeMed: med(rows.map(x => x.reportAge)), reportAgeMax: max(rows.map(x => x.reportAge)),
    trainsMax: max(rows.map(x => x.trains)),
    sizes: Object.fromEntries(kinds.map(k => [k, { med: med(rows.map(x => x.sizes?.[k])), max: max(rows.map(x => x.sizes?.[k])) }])),
    memMax: max(rows.map(x => x.memMB)),
  };
}

// The versions run in the rows (each row says its version since 2026-11-23): [{ ver, from }], oldest first.
export function versionsRun(rows) {
  const out = [];
  for (const r of rows) if (r.ver && out.at(-1)?.ver !== r.ver) out.push({ ver: r.ver, from: r.t });
  return out;
}
const dayTime = t => new Date(t).toLocaleString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Stockholm' });
export function versionLine(rows, ctx = {}) {
  const runs = versionsRun(rows);
  const now = ctx.versionText ?? (runs.at(-1) ? `Spårat ${runs.at(-1).ver}` : null);
  if (!now) return null;
  if (runs.length > 1) return `Version: ${now}; updated ${runs.slice(1).map(r => `to ${r.ver} at ${dayTime(r.from)}`).join(', ')} (from ${runs[0].ver}).`;
  return `Version: ${now}${runs.length ? `, the whole time watched` : ''}.`;
}

// The viewers (fetcher/viewers.mjs, from the release after 0.7.0): the day before the summary and today so far.
export function viewersLine(v, end) {
  if (!v || !v.days?.length) return null;
  const today = end ? new Date(end).toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' }) : null;
  const y = v.days.filter(x => x.day < today).at(-1), t = v.days.find(x => x.day === today);
  return `Viewers: ${y ? `${y.day} ${y.people} people (app ${y.app}, site ${y.site}), most at once ${y.peak}${y.peakAt ? ` at ${hm(y.peakAt)}` : ''}` : 'none counted yesterday'}${t ? `; today so far ${t.people}` : ''}.`;
}

export function summary(rows, mails, openKeys, ctx = {}) {
  const d = dayNumbers(rows);
  const problems = mails.filter(m => m.kind === 'problem' || m.kind === 'offline');
  const fine = !problems.length && !openKeys.length;
  const day = rows.length ? new Date(rows.at(-1).t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' }) : '';
  const cpus = rows.map(x => x.cpuPct).filter(x => x !== null && x !== undefined);
  const cpuAvg = cpus.length ? (cpus.reduce((n, x) => n + x, 0) / cpus.length).toFixed(1) : null;
  const lines = [
    rows.length < 1380 ? `(The monitor has watched for ${Math.round(rows.length / 60 * 10) / 10} h of the last 24.)` : 'The last 24 hours:',
    versionLine(rows, ctx),
    '',
    `Fetcher: running ${d.upPct} % of the time, ${d.restarts} restart(s)${d.offlineMin ? `; internet out ${d.offlineMin} min in all` : ''}.`,
    `Trafikverket: ${d.asks} questions (${(d.asks / Math.max(1, d.minutes)).toFixed(1)} a minute, most ${d.asksMax} in one minute), ${d.streamsOpened} stream(s) opened, ${d.refused} "too many requests", ${d.trvFailed} failed, ${MB(d.bytesIn)} received.`,
    `one.com: ${d.upOk} uploads, ${d.upFailed} failed, ${d.reconnects} reconnects, ${MB(d.bytesOut)} sent; the file viewers read was ${d.fileAgeMed ?? '-'} s old in the middle, ${d.fileAgeMax ?? '-'} s at worst when found${d.fileMissingMin ? `, none recent in ${d.fileMissingMin} minute(s)` : ''}${d.oneRefused ? `; "too many requests" ${d.oneRefused} time(s)` : ''}.`,
    `Train positions: the newest report ${d.reportAgeMed ?? '-'} s old in the middle, ${d.reportAgeMax === null ? '-' : d.reportAgeMax < 120 ? d.reportAgeMax + ' s' : Math.round(d.reportAgeMax / 60) + ' min'} at worst; up to ${d.trainsMax ?? '-'} trains at once.`,
    `File sizes (as viewers get them): ${Object.entries(d.sizes).map(([k, s]) => `${k} ${kB(s.med)} (max ${kB(s.max)})`).join(', ')}.`,
    `Fetcher memory: up to ${d.memMax ?? '-'} MB; CPU ${cpuAvg ?? '-'} % on average.`,
    viewersLine(ctx.viewers, rows.at(-1)?.t),
    '',
    problems.length ? `Problems mailed:\n${problems.map(m => `- ${hm(m.t)} ${m.subject}`).join('\n')}` : 'No problems.',
    openKeys.length ? `Still open now: ${openKeys.join(', ')}.` : null,
  ];
  const watchedH = Math.min(24, Math.round(rows.length / 60 * 10) / 10);
  const html = summaryHtml({ rows, mails, openKeys, ctx, d, day, fine, problemsCount: problems.length, watchedH });
  return { subject: `daily summary ${day}: ${fine ? 'all OK' : `${problems.length} problem(s)${openKeys.length ? ', some still open' : ''}`}`, text: lines.filter(x => x !== null).join('\n'), html };
}
