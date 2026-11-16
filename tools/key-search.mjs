// Searches a folder (a built page) for the Trafikverket key, as written in .env (VITE_TRV_KEY), and fails if it is
// there (public-plan step 3: "a search of the built page finds no key"). The key itself is never printed.
// Run: node tools/key-search.mjs [folder]   (default dist-public)   Exit code 0: not found; 1: found; 2: no key to search for.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist-public';
const env = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
const key = /^\s*VITE_TRV_KEY\s*=\s*['"]?([^'"\r\n]+)/m.exec(env)?.[1]?.trim();
if (!key) { console.log('key search: no VITE_TRV_KEY in .env to search for'); process.exit(2); }
if (!existsSync(dir)) { console.log(`key search: no folder ${dir}`); process.exit(2); }

const found = [];
let files = 0, bytes = 0;
(function walk(d) {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    const b = readFileSync(p);
    files++; bytes += b.length;
    // As text, and also any part of it 12 characters or longer (a key cut in two by a build would still show).
    const s = b.toString('latin1');
    if (s.includes(key) || [0, key.length - 12].some(i => s.includes(key.slice(i, i + 12)))) found.push(p);
  }
})(dir);
console.log(found.length ? `key search FAILED: the key is in ${found.join(', ')}` : `key search ok: the key is in none of ${files} files (${(bytes / 1e6).toFixed(1)} MB) in ${dir}`);
process.exit(found.length ? 1 : 0);
