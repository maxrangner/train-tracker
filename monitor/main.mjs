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
// What it keeps, in the service's own folder (STATE_DIRECTORY, or DAY_DIR): a row a minute for 25 hours in rows.jsonl
// and the mail rules' memory in state.json (since 2026-11-23: an update or a restart kept nothing, and the next summary
// covered only the hours since), and one line per day in days.jsonl. Nothing else is written.
import { createServer, get as httpGet } from 'node:http';
import { readFileSync, existsSync, appendFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createRules, dayNumbers, isOffline } from './rules.mjs';
import { swedishParts } from '../src/clock.js';
import { createMailer } from './mail.mjs';

const args = process.argv.slice(2);
const arg = (name, dflt = null) => { const i = args.indexOf(name); return i < 0 ? dflt : args[i + 1]; };
// --test-minute-ms N: a "minute" of N ms, all timers scaled (tools/monitor-check.mjs runs the monitor for real in seconds).
const MIN = Number(arg('--test-minute-ms', 60000));
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
// The outside warning while home is dark (deploy.md section 10; Max, 2026-11-23): an address called once a minute
// (healthchecks.io); it mails Max when the calls stop. Empty: off.
const PING_URL = /^https?:\/\/[^\s]+$/.test(cfg.MONITOR_PING_URL ?? '') ? cfg.MONITOR_PING_URL : '';
const log = (...a) => console.log(new Date(Date.now()).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' }), ...a);
// The version running (Max, 2026-11-23: the mails didn't tell; it had to be worked out from the restarts): the
// package's MANIFEST.json (tools/pack-linux.mjs) beside monitor/; none when run from the project folder ("dev").
const VERSION = (() => {
  try {
    const m = JSON.parse(readFileSync(new URL('../MANIFEST.json', import.meta.url), 'utf8'));
    const v = typeof m.version === 'string' && /^[\w.+-]{1,30}$/.test(m.version) ? m.version : null;
    const c = typeof m.commit === 'string' && /^[\w+]{1,20}$/.test(m.commit) ? m.commit : null;
    return v ? { version: v, commit: c } : { version: 'dev', commit: null };
  } catch { return { version: 'dev', commit: null }; }
})();
const versionText = `Spårat ${VERSION.version}${VERSION.commit ? ` (commit ${VERSION.commit})` : ''}`;

// The fetcher's status: over HTTP (MONITOR_FETCHER=http://127.0.0.1:8091/status, Windows and tests), or from its local
// socket file (MONITOR_FETCHER=unix:/run/sparat/status.sock, the Linux service: no network address, plan step 2).
function readStatus() {
  if (!FETCHER.startsWith('unix:')) return fetch(FETCHER, { signal: AbortSignal.timeout(5000), redirect: 'error' }).then(r => r.json());
  return new Promise((res, rej) => {
    const q = httpGet({ socketPath: FETCHER.slice(5), path: '/status', timeout: 5000 }, r => {
      let body = '';
      r.setEncoding('utf8'); r.on('data', c => { if ((body += c).length > 1e6) q.destroy(new Error('status too big')); });
      r.on('end', () => { try { res(JSON.parse(body)); } catch (e) { rej(e); } });
    });
    q.on('timeout', () => q.destroy(new Error('no answer in 5 s'))); q.on('error', rej);
  });
}

// The self-check (monitor/self-check.mjs) runs first and alone, then exits (78 or 79).
{
  const where = args.includes('--self-check') ? arg('--self-check') : arg('--self-check-file') && existsSync(arg('--self-check-file')) ? 'inside' : null;
  if (where) {
    const { selfCheck } = await import('./self-check.mjs');
    process.exit(await selfCheck(where === 'inside' ? 'inside' : 'outside', cfg, { args, readStatus, dataUrl: DATA_URL }));
  }
}

// --test-offline: pretend lost internet for the monitor (its read of one.com and its mails).
const offlineSpans = (arg('--test-offline') ?? '').split(',').filter(Boolean).map(p => { const [a, l = 1] = p.split('x').map(Number); return [a * MIN, (a + l) * MIN]; });
const startT = Date.now();
const testOffline = () => offlineSpans.some(([a, b]) => Date.now() - startT >= a && Date.now() - startT < b);

const rules = createRules({ summaryAt, context: () => summaryContext() });
const mailer = createMailer(cfg, log, { offline: testOffline, version: versionText });

// ---------- watching the fetcher (every 15 s) ----------
let cur = null;               // the newest status from the fetcher
// The fetcher's status is taken in only as the numbers and short words it should hold (Codex's review, 2026-11-17):
// a fetcher gone wrong can't put page code into the monitor page or odd text into a mail.
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const word = v => (typeof v === 'string' && /^[a-z-]{1,20}$/.test(v) ? v : '?');
const text = v => (typeof v === 'string' ? v.slice(0, 300).replace(/[<>&"'`]/g, '?') : null);   // never page code, wherever it is shown
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, num(o[k])]));
function cleanStatus(s) {
  const F = obj(s.feeds), U = s.upload && typeof s.upload === 'object' ? s.upload : null, feed = f => ({ mode: word(obj(f).mode), since: num(obj(f).since) });
  return {
    ...pick(obj(s), ['now', 'up', 'pid', 'startedAt', 'memoryMB']),
    feeds: { positions: feed(F.positions), passings: feed(F.passings), lastRecordAt: num(F.lastRecordAt), newestReport: num(F.newestReport) },
    state: Object.fromEntries(Object.entries(obj(s.state)).filter(([k]) => /^[a-zA-Z]{1,20}$/.test(k)).map(([k, v]) => [k, num(v)])),
    load: pick(obj(s.load), ['asks', 'streams', 'since', 'askBytes', 'refused', 'failed', 'streamBytes']),
    upload: U && { ...pick(U, ['ok', 'failed', 'removed', 'reconnects', 'lastOkAt', 'lastMs', 'swept', 'bytes', 'lastErrorAt', 'waiting']),
      connected: U.connected === true, lastError: text(U.lastError), refused: text(U.refused) },
    sizes: Object.fromEntries(Object.entries(obj(s.sizes)).filter(([k]) => /^[a-z-]{1,20}$/.test(k))
      .map(([k, v]) => [k, { name: /^[a-z0-9.-]{1,60}$/.test(obj(v).name ?? '') ? v.name : null, bytes: num(obj(v).bytes), gz: num(obj(v).gz) }])),
    cpu: pick(obj(s.cpu), ['user', 'system']),
  };
}
let lastPid = null, minutePolls = 0, minuteUp = 0, minuteRestarts = 0;
async function poll() {
  minutePolls++;
  try {
    const s = cleanStatus(await readStatus());
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
  let status = 404, clockOff = null;
  // The Linux PC's clock against one.com's (the answer's Date header, whole seconds): the files are named by this
  // clock, and every viewer's page sets its own by them (TODO 62, 2026-11-22: nothing checked it).
  const clockOf = (res) => { const d = Date.parse(res.headers.get('date') ?? ''); if (clockOff === null && Number.isFinite(d)) clockOff = Math.round((Date.now() - (d + 500)) / 1000); };
  for (let back = 1; back <= 4; back++) {   // the newest finished 5-s file, then older ones (as the page will)
    const slot = Math.floor(now / LIVE_MS) - back;
    try {
      const res = await fetch(`${DATA_URL}live-${slot}.json`, { method: 'HEAD', signal: AbortSignal.timeout(10000), headers: { 'Accept-Encoding': 'gzip' }, redirect: 'error' });
      status = res.status;
      clockOf(res);
      if (res.status === 200) return { status: 200, age: Math.round((now - slot * LIVE_MS) / 1000), clockOff };
      if (res.status !== 404) return { status: res.status, age: null, clockOff };
    } catch { return { status: 'error', age: null, clockOff }; }
  }
  return { status, age: null, clockOff };
}

// ---------- the minute row ----------
const rows = [];
let base = null;              // the fetcher's counts at the last row (same process)
const diff = (a, b) => (a ?? 0) - (b ?? 0);
// Swedish time whatever the Linux PC's own zone (until 2026-11-22 the PC's: in UTC the 07:00 summary, the day's
// numbers and the daytime rules would have run an hour or two off; TODO 62).
function localParts(t) {
  return swedishParts(t);
}
async function minuteRow() {
  const one = await readOne();
  const t = Date.now();
  const fresh = cur && t - cur.seenAt < MIN / 2 ? cur : null;
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
    one,
    sizes: fresh ? Object.fromEntries(Object.entries(fresh.sizes ?? {}).map(([k, s]) => [k, s.gz])) : {},
    memMB: fresh?.memoryMB ?? null, cpuPct: elapsed > 0 ? Math.round(1000 * cpuMs / elapsed) / 10 : null,
    ver: VERSION.version,
  };
  row.offline = isOffline(row);
  if (fresh) base = fresh;
  minuteUp = 0; minuteRestarts = 0; minutePolls = 0;
  return row;
}

// ---------- the day file ----------
function writeDay(dayRows, partial = false) {
  if (!dayRows.length) return;
  const day = dayRows[0].day;
  const problems = rules.sent().filter(m => (m.kind === 'problem' || m.kind === 'offline') && swedishParts(m.t).day === day).length;
  try {
    mkdirSync(DAY_DIR, { recursive: true });
    appendFileSync(join(DAY_DIR, 'days.jsonl'), JSON.stringify({ day, partial: partial || dayRows.length < 1380, ...dayNumbers(dayRows), problems, ver: dayRows.at(-1).ver ?? null }) + '\n');
  } catch (e) { log(`day file: ${e.message}`); }
}
function readDays() {
  try {
    return readFileSync(join(DAY_DIR, 'days.jsonl'), 'utf8').trim().split('\n').filter(Boolean).slice(-90).map(l => JSON.parse(l));
  } catch { return []; }
}
// What the summary needs beyond the rows (monitor/rules.mjs): the version, the days before, the viewers.
function summaryContext() {
  return { version: VERSION.version, versionText, days: readDays() };
}

// ---------- the minutes and the rules' memory over a restart (2026-11-23) ----------
const ROWS_FILE = join(DAY_DIR, 'rows.jsonl'), STATE_FILE = join(DAY_DIR, 'state.json');
const KEEP_MS = 25 * 3600000;
function writeAtomic(path, text) {
  mkdirSync(DAY_DIR, { recursive: true });
  writeFileSync(path + '.new', text); renameSync(path + '.new', path);
}
function restore() {
  let kept = [];
  try {
    const cut = Date.now() - KEEP_MS;
    kept = readFileSync(ROWS_FILE, 'utf8').split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(r => r && typeof r.t === 'number' && r.t > cut && r.t < Date.now() + 60000)
      .sort((a, b) => a.t - b.t);
    writeAtomic(ROWS_FILE, kept.map(r => JSON.stringify(r) + '\n').join(''));
  } catch (e) { if (e.code !== 'ENOENT') log(`rows file: ${e.message}`); }
  let state = null;
  try { state = JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') log(`state file: ${e.message}`); }
  rows.push(...kept.slice(-1500));
  rules.restore(kept, state);
  if (kept.length) log(`kept from before: ${kept.length} minutes (from ${new Date(kept[0].t).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })})`);
}
let rowsSinceTrim = 0;
function keepRow(row) {
  try {
    mkdirSync(DAY_DIR, { recursive: true });
    if (++rowsSinceTrim >= 60) {   // once an hour the file is cut back to 25 hours
      rowsSinceTrim = 0;
      writeAtomic(ROWS_FILE, rows.filter(r => r.t > Date.now() - KEEP_MS).map(r => JSON.stringify(r) + '\n').join(''));
    } else appendFileSync(ROWS_FILE, JSON.stringify(row) + '\n');
  } catch (e) { log(`rows file: ${e.message}`); }
}
function keepState() {
  try { writeAtomic(STATE_FILE, JSON.stringify(rules.snapshot())); } catch (e) { log(`state file: ${e.message}`); }
}

// ---------- the outside warning: a call a minute ----------
const ping = { ok: 0, failed: 0, lastOkAt: null, lastError: null };
function sendPing() {
  if (!PING_URL || testOffline()) return;
  fetch(PING_URL, { signal: AbortSignal.timeout(10000) })
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); if (ping.lastError) log('outside warning: calls answered again'); ping.ok++; ping.lastOkAt = Date.now(); ping.lastError = null; })
    .catch(e => { if (!ping.lastError) log(`outside warning: call failed (${e.cause?.code ?? e.message})`); ping.failed++; ping.lastError = String(e.cause?.code ?? e.message).slice(0, 200); });
}

