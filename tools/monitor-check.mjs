// Checks the monitor's mail rules (monitor/rules.mjs) on made-up timelines: each must give exactly the expected mails
// and no others. No internet, no key. Run: node tools/monitor-check.mjs [--show] (--show prints every mail made).
import { createRules, isOffline } from '../monitor/rules.mjs';

const MIN = 60000;
const show = process.argv.includes('--show');
// Local time from a Swedish clock string (this check's rows say what hour it is, as the monitor's do).
const at = s => new Date(s).getTime();
function normal(t, over = {}) {
  const d = new Date(t);
  return { t, day: d.toLocaleDateString('sv-SE'), hour: d.getHours(), minute: d.getMinutes(),
    up: true, upFor: 6 * 3600, restarts: 0, asks: 3, refused: 0, trvFailed: 0, bytesIn: 400000, streamsOpened: 0,
    feeds: 'stream/stream', uploads: true, upOk: 13, upFailed: 0, reconnects: 0, bytesOut: 300000, upAgo: 3,
    reportAge: 4, trains: 120, one: { status: 200, age: 5 }, sizes: { live: 4200, passings: 40000 },
    memMB: 90, cpuPct: 0.1, ...over };
}
// A timeline: `minutes` rows from `start`; change(i, row) may alter row i (minutes from the start).
function run(start, minutes, change = () => {}, opts) {
  const rules = createRules(opts);
  const mails = [];
  let upFor = 6 * 3600;
  for (let i = 0; i < minutes; i++) {
    const row = normal(at(start) + i * MIN, { upFor });
    change(i, row);
    row.offline = isOffline(row);   // as monitor/main.mjs does
    upFor = row.restarts ? 30 : row.up ? row.upFor + 60 : 0;
    row.upFor = row.up ? (row.restarts ? 30 : row.upFor) : 0;
    for (const m of rules.step(row)) mails.push({ i, ...m });
  }
  return mails;
}

