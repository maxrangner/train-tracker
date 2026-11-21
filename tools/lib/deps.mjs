// What a check depends on, found from the code itself (tools/check.mjs, 2026-11-21: run only the checks a change can
// touch). depsOf(entries) follows every relative import (`import … from './x.js'`, `import('./x.js')`) from the
// entry files, and every other tool a file starts by name (a string like 'tools/models-check.mjs'), to the full set of
// project files they use. Library imports (`maplibre-gl`, `node:fs`) are not followed: package-lock.json stands for
// them. stampOf(files) is one SHA-256 of all those files' paths and contents (a missing file counts as "none"), so a
// check whose stamp is as when it last passed can be skipped: nothing it reads has changed.
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
const rel = p => relative(ROOT, p).replaceAll('\\', '/');
const CODE = /\.(m?js)$/;

// Relative imports and tools started by name, from one file's text.
function edges(file) {
  const text = readFileSync(join(ROOT, file), 'utf8'), out = new Set(), here = dirname(join(ROOT, file));
  for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g)) out.add(rel(resolve(here, m[1])));
  for (const m of text.matchAll(/['"`]((?:tools|fetcher|monitor|src)\/[\w./-]+\.m?js)['"`]/g)) out.add(m[1]);
  return [...out].filter(f => existsSync(join(ROOT, f)) && statSync(join(ROOT, f)).isFile());
}

// Every project code file the entries use (the entries included), sorted.
export function depsOf(...entries) {
  const seen = new Set(), todo = entries.flat().filter(f => existsSync(join(ROOT, f)));
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if (CODE.test(f)) todo.push(...edges(f));
  }
  return [...seen].sort();
}

// Every file under a folder (relative to the project), e.g. filesIn('src'); a file name is itself.
export function filesIn(...paths) {
  const out = [];
  const walk = p => {
    const abs = join(ROOT, p);
    if (!existsSync(abs)) return;
    if (statSync(abs).isDirectory()) for (const n of readdirSync(abs)) walk(`${p}/${n}`);
    else out.push(p);
  };
  for (const p of paths.flat()) walk(p);
  return out.sort();
}

export function stampOf(files, extra = '') {
  const h = createHash('sha256').update(extra);
  for (const f of [...new Set(files)].sort()) {
    const abs = join(ROOT, f);
    h.update(`\n${f}:`);
    h.update(existsSync(abs) ? createHash('sha256').update(readFileSync(abs)).digest('hex') : 'none');
  }
  return h.digest('hex');
}
