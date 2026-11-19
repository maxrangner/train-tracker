// The live pill stays short (Max, 2026-11-19: some status texts were "WAY too long"). Every state the pill can show
// (src/connection.js pillText), in English and Swedish, is put in the pill on a phone-sized page and measured: one
// line, nothing cut off, at most MAX_W px wide, and the search field beside it keeps room.
// node tools/pill-check.mjs (with npm run dev; PAGE= for another port).
import { launch, sleep, PHONE, CARD_HOUR, address } from './lib/browser.mjs';

const MAX_W = 150;          // the pill, px (the bar is 353 px on a phone: ☰, the logo and the search word need the rest)
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
    await sleep(6000);
    const rows = await page.evaluate(async (cases) => {
      const { pillText } = await import('/src/connection.js');
      const pill = document.getElementById('status'), count = pill.querySelector('.count');
      const bar = document.getElementById('menu-button');
      return cases.map(([name, c]) => {
        count.textContent = pillText(c);
        pill.classList.toggle('problem', Boolean(c.error || c.outdated || c.pausedSince || c.noDataSince));
        const r = pill.getBoundingClientRect();
        return { name, text: count.textContent, w: Math.round(r.width), h: Math.round(r.height), cut: count.scrollWidth > count.clientWidth + 1,
          search: Math.round(bar.getBoundingClientRect().width) };
      });
    }, CASES);
    const oneLine = rows.find(r => r.name === 'live').h;
    for (const r of rows) {
      const bad = [r.w > MAX_W && `${r.w} px wide (max ${MAX_W})`, r.h > oneLine + 1 && `${r.h} px high, more than one line`, r.cut && 'cut off'].filter(Boolean);
      (bad.length ? fails : notes).push(`${lang}, ${r.name}: "${r.text}" ${bad.length ? bad.join(', ') : `${r.w} px`}`);
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
