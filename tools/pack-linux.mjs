// Packs what runs on the Linux PC, and nothing else (plan to beta step 2, 2026-11-17; Codex's review): the fetcher, the
// monitor, every project file they really import (followed from their start files, so none is forgotten), their
// service files and example settings, and a package list with only their two libraries (ssh2, nodemailer) and a lock
// file copied from the project's own (the same exact versions and checksums; nothing is looked up anew). Then the
// secret search runs over the package; a find stops it.
// Left out on purpose: fetcher/trial.sh (the old trial: it skipped the checks and opened a server to the home network).
// The libraries go inside the package (npm ci --omit=dev --ignore-scripts here: the lock file's exact versions and
// checksums, no library's own install program run; all 9 are plain JavaScript), so the Linux PC needs Node only, not
// npm (2026-11-17: Ubuntu's npm would have pulled in hundreds of packages).
// Run: node tools/pack-linux.mjs     -> dist-linux/sparat/ and dist-linux/sparat-<version>.tar.gz
// On the Linux PC (docs/deploy.md section 4): unpack into /opt/sparat, restart the services.
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { spawnSync } from 'node:child_process';

const OUT = 'dist-linux', DIR = `${OUT}/sparat`;
const STARTS = ['fetcher/main.mjs', 'fetcher/self-check.mjs', 'monitor/main.mjs', 'monitor/top.mjs'];
const ALSO = ['fetcher/data.htaccess', 'fetcher/example.env', 'fetcher/sparat-fetcher.service',
  'monitor/page.html', 'monitor/example.env', 'monitor/sparat-monitor.service', 'LICENSE', 'NOTICE'];
const LIBS = ['ssh2', 'nodemailer'];

// Every project file reached by import from the start files (import/export … from '…' at a line's start, and import('…')).
const specs = src => [...src.matchAll(/^\s*(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/gm), ...src.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm),
  ...src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]);
const files = new Set();
(function follow(list) {
  for (const f of list) {
    if (files.has(f)) continue;
    files.add(f);
    const all = specs(readFileSync(f, 'utf8'));
    for (const s of all) if (!/^\.{1,2}\//.test(s) && !s.startsWith('node:') && !LIBS.includes(s))
      throw new Error(`${f} uses the library ${s}, which the Linux package doesn't carry`);
    const next = all.filter(s => /^\.{1,2}\//.test(s)).map(s => posix.normalize(posix.join(posix.dirname(f), s)));
    for (const n of next) if (!existsSync(n)) throw new Error(`${f} imports ${n}, which is missing`);
    follow(next);
  }
})(STARTS);

rmSync(OUT, { recursive: true, force: true });
for (const f of [...files, ...ALSO]) { mkdirSync(dirname(join(DIR, f)), { recursive: true }); copyFileSync(f, join(DIR, f)); }

// The package list and a lock file cut from the project's own: the two libraries and what they need.
const pkg = JSON.parse(readFileSync('package.json', 'utf8')), lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const deps = Object.fromEntries(LIBS.map(n => [n, pkg.dependencies[n]]));
const keep = {}, todo = [...LIBS];
while (todo.length) {
  const n = todo.pop(), key = `node_modules/${n}`, e = lock.packages[key];
  if (!e) throw new Error(`${n} is not in package-lock.json`);
  if (keep[key]) continue;
  keep[key] = e;
  todo.push(...Object.keys(e.dependencies ?? {}), ...Object.keys(e.optionalDependencies ?? {}));
}
const out = { name: 'sparat-linux', version: pkg.version, private: true, type: 'module', license: pkg.license, dependencies: deps };
writeFileSync(join(DIR, 'package.json'), JSON.stringify(out, null, 2) + '\n');
writeFileSync(join(DIR, 'package-lock.json'), JSON.stringify({ name: out.name, version: out.version, lockfileVersion: 3, requires: true,
  packages: { '': { name: out.name, version: out.version, license: out.license, dependencies: deps }, ...keep } }, null, 2) + '\n');

const libs = spawnSync('npm ci --omit=dev --ignore-scripts --no-audit --no-fund', { cwd: DIR, stdio: 'inherit', shell: true });
if (libs.status !== 0) { console.log('pack-linux: installing the libraries failed'); process.exit(1); }
const search = spawnSync(process.execPath, ['tools/key-search.mjs', DIR], { stdio: 'inherit' });
if (search.status !== 0) { rmSync(OUT, { recursive: true, force: true }); console.log('pack-linux: stopped, the package was deleted'); process.exit(1); }
const tar = `sparat-${pkg.version}.tar.gz`;
const t = spawnSync('tar', ['-czf', tar, 'sparat'], { cwd: OUT, stdio: 'inherit' });
if (t.status !== 0) process.exit(1);
console.log(`pack-linux: ${files.size + ALSO.length + 2} files, libraries ${Object.keys(keep).map(k => k.slice(13)).join(', ')} -> ${OUT}/${tar}`);
