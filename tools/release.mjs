// A release in one command (Max, 2026-11-18: yes to "one release command"; nothing automatic: a session runs it only
// after his yes, and asks him first whether the app goes with it). It stops at the first problem.
//   1. main, with nothing uncommitted;
//   2. the full check (tools/check.mjs): a failure stops everything, nothing goes online;
//   3. the version (docs/versions.md): --feature the middle number (something he can see or use), --fix the last;
//      its own branch chore/version-X.Y.Z, merged --no-ff, tag vX.Y.Z;
//   4. the page online (tools/deploy.mjs page), then the site is read to see it serves the new version;
//   5. --app: the app without a key (tools/apk.mjs --public), dist/sparat-X.Y.Z.apk, for the session to send him;
//   6. the push (docs/kit/push.mjs: the before-push searches, then main and the tags);
//   7. the Linux PC: when a file of its package changed since its last update (data/site/linux.json), the package
//      (tools/pack-linux.mjs) and his commands; otherwise "nothing to do". After he has updated it:
//      node tools/release.mjs --linux-done (records what runs there now).
// Run in the main folder: node tools/release.mjs --feature|--fix [--app] --env <site settings> [--trailer "<line>"]
//   --dry: only says what it would do (no check, no version, nothing online).
// The site settings (as tools/deploy.mjs) may also hold LINUX_HOST (e.g. user@address of the Linux PC, for the copy
// command it prints).
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';

const args = process.argv.slice(2);
const has = n => args.includes(n);
const arg = n => { const i = args.indexOf(n); return i < 0 ? null : args[i + 1]; };
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const RECORD = 'data/site/linux.json';
const pkgVersion = () => JSON.parse(readFileSync('package.json', 'utf8')).version;

if (has('--linux-done')) {
  writeFileSync(RECORD, JSON.stringify({ version: pkgVersion(), commit: git('rev-parse', '--short', 'HEAD'), at: new Date().toISOString() }, null, 1) + '\n');
  console.log(`release: the Linux PC recorded as running ${pkgVersion()} (${git('rev-parse', '--short', 'HEAD')})`);
  process.exit(0);
}

const kind = has('--feature') ? 'feature' : has('--fix') ? 'fix' : null;
const envPath = arg('--env'), app = has('--app'), dry = has('--dry'), trailer = arg('--trailer');
if (!kind || !envPath) { console.log('node tools/release.mjs --feature|--fix [--app] --env <site settings> [--trailer "<line>"] [--dry]  |  --linux-done'); process.exit(2); }
const cfg = Object.fromEntries(readFileSync(envPath, 'utf8').split(/\r?\n/).map(l => /^\s*([A-Z_]+)\s*=\s*(.*)$/.exec(l)).filter(Boolean).map(m => [m[1], m[2].trim()]));
const SITE = (cfg.SITE_URL ?? '').replace(/\/$/, '');
let n = 0;
const step = s => console.log(`\n== ${++n}. ${s}`);
const stop = why => { console.log(`\nrelease STOPPED at step ${n}: ${why}. Nothing after it was done.`); process.exit(1); };
const node = (...a) => spawnSync(process.execPath, a, { stdio: 'inherit' }).status;
const message = text => (trailer ? `${text}\n\n${trailer}` : text);

step('main, nothing uncommitted');
if (git('branch', '--show-current') !== 'main') stop('not on main');
if (git('status', '--porcelain', '--untracked-files=no')) stop('uncommitted changes in main');
console.log(`ok: main at ${git('log', '--oneline', '-1')}`);

const [a, b, c] = pkgVersion().split('.').map(Number);
const next = kind === 'feature' ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
if (dry) {
  console.log(`\n(dry) would: run the check, make ${next} (${kind}), put the page on ${SITE}${app ? ', build the app' : ''}, push, and look at the Linux PC:`);
  linuxReport(false);
  process.exit(0);
}

step('the full check');
if (node('tools/check.mjs') !== 0) stop('the check did not pass');

