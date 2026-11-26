// Checks that the fetcher's uploader (fetcher/upload.mjs) only ever writes in Spårat's own folder (plan to beta step 1,
// 2026-11-17, after Codex's review): with a pretend SFTP connection and a pretend web space in memory, no network.
// Each case sets up the web space, runs the uploader briefly, and checks what it wrote, renamed, deleted or refused.
// Run: node tools/upload-check.mjs     exit code 0: all hold; 1: one failed
import { EventEmitter } from 'node:events';
import { createUploader, checkDir, MARK, NAME, order, uploadStuck, STUCK_MS } from '../fetcher/upload.mjs';
import { createShelf, KINDS } from '../fetcher/files.mjs';
import { historyName, historySlot } from '../src/live-file.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const err = (code, m) => Object.assign(new Error(m), { code });
const DIR = '/web/sparat/data';

// A pretend web space: path -> { type: 'dir' | 'file' | 'link', data, to }. Every change is logged in `ops`.
function space(entries, top = '') {   // top: the prefix the server adds to real paths (one.com: /customers/…)
  const fs = new Map(Object.entries({ '/': { type: 'dir' }, '/web': { type: 'dir' }, ...entries }));
  const ops = [];
  const parent = p => p.slice(0, p.lastIndexOf('/')) || '/';
  const resolve = p => {   // follows links in every part, like a server's realpath
    let at = '';
    for (const part of p.split('/').filter(Boolean)) {
      at = `${at}/${part}`;
      for (let n = 0; fs.get(at)?.type === 'link' && n < 10; n++) at = fs.get(at).to;
      if (!fs.has(at)) return null;
    }
    return at || '/';
  };
  // The path with the links above its last part followed, the last part not (how a server looks up a name).
  const at = p => { const r = resolve(parent(p)); return r && `${r === '/' ? '' : r}/${p.slice(p.lastIndexOf('/') + 1)}`; };
  const st = e => ({ isDirectory: () => e.type === 'dir', isFile: () => e.type === 'file', isSymbolicLink: () => e.type === 'link' });
  const later = (cb, e, v) => setImmediate(() => cb(e, v));
  let failNext = null, failWrites = 0, closeLate = 0, slowWrite = 0, refuseLogins = 0;
  const silent = {};   // op -> how many calls get no answer at all (one.com going quiet, 2026-11-24)
  const quiet = op => { if (silent[op] > 0) { silent[op]--; return true; } return false; };
  const sftp = {
    realpath: (p, cb) => { const r = resolve(p); later(cb, r ? null : err(2, 'no such file'), r && (r === '/' ? top || '/' : top + r)); },
    lstat: (p, cb) => {
      if (failNext?.op === 'lstat' && p === failNext.path) return later(cb, err(3, 'permission denied'));
      const e = fs.get(at(p)); later(cb, e ? null : err(2, 'no such file'), e && st(e));
    },
    readFile: (p, o, cb) => { cb ??= o; const r = resolve(p); later(cb, r ? null : err(2, 'no such file'), r && fs.get(r).data); },
    writeFile: (p, data, o, cb) => {
      if (typeof o === 'function') { cb = o; o = {}; }
      if (quiet('writeFile')) return;
      if (slowWrite) { const ms = slowWrite; slowWrite = 0; return setTimeout(() => sftp.writeFile(p, data, o, cb), ms); }   // answered late
      const q = at(p);
      if (!q) return later(cb, err(2, 'no such folder'));
      if (o?.flag === 'wx' && fs.has(q)) return later(cb, err(4, 'exists'));
      if (failWrites > 0 && !q.endsWith('.htaccess')) { failWrites--; return later(cb, err(3, 'refused')); }
      let target = q;
      for (let n = 0; fs.get(target)?.type === 'link' && n < 10; n++) target = fs.get(target).to;   // writing through a link
      fs.set(target, { type: 'file', data: Buffer.from(data) }); ops.push(['write', target]);
      later(cb, null);
    },
    rename: (a, b, cb) => {
      const qa = at(a), qb = at(b);
      if (!qa || !fs.has(qa)) return later(cb, err(2, 'no such file'));
      if (!qb || fs.has(qb)) return later(cb, err(4, 'exists'));   // one.com: no renaming onto an existing name
      fs.set(qb, fs.get(qa)); fs.delete(qa); ops.push(['rename', qa, qb]); later(cb, null);
    },
    unlink: (p, cb) => { const q = at(p); if (!q || !fs.has(q)) return later(cb, err(2, 'no such file')); fs.delete(q); ops.push(['delete', q]); later(cb, null); },
    createReadStream: (p, o = {}) => {
      const s = new EventEmitter(); s.destroy = () => {};
      if (quiet('read')) return s;
      setImmediate(() => { const r = resolve(p); if (!r) return s.emit('error', err(2, 'no such file')); s.emit('data', fs.get(r).data.subarray(o.start ?? 0)); s.emit('end'); });
      return s;
    },
    readdir: (p, cb) => { if (quiet('readdir')) return; const r = resolve(p); later(cb, null, [...fs.keys()].filter(k => parent(k) === r && k !== r).map(k => ({ filename: k.slice(r.length + 1) }))); },
    mkdir: (p, cb) => { ops.push(['mkdir', p]); fs.set(p, { type: 'dir' }); later(cb, null); },
  };
  class Client extends EventEmitter {
    connect() {
      if (refuseLogins > 0) { refuseLogins--; return setImmediate(() => this.emit('error', Object.assign(new Error('All configured authentication methods failed'), { level: 'client-authentication' }))); }
      setImmediate(() => this.emit('ready'));
    }
    sftp(cb) { if (quiet('sftp')) return; setImmediate(() => cb(null, sftp)); }
    end() { const late = closeLate; setTimeout(() => this.emit('close'), late); }
  }
  return { fs, ops, Client, failLstat: path => { failNext = { op: 'lstat', path }; }, failWrites: n => { failWrites = n; },
    silence: (op, n = 1) => { silent[op] = n; }, closeLate: ms => { closeLate = ms; }, slowWrite: ms => { slowWrite = ms; },
    refuseLogins: n => { refuseLogins = n; } };
}

