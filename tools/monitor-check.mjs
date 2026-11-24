// Checks the monitor's mail rules (monitor/rules.mjs) on made-up timelines: each must give exactly the expected mails
// and no others. No internet, no key. Run: node tools/monitor-check.mjs [--show] (--show prints every mail made).
import { createRules, isOffline, summary } from '../monitor/rules.mjs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { swedishParts } from '../src/clock.js';
import { lateKinds } from '../fetcher/files.mjs';

const MIN = 60000;
const show = process.argv.includes('--show');
// A Swedish clock string as a moment ('2026-11-17T10:00' is Swedish time, winter; an offset may be given), and the
// rows' day, hour and minute in Swedish time as the monitor makes them (monitor/main.mjs; since 2026-11-22 whatever the
// computer's own zone: this check is also run with TZ=UTC).
const at = s => Date.parse(/[+-]\d\d:\d\d$/.test(s) ? s : `${s}:00+01:00`);
function normal(t, over = {}) {
  const p = swedishParts(t);
  return { t, day: p.day, hour: p.hour, minute: p.minute,
    up: true, upFor: 6 * 3600, restarts: 0, asks: 3, refused: 0, trvFailed: 0, bytesIn: 400000, streamsOpened: 0,
    feeds: 'stream/stream', uploads: true, upOk: 13, upFailed: 0, reconnects: 0, bytesOut: 300000, upAgo: 3,
    reportAge: 4, trains: 120, one: { status: 200, age: 5, clockOff: 0 }, sizes: { live: 4200, passings: 40000 },
    memMB: 90, cpuPct: 0.1, ...over };
}
// A timeline: `minutes` rows from `start`; change(i, row) may alter row i (minutes from the start). restartAt: the
// monitor restarts before that minute (2026-11-23: its rows and the rules' memory come back from its files, here a
// snapshot through JSON as main.mjs writes it).
function run(start, minutes, change = () => {}, opts, restartAt = null) {
  let rules = createRules(opts);
  const mails = [], rows = [];
  let upFor = 6 * 3600;
  for (let i = 0; i < minutes; i++) {
    if (i === restartAt) { const snap = JSON.parse(JSON.stringify(rules.snapshot())); rules = createRules(opts); rules.restore(JSON.parse(JSON.stringify(rows)), snap); }
    const row = normal(at(start) + i * MIN, { upFor });
    change(i, row);
    row.offline = isOffline(row);   // as monitor/main.mjs does
    upFor = row.restarts ? 30 : row.up ? row.upFor + 60 : 0;
    row.upFor = row.up ? (row.restarts ? 30 : row.upFor) : 0;
    rows.push(row);
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
  // The summary on the clock-change days, at a time in the hour that repeats (25 Oct) or is skipped (29 Mar): once.
  ['the summary at 02:30 on 25 Oct (the hour comes twice): once', run('2026-10-25T01:00:00+02:00', 240, () => {}, { summaryAt: '02:30' }), ['summary summary']],
  ['the summary at 02:30 on 29 Mar (no such time): once, at 03:00', run('2026-03-29T01:00:00+01:00', 180, () => {}, { summaryAt: '02:30' }), ['summary summary']],
  // The Linux PC's clock (2026-11-22): 2 minutes ahead for 10 minutes; a single odd minute is no mail.
  ["the Linux PC's clock 2 minutes ahead for 10 minutes", run('2026-11-17T10:00', 60, (i, r) => { if (i >= 30 && i < 40) r.one = { ...r.one, clockOff: 120 }; }),
    ['problem clock-off', 'ok clock-off']],
  ["the Linux PC's clock off in one minute only", run('2026-11-17T10:00', 60, (i, r) => { if (i === 30) r.one = { ...r.one, clockOff: -90 }; }), []],
  ['the daily summary at 07:00, a quiet night', run('2026-11-17T05:00', 125), ['summary summary']],
  ['the daily summary after a problem', run('2026-11-17T05:00', 125, (i, r) => { if (i === 30) r.refused = 1; }),
    ['problem trv-refused', 'ok trv-refused', 'summary summary']],
  // Over a restart (2026-11-23): nothing mailed again, nothing lost.
  ['a restart after a problem: no mail again, the summary lists it', run('2026-11-17T05:00', 125, (i, r) => { if (i === 30) r.refused = 1; }, undefined, 60),
    ['problem trv-refused', 'ok trv-refused', 'summary summary']],
  ['a restart after the summary: not sent twice', run('2026-11-17T06:00', 120, () => {}, undefined, 90), ['summary summary']],
  ['a restart while the fetcher is down: its OK comes after', run('2026-11-17T10:00', 60, (i, r) => {
    if (i >= 30 && i < 40) Object.assign(r, { up: false, upAgo: null });
    if (i === 40) r.restarts = 1;
  }, undefined, 35), ['problem fetcher-down', 'ok fetcher-down']],
  ['a restart while the internet is out: one mail when back', run('2026-11-17T10:00', 60, (i, r) => {
    if (i >= 30 && i < 37) Object.assign(r, { upOk: 0, upAgo: (i - 29) * 60, trvFailed: 2, feeds: 'poll/poll', one: { status: 'error', age: null } });
  }, undefined, 33), ['offline offline']],
  // The hang review (2026-11-24). Finding 4: one kind of data frozen for 30 minutes (the fetcher's status says late).
  ['part of the data late for 30 minutes', run('2026-11-17T10:00', 70, (i, r) => {
    if (i >= 30 && i < 60) r.late = [{ kind: 'disruptions', age: 900 + (i - 30) * 60, every: 300 }];
  }), ['problem data-late', 'ok data-late']],
  ['a kind late in the fetcher\'s first 20 minutes: not mailed', run('2026-11-17T10:00', 30, (i, r) => {
    if (i === 5) r.restarts = 1;
    if (i >= 5 && i < 20) r.late = [{ kind: 'stations', age: 99999, every: 86400 }];
  }), []],
  // Finding 8: a stall like 2026-11-24's (no error since the last good upload) said as such, not an old error.
  ['uploads stalled with an old error', run('2026-11-17T10:00', 40, (i, r) => {
    r.upError = 'No response from server'; r.upErrorAt = at('2026-11-17T08:00');
    if (i >= 20 && i < 30) Object.assign(r, { upOk: 0, upAgo: (i - 19) * 60, one: { status: 200, age: (i - 19) * 60 + 5 } });
  }), ['problem stale-file', 'problem uploads-failing', 'ok uploads-failing', 'ok stale-file']],
];

let bad = 0;
for (const [name, mails, want] of cases) {
  const got = mails.map(m => `${m.kind} ${m.key}`);
  const ok = JSON.stringify([...got].sort()) === JSON.stringify([...want].sort());
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     expected: ${want.join(', ') || 'none'}\n     got:      ${got.join(', ') || 'none'}`}`);
  if (show || !ok) for (const m of mails) console.log(`       [minute ${m.i}] Spårat: ${m.subject}\n         ${m.text.replace(/\n/g, '\n         ')}`);
}
{
  const m = cases.find(c => c[0] === 'uploads stalled with an old error')[1].find(x => x.key === 'uploads-failing' && x.kind === 'problem');
  const ok = /No error since the last good upload: it may be stuck/.test(m?.text ?? '') && /from before \(08:00\)/.test(m.text);
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} a stall's mail says no error came since the last good upload, the old error marked as from before${ok ? '' : `: ${m?.text}`}`);
  const late = cases.find(c => c[0] === 'part of the data late for 30 minutes')[1].find(x => x.kind === 'problem');
  const ok2 = /Late: disruptions \(newest \d+ min old; made every 5 min\)/.test(late?.text ?? '');
  if (!ok2) bad++;
  console.log(`${ok2 ? 'ok  ' : 'FAIL'} the late data's mail names the kind and its period${ok2 ? '' : `: ${late?.text}`}`);
}
// Finding 4, the fetcher's side (fetcher/files.mjs lateKinds): which kinds' newest file is late.
{
  const now = at('2026-11-17T10:00');
  const late = lateKinds({ live: 'live-1.json', disruptions: `disruptions-${now - 16 * MIN}.json`, stats: `stats-${now - 14 * MIN}.json`,
    'passings-add': `passings-add-${now - 9 * MIN}.json`, 'taps-add': `taps-add-${now - 11 * MIN}.json`, stations: `stations-${now - 30 * 3600000}.json`, 'card-07': `card-07-${now - 99 * MIN}.json` }, now);
  const ok = JSON.stringify(late.map(k => k.kind)) === JSON.stringify(['disruptions', 'taps-add']) && late[0].every === 300;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} late kinds: over 3 periods and 10 minutes (disruptions 16 min, taps-add 11 min); not stats 14 min, passings-add 9 min, stations 30 h, cards${ok ? '' : `: ${JSON.stringify(late)}`}`);
}
// Finding 7: a summary that throws still mails something, and the rules go on.
{
  const rules = createRules({ context: () => { throw new Error('made-up failure'); } });
  const got = [];
  for (let i = 0; i < 5; i++) got.push(...rules.step(normal(at('2026-11-17T06:58') + i * MIN)));
  const ok = got.length === 1 && got[0].kind === 'summary' && /could not be made: made-up failure/.test(got[0].text);
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} a summary that can't be made: one short mail instead, the monitor goes on${ok ? '' : `: ${JSON.stringify(got)}`}`);
}
// The summary's wording on the quiet night.
const s = cases.find(c => c[0].startsWith('the daily summary after'))[1].find(m => m.kind === 'summary');
if (!/1 problem/.test(s.subject)) { bad++; console.log(`FAIL summary subject: ${s.subject}`); }
const sr = cases.find(c => c[0].startsWith('a restart after a problem'))[1].find(m => m.kind === 'summary');
if (!/1 problem/.test(sr.subject) || !/trafikverket answers "too many requests"/i.test(sr.text)) { bad++; console.log(`FAIL the summary after a restart: ${sr.subject}`); }
else console.log('ok   the summary after a restart lists the problem mailed before it');
// The version in the summary (2026-11-23): each row says its version; an update within the 24 hours is named.
{
  const t0 = at('2026-11-17T06:00');
  const rows = Array.from({ length: 60 }, (_, i) => normal(t0 + i * MIN, { ver: i < 20 ? '0.7.0' : '0.8.0' }));
  const a = summary(rows, [], [], { versionText: 'Spårat 0.8.0 (commit abc1234)' }).text;
  const b = summary(rows.slice(30), [], [], { versionText: 'Spårat 0.8.0 (commit abc1234)' }).text;
  const ok = /Version: Spårat 0\.8\.0 \(commit abc1234\); updated to 0\.8\.0 at 17 nov\.? 06:20 \(from 0\.7\.0\)/.test(a) && /Version: Spårat 0\.8\.0 \(commit abc1234\), the whole time/.test(b);
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} the version in the summary${ok ? '' : `\n${a}\n${b}`}`);
}
// The summary as a page with graphs (2026-11-23; monitor/summary-mail.mjs): a whole made-up day with an outage, the
// days before and the viewers; every number in it, short enough for Gmail (it cuts a mail past 102 kB).
{
  const t0 = at('2026-11-23T07:01');
  const rows = Array.from({ length: 1440 }, (_, i) => {
    const r = normal(t0 + i * MIN, { trains: 100 + (i % 300), memMB: 300 + (i % 140), cpuPct: 2, ver: '0.8.0', bytesIn: 900000, bytesOut: 230000 });
    if (i >= 360 && i < 401) Object.assign(r, { trvFailed: 2, feeds: 'poll/poll', one: { status: 'error', age: null } });
    r.offline = isOffline(r);
    return r;
  });
  const days = [{ day: '2026-11-21', minutes: 1440, trainsMax: 265, bytesIn: 945e6, bytesOut: 247e6, memMax: 365, problems: 0 },
    { day: '2026-11-22', minutes: 1440, trainsMax: 365, bytesIn: 1041e6, bytesOut: 268e6, memMax: 427, problems: 0 },
    { day: '2026-11-22', minutes: 300, partial: true, trainsMax: 1, problems: 0 }];
  const viewers = { at: t0, error: null, days: [{ day: '2026-11-23', people: 412, app: 96, site: 316, peak: 23, peakAt: at('2026-11-23T17:35') }],
    hours: [{ t: at('2026-11-23T17:00'), people: 38, peak: 21 }] };
  const ctx = { versionText: 'Spårat 0.8.0 (commit abc1234)', days, viewers };
  const mails = [{ t: at('2026-11-23T13:42'), kind: 'offline', key: 'offline', subject: 'the internet was out 13:00–13:41 (41 min)' }];
  const s = summary(rows, mails, [], ctx);
  const kb = Buffer.byteLength(s.html) / 1000;
  const want = ['Spårat 0.8.0 (commit abc1234)', '>412<', 'app 96 · site 316', '>23<', 'at 17:35', '>399<', 'the internet was out 13:00–13:41', 'internet out 41 min',
    'Sun 22', 'Sat 21', '>1 041<', '>427<', 'People at once', 'most 21 at 17:00', 'Trains on the map', 'Running', 'Fetcher CPU', '<!--foot-->', 'watched 24 h of 24'];
  const missing = want.filter(w => !s.html.includes(w));
  check(`the summary page: ${kb.toFixed(1)} kB, every number in it, the days before (the whole day's line, not the part one)`,
    kb < 90 && !missing.length && !s.html.includes('>1<') && /Viewers: 2026-11-23 412 people \(app 96, site 316\), most at once 23 at 17:35/.test(s.text),
    `missing: ${missing.join(' | ')}`);
  const none = summary(rows.slice(0, 600), [], [], { versionText: 'Spårat 0.7.0' });
  check('the summary page without the viewer count (before the release): says so, no viewer graphs, no empty week',
    none.html.includes('counted from the next release') && !none.html.includes('People at once') && none.html.includes('No days kept yet') && none.html.includes('watched 10 h of 24'));
}
function check(name, ok, more = '') { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     ${more}`}`); }
await live();
console.log(bad ? `monitor check FAILED (${bad})` : 'monitor check ok');
process.exit(bad ? 1 : 0);

