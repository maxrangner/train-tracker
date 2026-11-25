// Puts the fetcher's files on one.com over SFTP (one.com's file upload; measured 2026-11-15, docs/data.md "one.com,
// measured"). One connection is kept open; each file is written under a temporary name and then renamed to its new
// name, so a page never reads half a file (renaming onto a NEW name works there; onto an existing one it doesn't, and
// every file has a new name anyway). Old names are deleted when the shelf lets go of them. A broken connection is
// opened again (1 s, 2 s, 5 s ... 30 s) and the waiting files go then: only what the newest live file needs, that
// file first after them, deletes last (order() below).
// While the line is down the waiting list doesn't grow (2026-11-19, TODO 40; Codex's beta review point 4: 1,427 jobs
// and 23 MB an hour before): a file the shelf lets go of before it was sent is simply forgotten (its upload and its
// delete both dropped), so only what is still current waits, plus the deletes of files already on one.com. A file
// one.com refuses is tried again, 3 times in all, 5 s apart (it was dropped at once while the live files named it).
// The live file names only files that are on one.com (2026-11-21, TODO 40's rest; point 4's second half): names()
// gives, per kind, the newest file uploaded and not yet let go by the shelf. A file still on its way is named by the
// first live file made after it arrived; one refused 3 times is never named (the one before it stays named).
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
const TRIES = 3, TRY_AGAIN_MS = 5000;   // a refused file
const REFUSED_WAIT = 10 * 60000;
export const MARK = '.sparat-data';
export const NAME = /^(live|passings|passings-add|planned|planned-add|disruptions|stats|arrivals|arrivals-add|stations|card-\d\d|board-\d\d|day-\d\d|taps-add|taps-index|messages)-\d+\.json$/;
const TMP = /^(live|passings|passings-add|planned|planned-add|disruptions|stats|arrivals|arrivals-add|stations|card-\d\d|board-\d\d|day-\d\d|taps-add|taps-index|messages)-\d+\.json\.tmp$/;
const HTACCESS = readFileSync(new URL('./data.htaccess', import.meta.url));

const callOn = (s, fn, ...a) => new Promise((res, rej) => s[fn](...a, (e, v) => e ? rej(e) : res(v)));
// Every request on the kept connection has a time limit (2026-11-24, TODO 69: one write that one.com never answered,
// on a connection whose keepalives still worked, held the uploads from 06:27 until a restart at 08:01: no error, no
// reconnect, the map dark). Past the limit the connection counts as broken: a new one is opened, the file waits for it.
export const CALL_MS = 30000;
const noAnswer = (fn, ms) => Object.assign(new Error(`one.com: no answer to ${fn} in ${ms / 1000} s`), { noAnswer: true });
const limited = (p, ms, fn) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(noAnswer(fn, ms)), ms);
  p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); });
});
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
// ask(fn, ...args): one SFTP call (with its time limit on the kept connection).
async function folderProblem(ask, dir) {
  let d;
  try { d = await ask('lstat', dir); } catch (e) { if (gone(e)) return `${dir} does not exist (it is never made here)`; throw e; }
  if (d.isSymbolicLink()) return `${dir} is a link: SFTP_DIR must be Spårat's data folder itself`;
  if (!d.isDirectory()) return `${dir} is not a folder`;
  let m;
  try { m = await ask('lstat', `${dir}/${MARK}`); } catch (e) { if (gone(e)) return `${dir} has no ${MARK}: not Spårat's folder`; throw e; }
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
      try { if (e) throw e; res(await folderProblem((fn, ...a) => callOn(s, fn, ...a), dir)); } catch (err) { rej(err); } finally { clearTimeout(t); c.end(); }
    }));
    c.on('error', e => { clearTimeout(t); rej(e); });
    c.connect({ host: cfg.SFTP_HOST, port: Number(cfg.SFTP_PORT ?? 22), username: cfg.SFTP_USER, password: cfg.SFTP_PASS,
      readyTimeout: 20000, hostVerifier: verifier(cfg) });
  });
}

// The order of the waiting jobs, so the map comes back first after a break (2026-11-18: after 40 minutes offline
// 1708 jobs waited, sent oldest first, and the map stayed empty ~3 minutes after the connection was back).
// The live files name the newest file of every kind (since 2026-11-21 only once it is on one.com: names() below; puts
// are queued in the order they are made). So: of the files waiting before the newest live file, only the newest of
// each kind goes (the next live files name them), then the live file, then the files made after it; deletes last.
// Older files are never sent (no live file names them), and their deletes are dropped (nothing there to delete).
// -> { jobs, skipped: puts not sent }
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

