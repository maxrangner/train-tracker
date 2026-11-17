// Checks that the fetcher's uploader (fetcher/upload.mjs) only ever writes in Spårat's own folder (plan to beta step 1,
// 2026-11-17, after Codex's review): with a pretend SFTP connection and a pretend web space in memory, no network.
// Each case sets up the web space, runs the uploader briefly, and checks what it wrote, renamed, deleted or refused.
// Run: node tools/upload-check.mjs     exit code 0: all hold; 1: one failed
import { EventEmitter } from 'node:events';
import { createUploader, checkDir, MARK } from '../fetcher/upload.mjs';

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
  let failNext = null;
  const sftp = {
    realpath: (p, cb) => { const r = resolve(p); later(cb, r ? null : err(2, 'no such file'), r && (r === '/' ? top || '/' : top + r)); },
    lstat: (p, cb) => {
      if (failNext?.op === 'lstat' && p === failNext.path) return later(cb, err(3, 'permission denied'));
      const e = fs.get(at(p)); later(cb, e ? null : err(2, 'no such file'), e && st(e));
    },
    readFile: (p, o, cb) => { cb ??= o; const r = resolve(p); later(cb, r ? null : err(2, 'no such file'), r && fs.get(r).data); },
    writeFile: (p, data, o, cb) => {
      if (typeof o === 'function') { cb = o; o = {}; }
      const q = at(p);
      if (!q) return later(cb, err(2, 'no such folder'));
      if (o?.flag === 'wx' && fs.has(q)) return later(cb, err(4, 'exists'));
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
    readdir: (p, cb) => { const r = resolve(p); later(cb, null, [...fs.keys()].filter(k => parent(k) === r && k !== r).map(k => ({ filename: k.slice(r.length + 1) }))); },
    mkdir: (p, cb) => { ops.push(['mkdir', p]); fs.set(p, { type: 'dir' }); later(cb, null); },
  };
  class Client extends EventEmitter {
    connect() { setImmediate(() => this.emit('ready')); }
    sftp(cb) { setImmediate(() => cb(null, sftp)); }
    end() { setImmediate(() => this.emit('close')); }
  }
  return { fs, ops, Client, failLstat: path => { failNext = { op: 'lstat', path }; } };
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

console.log(failed ? `${failed} failed` : 'upload-check: all hold');
process.exit(failed ? 1 : 0);