const cfg = dir => ({ SFTP_HOST: 'x', SFTP_USER: 'x', SFTP_PASS: 'x', SFTP_DIR: dir, SFTP_HOSTKEY: 'x' });
const file = (data = 'x') => ({ type: 'file', data: Buffer.from(data) });
const marked = (extra = {}) => ({ '/web/sparat': { type: 'dir' }, [DIR]: { type: 'dir' }, [`${DIR}/${MARK}`]: file(), '/web/rangner': { type: 'dir' },
  '/web/rangner/index.html': file('portfolio'), '/web/rangner/.htaccess': file('rangner rules'), ...extra });
const live = { gz: Buffer.from('gz'), kind: 'live' };
const outside = ops => ops.filter(o => o.slice(1).some(p => !p.startsWith(`${DIR}/`)));

let failed = 0;
const check = (name, ok, why = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` (${why})`}`); if (!ok) failed++; };
async function run(entries, dir, steps, top) {
  const s = space(entries, top);
  const logs = [];
  const up = createUploader(cfg(dir), m => logs.push(m), { Client: s.Client });
  await wait(30);
  await steps?.(up, s);
  await wait(30);
  const stats = up.stats();
  await up.close();
  return { ...s, logs, stats };
}

// 1. The folder setting itself.
for (const bad of ['', 'webroots/x/data', '/a/../b', '/a//b', '/a/./b', '/a b', '/a;rm']) {
  let threw = false; try { checkDir(bad); } catch { threw = true; }
  check(`folder setting "${bad}" refused`, threw);
}
check('folder setting "/webroots/4506cfb2/data/" accepted', checkDir('/webroots/4506cfb2/data/') === '/webroots/4506cfb2/data');

// 2. A marked folder: files go there and nowhere else.
{
  const r = await run(marked(), DIR, async up => { up.add('live-123.json', live); await wait(30); });
  check('marked folder: the file arrives', r.fs.has(`${DIR}/live-123.json`), JSON.stringify(r.ops));
  check('marked folder: .htaccess written there', r.fs.has(`${DIR}/.htaccess`));
  check('marked folder: nothing written outside it', outside(r.ops).length === 0, JSON.stringify(outside(r.ops)));
  check('marked folder: no folder made', !r.ops.some(o => o[0] === 'mkdir'));
}

// 2b. Links above the folder are one.com's own (its site folders are links, and real paths carry a prefix; measured
// 2026-11-17): still Spårat's folder when the folder itself holds the marker.
{
  const above = { '/store': { type: 'dir' }, '/store/sparat': { type: 'dir' }, '/store/sparat/data': { type: 'dir' }, [`/store/sparat/data/${MARK}`]: file(),
    '/web/sparat': { type: 'link', to: '/store/sparat' }, '/web/rangner': { type: 'dir' }, '/web/rangner/index.html': file('portfolio') };
  const r = await run(above, DIR, async up => { up.add('live-124.json', live); await wait(30); }, '/customers/b/8/3/acct');
  check('a link above the folder (one.com): the file arrives', r.fs.has('/store/sparat/data/live-124.json'), r.stats.refused ?? JSON.stringify(r.ops));
  check('a link above the folder: nothing written elsewhere', r.ops.every(o => o.slice(1).every(p => p.startsWith('/store/sparat/data/'))), JSON.stringify(r.ops));
}

// 3. Folders that are not Spårat's: nothing at all is written, the reason is told.
const refusals = [
  ['no marker', { '/web/sparat': { type: 'dir' }, [DIR]: { type: 'dir' } }, /has no \.sparat-data/],
  ['the folder is missing', { '/web/sparat': { type: 'dir' } }, /does not exist/],
  ['the marker is a folder', { '/web/sparat': { type: 'dir' }, [DIR]: { type: 'dir' }, [`${DIR}/${MARK}`]: { type: 'dir' } }, /not a plain file/],
  ['the marker is a link', { '/web/sparat': { type: 'dir' }, [DIR]: { type: 'dir' }, [`${DIR}/${MARK}`]: { type: 'link', to: '/web/rangner/index.html' } }, /not a plain file/],
  ['the folder is a link to another site', { '/web/sparat': { type: 'dir' }, [DIR]: { type: 'link', to: '/web/rangner' }, '/web/rangner': { type: 'dir' }, [`/web/rangner/${MARK}`]: file() }, /is a link/],
  ['the setting points at another site', marked(), '/web/rangner', /has no \.sparat-data/],
];
for (const [name, entries, dirOrRe, re] of refusals) {
  const dir = typeof dirOrRe === 'string' ? dirOrRe : DIR, want = re ?? dirOrRe;
  const r = await run(entries, dir, async up => { up.add('live-1.json', live); await wait(30); });
  check(`${name}: nothing written`, r.ops.length === 0, JSON.stringify(r.ops));
  check(`${name}: the reason is told`, want.test(r.stats.refused ?? '') && r.logs.some(l => /REFUSED/.test(l)), r.stats.refused);
}

// 4. Inspection errors stop it (never taken as "fine").
{
  const r = await run(marked(), DIR, async (up, s) => { s.failLstat(`${DIR}/${MARK}`); });
  const r2 = await run(marked(), DIR, async (up, s) => { up.add('live-1.json', live); await wait(10); });
  check('marked folder after a first good look works', r2.fs.has(`${DIR}/live-1.json`));
  const s = space(marked()); s.failLstat(DIR);
  const logs = []; const up = createUploader(cfg(DIR), m => logs.push(m), { Client: s.Client }); up.add('live-1.json', live);
  await wait(40); await up.close();
  check('an error while looking at the folder: nothing written', s.ops.length === 0, JSON.stringify(s.ops));
}

// 5. Names: only the fetcher's own.
{
  const r = await run(marked(), DIR, async up => {
    up.add('../../rangner/index.html', live); up.add('.htaccess', live); up.add('index.html', live);
    up.remove('index.html'); up.remove(`../${MARK}`); up.remove('live-1.json.tmp');
    await wait(30);
  });
  check('odd names to write: refused', !r.ops.some(o => o[0] === 'write' && !/\.htaccess$/.test(o[1])), JSON.stringify(r.ops));
  check('odd names to delete: refused, own .tmp allowed', r.ops.filter(o => o[0] === 'delete').length === 0 && r.logs.filter(l => /refused to/.test(l)).length === 4 && !r.logs.some(l => /live-1\.json\.tmp/.test(l)), r.logs.join(' | '));   // index.html is told once
}

// 6. The sweep removes only old files of its own.
{
  const r = await run(marked({ [`${DIR}/other.json.tmp`]: file(), [`${DIR}/index.html`]: file(), [`${DIR}/live-1.json`]: file(), [`${DIR}/live-1.json.tmp`]: file(),
    [`${DIR}/notes.json`]: file() }), DIR, async up => { up.sweep(); await wait(40); });
  const del = r.ops.filter(o => o[0] === 'delete').map(o => o[1].slice(DIR.length + 1)).sort();
  check('sweep: only its own old files', JSON.stringify(del) === JSON.stringify(['live-1.json', 'live-1.json.tmp']), JSON.stringify(del));
}

// 6b. The day's history files (2026-11-22): the sweep keeps today's, also those an earlier run made (not on this run's
// shelf: a restart must not delete the day so far), and removes those past their keep time (01:00 the next night).
{
  const slot = historySlot(Date.now());
  const today = historyName(slot - 4), old = historyName(slot - 3 * 96);
  const r = await run(marked({ [`${DIR}/${today}`]: file(), [`${DIR}/${old}`]: file() }), DIR, async up => { up.sweep(); await wait(40); });
  const del = r.ops.filter(o => o[0] === 'delete').map(o => o[1].slice(DIR.length + 1));
  check('sweep: today\'s history from an earlier run kept, three days old removed', r.fs.has(`${DIR}/${today}`) && JSON.stringify(del) === JSON.stringify([old]), JSON.stringify(del));
  check('history names allowed, odd ones not', NAME.test('history-1958400.json') && !NAME.test('history-x.json') && !NAME.test('history-12.json.gz'));
}

// 7. Links planted where it writes are never written through.
{
  const r = await run(marked({ [`${DIR}/live-5.json.tmp`]: { type: 'link', to: '/web/rangner/index.html' } }), DIR, async up => { up.add('live-5.json', live); await wait(40); });
  check('a link at a temporary name: the other site untouched', r.fs.get('/web/rangner/index.html').data.toString() === 'portfolio', JSON.stringify(r.ops));
  check('a link at a temporary name: the file still arrives', r.fs.get(`${DIR}/live-5.json`)?.type === 'file');
  const h = await run(marked({ [`${DIR}/.htaccess`]: { type: 'link', to: '/web/rangner/.htaccess' } }), DIR, async up => { up.add('live-6.json', live); await wait(40); });
  check('.htaccess is a link: nothing written', h.ops.length === 0 && h.fs.get('/web/rangner/.htaccess').data.toString() === 'rangner rules', JSON.stringify(h.ops));
}

// 8. A new connection looks again: the marker gone between connections means nothing more is written.
{
  const s = space(marked());
  const logs = []; const up = createUploader(cfg(DIR), m => logs.push(m), { Client: s.Client });
  await wait(30); up.add('live-7.json', live); await wait(30);
  s.fs.delete(`${DIR}/${MARK}`); up.breakFor(10); await wait(1300);
  up.add('live-8.json', live); await wait(30);
  const st = up.stats(); await up.close();
  check('reconnect: the first file arrived', s.fs.has(`${DIR}/live-7.json`));
  check('reconnect: looked again and refused', /has no \.sparat-data/.test(st.refused ?? '') && !s.fs.has(`${DIR}/live-8.json`), st.refused);
}

// 9. After a break the map comes back first (2026-11-18): of the files waiting, only the newest of each kind made
// before the newest live file go, then that live file, then newer files; deletes last; older files never.
{
  const put = (name, kind) => ({ op: 'put', name, f: { kind, gz: Buffer.from(name) } });
  const q = [put('card-01-1.json', 'card-01'), put('live-1.json', 'live'), put('card-01-2.json', 'card-01'), { op: 'rm', name: 'stats-0.json' },
    put('passings-3.json', 'passings'), put('live-2.json', 'live'), { op: 'rm', name: 'card-01-1.json' }, { op: 'rm', name: 'live-1.json' },
    put('card-01-4.json', 'card-01')];
  const { jobs, skipped } = order(q);
  const got = jobs.map(j => `${j.op} ${j.name}`).join(', ');
  check('order: newest of each kind, the live file, newer files, deletes', got === 'put card-01-2.json, put passings-3.json, put live-2.json, put card-01-4.json, rm stats-0.json', got);
  check('order: older files skipped and counted', skipped === 2, String(skipped));
  // History files: every one waiting goes (each holds its own 15 minutes), right after the live file.
  const h = [put('history-10.json', 'history'), put('live-3.json', 'live'), put('history-11.json', 'history'), put('stats-1.json', 'stats'),
    put('stats-2.json', 'stats'), put('live-4.json', 'live'), put('history-12.json', 'history')];
  const hgot = order(h).jobs.map(j => j.name).join(', ');
  check('order: every waiting history file goes, after the live file', hgot === 'stats-2.json, live-4.json, history-10.json, history-11.json, history-12.json', hgot);
  check('order: nothing to reorder without a live file', order(q.slice(0, 1)).jobs.length === 1 && order([put('a-1.json', 'a'), put('a-2.json', 'a')]).jobs.length === 2);

  // The same through the uploader: everything made during a break, then the connection back.
  const s = space(marked());
  const logs = []; const up = createUploader(cfg(DIR), m => logs.push(m), { Client: s.Client });
  await wait(30); up.breakFor(1500); await wait(30);
  for (const j of q) j.op === 'put' ? up.add(j.name, j.f) : up.remove(j.name);
  await wait(2500);
  const st = up.stats(); await up.close();
  const sent = s.ops.filter(o => o[0] === 'rename').map(o => o[2].slice(DIR.length + 1)).join(', ');
  check('after a break: only what the map needs, the live file after what it names', sent === 'card-01-2.json, passings-3.json, live-2.json, card-01-4.json', sent);
  check('after a break: the skipped files counted', st.skipped + st.forgotten === 2 && st.waiting === 0, JSON.stringify(st));
}

// 10. Six hours without one.com (2026-11-19, TODO 40): the waiting list holds only what is still current, not every
// file made (before: 1,427 jobs an hour with live files alone). The fetcher's real shelf and kinds, a made-up clock.
{
  const s = space(marked());
  const logs = []; const up = createUploader(cfg(DIR), m => logs.push(m), { Client: s.Client });
  await wait(30); const back = Date.now() + 8000; up.breakFor(8000); await wait(30);
  const sentBefore = new Set(s.ops.filter(o => o[0] === 'rename').map(o => o[2]));
  const shelf = createShelf({ onAdd: (n, f) => up.add(n, f), onRemove: n => up.remove(n) });
  const kinds = [...Object.entries(KINDS).map(([k, [every]]) => [k, every]),
    ...Array.from({ length: 32 }, (_, i) => String(i).padStart(2, '0')).flatMap(g => [[`card-${g}`, 16 * 60000], [`board-${g}`, 16 * 60000]])];
  const T0 = Math.floor(Date.now() / 5000) * 5000;
  let made = 0, most = 0;
  for (let t = T0; t <= T0 + 6 * 3600e3; t += 5000) {
    for (const [k, every] of kinds) if ((t - T0) % every === 0) { shelf.put(k, t, { k, t }); made++; }
    shelf.sweep(t);
    most = Math.max(most, up.stats().waiting);
  }
  const held = shelf.all().length;
  check('six hours offline: the waiting list stays small', most <= held + 200 && Date.now() < back, `at most ${most} waiting, ${held} files on the shelf, ${made} made; still offline: ${Date.now() < back}`);
  await wait(Math.max(0, back - Date.now()) + 2000);
  const st = up.stats(); await up.close();
  const live = Object.entries(shelf.names()).find(([k]) => k === 'live')[1];
  const named = Object.values(shelf.names());
  check('six hours offline, then back: every current file is there', named.every(n => s.fs.has(`${DIR}/${n}`)), named.filter(n => !s.fs.has(`${DIR}/${n}`)).join(', '));
  check('six hours offline, then back: only current files sent', s.ops.filter(o => o[0] === 'rename' && !sentBefore.has(o[2])).length <= held && st.waiting === 0, JSON.stringify(st));
  check('six hours offline, then back: the newest live file is there', s.fs.has(`${DIR}/${live}`));
  const days = shelf.all().filter(([, f]) => f.kind === 'history').map(([n]) => n);
  check('six hours offline, then back: every history file of those hours is there', days.length > 0 && days.every(n => s.fs.has(`${DIR}/${n}`)), `${days.filter(n => !s.fs.has(`${DIR}/${n}`)).length} of ${days.length} missing`);
  console.log(`     (${made} files made in 6 h; at most ${most} waiting; ${st.forgotten} forgotten unsent; ${held} on the shelf)`);
}

// 11. A file one.com refuses is tried again, 3 times in all (2026-11-19, TODO 40; it was dropped at once).
{
  const s = space(marked());
  const logs = []; const up = createUploader(cfg(DIR), m => logs.push(m), { Client: s.Client, tryAgainMs: 100 });
  await wait(30);
  s.failWrites(4);   // two tries (each writes the temporary file twice: once, then again after clearing it)
  up.add('card-03-1.json', { kind: 'card-03', gz: Buffer.from('c') });
  await wait(600);
  check('refused twice: there on the third try', s.fs.has(`${DIR}/card-03-1.json`), logs.join(' | '));
  s.failWrites(6);
  up.add('card-03-2.json', { kind: 'card-03', gz: Buffer.from('c') });
  await wait(600);
  check('refused three times: given up, said in the log', !s.fs.has(`${DIR}/card-03-2.json`) && logs.some(l => /card-03-2\.json.*given up after 3 tries/.test(l)), logs.join(' | '));
  s.failWrites(2);
  up.add('card-03-3.json', { kind: 'card-03', gz: Buffer.from('c') });
  await wait(20); up.remove('card-03-3.json'); await wait(400);
  const st = up.stats(); await up.close();
  check('refused, then let go of before the next try: not sent, nothing deleted', !s.fs.has(`${DIR}/card-03-3.json`) && !s.ops.some(o => o[0] === 'delete' && o[1].endsWith('card-03-3.json')) && st.waiting === 0, JSON.stringify(st));
}

// 12. The live file names only files that are on one.com (2026-11-21, TODO 40's rest): a file refused 3 times was
// named until the next of its kind. Per kind the newest file uploaded, the one before when the newest was refused,
// nothing on its way, nothing let go of.
{
  const s = space(marked());
  const logs = []; const up = createUploader(cfg(DIR), m => logs.push(m), { Client: s.Client, tryAgainMs: 100 });
  const shelf = createShelf({ onAdd: (n, f) => up.add(n, f), onRemove: n => up.remove(n) });
  await wait(30);
  const T0 = 1_800_000_000_000;
  const a = shelf.put('stats', T0, { a: 1 }); shelf.put('disruptions', T0, { d: 1 });
  await wait(100);
  check('named once uploaded', up.names().stats === a && Boolean(up.names().disruptions) && !('live' in up.names()), JSON.stringify(up.names()));
  s.failWrites(6);   // three tries refused (each writes the temporary file twice)
  const b = shelf.put('stats', T0 + 300000, { b: 1 });
  check('on its way: not named yet', up.names().stats === a, JSON.stringify(up.names()));
  await wait(600);
  check('refused 3 times: never named, the one before still is', !s.fs.has(`${DIR}/${b}`) && up.names().stats === a && logs.some(l => l.includes(`${b}: `) && /given up/.test(l)), JSON.stringify(up.names()) + ' | ' + logs.join(' | '));
  const c = shelf.put('stats', T0 + 600000, { c: 1 });
  await wait(100);
  check('the next one uploaded: named', up.names().stats === c && s.fs.has(`${DIR}/${c}`), JSON.stringify(up.names()));
  up.breakFor(300); await wait(30);
  const d = shelf.put('stats', T0 + 900000, { d: 1 });
  await wait(100);
  check('offline: the newest is not named until it is there', up.names().stats === c, JSON.stringify(up.names()));
  await wait(1500);
  check('back: named', up.names().stats === d && s.fs.has(`${DIR}/${d}`), JSON.stringify(up.names()));
  shelf.sweep(T0 + 900000 + 11 * 60000);   // the older stats files let go of (kept 10 minutes)
  await wait(100);
  const st = up.stats();
  check('a file let go of is never named', up.names().stats === d && !s.fs.has(`${DIR}/${c}`) && st.waiting === 0, JSON.stringify(up.names()) + JSON.stringify(st));
  await up.close();
}

// 9. one.com stops answering on a connection that still looks open (2026-11-24, TODO 69: one write never answered,
// the uploads held 06:27-08:01 with no error and no reconnect): past the time limit a new connection is opened and the
// file goes on it; an old connection closing late doesn't break the new one; a read that stops answering does the same.
{
  const s = space(marked());
  const logs = [];
  const up = createUploader(cfg(DIR), m => logs.push(m), { Client: s.Client, callMs: 200 });
  await wait(30);
  s.silence('writeFile'); s.closeLate(1500);   // the old connection's "closed" comes after the new one is open
  up.add('live-200.json', live);
  await wait(100);
  check('silent write: still waiting before the limit', !s.fs.has(`${DIR}/live-200.json`) && up.stats().reconnects === 0, JSON.stringify(up.stats()));
  await wait(1400);   // 200 ms limit, 1 s before connecting again
  const st = up.stats();
  check('silent write: a new connection after the limit, the file arrives', s.fs.has(`${DIR}/live-200.json`) && st.reconnects === 1 && st.connected && st.waiting === 0, JSON.stringify(st));
  check('silent write: told in the log', logs.some(l => /no answer to writeFile/.test(l)), logs.join(' | '));
  await wait(800);   // the old connection's late close
  check('an old connection closing late leaves the new one alone', up.stats().reconnects === 1 && up.stats().connected, JSON.stringify(up.stats()));
  up.add('live-201.json', live); await wait(50);
  check('and the next file goes at once', s.fs.has(`${DIR}/live-201.json`));
  s.closeLate(0);
  s.fs.set('/web/sparat/count', { type: 'dir' }); s.fs.set('/web/sparat/count/days', { type: 'dir' });
  s.fs.set('/web/sparat/count/days/2026-11-24.txt', file('1 abcdefghijkl s\n'));
  check('a count file is read', await up.readCount('2026-11-24.txt') === '1 abcdefghijkl s\n');
  s.silence('read');
  let why = '';
  try { await up.readCount('2026-11-24.txt'); } catch (e) { why = e.message; }
  check('a read with no answer: given up after the limit', /no answer to read/.test(why), why);
  await wait(1300);
  check('a read with no answer: a new connection', up.stats().reconnects === 2 && up.stats().connected, JSON.stringify(up.stats()));
  s.silence('readdir');
  up.sweep(); await wait(300);
  up.add('live-202.json', live); await wait(1300);
  check('a sweep with no answer: a new connection, uploads go on', up.stats().reconnects === 3 && s.fs.has(`${DIR}/live-202.json`), JSON.stringify(up.stats()));
  await up.close();
}

// 10. The hang review (2026-11-24): one.com letting us in and never opening the file channel (finding 1); a write
// answered only after the connection was replaced (finding 2: the old loop went on beside the new one); a refused
// login tried every 10 minutes, said plainly (finding 8); the fetcher's last resort (finding 3).
{
  const s = space(marked());
  const logs = [];
  s.silence('sftp');
  const up = createUploader(cfg(DIR), m => logs.push(m), { Client: s.Client, callMs: 200 });
  up.add('live-300.json', live);
  await wait(1500);   // 200 ms limit, 1 s before connecting again
  check('no file channel after the login: a new connection, the file arrives', s.fs.has(`${DIR}/live-300.json`) && up.stats().reconnects === 1 && up.stats().connected, JSON.stringify(up.stats()) + ' | ' + logs.join(' | '));
  await up.close();
}
{
  const s = space(marked());
  const logs = [];
  const up = createUploader(cfg(DIR), m => logs.push(m), { Client: s.Client, callMs: 3000 });   // the answer comes within the limit
  await wait(30);
  const before = up.stats();
  s.slowWrite(1600);                 // this write is answered after the connection was replaced
  up.add('live-301.json', live);
  await wait(50);
  up.breakFor(10);                   // the line drops while the write waits; back 1 s later
  await wait(2500);
  const st = up.stats();
  check('a late answer after a reconnect: the file sent once, nothing given up or retried', s.fs.has(`${DIR}/live-301.json`) && st.ok - before.ok === 1 && st.waiting === 0 &&
    !logs.some(l => /trying again|given up/.test(l)), JSON.stringify(st) + ' | ' + logs.join(' | '));
  up.add('live-302.json', live); await wait(50);
  check('and the uploads go on', s.fs.has(`${DIR}/live-302.json`), JSON.stringify(up.stats()));
  await up.close();
}
{
  const s = space(marked());
  const logs = [];
  s.refuseLogins(1);
  const up = createUploader(cfg(DIR), m => logs.push(m), { Client: s.Client, callMs: 200 });
  await wait(2500);
  const st = up.stats();
  check('a refused login: not tried again within seconds', st.reconnects === 1 && !st.connected && st.loginRefused, JSON.stringify(st));
  check('a refused login: said plainly', /refused the login/.test(st.lastError ?? '') && logs.some(l => /refused the login.*600 s/.test(l)), logs.join(' | '));
  await up.close();
}
{
  const now = 1e12, since = now - 60 * 60000, fresh = now - 10000;
  const st = (o = {}) => ({ refused: null, loginRefused: false, lastOkAt: now - STUCK_MS - 1000, ...o });
  check('last resort: no upload for 10 min while Trafikverket answers: restart', uploadStuck(st(), { now, since, lastRecordAt: fresh }));
  check('last resort: an upload 9 min ago: no', !uploadStuck(st({ lastOkAt: now - 9 * 60000 }), { now, since, lastRecordAt: fresh }));
  check('last resort: just started, nothing yet: not before 10 min', !uploadStuck(st({ lastOkAt: null }), { now, since: now - 5 * 60000, lastRecordAt: fresh }) &&
    uploadStuck(st({ lastOkAt: null }), { now, since: now - 11 * 60000, lastRecordAt: fresh }));
  check('last resort: the internet out (no positions for 3 min): no', !uploadStuck(st(), { now, since, lastRecordAt: now - 3 * 60000 }) && !uploadStuck(st(), { now, since, lastRecordAt: null }));
  check('last resort: the folder or the login refused: no (a restart can\'t help)', !uploadStuck(st({ refused: 'x' }), { now, since, lastRecordAt: fresh }) && !uploadStuck(st({ loginRefused: true }), { now, since, lastRecordAt: fresh }));
}

console.log(failed ? `${failed} failed` : 'upload-check: all hold');
process.exit(failed ? 1 : 0);
