// Puts the public page online (public-plan step 7) into its own address's folder on one.com, over SFTP.
// Run: node tools/deploy.mjs <what> --env <settings file>     (e.g. --env D:/dev/sparat-site.env)
//   tiles   the newest data/map/sweden-<date>.pmtiles into tiles/ (skipped when it is there with the same size)
//   page   builds the public page for SITE_URL (tools/build-public.mjs: no key, the key search) and uploads it: every
//           new or changed file first, index.html last, so a page being opened never mixes versions; files the new
//           page no longer has are kept a day (pages already open may still ask for them), then deleted
//   all     tiles, page
//   list    what is on the site
//   remove  undo: everything in the folder, the fetcher's data/ too; the address shows one.com's placeholder again
// Settings: the fetcher's (SFTP_HOST, SFTP_PORT, SFTP_USER, SFTP_PASS, SFTP_HOSTKEY) plus SITE_DIR (the address's
// folder on one.com, e.g. /webroots/4506cfb2) and SITE_URL (e.g. https://sparat.rangner.com).
// No key and no script ever goes to one.com (2026-11-17, Max: the tap script ask.php and its key file were taken off
// one.com; taps come from the fetcher's files instead, public plan phase B): put() refuses any .php file and anything
// under api/. Until phase B the page is built with taps pointing at api/ask.php, which answers 404: a tap fails
// quietly and no viewer's browser asks Trafikverket anything.
// Safety: it writes and deletes only inside SITE_DIR, and never in data/ (the fetcher's) except on remove. The first
// run needs the folder empty (data/ allowed) and leaves a marker (.sparat-site); later runs refuse a folder without
// it, so a wrong SITE_DIR (rangner.com's own folder, say) is never written to.
// What was uploaded is remembered in data/site/<folder>.json (a file's fingerprint; when it left the page).
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import ssh2 from 'ssh2';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const arg = n => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : undefined; };
const what = process.argv[2];
const envPath = arg('env');
if (!['tiles', 'page', 'all', 'list', 'remove'].includes(what) || !envPath) {
  console.log('node tools/deploy.mjs tiles|page|all|list|remove --env <settings file>'); process.exit(2);
}
const cfg = Object.fromEntries(readFileSync(envPath, 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
for (const k of ['SFTP_HOST', 'SFTP_USER', 'SFTP_PASS', 'SFTP_HOSTKEY', 'SITE_DIR', 'SITE_URL'])
  if (!cfg[k]) { console.log(`${envPath} has no ${k}`); process.exit(2); }
const SITE = cfg.SITE_DIR.replace(/\/$/, '');
const URL_ = cfg.SITE_URL.replace(/\/$/, '');
if (!/^\/webroots\/[0-9a-z]+$/.test(SITE)) { console.log(`SITE_DIR must be a one.com address folder like /webroots/4506cfb2 (got ${SITE})`); process.exit(2); }
const MARK = '.sparat-site';
const OURS = new Set(['data', 'api', 'tiles', MARK]);   // never part of the page's own files

// Cache rules. Root: the page itself is asked again every visit (a new version shows at once); the few named files
// beside it are kept an hour. assets/: built names change with their content, so they are kept a year. map/, glyphs/,
// fonts/: an hour. tiles/: the map file (a new map gets a new name) a week; pieces must reach the phone byte-exact
// (no-gzip); any site may read it (the apps, later). Plain http goes to https.
const HT_ROOT = `# Spårat's page (tools/deploy.mjs, public-plan step 7)
Options -Indexes
DirectoryIndex index.html
RewriteEngine On
RewriteCond %{HTTPS} !=on
RewriteCond %{HTTP:X-Forwarded-Proto} !=https
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L]
<Files ".sparat-site">
Require all denied
</Files>
<IfModule mod_headers.c>
<FilesMatch "^(index\\.html)?$">
Header set Cache-Control "no-cache"
</FilesMatch>
<FilesMatch "^(sweden-mask\\.json|stop-places\\.json|rail-[a-z-]+\\.(json|geojson)|robots\\.txt)$">
Header set Cache-Control "public, max-age=3600"
</FilesMatch>
</IfModule>
`;
const HT_HOUR = `# Spårat (tools/deploy.mjs): kept an hour\n<IfModule mod_headers.c>\nHeader set Cache-Control "public, max-age=3600"\n</IfModule>\n`;
const HT_ASSETS = `# Spårat (tools/deploy.mjs): built files, their names change with their content: kept a year\n<IfModule mod_headers.c>\nHeader set Cache-Control "public, max-age=31536000, immutable"\n</IfModule>\n`;
const HT_TILES = `# Spårat's map file (tools/deploy.mjs): read in pieces, kept a week, never repacked, any site may read
SetEnvIf Request_URI "\\.pmtiles$" no-gzip=1
<IfModule mod_headers.c>
Header always set Access-Control-Allow-Origin "*"
Header always set Access-Control-Expose-Headers "Content-Length, Content-Range, ETag"
<FilesMatch "\\.pmtiles$">
Header always set Cache-Control "public, max-age=604800"
</FilesMatch>
</IfModule>
`;
const ROBOTS = '# Spårat is not announced yet (public-plan step 9): please don\'t list it.\nUser-agent: *\nDisallow: /\n';

const sha = b => createHash('sha256').update(b).digest('hex');
const mapFiles = () => readdirSync(join(ROOT, 'data/map')).filter(f => /^sweden-\d{4}-\d\d-\d\d\.pmtiles$/.test(f)).sort();
const recordPath = join(ROOT, 'data/site', SITE.split('/').pop() + '.json');
const record = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')) : { files: {}, gone: {} };
const saveRecord = () => { mkdirSync(join(ROOT, 'data/site'), { recursive: true }); writeFileSync(recordPath, JSON.stringify(record, null, 1)); };
const log = s => console.log(`${new Date().toLocaleTimeString('sv-SE')} ${s}`);

// --- SFTP ---
const pins = cfg.SFTP_HOSTKEY.split(',').map(s => s.trim().replace(/^SHA256:/, '').replace(/=+$/, ''));
const conn = new ssh2.Client();
const sftp = await new Promise((res, rej) => {
  conn.on('ready', () => conn.sftp((e, s) => (e ? rej(e) : res(s)))).on('error', rej);
  conn.connect({ host: cfg.SFTP_HOST, port: Number(cfg.SFTP_PORT ?? 22), username: cfg.SFTP_USER, password: cfg.SFTP_PASS, readyTimeout: 30000,
    hostVerifier: k => pins.includes(createHash('sha256').update(k).digest('base64').replace(/=+$/, '')) });
});
const call = (fn, ...a) => new Promise((res, rej) => sftp[fn](...a, (e, v) => (e ? rej(e) : res(v))));
const inside = p => { const n = posix.normalize(p); if (n !== SITE && !n.startsWith(SITE + '/')) throw new Error('outside the site folder: ' + p); return n; };
const stat = async p => { try { return await call('stat', inside(p)); } catch { return null; } };
const readdir = async p => { try { return await call('readdir', inside(p)); } catch { return []; } };
const made = new Set();
async function mkdirs(dir) {
  let at = SITE;
  for (const part of posix.relative(SITE, inside(dir)).split('/').filter(Boolean)) {
    at += '/' + part;
    if (made.has(at)) continue;
    if (!(await stat(at))) await call('mkdir', at);
    made.add(at);
  }
}
// A whole file under a temporary name, then into place: a reader never gets half a file.
async function put(rel, buf) {
  if (/\.(php|phtml|phar)$/i.test(rel) || rel.split('/')[0] === 'api') throw new Error(`refusing ${rel}: no scripts and nothing under api/ on one.com`);
  const to = inside(`${SITE}/${rel}`), tmp = `${to}.up-${process.pid}.tmp`;
  await mkdirs(posix.dirname(to));
  await call('writeFile', tmp, buf);
  try { await call('ext_openssh_rename', tmp, to); } catch {
    try { await call('unlink', to); } catch { /* not there */ }
    await call('rename', tmp, to);
  }
}
async function rmTree(p) {
  for (const e of await readdir(p)) {
    const full = `${p}/${e.filename}`;
    if (e.longname.startsWith('d')) { await rmTree(full); await call('rmdir', inside(full)); } else await call('unlink', inside(full));
  }
}
async function walkRemote(p, out = []) {
  for (const e of await readdir(p)) {
    const full = `${p}/${e.filename}`;
    if (e.longname.startsWith('d')) await walkRemote(full, out); else out.push({ path: full, size: e.attrs.size, mtime: e.attrs.mtime });
  }
  return out;
}

// The folder must be ours (the marker), or empty (data/ allowed) on the first run.
async function claim() {
  const names = (await readdir(SITE)).map(e => e.filename);
  if (names.includes(MARK)) return;
  const other = names.filter(n => n !== 'data');
  if (other.length) throw new Error(`${SITE} is not Spårat's (no ${MARK}) and not empty (${other.slice(0, 5).join(', ')}): refusing`);
  await put(MARK, `Spårat's site folder (tools/deploy.mjs). ${URL_}\n`);
  await put('.htaccess', HT_ROOT);
  log(`claimed ${SITE} (${MARK})`);
}

async function tiles() {
  const name = mapFiles().at(-1);
  if (!name) throw new Error('no data/map/sweden-<date>.pmtiles (node tools/map-file.mjs cut)');
  const local = statSync(join(ROOT, 'data/map', name)).size;
  await put('tiles/.htaccess', HT_TILES);
  const there = await stat(`${SITE}/tiles/${name}`);
  if (there?.size === local) { log(`tiles: ${name} is there (${(local / 1e6).toFixed(0)} MB)`); return; }
  log(`tiles: uploading ${name} (${(local / 1e6).toFixed(0)} MB)…`);
  const to = `${SITE}/tiles/${name}`, tmp = `${to}.up-${process.pid}.tmp`;
  const t = Date.now();
  await call('fastPut', join(ROOT, 'data/map', name), inside(tmp), { concurrency: 16, chunkSize: 1 << 17 });
  try { await call('unlink', inside(to)); } catch { /* not there */ }
  await call('rename', inside(tmp), inside(to));
  log(`tiles: ${name} uploaded in ${((Date.now() - t) / 1000).toFixed(0)} s`);
}

async function page() {
  const name = mapFiles().at(-1);
  if (!name || (await stat(`${SITE}/tiles/${name}`))?.size !== statSync(join(ROOT, 'data/map', name)).size)
    throw new Error(`the map file ${name} is not on the site yet: run tiles first`);
  const b = spawnSync(process.execPath, ['tools/build-public.mjs', '--data', `${URL_}/data/`, '--tap', `${URL_}/api/ask.php`, '--map', `${URL_}/tiles/${name}`],
    { cwd: ROOT, stdio: 'inherit' });
  if (b.status !== 0) throw new Error('build:public failed (or the key search found the key): nothing uploaded');
  const dist = join(ROOT, 'dist-public');
  const files = new Map();
  (function walk(d, rel) {
    for (const n of readdirSync(d)) {
      const p = join(d, n), r = rel ? `${rel}/${n}` : n;
      if (statSync(p).isDirectory()) walk(p, r); else files.set(r, readFileSync(p));
    }
  })(dist, '');
  if (!files.has('index.html')) throw new Error('no index.html in dist-public');
  for (const top of files.keys()) if (OURS.has(top.split('/')[0])) throw new Error(`the build has ${top}, which would clash with the site's own folders`);
  files.set('robots.txt', Buffer.from(ROBOTS));
  files.set('.htaccess', Buffer.from(HT_ROOT));
  files.set('assets/.htaccess', Buffer.from(HT_ASSETS));
  for (const d of ['map', 'glyphs', 'fonts']) if ([...files.keys()].some(k => k.startsWith(d + '/'))) files.set(`${d}/.htaccess`, Buffer.from(HT_HOUR));

  const remote = new Map((await walkRemote(SITE)).map(f => [posix.relative(SITE, f.path), f]));
  let sent = 0, kept = 0, bytes = 0;
  const order = [...files.keys()].filter(k => k !== 'index.html').concat('index.html');
  for (const rel of order) {
    const buf = files.get(rel), h = sha(buf);
    if (rel !== 'index.html' && record.files[rel] === h && remote.get(rel)?.size === buf.length) { kept++; continue; }
    await put(rel, buf);
    record.files[rel] = h; delete record.gone[rel];
    sent++; bytes += buf.length;
  }
  saveRecord();
  log(`page: ${sent} files uploaded (${(bytes / 1e6).toFixed(1)} MB), ${kept} unchanged; index.html last`);

  // Files the new page no longer has: kept a day after they left it, then deleted.
  const now = Date.now();
  let dropped = 0, waiting = 0;
  for (const [rel] of remote) {
    if (OURS.has(rel.split('/')[0]) || files.has(rel) || rel.endsWith('.tmp')) continue;
    record.gone[rel] ??= now;
    if (now - record.gone[rel] > 24 * 3600e3) { await call('unlink', inside(`${SITE}/${rel}`)); delete record.gone[rel]; delete record.files[rel]; dropped++; } else waiting++;
  }
  saveRecord();
  if (dropped || waiting) log(`page: ${dropped} old files deleted, ${waiting} kept until a day after they left the page`);
  log(`page: ${URL_}/`);
}

async function list() {
  const all = await walkRemote(SITE);
  const by = {};
  for (const f of all) { const top = posix.relative(SITE, f.path).split('/')[0]; (by[top] ??= { n: 0, b: 0 }); by[top].n++; by[top].b += f.size; }
  for (const [k, v] of Object.entries(by).sort()) console.log(`${k.padEnd(28)} ${String(v.n).padStart(5)} files ${(v.b / 1e6).toFixed(1).padStart(8)} MB`);
}

try {
  if (what === 'list') await list();
  else if (what === 'remove') {
    if (!(await stat(`${SITE}/${MARK}`))) throw new Error(`${SITE} has no ${MARK}: not Spårat's, refusing`);
    await rmTree(SITE);
    record.files = {}; record.gone = {}; saveRecord();
    log(`removed everything in ${SITE}; ${URL_} shows one.com's placeholder again`);
  } else {
    await claim();
    if (what === 'tiles' || what === 'all') await tiles();
    if (what === 'page' || what === 'all') await page();
  }
} catch (e) { console.log('deploy: ' + e.message); process.exitCode = 1; }
conn.end();