const cases = [
  ['a normal day, 3 hours', run('2026-11-17T10:00', 180), []],
  ['the fetcher killed for 5 minutes', run('2026-11-17T10:00', 60, (i, r) => {
    if (i >= 30 && i < 35) Object.assign(r, { up: false, upAgo: null, one: { status: 200, age: (i - 29) * 60 } });
    if (i === 35) r.restarts = 1;
  }), ['problem fetcher-down', 'ok fetcher-down']],
  ['a crash loop (3 restarts in 4 minutes)', run('2026-11-17T10:00', 60, (i, r) => { if ([20, 22, 24].includes(i)) r.restarts = 1; }),
    ['problem crash-loop', 'ok crash-loop']],
  ['Trafikverket "too many requests" once', run('2026-11-17T10:00', 60, (i, r) => { if (i === 30) r.refused = 2; }),
    ['problem trv-refused', 'ok trv-refused']],
  ['asking too much for 2 minutes', run('2026-11-17T10:00', 60, (i, r) => { if (i === 30 || i === 31) r.asks = 50; }),
    ['problem asking-too-much', 'ok asking-too-much']],
  ['asking a lot for 1 minute only (a start)', run('2026-11-17T10:00', 60, (i, r) => { if (i === 30) r.asks = 25; }), []],
  ['uploads failing for 10 minutes', run('2026-11-17T10:00', 60, (i, r) => {
    if (i >= 30 && i < 40) Object.assign(r, { upOk: 0, upFailed: 3, reconnects: 2, upAgo: (i - 29) * 60, one: { status: 200, age: (i - 29) * 60 + 5 } });
  }), ['problem stale-file', 'problem uploads-failing', 'ok uploads-failing', 'ok stale-file']],
  ['uploads failing for 1 minute', run('2026-11-17T10:00', 60, (i, r) => {
    if (i === 30) Object.assign(r, { upOk: 0, upFailed: 3, upAgo: 50, one: { status: 200, age: 55 } });
  }), []],
  ['one.com "too many requests" once', run('2026-11-17T10:00', 60, (i, r) => { if (i === 30) r.one = { status: 429, age: null }; }),
    ['problem onecom-refused', 'ok onecom-refused']],
  ['one.com serves an old file (uploads fine)', run('2026-11-17T10:00', 60, (i, r) => { if (i >= 30 && i < 40) r.one = { status: 200, age: 300 }; }),
    ['problem stale-file', 'ok stale-file']],
  ['no train reports for 15 minutes, daytime', run('2026-11-17T10:00', 60, (i, r) => { if (i >= 30 && i < 45) r.reportAge = (i - 29) * 60; }),
    ['problem no-reports', 'ok no-reports']],
  ['no train reports for 15 minutes, 01:00 (no trains at night)', run('2026-11-17T01:00', 60, (i, r) => { if (i >= 30 && i < 45) r.reportAge = (i - 29) * 60; }), []],
  ['the internet out 7 minutes', run('2026-11-17T10:00', 60, (i, r) => {
    if (i >= 30 && i < 37) Object.assign(r, { upOk: 0, upFailed: 2, upAgo: (i - 29) * 60, reportAge: (i - 29) * 60, trvFailed: 2,
      feeds: 'poll/poll', one: { status: 'error', age: null } });
    if (i === 37) Object.assign(r, { upAgo: 20, reportAge: 70, one: { status: 200, age: 40 } });   // back: catching up
  }), ['offline offline']],
  ['the internet out 2 minutes', run('2026-11-17T10:00', 60, (i, r) => {
    if (i >= 30 && i < 32) Object.assign(r, { upAgo: (i - 29) * 60, trvFailed: 1, feeds: 'poll/poll', one: { status: 'error', age: null } });
  }), []],
  ['one.com not answering for 10 minutes, the home internet fine', run('2026-11-17T10:00', 60, (i, r) => {
    if (i >= 30 && i < 40) Object.assign(r, { upOk: 0, upFailed: 3, upAgo: (i - 29) * 60, one: { status: 'error', age: null } });
  }), ['problem uploads-failing', 'ok uploads-failing']],
  ['the fetcher down and its own files gone (no answer), the internet fine', run('2026-11-17T10:00', 60, (i, r) => {
    if (i >= 30 && i < 35) Object.assign(r, { up: false, upAgo: null, one: { status: 'error', age: null } });
    if (i === 35) r.restarts = 1;
  }), ['problem fetcher-down', 'ok fetcher-down']],
  ['the fetcher down twice within 30 minutes (one mail pair only)', run('2026-11-17T10:00', 70, (i, r) => {
    if ((i >= 30 && i < 33) || (i >= 40 && i < 43)) Object.assign(r, { up: false, upAgo: null });
    if (i === 33 || i === 43) r.restarts = 1;
  }), ['problem fetcher-down', 'ok fetcher-down']],
  // The code review of 2026-11-21, finding 1: a problem back within the quiet time and still on when it ends is mailed then.
  ['the fetcher down 3 minutes, then again 40 minutes within the quiet time (mailed when it ends)', run('2026-11-17T10:00', 100, (i, r) => {
    if ((i >= 30 && i < 33) || (i >= 40 && i < 80)) Object.assign(r, { up: false, upAgo: null });
    if (i === 33 || i === 80) r.restarts = 1;
  }), ['problem fetcher-down', 'ok fetcher-down', 'problem fetcher-down', 'ok fetcher-down']],
  // Finding 5: uploads failing, then the fetcher stops answering: no "OK again" until it answers and uploads work.
  ['uploads failing, then the fetcher down 10 minutes (no OK while down)', run('2026-11-17T10:00', 80, (i, r) => {
    if (i >= 30 && i < 50) Object.assign(r, { upOk: 0, upFailed: 3, upAgo: (i - 29) * 60, one: { status: 200, age: (i - 29) * 60 + 5 } });
    if (i >= 40 && i < 50) Object.assign(r, { up: false, upAgo: null });
    if (i === 50) r.restarts = 1;
  }), ['problem stale-file', 'problem uploads-failing', 'problem fetcher-down', 'ok fetcher-down', 'ok uploads-failing', 'ok stale-file']],
  ['the daily summary at 07:00, a quiet night', run('2026-11-17T05:00', 125), ['summary summary']],
  ['the daily summary after a problem', run('2026-11-17T05:00', 125, (i, r) => { if (i === 30) r.refused = 1; }),
    ['problem trv-refused', 'ok trv-refused', 'summary summary']],
];

let bad = 0;
for (const [name, mails, want] of cases) {
  const got = mails.map(m => `${m.kind} ${m.key}`);
  const ok = JSON.stringify([...got].sort()) === JSON.stringify([...want].sort());
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     expected: ${want.join(', ') || 'none'}\n     got:      ${got.join(', ') || 'none'}`}`);
  if (show || !ok) for (const m of mails) console.log(`       [minute ${m.i}] Spårat: ${m.subject}\n         ${m.text.replace(/\n/g, '\n         ')}`);
}
// The summary's wording on the quiet night.
const s = cases.find(c => c[0].startsWith('the daily summary after'))[1].find(m => m.kind === 'summary');
if (!/1 problem/.test(s.subject)) { bad++; console.log(`FAIL summary subject: ${s.subject}`); }
console.log(bad ? `monitor check FAILED (${bad})` : 'monitor check ok');
process.exit(bad ? 1 : 0);
