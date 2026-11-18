// Puts the fetcher's files on one.com over SFTP (one.com's file upload; measured 2026-11-15, docs/data.md "one.com,
// measured"). One connection is kept open; each file is written under a temporary name and then renamed to its new
// name, so a page never reads half a file (renaming onto a NEW name works there; onto an existing one it doesn't, and
// every file has a new name anyway). Old names are deleted when the shelf lets go of them. A broken connection is
// opened again (1 s, 2 s, 5 s ... 30 s) and the waiting files go then: only what the newest live file needs, that
// file first after them, deletes last (order() below).
// Every 10 minutes the folder is swept of our files nobody needs (also those left by an earlier run).
// Files go up packed (gzip, since 2026-11-16: about 5 times less to send); one.com hands them out as they are, saying
// so in a header (fetcher/data.htaccess), and browsers unpack them by themselves.
// The server's key is checked against SFTP_HOSTKEY (SHA256 fingerprints, comma-separated): a different server is
// never sent anything. Pure JavaScript (ssh2), the same on Windows and Linux.
//
// Only Spårat's own folder, never anything else (plan to beta step 1, 2026-11-17; Codex's review): the one.com login
// opens the owner's whole web space, so one typo in SFTP_DIR must not touch another site.
// - SFTP_DIR must be a plain absolute path (letters, digits, . _ - and /; no "..", no "//").
// - On every new connection, before anything is written, the folder must be what SFTP_DIR says (its real path, so no
//   link leads elsewhere), a folder, and hold Spårat's marker: a plain file named .sparat-data (tools/deploy.mjs puts
//   it there). Otherwise nothing is written or deleted; the reason goes to the log and the status (the monitor mails
//   it) and the folder is looked at again in 10 minutes. No folder is ever made here.
// - Only names the fetcher makes are written or deleted (NAME below, and the same + ".tmp"); anything else asked of
//   it is refused. Temporary files are made only if no file of that name exists ('wx'), so a planted link is never
//   written through; .htaccess is written only if it is a plain file or missing.
// These stop mistakes. Someone who had the password itself could still reach everything (the daily check finds that).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ssh2 from 'ssh2';

const WAITS = [1000, 2000, 5000, 10000, 30000];
const REFUSED_WAIT = 10 * 60000;
export const MARK = '.sparat-data';
export const NAME = /^(live|passings|passings-add|planned|planned-add|disruptions|stats|arrivals|arrivals-add|stations|card-\d\d|board-\d\d|taps-add|taps-index|messages)-\d+\.json$/;
const TMP = /^(live|passings|passings-add|planned|planned-add|disruptions|stats|arrivals|arrivals-add|stations|card-\d\d|board-\d\d|taps-add|taps-index|messages)-\d+\.json\.tmp$/;
const HTACCESS = readFileSync(new URL('./data.htaccess', import.meta.url));

const callOn = (s, fn, ...a) => new Promise((res, rej) => s[fn](...a, (e, v) => e ? rej(e) : res(v)));
const gone = e => e?.code === 2;   // SFTP "no such file"
const verifier = cfg => {
  const pins = cfg.SFTP_HOSTKEY.split(',').map(s => s.trim().replace(/^SHA256:/, '').replace(/=+$/, ''));
  return key => pins.includes(createHash('sha256').update(key).digest('base64').replace(/=+$/, ''));
};

// Why the folder must not be used, or null when it is Spårat's.
// The folder itself must not be a link (looked at without following it), and the marker must be a plain file in it:
// whatever the path leads through, files only go where Spårat's marker is. Links above it are one.com's own (measured
// 2026-11-17: /webroots is a link, and /webroots/4506cfb2 links to /customers/…/webroots/4506cfb2), so a "real path"
// rule can't be used there.
async function folderProblem(s, dir) {
  let d;
  try { d = await callOn(s, 'lstat', dir); } catch (e) { if (gone(e)) return `${dir} does not exist (it is never made here)`; throw e; }
  if (d.isSymbolicLink()) return `${dir} is a link: SFTP_DIR must be Spårat's data folder itself`;
  if (!d.isDirectory()) return `${dir} is not a folder`;
  let m;
  try { m = await callOn(s, 'lstat', `${dir}/${MARK}`); } catch (e) { if (gone(e)) return `${dir} has no ${MARK}: not Spårat's folder`; throw e; }
  if (!m.isFile()) return `${dir}/${MARK} is not a plain file`;
  return null;
}

