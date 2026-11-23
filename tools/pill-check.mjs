// The live pill stays short (Max, 2026-11-19: some status texts were "WAY too long"). Every state the pill can show
// (src/connection.js pillText), in English and Swedish, is put in the pill on a phone-sized page and measured: one
// line, nothing cut off, at most MAX_W px wide, inside the screen at its top right.
// Since the one sheet (2026-11-22) the pill is the live mark alone at the top right (the top bar with ☰ and the
// search beside it went, so "the search field keeps room" means nothing now); the limit stays as Max's "short", and a
// tap still opens Connection, now a page in the sheet (page:conn).
// node tools/pill-check.mjs (with npm run dev; PAGE= for another port).
import { launch, sleep, PHONE, CARD_HOUR, address } from './lib/browser.mjs';
import { until } from './lib/screen.mjs';

const MAX_W = 150;          // the pill, px (Max, 2026-11-19: "WAY too long"; set for the old top bar, kept as the length the words may take)
const fails = [], notes = [];
const CASES = [
  ['live', { mode: 'stream' }], ['every 10 s', { mode: 'polling' }], ['connecting', { mode: 'starting' }],
  ['reconnecting', { mode: 'reconnecting' }], ['stopped', { mode: 'stopped' }], ['paused', { mode: 'paused' }],
  ['replay', { mode: 'replay', replayAt: '07:01' }], ['outdated', { mode: 'outdated', outdated: true }],
  ['paused since', { mode: 'paused', pausedSince: '14:32' }], ['no data since', { mode: 'stream', noDataSince: '14:32' }],
  ['error while live', { mode: 'stream', error: true }], ['error, every 10 s', { mode: 'polling', error: true }],
  ['unknown mode', { mode: 'something-new' }],
];

const browser = await launch();
try {
  for (const lang of ['en', 'sv']) {
    const page = await browser.newPage();
    await page.setViewport(PHONE);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(address({ replay: CARD_HOUR, lang }), { waitUntil: 'domcontentloaded' });
    await until(page, () => Boolean(window.__stack?.top()) && Boolean(document.querySelector('#status .count')), 20000);
    await sleep(3000);
    const rows = await page.evaluate(async (cases) => {
      const { pillText } = await import('/src/connection.js');
      const pill = document.getElementById('status'), count = pill.querySelector('.count');
      return cases.map(([name, c]) => {
        count.textContent = pillText(c);
        pill.classList.toggle('problem', Boolean(c.error || c.outdated || c.pausedSince || c.noDataSince));
        const r = pill.getBoundingClientRect();
        return { name, text: count.textContent, w: Math.round(r.width), h: Math.round(r.height), cut: count.scrollWidth > count.clientWidth + 1,
          inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.left > innerWidth / 2 - 40 };
      });
    }, CASES);
    const oneLine = rows.find(r => r.name === 'live').h;
    for (const r of rows) {
      const bad = [r.w > MAX_W && `${r.w} px wide (max ${MAX_W})`, r.h > oneLine + 1 && `${r.h} px high, more than one line`, r.cut && 'cut off', !r.inside && 'not inside the screen at its top right'].filter(Boolean);
      (bad.length ? fails : notes).push(`${lang}, ${r.name}: "${r.text}" ${bad.length ? bad.join(', ') : `${r.w} px`}`);
    }
    // An error after the start (the code review of 2026-11-21, finding 8): the pill goes on working (its words are
    // written again within 2 s) and the error is listed on the connection screen behind it.
    if (lang === 'en') {
      await page.evaluate(() => { window.dispatchEvent(new ErrorEvent('error', { message: 'pill-check test error', filename: 'http://x/src/test.js', lineno: 1 })); });   // (a thrown error from the test browser's own script reads "Script error.")
      await sleep(500);
      await page.evaluate(() => { document.querySelector('#status .count').textContent = 'x'; });
      await sleep(2500);
      const after = await page.evaluate(() => {
        const count = document.querySelector('#status .count');
        document.getElementById('status').click();
        return { count: Boolean(count), text: count?.textContent ?? document.getElementById('status').textContent };
      });
      await until(page, () => window.__stack.top() === 'page:conn', 3000);
      await sleep(1200);
      const listed = await page.evaluate(() => { const c = document.querySelector('#conn-page .conn-errors'); return window.__stack.top() === 'page:conn' && c && !c.hidden ? c.textContent : null; });
      if (!after.count || after.text === 'x' || /^Error/.test(after.text)) fails.push(`after an error the pill stopped working: "${after.text}"`);
      else notes.push(`after an error the pill goes on: "${after.text}"`);
      if (!listed || !listed.includes('pill-check test error')) fails.push(`the error is not on the connection screen (${listed ?? 'no list shown'})`);
      else notes.push('the error is listed on the connection screen');
      errors.splice(0, errors.length, ...errors.filter(e => !e.includes('pill-check test error')));
    }
    if (errors.length) fails.push(`${lang}: page errors: ${errors.slice(0, 3).join(' | ')}`);
    await page.close();
  }
} catch (e) {
  fails.push(`stopped: ${e.message}`);
} finally {
  await browser.close();
}
for (const n of notes) console.log(`ok   ${n}`);
for (const f of fails) console.log(`FAIL ${f}`);
console.log(fails.length ? `pill-check: ${fails.length} problem(s)` : `pill-check: every pill text is one short line (at most ${MAX_W} px)`);
process.exit(fails.length ? 1 : 0);