// The fetcher's own last resort (2026-11-24, the hang review, finding 3: nothing restarted a stuck fetcher, and at
// 03:00 nobody acts on the monitor's mail): nothing reached one.com for STUCK_MS although the internet works
// (Trafikverket's positions keep coming) and nothing says why (a refused folder or login: a restart can't help those,
// and the monitor mails them). fetcher/main.mjs then exits and systemd starts it again; the monitor counts the restart.
export const STUCK_MS = 10 * 60000;
export function uploadStuck(st, { now, since, lastRecordAt }) {
  if (!st || st.refused || st.loginRefused) return false;
  if (!lastRecordAt || now - lastRecordAt > 2 * 60000) return false;   // the internet (or Trafikverket) is out
  return now - Math.max(st.lastOkAt ?? 0, since) >= STUCK_MS;
}

// The folder setting: a plain absolute path; returns it without a trailing slash, or throws.
export function checkDir(raw) {
  const dir = String(raw ?? '').replace(/\/$/, '');
  if (!/^\/[A-Za-z0-9._/-]+$/.test(dir) || dir.includes('//') || dir.split('/').some(p => p === '.' || p === '..'))
    throw new Error(`SFTP_DIR must be a plain absolute path like /webroots/xxxxxxxx/data (got "${raw}")`);
  return dir;
}

