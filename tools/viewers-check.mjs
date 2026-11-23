// Checks the viewer count (Max, 2026-11-23: "how many are using my app and site"): the page's "I'm here" (src/count.js),
// the counter on one.com (count/i.php, on a portable PHP in data/php when it is there) and the fetcher's counting
// (fetcher/viewers.mjs). No internet. Run: node tools/viewers-check.mjs
import { startCount, EVERY_MS } from '../src/count.js';
import { createViewers, addLines, dayCounts } from '../fetcher/viewers.mjs';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIN = 60000;
let bad = 0;
const check = (name, ok, more = '') => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !more ? '' : `\n     ${more}`}`); };
const at = s => Date.parse(/[+-]\d\d:\d\d$/.test(s) ? s : `${s}:00+01:00`);   // Swedish winter time

// ---------- the page: src/count.js ----------
function page({ start = '2026-11-23T10:00', hidden = false, off = false, robot = false, url = 'https://x/count/i.php', storage } = {}) {
  let t = at(start);
  const sent = [], listeners = [], timers = [];
  const doc = { hidden, addEventListener: (k, f) => listeners.push(f), removeEventListener() {} };
  const store = storage ?? (() => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; })();
  const stop = startCount({ url, kind: 's', now: () => t, doc, storage: store, send: (u, body) => sent.push({ t, body }),
    off: () => off, robot, every: f => timers.push(f), stopEvery() {} });
  return {
    sent, doc, store, stop,
    // Time passes: the 30-s timer runs.
    pass(ms) { const end = t + ms; while (t < end) { t = Math.min(end, t + 30000); for (const f of timers) f(); } },
    show(v) { doc.hidden = !v; for (const f of listeners) f(); },
    set off(v) { off = v; },
  };
}
{
  const p = page();
  check('the page: "I\'m here" at opening', p.sent.length === 1 && /^[a-z0-9]{12} s$/.test(p.sent[0].body), JSON.stringify(p.sent));
  p.pass(4 * MIN);
  check('the page: nothing more within 5 minutes', p.sent.length === 1);
  p.pass(2 * MIN);
  check('the page: again after 5 minutes, the same id', p.sent.length === 2 && p.sent[1].body === p.sent[0].body && p.sent[1].t - p.sent[0].t >= EVERY_MS);
  p.pass(60 * MIN);
  check(`the page: an hour open sends ${p.sent.length - 2} more (12 expected)`, p.sent.length - 2 === 12);
  p.show(false); const n = p.sent.length; p.pass(30 * MIN);
  check('the page: nothing while hidden', p.sent.length === n);
  p.show(true);
  check('the page: shown again: at once', p.sent.length === n + 1);
}
{
  // The id is new on the Swedish day, not the UTC one: 23:50 and 00:05 Swedish time are two days, 00:30 and 00:50 one.
  const p = page({ start: '2026-11-23T23:50' });
  p.pass(15 * MIN);
  const before = p.sent.filter(x => x.t < at('2026-11-24T00:00')).map(x => x.body), after = p.sent.filter(x => x.t >= at('2026-11-24T00:00')).map(x => x.body);
  check('the page: a new id at Swedish midnight', before.length && after.length && new Set(before).size === 1 && new Set(after).size === 1 && before[0] !== after[0], JSON.stringify(p.sent));
  const q = page({ start: '2026-11-24T00:30' }); q.pass(20 * MIN);
  check('the page: the same id within the day (also kept in storage over a reload)', q.sent.length >= 2 && new Set(q.sent.map(x => x.body)).size === 1
    && page({ start: '2026-11-24T00:52', storage: q.store }).sent[0].body === q.sent[0].body);
}
{
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const p = page({ storage: broken }); p.pass(6 * MIN);
  check('the page: storage blocked: still counted, one id for the page', p.sent.length === 2 && p.sent[0].body === p.sent[1].body);
  check('the page: "Don\'t count me": nothing', page({ off: true }).sent.length === 0);
  const q = page(); q.off = true; q.pass(30 * MIN);
  check('the page: "Don\'t count me" turned on while open: nothing more', q.sent.length === 1);
  check('the page: a test browser (navigator.webdriver): nothing', page({ robot: true }).sent.length === 0);
  check('the page: a build without a count address (dev, tests): nothing', page({ url: '' }).sent.length === 0);
  check('the page: hidden at opening: nothing', page({ hidden: true }).sent.length === 0);
  const env = existsSync(join(ROOT, '.env')) ? readFileSync(join(ROOT, '.env'), 'utf8') : '';
  check('.env has no VITE_COUNT_URL (the dev page and phone builds never count)', !/^\s*VITE_COUNT_URL\s*=\s*\S/m.test(env));
}

// ---------- the fetcher: fetcher/viewers.mjs ----------
// A made-up day: 3 site viewers and 1 app viewer; each sends every 5 minutes while open.
const line = (t, id, k) => `${Math.floor(t / 1000)} ${id} ${k}\n`;
function madeDay(day) {
  const t0 = at(`${day}T08:00`);
  let s = '';
  for (let i = 0; i < 24; i++) s += line(t0 + i * 5 * MIN, 'aaaaaaaaaaa1', 's');           // 08:00-09:55
  for (let i = 0; i < 6; i++) s += line(t0 + 30 * MIN + i * 5 * MIN, 'bbbbbbbbbbb2', 's');  // 08:30-08:55
  for (let i = 0; i < 3; i++) s += line(t0 + 40 * MIN + i * 5 * MIN, 'ccccccccccc3', 'a');  // 08:40-08:50
  s += line(at(`${day}T18:00`), 'ddddddddddd4', 's');
  s += 'junk line\n1700000000 short s\n';
  return s;
}
{
  const d = { day: '2026-11-23', offset: 0, rest: '', ids: new Map(), hours: new Map(), slots: new Map() };
  addLines(d, madeDay('2026-11-23') + line(at('2026-11-24T00:10'), 'eeeeeeeeeee5', 's'));
  const c = dayCounts(d);
  check(`the fetcher: a day counted: ${c.people} people (app ${c.app}, site ${c.site}), most at once ${c.peak}`,
    c.people === 4 && c.app === 1 && c.site === 3 && c.peak === 3, JSON.stringify(c));
}
{
  // Read in pieces cut mid-line, as the file grows; then a restart reads it whole.
  const files = { '2026-11-22.txt': madeDay('2026-11-22'), '2026-11-23.txt': '', '2026-11-10.txt': madeDay('2026-11-10') };
  let t = at('2026-11-23T08:00');
  const read = (name, from) => Promise.resolve(Buffer.from(files[name] ?? '').subarray(from).toString('utf8'));
  const v = createViewers({ read, list: () => Promise.resolve(Object.keys(files)), now: () => t });
  await v.round();
  const full = madeDay('2026-11-23');
  for (const cut of [100, 257, 1000, full.length]) { files['2026-11-23.txt'] = full.slice(0, cut); t += 10 * MIN; await v.round(); }
  const s = v.status(), today = s.days.find(x => x.day === '2026-11-23'), before = s.days.find(x => x.day === '2026-11-22');
  check('the fetcher: read in pieces cut mid-line: the same counts', today?.people === 4 && today.peak === 3 && before?.people === 4, JSON.stringify(s.days));
  check('the fetcher: a day file older than 8 days is left out', !s.days.some(x => x.day === '2026-11-10'));
  const h8 = s.hours.find(h => h.t === at('2026-11-23T08:00'));
  check(`the fetcher: the hours: 08-09 ${h8?.people} people, most at once ${h8?.peak}`, h8?.people === 3 && h8.peak === 3, JSON.stringify(s.hours));
  const w = createViewers({ read, list: () => Promise.resolve(Object.keys(files)), now: () => t });
  await w.round();
  check('the fetcher: after a restart the same counts', JSON.stringify(w.status().days) === JSON.stringify(s.days));
  const x = createViewers({ read: () => Promise.reject(new Error('not connected to one.com')), list: () => Promise.reject(new Error('not connected to one.com')), now: () => t });
  await x.round();
  check('the fetcher: one.com not reachable: an error in the status, no crash', x.status().error === 'not connected to one.com' && x.status().days.length === 0);
}

// ---------- the counter on one.com: count/i.php ----------
const PHP = join(ROOT, 'data/php/php.exe');
if (!existsSync(PHP)) console.log('skip the counter (count/i.php): no portable PHP in data/php (see the top of this file)');
else {
  const dir = mkdtempSync(join(tmpdir(), 'count-check-'));
  mkdirSync(join(dir, 'count'));
  copyFileSync(join(ROOT, 'count/i.php'), join(dir, 'count/i.php'));
  const port = 28900 + Math.floor(Math.random() * 90);
  const php = spawn(PHP, ['-S', `127.0.0.1:${port}`, '-t', dir], { stdio: 'ignore' });
  try {
    const url = `http://127.0.0.1:${port}/count/i.php`;
    let up = false;
    for (let i = 0; i < 50 && !up; i++) { try { await fetch(url); up = true; } catch { await new Promise(r => setTimeout(r, 100)); } }
    const post = body => fetch(url, { method: 'POST', body }).then(r => r.status);
    const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
    const days = join(dir, 'count/days');
    mkdirSync(days);
    writeFileSync(join(days, '2020-01-01.txt'), 'old\n');
    const recent = new Date(Date.now() - 3 * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
    writeFileSync(join(days, `${recent}.txt`), 'recent\n');
    const good = await post('abcdefghij12 s');
    const app = await post('abcdefghij13 a\n');
    const lines = readFileSync(join(days, `${day}.txt`), 'utf8').trim().split('\n');
    check(`the counter: a good "I'm here" written (${good}, ${app}): "${lines[0]}"`, good === 204 && app === 204 && lines.length === 2
      && /^\d{10} abcdefghij12 s$/.test(lines[0]) && /^\d{10} abcdefghij13 a$/.test(lines[1]));
    const left = readdirSync(days);
    check('the counter: day files older than 8 days deleted, newer kept', !left.includes('2020-01-01.txt') && left.includes(`${recent}.txt`), left.join(', '));
    const refused = await Promise.all(['ABCDEFGHIJ12 s', 'abc s', 'abcdefghij12 x', 'abcdefghij12 s extra', 'x'.repeat(5000), '../../etc s'].map(post));
    const get = await fetch(url).then(r => r.status);
    check(`the counter: wrong lines refused (${refused.join(' ')}), a plain visit too (${get}), nothing written`,
      refused.every(s => s === 400) && get === 405 && readFileSync(join(days, `${day}.txt`), 'utf8').trim().split('\n').length === 2);
    writeFileSync(join(days, `${day}.txt`), Buffer.alloc(20000001, 'x'));
    check('the counter: a day file over 20 MB takes no more', (await post('abcdefghij12 s')) === 507);
  } finally {
    php.kill();
    await new Promise(r => setTimeout(r, 300));
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(bad ? `viewers check FAILED (${bad})` : 'viewers check ok');
process.exit(bad ? 1 : 0);
