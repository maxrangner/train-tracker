// A release in one command (Max, 2026-11-18: yes to "one release command"; nothing automatic: a session runs it only
// after his yes, and asks him first whether the app goes with it). It stops at the first problem.
//   1. main, with nothing uncommitted;
//   2. the full check (tools/check.mjs): a failure stops everything, nothing goes online;
//   3. the version (docs/versions.md): --feature the middle number (something he can see or use), --fix the last;
//      its own branch chore/version-X.Y.Z, merged --no-ff, tag vX.Y.Z;
//   4. the page online (tools/deploy.mjs page), then the site is read to see it serves the new version;
//   5. --app: the app without a key (tools/apk.mjs --public), dist/sparat-X.Y.Z.apk, for the session to send him;
//   6. the push (docs/kit/push.mjs: the before-push searches, then main and the tags);
//   7. the Linux PC: its package (tools/pack-linux.mjs) compared, file by file with fingerprints, with what runs there
//      (data/site/linux.json); when anything differs his commands (copy, `sudo sparat update`), otherwise "nothing to
//      do". After he has updated it: node tools/release.mjs --linux-done (records the package's manifest).
// Run in the main folder: node tools/release.mjs --feature|--fix [--app] --env <site settings> [--trailer "<line>"]
//   --dry: only says what it would do (no check, no version, nothing online).
// The site settings (as tools/deploy.mjs) may also hold LINUX_HOST (e.g. user@address of the Linux PC, for the copy
// command it prints).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const has = n => args.includes(n);
const arg = n => { const i = args.indexOf(n); return i < 0 ? null : args[i + 1]; };
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const RECORD = 'data/site/linux.json';
const pkgVersion = () => JSON.parse(readFileSync('package.json', 'utf8')).version;

// After he has run `sudo sparat update`: the package's own manifest is recorded (its version, the commit it was made
// from, every file's fingerprint), not whatever main is at by then (Codex's beta review point 8).
const MANIFEST = 'dist-linux/sparat/MANIFEST.json';
if (has('--linux-done')) {
  if (!existsSync(MANIFEST)) { console.log(`release: no ${MANIFEST} (make the package first: node tools/pack-linux.mjs)`); process.exit(1); }
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  writeFileSync(RECORD, JSON.stringify({ version: m.version, commit: m.commit, made: m.made, at: new Date().toISOString(), files: m.files }, null, 1) + '\n');
  console.log(`release: the Linux PC recorded as running ${m.version} (${m.commit}, packed ${m.made}; ${Object.keys(m.files).length} files)`);
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
  console.log(`\n(dry) would: run the check, make ${next} (${kind}), put the page on ${SITE}${app ? ', build the app' : ''}, push, and look at the Linux PC (its package made now, as it is in main today):`);
  linuxReport();
  process.exit(0);
}

// The screen checks must run for a release (SPARAT_RELEASE: tools/check.mjs fails, instead of skipping them, when no
// dev page answers; Codex's beta review point 8).
step('the full check');
if (spawnSync(process.execPath, ['tools/check.mjs'], { stdio: 'inherit', env: { ...process.env, SPARAT_RELEASE: '1' } }).status !== 0)
  stop('the check did not pass (or no dev page ran for the screen checks: start npm run dev)');

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
// The site must serve exactly the page just built (dist-public, tools/deploy.mjs page): index.html and its script
// byte for byte (until 2026-11-19: "the version text is somewhere in the script"). index.html keeps its name, and one.com
// served a replaced file minutes old at times (2026-11-15), so it is read again for up to 3 minutes.
{
  const sha = b => createHash('sha256').update(b).digest('hex');
  const localHtml = readFileSync('dist-public/index.html');
  const js = /assets\/index-[^"']+\.js/.exec(localHtml.toString())?.[0];
  if (!js) stop('no script named in dist-public/index.html');
  let same = false, why = '';
  for (let i = 0; i < 10 && !same; i++) {
    if (i) await new Promise(r => setTimeout(r, 20000));
    try {
      const html = Buffer.from(await (await fetch(`${SITE}/`, { cache: 'no-store' })).arrayBuffer());
      const code = Buffer.from(await (await fetch(`${SITE}/${js}`, { cache: 'no-store' })).arrayBuffer());
      same = sha(html) === sha(localHtml) && sha(code) === sha(readFileSync(`dist-public/${js}`));
      why = same ? '' : 'its index.html or script differs from the one just built';
    } catch (e) { why = `the site could not be read: ${e.message}`; }
  }
  if (!same) stop(`${SITE} doesn't serve the page just built (${why})`);
  console.log(`ok: ${SITE} serves exactly the page just built (${next}; index.html and ${js})`);
}

if (app) {
  step('the app without a key');
  if (node('tools/apk.mjs', '--public') !== 0) stop('the app build failed');
  console.log(`ok: dist/sparat-${next}.apk: the session sends it to Max as a file`);
}

step('the push');
if (!existsSync('docs/kit/push.mjs')) console.log('note: docs/kit/push.mjs is not here: not pushed');
else if (node('docs/kit/push.mjs') !== 0) stop('the push stopped (its searches found something, or git failed): tell Max');

step('the Linux PC');
linuxReport();
console.log(`\nrelease ${next} done. Left for the session: the ${next} section in docs/versions.md${app ? `, sending dist/sparat-${next}.apk` : ''}.`);

// The Linux PC: the package is made (tools/pack-linux.mjs) and its manifest (every file with its fingerprint: code,
// libraries, service files, the sparat command) compared with the one recorded for what runs there
// (data/site/linux.json, written by --linux-done). Exact: a library-only change or a removed file counts too (until
// 2026-11-19 only git changes to the code files were compared). Then his commands: copy, sparat update.
function linuxReport() {
  const rec = existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, 'utf8')) : null;
  if (node('tools/pack-linux.mjs') !== 0) stop('the Linux package could not be made');
  const man = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const old = rec?.files ?? null;
  const changed = old ? [...new Set([...Object.keys(man.files), ...Object.keys(old)])].filter(f => man.files[f] !== old[f]).sort() : null;
  if (changed && !changed.length) { console.log(`Linux PC: nothing to do (it runs ${rec.version}, ${rec.commit}; every file of the package the same)`); return; }
  console.log(changed ? `Linux PC: ${changed.length} file(s) differ from what runs there (${rec.version}, ${rec.commit}): ${changed.slice(0, 8).join(', ')}${changed.length > 8 ? ' …' : ''}`
    : `Linux PC: it runs ${rec?.version ?? 'a version'} from before the manifests (installed by hand): the whole package goes, and the sparat command once`);
  const tar = `sparat-${man.version}.tar.gz`, host = cfg.LINUX_HOST ?? '<user>@<Linux PC>';
  console.log(`His commands (each explained to him first):
  on this PC:    scp ${join(process.cwd(), 'dist-linux', tar)} ${join(process.cwd(), 'dist-linux', `${tar}.sha256`)} ${host}:~/
  on the Linux PC:${old ? '' : `
    (once) tar -xzf ~/${tar} sparat/sparat && sudo install -m 755 sparat/sparat /usr/local/bin/sparat && rm -r sparat`}
    sudo sparat update ~/${tar}
    sparat status
  then (the session): node tools/release.mjs --linux-done`);
}