export function createUploader(cfg, log, { keep = () => false, Client = ssh2.Client, tryAgainMs = TRY_AGAIN_MS, callMs = CALL_MS } = {}) {
  for (const k of ['SFTP_HOST', 'SFTP_USER', 'SFTP_PASS', 'SFTP_DIR', 'SFTP_HOSTKEY'])
    if (!cfg[k]) throw new Error(`--upload needs ${k} in the settings file`);
  const dir = checkDir(cfg.SFTP_DIR);
  const COUNT_DIR = `${dir.slice(0, dir.lastIndexOf('/'))}/count/days`, COUNT_NAME = /^\d{4}-\d\d-\d\d\.txt$/;
  const queue = [];         // [{ op: 'put' | 'rm', name, f }]
  const stats = { ok: 0, failed: 0, removed: 0, reconnects: 0, lastOkAt: null, lastMs: null, connected: false, swept: 0,
    bytes: 0, lastError: null, lastErrorAt: null, refused: null, loginRefused: false, skipped: 0, forgotten: 0 };
  // busyOn: the connection a work loop runs on (until 2026-11-24 a flag that broken() cleared while the old loop still
  // waited in a call, so after the reconnect two loops sent the same files; the hang review, finding 2).
  let client = null, sftp = null, busyOn = null, closing = false, tries = 0, sweepTimer = null, retryTimer = null;
  let sending = null;               // the job being sent now
  const again = new Map();          // name -> timer: a refused file waiting for its next try
  // What is on one.com: kind -> its files uploaded and not let go of yet, [{ name, n (the time in its name) }], oldest
  // first (a file tried again can arrive after a newer one). Live files are not kept here (they are never named).
  const onSite = new Map();
  const madeOf = name => Number(/-(\d+)\.json$/.exec(name)?.[1] ?? 0);
  function arrived(kind, name) {
    if (kind === 'live') return;
    const l = onSite.get(kind) ?? [];
    if (!l.some(x => x.name === name)) { l.push({ name, n: madeOf(name) }); l.sort((a, b) => a.n - b.n); }
    onSite.set(kind, l);
  }
  function left(name) {
    for (const [kind, l] of onSite) {
      const i = l.findIndex(x => x.name === name);
      if (i < 0) continue;
      l.splice(i, 1);
      if (!l.length) onSite.delete(kind);
      return;
    }
  }

  const ask = s => (fn, ...a) => limited(callOn(s, fn, ...a), callMs, fn);
  // Calls on one kept connection; no answer in time breaks that connection (the work loop then stops, the job waits).
  const on = s => (fn, ...a) => ask(s)(fn, ...a).catch(e => { if (e.noAnswer && s && sftp === s) broken(e); throw e; });
  const call = (fn, ...a) => on(sftp)(fn, ...a);
  let blockedUntil = 0;   // breakFor(): a pretend outage (the live test)

  function connect() {
    retryTimer = null;
    if (closing) return;
    if (Date.now() < blockedUntil) { retryTimer = setTimeout(connect, blockedUntil - Date.now()); return; }
    const c = new Client();
    client = c;
    // Only this connection's own events count: an old one closing late must not break the one opened after it.
    const brokenIf = e => { if (client === c) broken(e); };
    c.on('ready', () => {
      // Opening the file channel after the login has a limit too (readyTimeout covers only the login; the hang review,
      // finding 1: one.com letting us in and never opening it would have held the uploads like a silent write).
      const t = setTimeout(() => brokenIf(noAnswer('sftp', callMs)), callMs);
      c.sftp(async (e, s) => {
      clearTimeout(t);
      if (client !== c) return;
      if (e) return broken(e);
      let why;
      try { why = await folderProblem(ask(s), dir); } catch (err) { return brokenIf(err); }
      if (client !== c) return;
      if (why) return refuse(c, why);
      try { await putHtaccess(ask(s)); } catch (err) { return brokenIf(err); }
      if (client !== c) return;
      sftp = s;
      if (tries || stats.refused) log(`upload: connected${tries ? ` again after ${tries} tries` : ''}; ${dir} is Spårat's folder`);
      tries = 0; stats.connected = true; stats.refused = null; stats.loginRefused = false;
      work();
      });
    });
    c.on('error', brokenIf);
    c.on('close', () => brokenIf(new Error('connection closed')));
    c.connect({
      host: cfg.SFTP_HOST, port: Number(cfg.SFTP_PORT ?? 22), username: cfg.SFTP_USER, password: cfg.SFTP_PASS,
      readyTimeout: 20000, keepaliveInterval: 15000, keepaliveCountMax: 3,
      hostVerifier: verifier(cfg),
    });
  }
  async function putHtaccess(q) {
    const p = `${dir}/.htaccess`;
    try {
      const st = await q('lstat', p);
      if (!st.isFile()) throw new Error(`${p} is not a plain file: not written`);
      const now = await q('readFile', p);
      if (Buffer.compare(now, HTACCESS) === 0) return;
    } catch (e) { if (!gone(e)) throw e; }
    await q('writeFile', p, HTACCESS);
  }
  // The folder isn't Spårat's: nothing is written; look again in 10 minutes (a fix needs no restart).
  function refuse(c, why) {
    if (stats.refused !== why) log(`upload: REFUSED, nothing is written: ${why}. Looking again in 10 minutes.`);
    stats.refused = why; stats.lastError = why; stats.lastErrorAt = Date.now(); stats.connected = false;
    client = null; sftp = null;
    try { c.end(); } catch { /* already gone */ }
    if (!closing) retryTimer = setTimeout(connect, REFUSED_WAIT);
  }
  function broken(e) {
    if (closing || !client) return;
    const c = client;
    client = null; sftp = null; stats.connected = false;
    try { c.end(); if (e?.noAnswer) c.destroy?.(); } catch { /* already gone */ }   // a silent line: drop it at once
    // A refused login (a changed password) is tried every 10 minutes, not every 30 s (one.com may block the address
    // for many failed logins: not known; the hang review, finding 8), and said plainly.
    const login = e?.level === 'client-authentication';
    const wait = login ? REFUSED_WAIT : WAITS[Math.min(tries, WAITS.length - 1)];
    stats.lastError = login ? `one.com refused the login (SFTP_USER / SFTP_PASS wrong or changed?): ${e.message}` : String(e?.message ?? e);
    stats.lastErrorAt = Date.now(); stats.loginRefused = login;
    if (login || tries === 0 || tries % 10 === 0) log(`upload: ${stats.lastError}; connecting again in ${wait / 1000} s`);
    tries++; stats.reconnects++;
    retryTimer = setTimeout(connect, wait);
  }

  const done = job => { const i = queue.indexOf(job); if (i >= 0) queue.splice(i, 1); };

  // A temporary file is made only where no file of that name exists ('wx'); one left by a crash is removed first.
  async function putTmp(q, mine, tmp, data) {
    try { await q('writeFile', tmp, data, { flag: 'wx' }); }
    catch (e) {
      if (!mine()) throw e;
      await q('unlink', tmp).catch(u => { if (!gone(u)) throw u; });
      await q('writeFile', tmp, data, { flag: 'wx' });
    }
  }

  // One loop per connection, on that connection only: it stops when the connection is no longer the kept one.
  async function work() {
    const s = sftp;
    if (!s || busyOn === s) return;
    busyOn = s;
    const q = on(s), mine = () => sftp === s;
    while (queue.length && mine()) {
      if (queue.length > 1) {
        const { jobs, skipped } = order(queue);
        queue.splice(0, queue.length, ...jobs);
        if (skipped) { stats.skipped += skipped; if (skipped >= 10) log(`upload: ${skipped} waiting files out of date, not sent`); }
      }
      const job = queue[0];
      const t = Date.now();
      sending = job;
      try {
        if (job.op === 'put') {
          const tmp = `${dir}/${job.name}.tmp`;
          await putTmp(q, mine, tmp, job.f.gz);   // packed: one.com hands it out as it is (data.htaccess)
          if (!mine()) break;                     // the connection changed meanwhile: the job waits for the new loop
          await q('rename', tmp, `${dir}/${job.name}`);
          stats.ok++; stats.lastOkAt = Date.now(); stats.lastMs = Date.now() - t; stats.bytes += job.f.gz.length;
          arrived(job.f.kind, job.name);
        } else {
          await q('unlink', `${dir}/${job.name}`).catch(e => { if (!gone(e)) throw e; });   // already gone: fine
          stats.removed++;
          left(job.name);
        }
        done(job);
      } catch (e) {
        stats.failed++; stats.lastError = e.message; stats.lastErrorAt = Date.now();
        if (!mine()) break;                // the connection broke: the job waits for the next one
        done(job);                          // a job the server refuses is tried a few times, not forever
        job.tries = (job.tries ?? 1) + 1;
        if (job.op === 'put' && job.tries <= TRIES && !closing) {
          log(`upload: put ${job.name}: ${e.message}; trying again in ${tryAgainMs / 1000} s`);
          again.set(job.name, setTimeout(() => { again.delete(job.name); queue.push(job); work(); }, tryAgainMs));
        } else log(`upload: ${job.op} ${job.name}: ${e.message}${job.op === 'put' ? `; given up after ${TRIES} tries` : ''}`);
      } finally { if (sending === job) sending = null; }
    }
    if (busyOn === s) busyOn = null;
  }

  // Our files in the folder that nobody needs any more: older than 5 minutes and not kept by the shelf.
  async function sweep() {
    if (!sftp || busyOn === sftp) return;
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
    // Let go of by the shelf: a file still waiting to be sent (or to be tried again) is forgotten, nothing to delete;
    // one being sent right now, or already sent, is deleted.
    remove(name) {
      if (!ours('delete', name, true)) return;
      left(name);   // no longer named (its delete may still wait)
      const i = queue.findIndex(q => q.op === 'put' && q.name === name);
      if (i >= 0 && queue[i] !== sending) { queue.splice(i, 1); stats.forgotten++; return; }
      if (again.has(name)) { clearTimeout(again.get(name)); again.delete(name); stats.forgotten++; return; }
      queue.push({ op: 'rm', name }); work();
    },
    stats: () => ({ ...stats, waiting: queue.length }),
    // kind -> the newest file of that kind on one.com, for the live file (fetcher/main.mjs liveTick).
    names: () => Object.fromEntries([...onSite].map(([kind, l]) => [kind, l[l.length - 1].name])),
    sweep,
    // The viewer count's day files (count/i.php writes them; fetcher/viewers.mjs counts; 2026-11-23): only reading,
    // only that folder beside Spårat's data folder (<site>/count/days), only names like 2026-11-23.txt.
    async listCount() {
      if (!sftp) throw new Error('not connected to one.com');
      try { return (await call('readdir', COUNT_DIR)).map(e => e.filename).filter(n => COUNT_NAME.test(n)); } catch (e) { if (e.code === 2) return []; throw e; }
    },
    readCount(name, offset = 0) {
      if (!COUNT_NAME.test(name)) return Promise.reject(new Error(`not a count file: ${name}`));
      if (!sftp) return Promise.reject(new Error('not connected to one.com'));
      const on = sftp;
      return new Promise((res, rej) => {
        const parts = [];
        const s = on.createReadStream(`${COUNT_DIR}/${name}`, { start: offset });
        let t;   // a read one.com stops answering (nothing for callMs): the same as a call with no answer
        const arm = () => { clearTimeout(t); t = setTimeout(() => {
          const e = noAnswer('read', callMs);
          try { s.destroy?.(); } catch { /* gone */ }
          if (sftp === on) broken(e);
          rej(e);
        }, callMs); };
        arm();
        s.on('data', c => { parts.push(c); arm(); });
        s.on('end', () => { clearTimeout(t); res(Buffer.concat(parts).toString('utf8')); });
        s.on('error', e => { clearTimeout(t); if (e.code === 2) res(''); else rej(e); });
      });
    },
    // The live test (main.mjs --test-breaks): drop the connection and refuse to connect for ms, like a lost internet.
    breakFor(ms) { blockedUntil = Date.now() + ms; if (client) broken(new Error('test break')); },
    close() {
      closing = true;
      clearInterval(sweepTimer); clearTimeout(retryTimer); clearTimeout(firstSweep);
      for (const t of again.values()) clearTimeout(t);
      return new Promise(res => { if (!client) return res(); client.once('close', res); client.end(); setTimeout(res, 3000); });
    },
  };
}
