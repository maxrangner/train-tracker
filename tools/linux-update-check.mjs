// The Linux PC's `sparat` command (linux/sparat) on a pretend Linux (batch 2, 2026-11-19; TODO 25, 33): a folder
// stands for /, little scripts stand for systemctl and journalctl. Cases: a first update over a version without a
// manifest; a broken package (a file changed after packing) refused with nothing touched; a wrong fingerprint refused;
// a service that won't start: back to the previous version by itself; `sparat back` and back again; status.
// Needs bash, tar, sha256sum (Git Bash on Windows, any Linux). About 20 s, offline.
// Run: node tools/linux-update-check.mjs     exit code 0: all hold; 1: one failed; skipped without bash.
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, statSync, cpSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

const bash = spawnSync('bash', ['-c', 'command -v tar sha256sum cmp >/dev/null && echo ok'], { encoding: 'utf8' });
if (bash.status !== 0 || !bash.stdout.includes('ok')) { console.log('linux-update-check: no bash with tar, sha256sum and cmp here: skipped'); process.exit(0); }
const posix = p => p.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);

const T = join(tmpdir(), `sparat-update-check-${process.pid}`);
rmSync(T, { recursive: true, force: true });
const ROOT = join(T, 'root'), PKG = join(T, 'pkg');
mkdirSync(join(ROOT, 'opt/sparat'), { recursive: true });
mkdirSync(join(ROOT, 'etc/systemd/system'), { recursive: true });
mkdirSync(join(ROOT, 'usr/local/bin'), { recursive: true });
// systemctl / journalctl stand-ins: they log what they are asked; a service "runs" unless the running version's
// fetcher holds the word BROKEN.
const LOG = join(T, 'systemctl.log');
writeFileSync(join(T, 'systemctl'), `#!/bin/bash\necho "$*" >> "${posix(LOG)}"\n` +
  `if [ "$1" = is-active ]; then grep -q BROKEN "${posix(ROOT)}/opt/sparat/fetcher/main.mjs" 2>/dev/null && exit 3; exit 0; fi\nexit 0\n`);
writeFileSync(join(T, 'journalctl'), '#!/bin/bash\necho "(the fetcher\'s log)"\n');

// A package as tools/pack-linux.mjs makes it: sparat/ with the start files, the service files, the script and a manifest.
function pack(version, { change = null, broken = false } = {}) {
  const dir = join(PKG, version, 'sparat');
  rmSync(join(PKG, version), { recursive: true, force: true });
  const put = (f, s) => { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), s); };
  put('fetcher/main.mjs', `// fetcher ${version}${broken ? ' BROKEN' : ''}\nexport const v = 1;\n`);
  for (const f of ['fetcher/self-check.mjs', 'monitor/main.mjs', 'monitor/top.mjs']) put(f, `// ${f} ${version}\n`);
  put('fetcher/sparat-fetcher.service', `[Service]\nExecStart=/usr/bin/node /opt/sparat/fetcher/main.mjs # ${version}\n`);
  put('monitor/sparat-monitor.service', '[Service]\nExecStart=/usr/bin/node /opt/sparat/monitor/main.mjs\n');
  put('node_modules/ssh2/index.js', 'module.exports = {};\n');
  cpSync('linux/sparat', join(dir, 'sparat'));
  const files = {};
  (function walk(d) { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else files[relative(dir, p).replaceAll('\\', '/')] = createHash('sha256').update(readFileSync(p)).digest('hex'); } })(dir);
  put('MANIFEST.json', JSON.stringify({ version, commit: `c${version.replaceAll('.', '')}`, made: '2026-11-19T00:00:00Z', files }));
  if (change) put(change, '// changed after packing\n');
  const tar = join(PKG, `sparat-${version}.tar.gz`);
  spawnSync('tar', ['-czf', posix(tar), '-C', posix(join(PKG, version)), 'sparat'], { shell: false });
  writeFileSync(`${tar}.sha256`, `${createHash('sha256').update(readFileSync(tar)).digest('hex')}  sparat-${version}.tar.gz\n`);
  return tar;
}
const run = (...args) => {
  const r = spawnSync('bash', [posix('linux/sparat'), ...args.map(a => (a.includes(':') || a.includes('\\') ? posix(a) : a))], {
    encoding: 'utf8', env: { ...process.env, SPARAT_ROOT: posix(ROOT), SPARAT_SYSTEMCTL: posix(join(T, 'systemctl')), SPARAT_JOURNALCTL: posix(join(T, 'journalctl')), SPARAT_SETTLE: '0' } });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
};
const running = () => readFileSync(join(ROOT, 'opt/sparat/fetcher/main.mjs'), 'utf8').match(/fetcher (\S+)/)?.[1] ?? '?';
let failed = 0;
const ok = (good, what, out = '') => { console.log(`${good ? 'ok  ' : 'FAIL'} ${what}`); if (!good) { failed++; if (out) console.log(out.split('\n').map(l => `     ${l}`).join('\n')); } };

// The Linux PC as installed by hand (0.6.1, no manifest, no script).
writeFileSync(join(ROOT, 'opt/sparat/fetcher.txt'), 'x');
mkdirSync(join(ROOT, 'opt/sparat/fetcher'), { recursive: true });
writeFileSync(join(ROOT, 'opt/sparat/fetcher/main.mjs'), '// fetcher 0.6.1\n');

let r = run('update', pack('0.7.0'));
ok(r.code === 0 && running() === '0.7.0' && existsSync(join(ROOT, 'usr/local/bin/sparat')) && existsSync(join(ROOT, 'etc/systemd/system/sparat-fetcher.service'))
  && readFileSync(LOG, 'utf8').includes('daemon-reload'), 'update 0.6.1 -> 0.7.0: running, service files handed over, the command installed', r.out);
writeFileSync(LOG, '');
r = run('update', pack('0.7.1', { change: 'fetcher/self-check.mjs' }));
ok(r.code !== 0 && running() === '0.7.0' && !readFileSync(LOG, 'utf8').includes('stop'), 'a package changed after packing: refused, nothing stopped, 0.7.0 still runs', r.out);
const bad = pack('0.7.2');
writeFileSync(`${bad}.sha256`, `${'0'.repeat(64)}  x\n`);
r = run('update', bad);
ok(r.code !== 0 && running() === '0.7.0' && /fingerprint/.test(r.out), 'a wrong fingerprint: refused, 0.7.0 still runs', r.out);
r = run('update', pack('0.7.3', { broken: true }));
ok(r.code !== 0 && running() === '0.7.0' && /previous version runs again/.test(r.out), 'a version whose service won\'t start: back to 0.7.0 by itself', r.out);
r = run('update', pack('0.7.4'));
ok(r.code === 0 && running() === '0.7.4', 'update 0.7.0 -> 0.7.4', r.out);
r = run('back');
ok(r.code === 0 && running() === '0.7.0', 'sparat back: 0.7.0 again', r.out);
r = run('back');
ok(r.code === 0 && running() === '0.7.4', 'sparat back again: 0.7.4 again', r.out);
r = run('status');
ok(r.code === 0 && /running 0\.7\.4 \(c074\)/.test(r.out) && /sparat-fetcher: running/.test(r.out) && /kept for sparat back: 0\.7\.0/.test(r.out), 'sparat status: version, services, the kept one, the log', r.out);
r = run('update', join(T, 'nothing.tar.gz'));
ok(r.code !== 0 && running() === '0.7.4', 'no such package: refused', r.out);

rmSync(T, { recursive: true, force: true });
console.log(failed ? `linux-update-check FAILED (${failed})` : 'linux-update-check ok');
process.exit(failed ? 1 : 0);