step(`the version: ${pkgVersion()} -> ${next} (${kind})`);
const branch = `chore/version-${next}`;
git('switch', '-q', '-c', branch);
if (spawnSync(`npm version ${next} --no-git-tag-version`, { shell: true, stdio: 'inherit' }).status !== 0) { git('switch', '-q', 'main'); stop('npm version failed'); }
git('commit', '-qam', message(`version ${next} (tools/release.mjs; docs/versions.md)`));
git('switch', '-q', 'main');
git('merge', '--no-ff', '-q', branch, '-m', message(`Merge branch '${branch}'`));
git('branch', '-q', '-d', branch);
git('tag', '-a', `v${next}`, '-m', `${next} (tools/release.mjs)`);
console.log(`ok: ${git('log', '--oneline', '-1')}, tag v${next}`);

step(`the page on ${SITE}`);
if (node('tools/deploy.mjs', 'page', '--env', envPath) !== 0) stop('the upload failed');
try {
  const html = await (await fetch(`${SITE}/`, { cache: 'no-store' })).text();
  const js = /assets\/index-[^"']+\.js/.exec(html)?.[0];
  const code = js ? await (await fetch(`${SITE}/${js}`)).text() : '';
  if (!code.includes(next)) stop(`the site does not serve ${next} yet (${js ?? 'no script found'})`);
  console.log(`ok: ${SITE} serves ${next}`);
} catch (e) { stop(`the site could not be read: ${e.message}`); }

if (app) {
  step('the app without a key');
  if (node('tools/apk.mjs', '--public') !== 0) stop('the app build failed');
  console.log(`ok: dist/sparat-${next}.apk: the session sends it to Max as a file`);
}

step('the push');
if (!existsSync('docs/kit/push.mjs')) console.log('note: docs/kit/push.mjs is not here: not pushed');
else if (node('docs/kit/push.mjs') !== 0) stop('the push stopped (its searches found something, or git failed): tell Max');

step('the Linux PC');
linuxReport(true);
console.log(`\nrelease ${next} done. Left for the session: the ${next} section in docs/versions.md${app ? `, sending dist/sparat-${next}.apk` : ''}.`);

// The Linux PC: which files of its package changed since what runs there (data/site/linux.json).
function linuxReport(make) {
  const rec = existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, 'utf8')) : null;
  if (make && node('tools/pack-linux.mjs') !== 0) stop('the Linux package could not be made');
  const files = [];
  (function walk(d) {
    if (!existsSync(d)) return;
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (f === 'node_modules' || /^package(-lock)?\.json$/.test(f)) continue;
      if (statSync(p).isDirectory()) walk(p); else files.push(relative('dist-linux/sparat', p).replaceAll('\\', '/'));
    }
  })('dist-linux/sparat');
  const changed = rec && files.length ? git('diff', '--name-only', rec.commit, 'HEAD', '--', ...files).split('\n').filter(Boolean) : null;
  if (rec && changed && !changed.length) { console.log(`Linux PC: nothing to do (it runs ${rec.version}, ${rec.commit}; none of its files changed)`); return; }
  console.log(rec ? `Linux PC: ${changed ? changed.length : '?'} of its files changed since ${rec.version} (${rec.commit})${changed ? `: ${changed.slice(0, 6).join(', ')}${changed.length > 6 ? ' …' : ''}` : ''}` : 'Linux PC: no record of what runs there');
  if (!make) return;
  const v = pkgVersion(), host = cfg.LINUX_HOST ?? '<user>@<Linux PC>';
  console.log(`His commands (each explained to him first):
  on this PC:    scp ${join(process.cwd(), 'dist-linux', `sparat-${v}.tar.gz`)} ${host}:~/
  on the Linux PC:
    sudo systemctl stop sparat-fetcher sparat-monitor
    sudo rm -r /opt/sparat/*
    sudo tar -xzf ~/sparat-${v}.tar.gz -C /opt/sparat --strip-components=1 --no-same-owner
    sudo systemctl start sparat-fetcher sparat-monitor
    sudo journalctl -u sparat-fetcher -n 8 --no-pager
  then: node tools/release.mjs --linux-done`);
}
