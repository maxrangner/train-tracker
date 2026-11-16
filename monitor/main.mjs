// Spårat's monitor: runs beside the fetcher on the Linux PC (Max, 2026-11-16). It watches the fetcher (running,
// restarts, its traffic to Trafikverket and one.com, the data's health, file sizes), mails Max when something goes wrong
// and once a day a summary (monitor/rules.mjs, monitor/mail.mjs), and shows it all on a page and in a terminal on that
// PC only (127.0.0.1: no other device can reach it).
//
// Run (Node 22 or newer):  node monitor/main.mjs --env <settings file>   (monitor/example.env shows the lines)
// On Linux as a service: monitor/sparat-monitor.service. The terminal view: node monitor/top.mjs
// Test options: --minutes N (stop after N minutes), --test-offline A,AxL (from minute A pretend no internet for 1 or L
// minutes: the read of one.com and mails fail), --summary-at HH:MM (instead of 07:00).
//
// What it keeps: a row a minute for 24 hours in memory; one line per day in days.jsonl (in the service's own folder,
// STATE_DIRECTORY, or DAY_DIR). Nothing else is written.
import { createServer } from 'node:http';
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRules, dayNumbers } from './rules.mjs';
import { createMailer } from './mail.mjs';

const MIN = 60000;
const args = process.argv.slice(2);
const arg = (name, dflt = null) => { const i = args.indexOf(name); return i < 0 ? dflt : args[i + 1]; };
const envPath = arg('--env', process.env.SPARAT_MONITOR_ENV ?? 'monitor.env');
function readEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}
const cfg = { ...readEnv(envPath), ...Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(MAIL_|MONITOR_)/.test(k))) };
const FETCHER = cfg.MONITOR_FETCHER ?? 'http://127.0.0.1:8091/status';
const DATA_URL = cfg.MONITOR_DATA_URL ? cfg.MONITOR_DATA_URL.replace(/\/?$/, '/') : '';   // where viewers read the files (one.com)
const PAGE_PORT = Number(cfg.MONITOR_PORT ?? 8092);
const DAY_DIR = process.env.STATE_DIRECTORY ?? cfg.MONITOR_DAY_DIR ?? 'monitor-days';
const summaryAt = arg('--summary-at', cfg.MONITOR_SUMMARY_AT ?? '07:00');
const log = (...a) => console.log(new Date().toLocaleString('sv-SE'), ...a);

// --test-offline: pretend lost internet for the monitor (its read of one.com and its mails).
const offlineSpans = (arg('--test-offline') ?? '').split(',').filter(Boolean).map(p => { const [a, l = 1] = p.split('x').map(Number); return [a * MIN, (a + l) * MIN]; });
const startT = Date.now();
const testOffline = () => offlineSpans.some(([a, b]) => Date.now() - startT >= a && Date.now() - startT < b);

const rules = createRules({ summaryAt });
const mailer = createMailer(cfg, log, { offline: testOffline });

// ---------- watching the fetcher (every 15 s) ----------
let cur = null;               // the newest status from the fetcher
let lastPid = null, minutePolls = 0, minuteUp = 0, minuteRestarts = 0;
async function poll() {
  minutePolls++;
  try {
    const s = await (await fetch(FETCHER, { signal: AbortSignal.timeout(5000) })).json();
    if (lastPid !== null && s.pid !== lastPid) { minuteRestarts++; log(`the fetcher started again (process ${s.pid})`); }
    lastPid = s.pid; cur = { ...s, seenAt: Date.now() }; minuteUp++;
  } catch { /* not answering: counted by the minute row */ }
}

// ---------- reading the newest file on one.com, as a viewer (once a minute) ----------
const LIVE_MS = 5000;
async function readOne() {
  if (!DATA_URL) return { status: 'off', age: null };
  if (testOffline()) return { status: 'error', age: null };
  const now = Date.now();
  let status = 404;
  for (let back = 1; back <= 4; back++) {   // the newest finished 5-s file, then older ones (as the page will)
    const slot = Math.floor(now / LIVE_MS) - back;
    try {
      const res = await fetch(`${DATA_URL}live-${slot}.json`, { method: 'HEAD', signal: AbortSignal.timeout(10000), headers: { 'Accept-Encoding': 'gzip' } });
      status = res.status;
      if (res.status === 200) return { status: 200, age: Math.round((now - slot * LIVE_MS) / 1000) };
      if (res.status !== 404) return { status: res.status, age: null };
    } catch { return { status: 'error', age: null }; }
  }
  return { status, age: null };
}