// Logs in and looks at the folder, writing nothing (the self-check, fetcher/self-check.mjs): null when it is Spårat's,
// otherwise why not.
export function folderCheck(cfg, { Client = ssh2.Client } = {}) {
  const dir = checkDir(cfg.SFTP_DIR);
  return new Promise((res, rej) => {
    const c = new Client();
    const t = setTimeout(() => { c.end(); rej(new Error('one.com: no answer in 30 s')); }, 30000);
    c.on('ready', () => c.sftp(async (e, s) => {
      try { if (e) throw e; res(await folderProblem(s, dir)); } catch (err) { rej(err); } finally { clearTimeout(t); c.end(); }
    }));
    c.on('error', e => { clearTimeout(t); rej(e); });
    c.connect({ host: cfg.SFTP_HOST, port: Number(cfg.SFTP_PORT ?? 22), username: cfg.SFTP_USER, password: cfg.SFTP_PASS,
      readyTimeout: 20000, hostVerifier: verifier(cfg) });
  });
}

// The order of the waiting jobs, so the map comes back first after a break (2026-11-18: after 40 minutes offline
// 1708 jobs waited, sent oldest first, and the map stayed empty ~3 minutes after the connection was back).
// The newest live file names the newest file of every kind made before it (fetcher/files.mjs, liveTick; puts are
// queued in the order they are made). So: of the files waiting before it, only the newest of each kind goes, then the
// live file, then the files made after it; deletes last. The live file still goes after every file it names (a page
// keeps a 404 for a name, src/files-source.js get()). Older files are never sent (no live file that is sent names
// them), and their deletes are dropped (nothing there to delete). -> { jobs, skipped: puts not sent }
export function order(queue) {
  let last = -1;
  for (let i = queue.length - 1; i >= 0 && last < 0; i--) if (queue[i].op === 'put' && queue[i].f.kind === 'live') last = i;
  if (last < 0) return { jobs: queue, skipped: 0 };
  const newest = new Map();   // kind -> index of its newest put before the live file
  for (let i = 0; i < last; i++) if (queue[i].op === 'put') newest.set(queue[i].f.kind, i);
  const before = [], after = [], removes = [], dropped = new Set();
  queue.forEach((q, i) => {
    if (q.op !== 'put') removes.push(q);
    else if (i > last) after.push(q);
    else if (i < last) { if (q.f.kind !== 'live' && newest.get(q.f.kind) === i) before.push(q); else dropped.add(q.name); }
  });
  return { jobs: [...before, queue[last], ...after, ...removes.filter(q => !dropped.has(q.name))], skipped: dropped.size };
}

// The folder setting: a plain absolute path; returns it without a trailing slash, or throws.
export function checkDir(raw) {
  const dir = String(raw ?? '').replace(/\/$/, '');
  if (!/^\/[A-Za-z0-9._/-]+$/.test(dir) || dir.includes('//') || dir.split('/').some(p => p === '.' || p === '..'))
    throw new Error(`SFTP_DIR must be a plain absolute path like /webroots/xxxxxxxx/data (got "${raw}")`);
  return dir;
}