// ---------- each minute ----------
const mails = [];             // the mails made (for the page), newest last
async function tick() {
  // The first row only after at least 50 s of watching (a row made seconds after the start would say "not running"
  // for a fetcher that was just slower to start).
  if (Date.now() - startT < MIN * 5 / 6) { minuteUp = 0; minuteRestarts = 0; minutePolls = 0; return; }
  let row;
  try { row = await minuteRow(); } catch (e) { log(`row: ${e.message}`); return; }
  const prev = rows.at(-1);
  if (prev && prev.day !== row.day) writeDay(rows.filter(x => x.day === prev.day));
  rows.push(row);
  while (rows.length > 1500) rows.shift();   // 25 hours: the day the clock goes back has 1,500 minutes (1,440 lost its first hour)
  keepRow(row);
  sendPing();
  if (prev?.offline && !row.offline) mailer?.nudge();
  const made = rules.step(row);
  for (const m of made) {
    log(`${m.kind}: ${m.subject}`);
    mails.push(m); if (mails.length > 200) mails.shift();
    mailer?.send(m);
  }
  if (made.length || row.minute % 10 === 0) keepState();
}

// ---------- the page and the data (this computer only) ----------
const PAGE = new URL('./page.html', import.meta.url);
const data = () => ({
  now: Date.now(), startedAt: startT, summaryAt, dataUrl: DATA_URL, mailTo: cfg.MAIL_TO ?? null, mail: mailer?.stats() ?? null,
  version: versionText, ping: PING_URL ? { ...ping } : null,
  fetcher: cur ? { up: Date.now() - cur.seenAt < 30000, pid: cur.pid, startedAt: cur.startedAt, feeds: cur.feeds, state: cur.state,
    upload: cur.upload, sizes: cur.sizes, memoryMB: cur.memoryMB, seenAt: cur.seenAt } : null,
  open: rules.open(), mails: mails.slice(-50), rows, days: readDays(),
});
const server = createServer((req, res) => {
  let path;
  try { path = new URL(req.url, 'http://x').pathname; } catch { res.writeHead(400); return res.end(); }   // a malformed address: 400, no crash
  if (path === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(readFileSync(PAGE)); }
  if (path === '/data.json') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify(data())); }
  res.writeHead(404); res.end();
});
// If the page's port is taken (another monitor still running), the watching and the mails go on without the page.
server.on('error', e => log(`page: ${e.code === 'EADDRINUSE' ? `port ${PAGE_PORT} is taken (another monitor running?)` : e.message}; watching and mails go on without the page`));
server.listen(PAGE_PORT, '127.0.0.1');