// ---------- the minute row ----------
const rows = [];
let base = null;              // the fetcher's counts at the last row (same process)
const diff = (a, b) => (a ?? 0) - (b ?? 0);
function localParts(t) {
  const d = new Date(t);
  return { day: d.toLocaleDateString('sv-SE'), hour: d.getHours(), minute: d.getMinutes() };
}
async function minuteRow() {
  const one = await readOne();
  const t = Date.now();
  const fresh = cur && t - cur.seenAt < 30000 ? cur : null;
  const up = minuteUp > 0 && fresh !== null;
  // Counts since the last row; after a restart the new process counts from zero.
  const b = fresh && base && base.pid === fresh.pid ? base : null;
  const L = fresh?.load ?? {}, B = b?.load ?? {}, U = fresh?.upload ?? null, BU = b?.upload ?? {};
  const cpuMs = fresh ? (diff(fresh.cpu?.user, b?.cpu?.user) + diff(fresh.cpu?.system, b?.cpu?.system)) / 1000 : 0;
  const elapsed = fresh ? (b ? fresh.now - b.now : fresh.up * 1000) : 0;
  const row = {
    t, ...localParts(t),
    up, upFor: fresh ? fresh.up : 0, restarts: minuteRestarts,
    asks: diff(L.asks, B.asks), refused: diff(L.refused, B.refused), trvFailed: diff(L.failed, B.failed),
    bytesIn: diff(L.askBytes, B.askBytes) + diff(L.streamBytes, B.streamBytes), streamsOpened: diff(L.streams, B.streams),
    feeds: fresh ? `${fresh.feeds.positions.mode}/${fresh.feeds.passings.mode}` : '-',
    uploads: Boolean(U), upOk: diff(U?.ok, BU.ok), upFailed: diff(U?.failed, BU.failed), reconnects: diff(U?.reconnects, BU.reconnects),
    bytesOut: diff(U?.bytes, BU.bytes), upAgo: U?.lastOkAt ? Math.round((fresh.now - U.lastOkAt) / 1000) : null,
    upError: U?.lastError ?? null,
    reportAge: fresh?.feeds.newestReport ? Math.max(0, Math.round((fresh.now - fresh.feeds.newestReport) / 1000)) : null,
    trains: fresh?.state.trains ?? null,
    one, offline: one.status === 'error',
    sizes: fresh ? Object.fromEntries(Object.entries(fresh.sizes ?? {}).map(([k, s]) => [k, s.gz])) : {},
    memMB: fresh?.memoryMB ?? null, cpuPct: elapsed > 0 ? Math.round(1000 * cpuMs / elapsed) / 10 : null,
  };
  if (fresh) base = fresh;
  minuteUp = 0; minuteRestarts = 0; minutePolls = 0;
  return row;
}

// ---------- the day file ----------
function writeDay(dayRows, partial = false) {
  if (!dayRows.length) return;
  try {
    mkdirSync(DAY_DIR, { recursive: true });
    appendFileSync(join(DAY_DIR, 'days.jsonl'), JSON.stringify({ day: dayRows[0].day, partial: partial || dayRows.length < 1380, ...dayNumbers(dayRows) }) + '\n');
  } catch (e) { log(`day file: ${e.message}`); }
}
function readDays() {
  try {
    return readFileSync(join(DAY_DIR, 'days.jsonl'), 'utf8').trim().split('\n').filter(Boolean).slice(-90).map(l => JSON.parse(l));
  } catch { return []; }
}

// ---------- each minute ----------
const mails = [];             // the mails made (for the page), newest last
async function tick() {
  // The first row only after at least 50 s of watching (a row made seconds after the start would say "not running"
  // for a fetcher that was just slower to start).
  if (Date.now() - startT < 50000) { minuteUp = 0; minuteRestarts = 0; minutePolls = 0; return; }
  let row;
  try { row = await minuteRow(); } catch (e) { log(`row: ${e.message}`); return; }
  const prev = rows.at(-1);
  if (prev && prev.day !== row.day) writeDay(rows.filter(x => x.day === prev.day));
  rows.push(row);
  while (rows.length > 1440) rows.shift();
  if (prev?.offline && !row.offline) mailer?.nudge();
  for (const m of rules.step(row)) {
    log(`${m.kind}: ${m.subject}`);
    mails.push(m); if (mails.length > 200) mails.shift();
    mailer?.send(m);
  }
}

// ---------- the page and the data (this computer only) ----------
const PAGE = new URL('./page.html', import.meta.url);
const data = () => ({
  now: Date.now(), startedAt: startT, summaryAt, dataUrl: DATA_URL, mailTo: cfg.MAIL_TO ?? null, mail: mailer?.stats() ?? null,
  fetcher: cur ? { up: Date.now() - cur.seenAt < 30000, pid: cur.pid, startedAt: cur.startedAt, feeds: cur.feeds, state: cur.state,
    upload: cur.upload, sizes: cur.sizes, memoryMB: cur.memoryMB, seenAt: cur.seenAt } : null,
  open: rules.open(), mails: mails.slice(-50), rows, days: readDays(),
});
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(readFileSync(PAGE)); }
  if (path === '/data.json') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify(data())); }
  res.writeHead(404); res.end();
});
server.listen(PAGE_PORT, '127.0.0.1');

// ---------- timers ----------
poll();
const pollTimer = setInterval(poll, 15000);
let minuteTimer = null;
function nextMinute() { minuteTimer = setTimeout(async () => { await tick(); nextMinute(); }, MIN - (Date.now() % MIN) + 1000); }
nextMinute();

function stop(why) {
  log(`stopping (${why}); ${rows.length} minutes watched, ${mails.length} mails made${mailer ? `, ${mailer.stats().sent} sent, ${mailer.stats().waiting} waiting` : ''}`);
  clearInterval(pollTimer); clearTimeout(minuteTimer);
  const last = rows.at(-1);
  if (last) writeDay(rows.filter(x => x.day === last.day), true);
  server.close(); mailer?.close();
  setTimeout(() => process.exit(0), 200);
}
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
const minutes = arg('--minutes') ? Number(arg('--minutes')) : null;
if (minutes) setTimeout(() => stop(`${minutes} minutes`), minutes * MIN);
log(`started (${envPath}; fetcher ${FETCHER}; one.com ${DATA_URL || 'not set'}; mail ${mailer ? `to ${cfg.MAIL_TO}` : 'off'}; page http://127.0.0.1:${PAGE_PORT}/; days in ${DAY_DIR}; Node ${process.version})`);
