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
      load: { asks: 1, askBytes: 1, streamBytes: 1 }, sizes: {}, cpu: { user: 0, system: 0 } }));
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
