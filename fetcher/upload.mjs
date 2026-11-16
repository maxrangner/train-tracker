// Puts the fetcher's files on one.com over SFTP (one.com's file upload; measured 2026-11-15, docs/data.md "one.com,
// measured"). One connection is kept open; each file is written under a temporary name and then renamed to its new
// name, so a page never reads half a file (renaming onto a NEW name works there; onto an existing one it doesn't, and
// every file has a new name anyway). Old names are deleted when the shelf lets go of them. A broken connection is
// opened again (1 s, 2 s, 5 s ... 30 s) and the waiting files go then; of the live files only the newest is sent.
// Every 10 minutes the folder is swept of our files nobody needs (also those left by an earlier run).
// The server's key is checked against SFTP_HOSTKEY (SHA256 fingerprints, comma-separated): a different server is
// never sent anything. Pure JavaScript (ssh2), the same on Windows and Linux.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ssh2 from 'ssh2';

const { Client } = ssh2;
const WAITS = [1000, 2000, 5000, 10000, 30000];
const OURS = /^(live|passings|planned|planned-add|disruptions|stats|arrivals|arrivals-add|stations)-\d+\.json$/;
const HTACCESS = readFileSync(new URL('./data.htaccess', import.meta.url));

export function createUploader(cfg, log, { keep = () => false } = {}) {
  for (const k of ['SFTP_HOST', 'SFTP_USER', 'SFTP_PASS', 'SFTP_DIR', 'SFTP_HOSTKEY'])
    if (!cfg[k]) throw new Error(`--upload needs ${k} in the settings file`);
  const dir = cfg.SFTP_DIR.replace(/\/$/, '');
  const pins = cfg.SFTP_HOSTKEY.split(',').map(s => s.trim().replace(/^SHA256:/, '').replace(/=+$/, ''));
  const queue = [];         // [{ op: 'put' | 'rm', name, f }]
  const stats = { ok: 0, failed: 0, removed: 0, reconnects: 0, lastOkAt: null, lastMs: null, connected: false, swept: 0,
    bytes: 0, lastError: null, lastErrorAt: null };
  let client = null, sftp = null, busy = false, closing = false, tries = 0, sweepTimer = null;

  const callOn = (s, fn, ...a) => new Promise((res, rej) => s[fn](...a, (e, v) => e ? rej(e) : res(v)));
  const call = (fn, ...a) => callOn(sftp, fn, ...a);
  let blockedUntil = 0;   // breakFor(): a pretend outage (the live test)

  function connect() {
    if (closing) return;
    if (Date.now() < blockedUntil) return setTimeout(connect, blockedUntil - Date.now());
    const c = new Client();
    client = c;
    c.on('ready', () => c.sftp(async (e, s) => {
      if (e) return broken(e);
      try {   // the folder and its rules first; only then is the connection used for files
        await mkdirs(s, dir);
        await callOn(s, 'writeFile', `${dir}/.htaccess`, HTACCESS);
      } catch (err) { return broken(err); }
      if (client !== c) return;
      sftp = s;
      if (tries) log(`upload: connected again after ${tries} tries`);
      tries = 0; stats.connected = true;
      work();
    }));
    c.on('error', broken);
    c.on('close', () => broken(new Error('connection closed')));
    c.connect({
      host: cfg.SFTP_HOST, port: Number(cfg.SFTP_PORT ?? 22), username: cfg.SFTP_USER, password: cfg.SFTP_PASS,
      readyTimeout: 20000, keepaliveInterval: 15000, keepaliveCountMax: 3,
      hostVerifier: key => pins.includes(createHash('sha256').update(key).digest('base64').replace(/=+$/, '')),
    });
  }
  function broken(e) {
    if (closing || !client) return;
    const c = client;
    client = null; sftp = null; stats.connected = false; busy = false;
    try { c.end(); } catch { /* already gone */ }
    const wait = WAITS[Math.min(tries, WAITS.length - 1)];
    stats.lastError = String(e?.message ?? e); stats.lastErrorAt = Date.now();
    if (tries === 0 || tries % 10 === 0) log(`upload: ${e?.message ?? e}; connecting again in ${wait / 1000} s`);
    tries++; stats.reconnects++;
    setTimeout(connect, wait);
  }
  async function mkdirs(s, path) {
    let at = '';
    for (const part of path.split('/').filter(Boolean)) {
      at += `/${part}`;
      try { await callOn(s, 'stat', at); } catch { await callOn(s, 'mkdir', at); }
    }
  }

  async function work() {
    if (busy || !sftp) return;
    busy = true;
    while (queue.length && sftp) {
      // Of the live files waiting, only the newest is worth sending.
      const lives = queue.filter(q => q.op === 'put' && q.f.kind === 'live');
      for (const q of lives.slice(0, -1)) queue.splice(queue.indexOf(q), 1);
      const job = queue[0];
      const t = Date.now();
      try {
        if (job.op === 'put') {
          const tmp = `${dir}/${job.name}.tmp`;
          await call('writeFile', tmp, job.f.json);
          await call('rename', tmp, `${dir}/${job.name}`);
          stats.ok++; stats.lastOkAt = Date.now(); stats.lastMs = Date.now() - t; stats.bytes += job.f.json.length;
        } else {
          await call('unlink', `${dir}/${job.name}`).catch(e => { if (e.code !== 2) throw e; });   // 2: already gone
          stats.removed++;
        }
        queue.shift();
      } catch (e) {
        stats.failed++; stats.lastError = e.message; stats.lastErrorAt = Date.now();
        if (!sftp) break;                  // the connection broke: the job waits for the next one
        log(`upload: ${job.op} ${job.name}: ${e.message}`);
        queue.shift();                      // a job the server refuses is not tried forever
      }
    }
    busy = false;
  }

  // Our files in the folder that nobody needs any more: older than 5 minutes and not kept by the shelf.
  async function sweep() {
    if (!sftp || busy) return;
    try {
      const list = await call('readdir', dir);
      const now = Date.now();
      for (const { filename } of list) {
        if (!OURS.test(filename) && !/\.json\.tmp$/.test(filename)) continue;
        if (keep(filename)) continue;
        const n = Number(/-(\d+)\.json/.exec(filename)?.[1] ?? 0);
        const made = filename.startsWith('live-') ? n * 5000 : n;
        if (now - made < 5 * 60000) continue;
        queue.push({ op: 'rm', name: filename }); stats.swept++;
      }
      work();
    } catch (e) { log(`upload: sweep: ${e.message}`); }
  }
  sweepTimer = setInterval(sweep, 10 * 60000);
  setTimeout(sweep, 60000);

  connect();
  return {
    add(name, f) { queue.push({ op: 'put', name, f }); work(); },
    remove(name) { queue.push({ op: 'rm', name }); work(); },
    stats: () => ({ ...stats, waiting: queue.length }),
    // The live test (main.mjs --test-breaks): drop the connection and refuse to connect for ms, like a lost internet.
    breakFor(ms) { blockedUntil = Date.now() + ms; if (client) broken(new Error('test break')); },
    close() {
      closing = true;
      clearInterval(sweepTimer);
      return new Promise(res => { if (!client) return res(); client.once('close', res); client.end(); setTimeout(res, 3000); });
    },
  };
}
