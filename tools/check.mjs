// The check to run before merging a change: the replays (tools/motion-check.mjs on the chosen recordings,
// tools/recordings.json, held to tools/check-limits.mjs), the offline checks of the fetcher and the file reader, the
// file formats, and the screens (when the page is running: npm run dev, or PAGE=<its address>).
// Run: node tools/check.mjs [--full] [--library | --all] [--rebaseline]   exit code 0: all good; 1: something failed
//   --full  run every check, also those whose inputs are unchanged (a release always does: SPARAT_RELEASE)
//   --library  the library recordings too;  --all  every recording in data/, listed or not
//   --rebaseline  replay and accept the numbers as they are now (tools/baseline.json)
// Since 2026-11-21 (Max: "even the smallest fixes needs long tests"): each check knows what it reads (its code, found
// by tools/lib/deps.mjs from the imports, plus the data it uses) and is skipped when none of it has changed since it
// last passed (data/.check-stamps.json, shared by every working folder through the data link); a skipped check is
// named. The checks run two at a time (the CPU rule: at most 2 heavy jobs), the longest first; one that only waits
// (the file formats) runs beside them; one measuring smoothness (the splash) runs alone at the end. Each check's output is printed when it ends; the times close the run.
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { RUSH_HOUR, CARD_HOUR, PAGE } from './lib/browser.mjs';
import { depsOf, filesIn, stampOf } from './lib/deps.mjs';
import { capSelf, oneCheckAtATime } from './lib/cpu-cap.mjs';
import { CHECKS, MARGINS, ALWAYS, FOLLOW_MIN, FOLLOW_ON, FOLLOW_FLIPS } from './check-limits.mjs';

// The PC stays usable: one check at a time on this PC, the whole run at most 90 % of the CPU at below-normal priority
// (Max, 2026-11-23; tools/lib/cpu-cap.mjs).
await oneCheckAtATime();
capSelf();
const T0 = Date.now();
const REBASE = process.argv.includes('--rebaseline');
const ALL = process.argv.includes('--full') || REBASE || Boolean(process.env.SPARAT_RELEASE);
const AT_ONCE = 2;
const secs = ms => Math.round(ms / 1000);

// ---------- the recordings ----------
// tools/recordings.json says each kept recording's role. The core is replayed every time the replay runs; --library
// adds the library; --all replays every recording in data/ (over 1 MB, so a minute's test is left out). A recording in
// data/ that isn't in the list is unsorted: named here, not replayed.
const LIST = JSON.parse(readFileSync('tools/recordings.json', 'utf8'));
const MODE = process.argv.includes('--all') ? 'all' : process.argv.includes('--library') ? 'library' : 'core';
const inData = readdirSync('data').filter(f => f.startsWith('positions-') && f.endsWith('.jsonl'));
const listed = new Set(LIST.recordings.map(x => `positions-${x.name}.jsonl`));
let failed = 0;
const sums = new Map();   // file -> its SHA-256 now
for (const x of LIST.recordings) for (const kind of ['positions', 'timetable']) {
  const want = x[kind], f = `data/${kind}-${x.name}.jsonl`;
  if (!want) continue;
  if (!existsSync(f)) {
    console.log(`${x.role === 'core' ? 'FAIL' : 'note'} ${f} is listed (${x.role}) but missing`);
    if (x.role === 'core') failed++;
  } else {
    const sum = createHash('sha256').update(readFileSync(f)).digest('hex');
    sums.set(f, sum);
    if (statSync(f).size === want.bytes && sum === want.sha256) continue;
    // A core recording that isn't the chosen one fails the check: its numbers mean nothing then.
    console.log(`${x.role === 'core' ? 'FAIL' : 'note'} ${f} differs from tools/recordings.json (size or SHA-256): not the recording that was chosen`);
    if (x.role === 'core') failed++;
  }
}
const unsorted = inData.filter(f => !listed.has(f) && statSync(`data/${f}`).size > 1e6);
if (unsorted.length) console.log(`note unsorted, not replayed (add to tools/recordings.json to use): ${unsorted.join(', ')}`);
const recordings = (MODE === 'all' ? inData.filter(f => statSync(`data/${f}`).size > 1e6)
  : LIST.recordings.filter(x => x.role === 'core' || (MODE === 'library' && x.role === 'library')).map(x => `positions-${x.name}.jsonl`))
  .filter(f => existsSync(`data/${f}`)).sort();

