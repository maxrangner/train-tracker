// Searches for our secrets and fails if one is found (public-plan step 3: "a search of the built page finds no key";
// plan to beta phase B, 2026-11-17: the search covers every secret and can't be skipped by mistake).
// The secrets: the Trafikverket key and the passwords, read from the settings files on this computer (SECRETS below,
// or SECRET_FILES=<file>;<file> to name others). Only values whose name says key, password, secret or token count
// (not SFTP_HOSTKEY: one.com's public host key). Nothing found to search for is a failure, never a pass. The
// secrets themselves are never printed.
// Run: node tools/key-search.mjs [folder]   a folder (default dist-public), every file in it
//      node tools/key-search.mjs --git      the files git tracks, as they are now on disk (tools/check.mjs)
//      node tools/key-search.mjs --staged   what is about to be committed (the pre-commit hook)
// Exit code 0: none found; 1: found; 2: nothing to search for, or the folder is missing (also a failure).
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// The project's .env, then the settings files kept beside the project folder (D:/dev here; one level up from any
// working folder of the project, so second working folders find them too).
const SECRETS = ['.env', '../sparat-site.env', '../sparat-fetcher.env', '../sparat-monitor.env'];
const files = process.env.SECRET_FILES ? process.env.SECRET_FILES.split(';').filter(Boolean) : SECRETS;

const secrets = [];   // [what, value]
for (const f of files) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][\w]*)\s*=\s*(.*)$/.exec(line);
    if (!m || !/KEY|PASS|SECRET|TOKEN/i.test(m[1]) || /HOSTKEY/i.test(m[1])) continue;
    const v = m[2].trim().replace(/^['"]|['"]$/g, '');
    if (v.length >= 8 && !secrets.some(([, x]) => x === v)) secrets.push([`${m[1]} (${f})`, v]);
  }
}
if (!secrets.length) { console.log(`secret search FAILED: no secret found to search for in ${files.join(', ')}`); process.exit(2); }

// A value is found whole, or (16 characters or longer) as its first or last 12 characters: a key cut in two by a
// build would still show.
const parts = secrets.map(([what, v]) => [what, v.length >= 16 ? [v, v.slice(0, 12), v.slice(-12)] : [v]]);
const found = [];
let count = 0, bytes = 0;
function look(name, buf) {
  count++; bytes += buf.length;
  const s = buf.toString('latin1');
  for (const [what, ps] of parts) if (ps.some(p => s.includes(p))) found.push(`${what} in ${name}`);
}

const mode = process.argv[2] ?? 'dist-public';
let where;
if (mode === '--git' || mode === '--staged') {
  const git = args => execFileSync('git', args, { maxBuffer: 1 << 28 });
  const names = (mode === '--git' ? git(['ls-files', '-z']) : git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']))
    .toString('utf8').split('\0').filter(Boolean);
  for (const n of names) {
    if (mode === '--staged') look(n, git(['show', `:${n}`]));
    else if (existsSync(n) && statSync(n).isFile()) look(n, readFileSync(n));
  }
  where = mode === '--git' ? 'the files git tracks' : 'what is about to be committed';
} else {
  if (!existsSync(mode)) { console.log(`secret search FAILED: no folder ${mode}`); process.exit(2); }
  (function walk(d) {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p); else look(p, readFileSync(p));
    }
  })(mode);
  where = mode;
}
console.log(found.length ? `secret search FAILED: ${found.join(', ')}`
  : `secret search ok: none of ${secrets.length} secrets in ${count} files (${(bytes / 1e6).toFixed(1)} MB), ${where}`);
process.exit(found.length ? 1 : 0);
