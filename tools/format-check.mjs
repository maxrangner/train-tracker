// The files stay backwards compatible (HARD RULE, Max 2026-11-18: "data from the first app release and forward has to
// be backwards compatible"). Every file the fetcher makes for the page and the apps (src/live-file.js, src/tap-files.js,
// fetcher/files.mjs, fetcher/timetable.mjs) must stay readable by every page and app already released: fields, row
// positions and file kinds may be ADDED (at the end of a row), never renamed, removed, moved or given another type or
// meaning. A change that can't keep that comes as a new set of files beside the old ones (src/live-file.js FORMAT + 1),
// the old ones made until no released app reads them, and Max is told before.
// This check holds the formats as released (tools/file-formats.json: every field's path and its types) and compares
// files built by the code now: a path that is gone, or has a type it never had, fails. New paths are only listed; they
// go into the list with --write once released (the list never loses a path).
// Run: node tools/format-check.mjs --files <address of the files> [--write]
//   tools/check.mjs runs it against its replaying fetcher (http://localhost:8095/: live, passings, planned, stations,
//   disruptions, stats, arrivals) and against the site (https://sparat.rangner.com/data/: everything, tap files too;
//   the site not answering is a note).
// Exit code 0: compatible; 1: not; 2: no files found.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { LIVE_MS } from '../src/live-file.js';

const arg = n => { const i = process.argv.indexOf(n); return i < 0 ? null : process.argv[i + 1]; };
const BASE = (arg('--files') ?? 'https://sparat.rangner.com/data/').replace(/\/?$/, '/');
const WRITE = process.argv.includes('--write');
const LIST = 'tools/file-formats.json';
const MAPS = new Set(['files', 'ops', 'brands']);   // objects whose keys are data (a kind, a train number, a train)

// Every path in a value and the types seen there: "trains[][2]" number, "files{}" string, ...
function paths(v, at, out, seen) {
  const add = t => (out[at] ??= new Set()).add(t);
  if (v === null || v === undefined) return add('null');
  if (Array.isArray(v)) {
    add('array');
    if (v.length) seen.add(at);
    for (const el of v.slice(0, 300)) {
      if (Array.isArray(el)) { add('rows'); el.forEach((x, i) => paths(x, `${at}[][${i}]`, out, seen)); }
      else paths(el, `${at}[]`, out, seen);
    }
    return;
  }
  if (typeof v === 'object') {
    add('object');
    const key = at.split('.').at(-1);
    if (MAPS.has(key)) { if (Object.keys(v).length) seen.add(at); for (const x of Object.values(v).slice(0, 300)) paths(x, `${at}{}`, out, seen); return; }
    for (const [k, x] of Object.entries(v)) paths(x, at ? `${at}.${k}` : k, out, seen);
    return;
  }
  add(typeof v);
}
const kindOf = name => name.replace(/-\d+\.json$/, '').replace(/^(card|board)-\d\d$/, '$1');

// The newest live file and the files it names.
// One file; a refusal or a slow answer is tried twice more (one.com answers some quick runs of requests slowly).
async function json(name) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(BASE + name, { signal: AbortSignal.timeout(15000) }); if (r.status === 404) return null; if (r.ok) return await r.json(); } catch { /* again */ }
    await new Promise(res => setTimeout(res, 1000));
  }
  return null;
}
let live = null;
for (let k = 1; k <= 6 && !live; k++) live = await json(`live-${Math.floor(Date.now() / LIVE_MS) - k}.json`).catch(() => null);
if (!live) { console.log(`format-check: no live file at ${BASE}`); process.exit(2); }
const files = { live }, missing = [];
const names = Object.entries(live.files ?? {});
for (const [kind, name] of names) {
  const k = kindOf(name);
  if (files[k] || kind === 'live') continue;   // one of each: card-00 stands for every card group
  files[k] = await json(name).catch(() => null);
  if (!files[k]) missing.push(k);
}

const list = existsSync(LIST) ? JSON.parse(readFileSync(LIST, 'utf8')) : { about: '', kinds: {} };
let broken = 0;
const added = [], notSeen = [];
for (const [kind, f] of Object.entries(files)) {
  if (!f) continue;
  const out = {}, seen = new Set();
  paths(f, '', out, seen);
  const now = Object.fromEntries(Object.entries(out).map(([p, s]) => [p, [...s].sort()]));
  const known = list.kinds[kind] ?? {};
  for (const [p, types] of Object.entries(known)) {
    const parent = p.replace(/(\[\](\[\d+\])?|\{\})(\.[^[{]*)?$/, '').replace(/\[\]$/, '');
    if (!now[p]) {
      // Under an empty list nothing can be seen; otherwise the path is gone.
      const under = [...seen].some(s => p.startsWith(s));
      if (!under && p.includes('[')) { notSeen.push(`${kind}: ${p}`); continue; }
      console.log(`FAIL ${kind}: "${p}" is gone (was ${types.join('/')})`); broken++; continue;
    }
    // Empty (null) and a value are both normal for one field (an expected time is often empty); a field only ever
    // seen empty may show any type. Anything else new is a change of type.
    const strange = types.every(t => t === 'null') ? [] : now[p].filter(t => t !== 'null' && !types.includes(t));
    if (strange.length) { console.log(`FAIL ${kind}: "${p}" is now ${strange.join('/')} (was ${types.join('/')})`); broken++; }
  }
  for (const p of Object.keys(now)) if (!known[p]) added.push(`${kind}: ${p}`);
  if (WRITE) {
    list.kinds[kind] = { ...known };
    for (const [p, types] of Object.entries(now)) list.kinds[kind][p] = [...new Set([...(known[p] ?? []), ...types])].sort();
  }
}
if (WRITE) {
  list.about = 'The files\' formats as released (tools/format-check.mjs): a path may be added, never removed or given another type. Written with --write; never edited by hand to drop a path.';
  writeFileSync(LIST, JSON.stringify(list, null, 1) + '\n');
}
const kinds = Object.keys(files).filter(k => files[k]).length;
if (missing.length) console.log(`note not read (gone or not answering): ${missing.join(', ')}`);
if (added.length && !WRITE) console.log(`note ${added.length} new path(s), not yet in ${LIST} (add with --write once released): ${added.slice(0, 5).join(', ')}${added.length > 5 ? ' …' : ''}`);
console.log(`${broken ? 'format-check FAILED' : 'format-check ok'}: ${kinds} kinds of file at ${BASE}${broken ? `, ${broken} path(s) broken` : ', nothing removed or changed'}${notSeen.length ? `; ${notSeen.length} not seen (empty lists)` : ''}${WRITE ? `; written to ${LIST}` : ''}`);
process.exit(broken ? 1 : 0);
