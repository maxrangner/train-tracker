// Settings → Debug shows only when switched on (2026-11-18): #debug=off hides it, 7 taps on About's version line show
// it (and say so on that line for a moment), 7 more hide it, #debug shows it, and the choice is remembered on the
// device. On the dev page it is shown until switched off. node tools/debug-check.mjs (with npm run dev; PAGE= for
// another port). Not checked here: a build for the site or the app (hidden by default there: the same code, not DEV).
import { launch, address, sleep, PHONE } from './lib/browser.mjs';

const fails = [], notes = [];
const expect = (ok, what) => { (ok ? notes : fails).push(what); };
const browser = await launch();
try {
  const page = await browser.newPage();
  await page.setViewport(PHONE);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // The rows the train style doesn't hide anyway (toy-only, real-only, model-only follow Settings → Trains).
  const shown = () => page.evaluate(() => [...document.querySelectorAll('#settings .debug-only:not(.toy-only):not(.real-only):not(.model-only)')]
    .map(e => getComputedStyle(e).display !== 'none'));
  const rows = list => (list.every(Boolean) ? 'all shown' : list.some(Boolean) ? 'some shown' : 'all hidden');
  const go = async hash => { await page.goto(address({ lang: 'sv', ...hash }), { waitUntil: 'domcontentloaded' }); await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(1500); };

  await go({});
  let s = await shown();
  expect(s.length >= 5 && s.every(Boolean), `the dev page, nothing chosen: ${s.length} debug rows (heading included), ${rows(s)}`);
  await go({ debug: 'off' });
  s = await shown();
  expect(s.every(x => !x), `#debug=off: ${rows(s)}`);
  await go({});
  s = await shown();
  expect(s.every(x => !x), `then without #debug (remembered): ${rows(s)}`);

  // 7 taps on the version line (About), quick.
  const tap7 = () => page.evaluate(async () => { const v = document.getElementById('about-version'); for (let i = 0; i < 7; i++) { v.click(); await new Promise(r => setTimeout(r, 120)); } return v.textContent; });
  const six = await page.evaluate(async () => { const v = document.getElementById('about-version'); for (let i = 0; i < 6; i++) { v.click(); await new Promise(r => setTimeout(r, 120)); } return v.textContent; });
  s = await shown();
  expect(s.every(x => !x) && /^Version/.test(six), `6 taps: nothing yet (${rows(s)}, "${six}")`);
  await sleep(1700);   // a pause breaks the run
  let said = await tap7();
  s = await shown();
  expect(s.every(Boolean) && /Felsökning visas/.test(said), `7 taps: ${rows(s)}, the line says "${said}"`);
  await sleep(2800);
  const back = await page.evaluate(() => document.getElementById('about-version').textContent);
  expect(/^Version/.test(back), `then the version line again: "${back}"`);
  said = await tap7();
  s = await shown();
  expect(s.every(x => !x) && /dold/.test(said), `7 more: ${rows(s)}, "${said}"`);
  await go({ debug: '' });
  s = await shown();
  expect(s.every(Boolean), `#debug: ${rows(s)}`);
  await page.evaluate(() => { try { localStorage.removeItem('debugShown'); } catch {} });
  expect(!errors.length, `page errors: ${errors.slice(0, 3).join(' | ') || 'none'}`);
} finally { await browser.close(); }

for (const n of notes) console.log(`  ok   ${n}`);
for (const f of fails) console.log(`  FAIL ${f}`);
console.log(fails.length ? `debug-check: ${fails.length} failed` : `debug-check ok: Settings → Debug hidden until switched on (#debug, 7 taps), remembered`);
process.exit(fails.length ? 1 : 0);