// ---------- timers ----------
restore();
poll();
const pollTimer = setInterval(poll, MIN / 4);
let minuteTimer = null;
function nextMinute() { minuteTimer = setTimeout(async () => { await tick(); nextMinute(); }, MIN - (Date.now() % MIN) + MIN / 60); }
nextMinute();

function stop(why) {
  log(`stopping (${why}); ${rows.length} minutes watched, ${mails.length} mails made${mailer ? `, ${mailer.stats().sent} sent, ${mailer.stats().waiting} waiting` : ''}`);
  clearInterval(pollTimer); clearTimeout(minuteTimer);
  const last = rows.at(-1);
  if (last) writeDay(rows.filter(x => x.day === last.day), true);
  keepState();
  server.close(); mailer?.close();
  setTimeout(() => process.exit(0), 200);
}
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
const minutes = arg('--minutes') ? Number(arg('--minutes')) : null;
if (minutes) setTimeout(() => stop(`${minutes} minutes`), minutes * MIN);
log(`started (${versionText}; ${envPath}; outside warning ${PING_URL ? 'on' : 'off'}; fetcher ${FETCHER}; one.com ${DATA_URL || 'not set'}; mail ${mailer ? `to ${cfg.MAIL_TO}` : 'off'}; page http://127.0.0.1:${PAGE_PORT}/; days in ${DAY_DIR}; Node ${process.version})`);