// The monitor itself for a few seconds (--test-minute-ms 1000: a "minute" is a second), against a pretend fetcher and
// a pretend outside-warning address (2026-11-23): one call a "minute"; the rows kept in its folder and read back after
// a restart; a dead address neither stops the rows nor mails.
async function live() {
  const ROOT = fileURLToPath(new URL('..', import.meta.url));
  const serve = handler => new Promise(res => { const s = createServer(handler).listen(0, '127.0.0.1', () => res(s)); });
  const fetcher = await serve((req, res) => {
    const now = Date.now();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ now, up: 600, pid: 1, startedAt: now - 600000, memoryMB: 90,
      feeds: { positions: { mode: 'stream' }, passings: { mode: 'stream' }, newestReport: now - 3000 }, state: { trains: 100 },
      load: { asks: 1, askBytes: 1, streamBytes: 1 }, sizes: {}, cpu: { user: 0, system: 0 },
      viewers: { at: now, error: null, days: [{ day: swedishParts(now).day, people: 5, app: 2, site: 3, peak: 4, peakAt: now }, { day: '<b>x', people: 9 }],
        hours: [{ t: now - (now % 3600000), people: 5, peak: 4 }] } }));
  });
  let pings = 0;
  const pinger = await serve((req, res) => { pings++; res.writeHead(200); res.end('OK'); });
  const dir = mkdtempSync(join(tmpdir(), 'monitor-check-'));
  const runMonitor = (pingUrl, seconds) => new Promise(res => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(MAIL_|MONITOR_|STATE_DIRECTORY$)/.test(k)));
    Object.assign(env, { MONITOR_FETCHER: `http://127.0.0.1:${fetcher.address().port}/status`, MONITOR_PORT: '0', MONITOR_DAY_DIR: dir, MONITOR_PING_URL: pingUrl });
    const p = spawn(process.execPath, ['monitor/main.mjs', '--env', join(dir, 'none.env'), '--test-minute-ms', '1000', '--minutes', String(seconds)], { cwd: ROOT, env });
    let out = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
    p.on('exit', code => res({ code, out }));
  });
  const lines = () => readFileSync(join(dir, 'rows.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const check = (name, ok, more = '') => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n${more}`}`); };
  try {
    const a = await runMonitor(`http://127.0.0.1:${pinger.address().port}/ping`, 8);
    const r1 = lines();
    check(`the monitor live: ${r1.length} rows kept, ${pings} calls to the warning address, version "${r1[0]?.ver}"`,
      a.code === 0 && r1.length >= 5 && Math.abs(pings - r1.length) <= 1 && r1.every(r => r.ver === 'dev' && r.up) && /started \(Spårat dev;/.test(a.out), a.out);
    const dayLine = JSON.parse(readFileSync(join(dir, 'days.jsonl'), 'utf8').trim().split('\n').at(-1));
    check(`the day file keeps the viewer count (${JSON.stringify(dayLine.viewers)}), an odd day name from the fetcher dropped`,
      dayLine.viewers?.people === 5 && dayLine.viewers.app === 2 && dayLine.viewers.peak === 4 && !readFileSync(join(dir, 'days.jsonl'), 'utf8').includes('<b>'));
    const b = await runMonitor('http://127.0.0.1:1/ping', 6);
    const r2 = lines();
    check(`after a restart: ${r1.length} rows read back, ${r2.length - r1.length} more; a dead warning address logged once, no mail`,
      b.code === 0 && new RegExp(`kept from before: ${r1.length} minutes`).test(b.out) && r2.length >= r1.length + 3
        && (b.out.match(/outside warning: call failed/g) ?? []).length === 1 && !/problem|offline:/.test(b.out), b.out);
  } finally {
    fetcher.close(); pinger.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
