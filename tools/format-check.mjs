// The files stay backwards compatible (HARD RULE, Max 2026-11-18: "data from the first app release and forward has to
// be backwards compatible"; "Changing now and up until first app release is fine"). Until the first app release to
// others, tools/file-formats.json says enforced: false and a break is only a warning; at that release it is set to true
// (and the formats written as released), and from then on a break fails. Every file the fetcher makes for the page and the apps (src/live-file.js, src/tap-files.js,
// fetcher/files.mjs, fetcher/timetable.mjs) must stay readable by every page and app already released: fields, row
// positions and file kinds may be ADDED (at the end of a row), never renamed, removed, moved or given another type or
// meaning. A change that can't keep that comes as a new set of files beside the old ones (src/live-file.js FORMAT + 1),
// the old ones made until no released app reads them, and Max is told before.
// This check holds the formats as released (tools/file-formats.json: every field's path and its types) and compares
// files built by the code now: a path that is gone, or has a type it never had, fails. New paths are only listed; they
// go into the list with --write once released (the list never loses a path).
// Every kind in the list is looked for (since 2026-11-19, TODO 37: a kind no longer made was never noticed). With
// --strict (this computer's own fetcher) a kind not made, or a file it names that can't be read, fails; without it
// (the site, which one.com sometimes answers slowly) both are notes. --wait <s>: until every kind is named by the live
// file (some are first made minutes after the start), at most that long.
// Types only: whether the values still MEAN the same to the released readers is tools/format-read-check.mjs.
// Run: node tools/format-check.mjs --files <address of the files> [--strict] [--wait <s>] [--write]
//   tools/check.mjs runs it against its own replaying fetcher (every kind, tap files from the recording's timetable;
//   --strict) and against the site (https://sparat.rangner.com/data/: the code running there; the site not answering
//   is a note).
// Exit code 0: compatible; 1: not; 2: no files found.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { LIVE_MS, HISTORY_MS } from '../src/live-file.js';

const arg = n => { const i = process.argv.indexOf(n); return i < 0 ? null : process.argv[i + 1]; };
const BASE = (arg('--files') ?? 'https://sparat.rangner.com/data/').replace(/\/?$/, '/');
const WRITE = process.argv.includes('--write');
const STRICT = process.argv.includes('--strict');
const WAIT_MS = Number(arg('--wait') ?? 0) * 1000;
const LIST = 'tools/file-formats.json';
const MAPS = new Set(['files', 'ops', 'brands']);   // objects whose keys are data (a kind, a train number, a train)
// Kinds made more seldom than a check waits (2026-11-22: the day's history files, one when a quarter of an hour ends):
// not waited for, and not made yet is a note, also with --strict (their types are checked whenever one is there;
// tools/history-check.mjs reads them back offline every time).
const SELDOM = { history: HISTORY_MS };

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
const kindOf = name => name.replace(/-\d+\.json$/, '').replace(/^(card|board|day)-\d\d$/, '$1');

// The newest live file and the files it names.
// One file; a refusal or a slow answer is tried twice more (one.com answers some quick runs of requests slowly).
async function json(name) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(BASE + name, { signal: AbortSignal.timeout(15000) }); if (r.status === 404) return null; if (r.ok) return await r.json(); } catch { /* again */ }
    await new Promise(res => setTimeout(res, 1000));
  }
  return null;
}
const list = existsSync(LIST) ? JSON.parse(readFileSync(LIST, 'utf8')) : { about: '', kinds: {} };
const newestLive = async () => {
  for (let k = 1; k <= 6; k++) { const f = await json(`live-${Math.floor(Date.now() / LIVE_MS) - k}.json`).catch(() => null); if (f) return f; }
  return null;
};
const namedKinds = f => new Set(['live', ...Object.values(f?.files ?? {}).map(kindOf)]);
let live = await newestLive();
const until = Date.now() + WAIT_MS;
while (Date.now() < until && Object.keys(list.kinds).some(k => !SELDOM[k] && !namedKinds(live).has(k))) {
  await new Promise(res => setTimeout(res, 10000));
  live = (await newestLive()) ?? live;
}
if (!live) { console.log(`format-check: no live file at ${BASE}`); process.exit(2); }
const files = { live }, missing = [];
for (const [kind, name] of Object.entries(live.files ?? {})) {
  const k = kindOf(name);
  if (files[k] || kind === 'live') continue;   // one of each: card-00 stands for every card group
  files[k] = await json(name).catch(() => null);
  if (!files[k]) missing.push(k);
}
let broken = 0;
// Every kind ever released must still be made (and readable).
const notMade = Object.keys(list.kinds).filter(k => !(k in files) && !SELDOM[k]);
const notYet = Object.keys(list.kinds).filter(k => !(k in files) && SELDOM[k]);
if (notYet.length) console.log(`note not made yet (one every ${SELDOM[notYet[0]] / 60000} minutes): ${notYet.join(', ')}`);
if (STRICT) {
  for (const k of notMade) { console.log(`FAIL ${k}: no such file is made any more (not named by the live file)`); broken++; }
  for (const k of missing) { console.log(`FAIL ${k}: named by the live file but can't be read`); broken++; }
}
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
      // Under an empty list or map nothing can be seen (a replay's taps-index has no public numbers: ops is {});
      // otherwise the path is gone.
      const under = [...seen].some(s => p.startsWith(s));
      if (!under && /[[{]/.test(p)) { notSeen.push(`${kind}: ${p}`); continue; }
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
  list.enforced ??= false;
  list.about = 'The files\' formats as released (tools/format-check.mjs): a path may be added, never removed or given another type. Written with --write; never edited by hand to drop a path.';
  writeFileSync(LIST, JSON.stringify(list, null, 1) + '\n');
}
const kinds = Object.keys(files).filter(k => files[k]).length;
if (!STRICT && missing.length) console.log(`note not read (gone or not answering): ${missing.join(', ')}`);
if (!STRICT && notMade.length) console.log(`note not named by the live file: ${notMade.join(', ')}`);
if (added.length && !WRITE) console.log(`note ${added.length} new path(s), not yet in ${LIST} (add with --write once released): ${added.slice(0, 5).join(', ')}${added.length > 5 ? ' …' : ''}`);
console.log(`${broken ? 'format-check FAILED' : 'format-check ok'}: ${kinds} kinds of file at ${BASE}${broken ? `, ${broken} path(s) broken` : ', nothing removed or changed'}${notSeen.length ? `; ${notSeen.length} not seen (empty lists)` : ''}${WRITE ? `; written to ${LIST}` : ''}`);
if (broken && !list.enforced) { console.log('note: not enforced yet (until the first app release, tools/file-formats.json enforced: false): only a warning'); process.exit(0); }
process.exit(broken ? 1 : 0);