// ---------- what each check reads ----------
// The replay: the train code the replaying tools use (found from their imports), the limits, the accepted numbers,
// the rail network, the stations and the replayed recordings' contents. Not this file and not the list's other
// entries (since 2026-11-21: an edit to either started a 7-minute replay for nothing).
const REPLAY_FILES = [...depsOf('tools/motion-check.mjs', 'tools/path-check.mjs', 'tools/route-follow-check.mjs'),
  'src/clock.js', 'tools/check-limits.mjs', 'tools/baseline.json', 'public/rail-net.json', 'data/stations.json'];
const replayExtra = MODE + recordings.flatMap(f => [f, f.replace('positions-', 'timetable-')]).filter(f => existsSync(`data/${f}`))
  .map(f => `${f}:${sums.get(`data/${f}`) ?? createHash('sha256').update(readFileSync(`data/${f}`)).digest('hex')}`).join();
// The page: all its code, its files, its build settings and libraries, and the recordings the screens replay.
const replayData = name => ['positions', 'timetable', 'routes'].map(k => `data/${k}-${name}.jsonl`);
const PAGE_FILES = [...filesIn('src', 'public', 'index.html'), 'vite.config.js', 'package-lock.json', 'data/stations.json',
  ...replayData(CARD_HOUR), ...replayData(RUSH_HOUR)];
// The fetcher (its code from the imports, and the libraries).
const FETCHER_FILES = [...depsOf('fetcher/main.mjs'), 'package-lock.json'];
const SAVED_DAYS = filesIn('data/measure').filter(f => /\/day-[^/]*\.json$/.test(f));