export function createUploader(cfg, log, { keep = () => false, Client = ssh2.Client } = {}) {
  for (const k of ['SFTP_HOST', 'SFTP_USER', 'SFTP_PASS', 'SFTP_DIR', 'SFTP_HOSTKEY'])
    if (!cfg[k]) throw new Error(`--upload needs ${k} in the settings file`);
  const dir = checkDir(cfg.SFTP_DIR);
  const queue = [];         // [{ op: 'put' | 'rm', name, f }]
  const stats = { ok: 0, failed: 0, removed: 0, reconnects: 0, lastOkAt: null, lastMs: null, connected: false, swept: 0,
    bytes: 0, lastError: null, lastErrorAt: null, refused: null, skipped: 0 };
  let client = null, sftp = null, busy = false, closing = false, tries = 0, sweepTimer = null, retryTimer = null;

  const call = (fn, ...a) => callOn(sftp, fn, ...a);
  let blockedUntil = 0;   // breakFor(): a pretend outage (the live test)

  function connect() {
    retryTimer = null;
    if (closing) return;
    if (Date.now() < blockedUntil) { retryTimer = setTimeout(connect, blockedUntil - Date.now()); return; }
    const c = new Client();
    client = c;
    c.on('ready', () => c.sftp(async (e, s) => {
      if (e) return broken(e);
      let why;
      try { why = await folderProblem(s, dir); } catch (err) { return broken(err); }
      if (client !== c) return;
      if (why) return refuse(c, why);
      try { await putHtaccess(s); } catch (err) { return broken(err); }
      if (client !== c) return;
      sftp = s;
      if (tries || stats.refused) log(`upload: connected${tries ? ` again after ${tries} tries` : ''}; ${dir} is Spårat's folder`);
      tries = 0; stats.connected = true; stats.refused = null;
      work();
    }));
    c.on('error', broken);
    c.on('close', () => broken(new Error('connection closed')));
    c.connect({
      host: cfg.SFTP_HOST, port: Number(cfg.SFTP_PORT ?? 22), username: cfg.SFTP_USER, password: cfg.SFTP_PASS,
      readyTimeout: 20000, keepaliveInterval: 15000, keepaliveCountMax: 3,
      hostVerifier: verifier(cfg),
    });
  }
  async function putHtaccess(s) {
    const p = `${dir}/.htaccess`;
    try {
      const st = await callOn(s, 'lstat', p);
      if (!st.isFile()) throw new Error(`${p} is not a plain file: not written`);
      const now = await callOn(s, 'readFile', p);
      if (Buffer.compare(now, HTACCESS) === 0) return;
    } catch (e) { if (!gone(e)) throw e; }
    await callOn(s, 'writeFile', p, HTACCESS);
  }
  // The folder isn't Spårat's: nothing is written; look again in 10 minutes (a fix needs no restart).
  function refuse(c, why) {
    if (stats.refused !== why) log(`upload: REFUSED, nothing is written: ${why}. Looking again in 10 minutes.`);
    stats.refused = why; stats.lastError = why; stats.lastErrorAt = Date.now(); stats.connected = false;
    client = null; sftp = null; busy = false;
    try { c.end(); } catch { /* already gone */ }
    if (!closing) retryTimer = setTimeout(connect, REFUSED_WAIT);
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
    retryTimer = setTimeout(connect, wait);
  }

  const done = job => { const i = queue.indexOf(job); if (i >= 0) queue.splice(i, 1); };

  // A temporary file is made only where no file of that name exists ('wx'); one left by a crash is removed first.
  async function putTmp(tmp, data) {
    try { await call('writeFile', tmp, data, { flag: 'wx' }); }
    catch (e) {
      if (!sftp) throw e;
      await call('unlink', tmp).catch(u => { if (!gone(u)) throw u; });
      await call('writeFile', tmp, data, { flag: 'wx' });
    }
  }

  async function work() {
    if (busy || !sftp) return;
    busy = true;
    while (queue.length && sftp) {
      if (queue.length > 1) {
        const { jobs, skipped } = order(queue);
        queue.splice(0, queue.length, ...jobs);
        if (skipped) { stats.skipped += skipped; if (skipped >= 10) log(`upload: ${skipped} waiting files out of date, not sent`); }
      }
      const job = queue[0];
      const t = Date.now();
      try {
        if (job.op === 'put') {
          const tmp = `${dir}/${job.name}.tmp`;
          await putTmp(tmp, job.f.gz);   // packed: one.com hands it out as it is (data.htaccess)
          await call('rename', tmp, `${dir}/${job.name}`);
          stats.ok++; stats.lastOkAt = Date.now(); stats.lastMs = Date.now() - t; stats.bytes += job.f.gz.length;
        } else {
          await call('unlink', `${dir}/${job.name}`).catch(e => { if (!gone(e)) throw e; });   // already gone: fine
          stats.removed++;
        }
        done(job);
      } catch (e) {
        stats.failed++; stats.lastError = e.message; stats.lastErrorAt = Date.now();
        if (!sftp) break;                  // the connection broke: the job waits for the next one
        log(`upload: ${job.op} ${job.name}: ${e.message}`);
        done(job);                          // a job the server refuses is not tried forever
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
        if (!NAME.test(filename) && !TMP.test(filename)) continue;
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
  const firstSweep = setTimeout(sweep, 60000);

  // Only names the fetcher makes; anything else is a mistake and is refused (logged once per name).
  const said = new Set();
  const ours = (op, name, tmpToo) => {
    if (NAME.test(name) || (tmpToo && TMP.test(name))) return true;
    if (!said.has(name)) { said.add(name); log(`upload: refused to ${op} "${name}": not a name the fetcher makes`); }
    return false;
  };

  connect();
  return {
    add(name, f) { if (ours('write', name)) { queue.push({ op: 'put', name, f }); work(); } },
    remove(name) { if (ours('delete', name, true)) { queue.push({ op: 'rm', name }); work(); } },
    stats: () => ({ ...stats, waiting: queue.length }),
    sweep,
    // The live test (main.mjs --test-breaks): drop the connection and refuse to connect for ms, like a lost internet.
    breakFor(ms) { blockedUntil = Date.now() + ms; if (client) broken(new Error('test break')); },
    close() {
      closing = true;
      clearInterval(sweepTimer); clearTimeout(retryTimer); clearTimeout(firstSweep);
      return new Promise(res => { if (!client) return res(); client.once('close', res); client.end(); setTimeout(res, 3000); });
    },
  };
}