const STAMPS = 'data/.check-stamps.json';
const stamps = existsSync(STAMPS) ? JSON.parse(readFileSync(STAMPS, 'utf8')) : {};
function saveStamp(name, stamp) {
  const now = existsSync(STAMPS) ? JSON.parse(readFileSync(STAMPS, 'utf8')) : {};   // another folder's check may have written meanwhile
  now[name] = { stamp, when: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC' };
  writeFileSync(`${STAMPS}.tmp`, JSON.stringify(now, null, 1));
  renameSync(`${STAMPS}.tmp`, STAMPS);
}

// ---------- running ----------
// A tool's output, captured (printed when it ends, so two at once don't mix).
function tool(args, { env } = {}) {
  return new Promise((res) => {
    const p = spawn(process.execPath, args, { env: env ? { ...process.env, ...env } : process.env });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    p.on('close', status => res({ status, out: out.trimEnd() }));
  });
}
const lastLine = s => s.trim().split('\n').at(-1) ?? '';
const freePort = () => new Promise((res, rej) => { const s = createServer().once('error', rej).listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

const times = [];       // [name, seconds]
const skipped = [];     // [name, when it last passed]
const failures = [];
// A check: its name, the files it reads (null: always run, for checks of a second or ones asking online), and run()
// -> true when it passed (it prints its own lines). wait: it only waits (runs beside the two, not in their place);
// alone: it measures smoothness, so it runs after the others, with nothing beside it.
function check(name, files, run, { wait = false, order = 0, alone = false } = {}) {
  const stamp = files ? stampOf(files, name) : null;
  if (!ALL && stamp && stamps[name]?.stamp === stamp) { skipped.push([name, stamps[name].when]); return null; }
  return { name, wait, order, alone, go: async () => {
    const t = Date.now();
    let ok = false;
    try { ok = await run(); } catch (e) { console.log(`FAIL ${name}: ${e.message}`); }
    times.push([name, secs(Date.now() - t)]);
    if (!ok) failures.push(name);
    else if (stamp) saveStamp(name, stamp);
    return ok;
  } };
}
// The usual shape: run a tool, print all it says (or only its last line), passed on exit code 0.
const plain = (args, { short = false, env } = {}) => async () => {
  const r = await tool(args, { env });
  console.log(short ? `${r.status === 0 ? 'ok  ' : 'FAIL'} ${lastLine(r.out)}` : r.out);
  if (r.status !== 0 && short) console.log(r.out.split('\n').filter(l => l.startsWith('FAIL')).join('\n'));
  return r.status === 0;
};

// ---------- the checks ----------
const jobs = [];
const add = j => { if (j) jobs.push(j); };

// No secret in any file git tracks (plan to beta phase B, 2026-11-17); a search that can't run fails too.
add(check('secrets', null, plain(['tools/key-search.mjs', '--git'], { short: true })));
// Known problems in the libraries the Linux PC runs (npm's own list, asked online; Codex's review, 2026-11-17): high
// or critical there fails the check; in the page's other libraries it is a note; npm not answering is a note.
add(check('libraries', null, async () => {
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')).packages, linux = new Set(), todo = ['ssh2', 'nodemailer'];
  while (todo.length) { const n = todo.pop(); if (linux.has(n)) continue; linux.add(n); const e = lock[`node_modules/${n}`] ?? {}; todo.push(...Object.keys(e.dependencies ?? {}), ...Object.keys(e.optionalDependencies ?? {})); }
  const a = spawnSync('npm audit --omit=dev --json', { encoding: 'utf8', shell: true, timeout: 60000 });
  let v = null;
  try { v = JSON.parse(a.stdout).vulnerabilities; } catch { /* no answer */ }
  if (!v) { console.log('note the libraries\' known problems could not be asked (npm audit gave no answer)'); return true; }
  const bad = Object.values(v).filter(x => ['high', 'critical'].includes(x.severity));
  const there = bad.filter(x => linux.has(x.name)), other = bad.filter(x => !linux.has(x.name));
  console.log(`${there.length ? 'FAIL' : 'ok  '} libraries on the Linux PC (${linux.size}): ${there.length ? there.map(x => `${x.name} (${x.severity})`).join(', ') : 'no known high or critical problems'}`);
  if (other.length) console.log(`note the page's libraries: ${other.map(x => `${x.name} (${x.severity})`).join(', ')}`);
  return there.length === 0;
}));
// The fetcher writes only in Spårat's own folder on one.com (a pretend connection, no network; plan to beta step 1).
add(check('upload-check', depsOf('tools/upload-check.mjs'), plain(['tools/upload-check.mjs'], { short: true }), { order: 17 }));
// Taps from files (plan step 4): a saved day's timetable through the files' format and back, offline. A second.
add(check('taps-check', null, plain(['tools/taps-check.mjs', '--format'], { short: true })));
// The monitor's mail rules on made-up timelines (offline, under a second; in the check since 2026-11-22).
add(check('monitor-check', depsOf('tools/monitor-check.mjs'), plain(['tools/monitor-check.mjs'], { short: true })));
// An odd row stops no feed (positions, passings, a reader that throws; offline, under a second; 2026-11-22).
add(check('stream-guard-check', depsOf('tools/stream-guard-check.mjs'), plain(['tools/stream-guard-check.mjs'], { short: true })));
// The fetcher's planned-route questions when one fails: the rest still asked (offline, under a second; 2026-11-22).
add(check('ask-routes-check', depsOf('tools/ask-routes-check.mjs'), plain(['tools/ask-routes-check.mjs'], { short: true })));
// Night trains keep all their stops in the fetcher's memory past midnight (the saved day of 17 Nov; ~15 s; 2026-11-22).
add(check('night-trains-check', [...depsOf('tools/night-trains-check.mjs'), 'data/measure/day-2026-11-17.json'],
  plain(['tools/night-trains-check.mjs'], { short: true })));
// The date passes (TODO 62): four nights on a fake clock, in Swedish time and in UTC (~2.5 min; 2026-11-22).
add(check('dates-check', [...depsOf('tools/dates-check.mjs'), 'data/measure/day-2026-11-17.json', 'data/positions-2026-11-12T23-02-56-574Z.jsonl'],
  plain(['tools/dates-check.mjs'], { short: true }), { order: 5 }));
// A full round of tap files stays quick (the saved day of 17 Nov; ~5 s; 2026-11-22).
add(check('tap-round-check', [...depsOf('tools/tap-round-check.mjs'), 'data/measure/day-2026-11-17.json'],
  plain(['tools/tap-round-check.mjs'], { short: true })));

// The replays: each recording through the train code, its routes (none drawn straight across: tools/path-check.mjs,
// 0 of 73,368 pieces since 2026-11-14), and the open train's line following the train (tools/route-follow-check.mjs).
// One stamp for them all: they run, or are skipped, together.
const replayStamp = stampOf(REPLAY_FILES, replayExtra);
const replayKey = `replay-${MODE}`;
const replaySkip = !ALL && stamps[replayKey]?.stamp === replayStamp;
const base = existsSync('tools/baseline.json') ? JSON.parse(readFileSync('tools/baseline.json', 'utf8')) : { about: '', recordings: {} };
let replayFailed = 0, replayLeft = 0;
const replayStart = Date.now();
const replayDone = (ok) => {
  if (!ok) replayFailed++;
  if (--replayLeft > 0) return;
  console.log((replayFailed ? `${replayFailed} replay checks failed` : `all ${recordings.length} ${MODE} recordings pass`) + ` (replay ${secs(Date.now() - replayStart)} s, ${AT_ONCE} at a time)`);
  if (REBASE) {
    base.about = 'Accepted replay numbers per recording (tools/check.mjs holds each recording to its own, with a margin). Written by node tools/check.mjs --rebaseline when a change is accepted; why goes in docs/movement.md.';
    writeFileSync('tools/baseline.json', JSON.stringify(base, null, 2) + '\n');
    console.log('baseline written: tools/baseline.json');
  } else if (!replayFailed) saveStamp(replayKey, replayStamp);
};
const replayJob = (name, run, order) => { replayLeft++; return { name, order, go: async () => { const t = Date.now(); let ok = false; try { ok = await run(); } catch (e) { console.log(`FAIL ${name}: ${e.message}`); } times.push([name, secs(Date.now() - t)]); if (!ok) failures.push(name); replayDone(ok); return ok; } }; };
if (replaySkip) skipped.push([`replay (${recordings.length} ${MODE} recordings, routes, line follows)`, stamps[replayKey].when]);
else for (const f of recordings) {
  const short = f.slice(10, 29), name = f.slice('positions-'.length, -'.jsonl'.length), mb = statSync(`data/${f}`).size / 1e6;
  add(replayJob(`replay ${short}`, async () => {
    const out = await tool(['tools/motion-check.mjs', `data/${f}`, '--json']);
    let r;
    try { r = JSON.parse(lastLine(out.out)); } catch { console.log(`FAIL ${f}: the replay itself failed: ${out.out.split('\n')[0]}`); return false; }
    r.extraTurnBacks = r.turnBacks - r.truthTurnBacks;
    const b = base.recordings[name];
    // Own baseline: the must-be-0 rules and the track limit, then each number against its own accepted value.
    const bad = b
      ? [...CHECKS.filter(([k, ok]) => ALWAYS.has(k) && !ok(r[k])),
         ...Object.entries(MARGINS).filter(([k, [lim]]) => r[k] !== null && b[k] !== null && b[k] !== undefined && r[k] > lim(b[k]))
           .map(([k, [lim, what]]) => [k, null, `${what}: ${r[k]}, accepted ${b[k]} (limit ${Number(lim(b[k]).toFixed(2))})`])]
      : CHECKS.filter(([k, ok]) => !ok(r[k]));
    console.log(`${bad.length ? 'FAIL' : 'ok  '} ${f} (${r.minutes} min${r.routes ? `, ${r.routes} routes` : ''}${b ? ', own baseline' : ''}): ` +
      `frozen ${r.frozenPct} %, ${r.stopsPerMin} stops/min, 90 % within ${r.lag90S} s, through stops ${r.dwellThroughPct} %, track 99 % ${r.offTrack99M} m, ` +
      `grey ${r.greyPct} %, turn-backs ${r.turnBacks} (data ${r.truthTurnBacks}, unexplained ${r.unmatchedTurnBacks}), wrong way ${r.wrongWay}, past stop ${r.pastStop}, moved after standing ${r.movedAfterStanding}`);
    for (const [k, , why] of bad) console.log(`     ${why}${b ? '' : `: ${k} = ${r[k]}`}`);
    if (REBASE) {
      if (CHECKS.filter(([k, ok]) => ALWAYS.has(k) && !ok(r[k])).length) { console.log('     not rebaselined: a must-be-0 rule or the track limit fails'); return false; }
      const now = Object.fromEntries(Object.keys(MARGINS).map(k => [k, r[k]]));
      console.log(b ? `     baseline: ${Object.keys(MARGINS).filter(k => b[k] !== now[k]).map(k => `${k} ${b[k]} -> ${now[k]}`).join(', ') || 'unchanged'}` : '     baseline: first numbers');
      base.recordings[name] = { ...now, when: new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' }) };
      return true;   // rebaselining accepts the numbers as they are
    }
    return bad.length === 0;
  }, mb));
  const tt = `data/${f.replace('positions-', 'timetable-')}`;
  if (existsSync(tt)) add(replayJob(`routes ${short}`, async () => {
    const out = await tool(['tools/path-check.mjs', tt, '--json']);
    try {
      const p = JSON.parse(lastLine(out.out));
      console.log(`${p.straight ? 'FAIL' : 'ok  '} routes ${short}: ${p.straight} of ${p.pieces} pieces drawn straight (must be 0)`);
      return !p.straight;
    } catch { console.log(`FAIL routes ${f}: ${out.out.split('\n')[0]}`); return false; }
  }, 5));
  add(replayJob(`line follows ${short}`, async () => {
    const out = await tool(['tools/route-follow-check.mjs', `data/${f}`, '--minutes', String(FOLLOW_MIN), '--json']);
    try {
      const p = JSON.parse(lastLine(out.out));
      const bad = p.onLine < FOLLOW_ON || p.flipsPerTrainHour > FOLLOW_FLIPS;
      console.log(`${bad ? 'FAIL' : 'ok  '} line follows ${short}: on its line ${p.onLine} % (min ${FOLLOW_ON}; the timetable's route alone ${p.onBase} %), flips back ${p.flipsPerTrainHour} a train-hour (max ${FOLLOW_FLIPS}), slowest update ${p.updateMsMax} ms`);
      return !bad;
    } catch { console.log(`FAIL line follows ${f}: ${out.out.split('\n')[0]}`); return false; }
  }, 60 + mb));
}
// Max's screenshots of 19 Nov 23:26 (trains beside their painted route): 2576 and 2277 stay on their line in the
// recording made just after (on main before: 2576 17 m beside it). Seconds.
const FOLLOW_CASE = 'data/positions-2026-11-19T22-28-02-750Z.jsonl';
if (existsSync(FOLLOW_CASE)) add(check('case 2576/2277', [...REPLAY_FILES, FOLLOW_CASE], async () => {
  const r = await tool(['tools/route-follow-check.mjs', FOLLOW_CASE, '--train', '2576,2277', '--min-on', '99.9', '--max-flips', '0']);
  const line = r.out.split('\n').find(l => l.includes('on its line')) ?? '';
  console.log(`${r.status === 0 ? 'ok  ' : 'FAIL'} case 2576/2277 on their line (19 Nov 23:28):${line.split(':').slice(1).join(':')}`);
  if (r.status !== 0) console.log(r.out);
  return r.status === 0;
}, { order: 5 }));
else console.log(`note case 2576/2277 skipped: ${FOLLOW_CASE} is not here`);

// Seconds each, so always run: the cases (tools/recordings.json; one marked knownFailing shows but doesn't fail),
// trips split over several numbers (src/trip.js), the way-finding on a tiny made-up network (src/rail-net.js).
add(check('cases', null, plain(['tools/cases.mjs'])));
add(check('split-check', null, plain(['tools/split-check.mjs'])));
add(check('net-check', null, plain(['tools/net-check.mjs'])));
// The public page's file reader and its boards against a pretend site (Codex's beta review, batch 1): files asked
// again after a 404, nothing held up by a stalled file, few requests with home down, none hidden, an unknown format
// not read, the board cut after the gone trains, the text protector.
add(check('files-check', depsOf('tools/files-check.mjs'), plain(['tools/files-check.mjs']), { order: 50 }));
// The boards end to end: a saved day through the fetcher's own board files and the page's reader (batch 2): every
// board full at 4, 12 and 40 rows, read 25 minutes after its file.
add(check('board-check', [...depsOf('tools/board-check.mjs'), ...SAVED_DAYS], plain(['tools/board-check.mjs']), { order: 70 }));
// The timetable stream through a 20-minute Trafikverket outage on a fast clock (batch 2).
add(check('outage-check', depsOf('tools/outage-check.mjs'), plain(['tools/outage-check.mjs']), { order: 15 }));
// The Linux PC's sparat command on a pretend Linux (batch 2): update, a damaged package or a wrong fingerprint refused
// with nothing touched, a version that won't start rolled back, back and forth, status.
add(check('linux-update-check', [...depsOf('tools/linux-update-check.mjs', 'tools/pack-linux.mjs'), ...filesIn('linux'), 'package.json', 'package-lock.json'],
  plain(['tools/linux-update-check.mjs']), { order: 10 }));

// The file formats (TODO 37; HARD RULE, 2026-11-18): a fetcher replaying the rush hour into its files on this
// computer (started at once: some kinds are made only minutes in, arrivals-add after ~5), then format-check --strict
// --wait (every kind made, readable, nothing removed or changed; with the key from .env it also asks stations,
// disruptions, stats and arrivals; without it only types are checked) and the released readers reading today's
// files (format-read-check, made-up rows).
const HAS_KEY = existsSync('.env') && /^\s*(VITE_)?TRV_KEY\s*=\s*\S/m.test(readFileSync('.env', 'utf8'));
let fetcher = null, fetcherPort = 0;
const startFetcher = async () => {
  if (fetcher) return;
  fetcherPort = await freePort();
  fetcher = spawn(process.execPath, ['fetcher/main.mjs', '--env', '.env', '--replay', RUSH_HOUR, '--serve', String(fetcherPort), '--minutes', '60'], { stdio: 'ignore' });
};
const FORMAT_FILES = [...FETCHER_FILES, ...depsOf('tools/format-check.mjs', 'tools/format-read-check.mjs'), 'tools/file-formats.json', '.env'];
const formatJob = check('file formats', FORMAT_FILES, async () => {
  const fmt = await tool(['tools/format-check.mjs', '--files', `http://localhost:${fetcherPort}/`, '--wait', '420', ...(HAS_KEY ? ['--strict'] : [])]);
  console.log(fmt.out);
  const read = await tool(['tools/format-read-check.mjs']);
  console.log(read.out);
  return fmt.status !== 1 && read.status === 0;
}, { wait: true });
// The site's files too (the code running on the Linux PC; tap files only there): the site not answering is a note.
add(check('site formats', null, async () => {
  const fmt = await tool(['tools/format-check.mjs', '--files', 'https://sparat.rangner.com/data/']);
  console.log(fmt.status === 2 ? `note ${fmt.out}` : fmt.out);
  return fmt.status !== 1;
}));

// The screens, in a phone-sized headless browser on the page (each tool's header says what it covers). Not run when
// the page doesn't answer, which is said and doesn't fail the check, for quick runs; in a release it fails.
const pageUp = await fetch(PAGE, { signal: AbortSignal.timeout(5000) }).then(r => r.ok, () => false);
const SCREENS = [
  ['screens', 'tools/ui-check.mjs', 70],                 // start, a tap, groups, search, a setting, models, stats, the card
  ['abroad', 'tools/abroad-check.mjs', 95],              // trains to and from abroad: the card's row and the map's leg
  ['debug', 'tools/debug-check.mjs', 15],                // Settings → Debug hidden until switched on
  ['groups', 'tools/group-check.mjs', 30],               // a tap in a "N trains" group lists the group
  ['disruptions', 'tools/disruption-check.mjs', 14],     // problems vs rail work, list and map (live data)
  ['scrollbars', 'tools/scroll-check.mjs', 55],          // room for the scrollbar in every scrolling area
  ['live pill', 'tools/pill-check.mjs', 13],             // every state one short line, both languages
  ['screens 1120', 'tools/screens-check.mjs', 65],       // Max's notes of 2026-11-20
  ['splash', 'tools/splash-check.mjs', 30, true],        // the start screen's logo on its own thread (alone: frame times; 2026-11-21 beside another check its longest pause hit the 80 ms limit)
  ['animations', 'tools/ui-motion-check.mjs', 53],       // buttons, numbers, rows, signs, the menu
  ['stats and board', 'tools/stats-board-check.mjs', 40], // Max's notes of 2026-11-21: Statistik's loading, dimming, company pages, the board's search (live)
  ['card moves', 'tools/sheet-moves-check.mjs', 35],     // every card moves in one go, no bounce (Max, 2026-11-21)
];
const screenJobs = [];
if (!pageUp) {
  console.log(`note the screens not checked: no page answering at ${PAGE} (start npm run dev)`);
  if (process.env.SPARAT_RELEASE) { console.log('FAIL the screens were not checked (no dev page answering): a release needs them'); failed++; }
} else {
  for (const [name, file, order, alone] of SCREENS) screenJobs.push(check(name, [...PAGE_FILES, ...depsOf(file)], plain([file]), { order, alone }));
  // The same screens on the page reading the fetcher's files (public-plan step 3) on a fetcher of their own, 75 s
  // into its replay, as the old check had it: later in that replay the test can fail by itself (2026-11-21: at about
  // 7 min a tap on 2513 opens Stockholm C's board; TODO B), so the moment is kept fixed. Its wait holds one of the two.
  screenJobs.push(check('screens on files', [...PAGE_FILES, ...FETCHER_FILES, ...depsOf('tools/ui-check.mjs')], async () => {
    const port = await freePort();
    const own = spawn(process.execPath, ['fetcher/main.mjs', '--env', '.env', '--replay', RUSH_HOUR, '--serve', String(port), '--minutes', '8'], { stdio: 'ignore' });
    try {
      await new Promise(r => setTimeout(r, 75000));
      return await plain(['tools/ui-check.mjs', '--files', `http://localhost:${port}/`])();
    } finally { own.kill(); }
  }, { order: 1000 }));   // first: its minute of waiting overlaps the replays' start
}
for (const j of screenJobs) add(j);

// ---------- go ----------
if (formatJob) await startFetcher();
const queue = jobs.filter(j => !j.wait && !j.alone).sort((a, b) => b.order - a.order), alone = jobs.filter(j => j.alone);
console.log(`checking: ${queue.length + (formatJob ? 1 : 0)} checks, ${AT_ONCE} at a time${skipped.length ? `; skipped, nothing they read has changed since they passed: ${skipped.map(([n]) => n).join(', ')}` : ''}${ALL ? ' (all: --full or a release)' : ''}`);
await Promise.all([
  formatJob?.go(),
  (async () => {
    await Promise.all(Array.from({ length: AT_ONCE }, async () => { while (queue.length) await queue.shift().go(); }));
    for (const j of alone) await j.go();
  })(),
]);
fetcher?.kill();

times.sort((a, b) => b[1] - a[1]);
console.log(`\ntimes: ${times.map(([n, s]) => `${n} ${s} s`).join(', ')}`);
if (skipped.length) console.log(`skipped (unchanged since they passed): ${skipped.map(([n, w]) => `${n} (${w})`).join(', ')}; --full runs them anyway`);
const total = failures.length + failed;
console.log(total ? `check FAILED: ${[...failures, ...(failed ? [`${failed} recording or page problem(s) above`] : [])].join(', ')} (${secs(Date.now() - T0)} s)` : `check ok (${secs(Date.now() - T0)} s)`);
process.exit(total ? 1 : 0);
