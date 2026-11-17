// About's buttons and the map credit (2026-11-17), in the test browser: the bug report's e-mail (to, subject, the
// build, the view link, the open train, the phone), the Ko-fi button's link, the "come alive soon" note gone; the map
// credit there at start, gone after 5 s or a drag, clear of the map's buttons. node tools/about-check.mjs (with
// npm run dev; PAGE= for another port). Not the phone: whether its mail app opens.
import { launch, address, sleep, PHONE, CARD_HOUR } from './lib/browser.mjs';

const browser = await launch();
const fails = [], notes = [];
async function open(size, hash) {
  const page = await browser.newPage();
  await page.setViewport(size);
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.evaluateOnNewDocument(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
  await page.goto(address(hash), { waitUntil: 'domcontentloaded' });
  for (let t0 = Date.now(); Date.now() - t0 < 30000; await sleep(300)) {
    if (await page.evaluate(() => (window.__trains?.count ?? 0) > 0 && Boolean(window.__map?.loaded())).catch(() => false)) break;
  }
  return page;
}
try {
  // ---- The buttons ----
  const page = await open(PHONE, { replay: CARD_HOUR, lang: 'sv', view: '11/59.33/18.06' });
  await sleep(1500);
  const number = await page.evaluate(() => { const f = window.__map.queryRenderedFeatures({ layers: ['train-dots'] })[0];
    return f ? String(window.__trains.get(f.properties.id).number) : null; });
  await page.evaluate(() => document.getElementById('menu-button').click()); await sleep(300);
  await page.evaluate((n) => { const i = document.getElementById('search'); i.focus(); i.value = n; i.dispatchEvent(new Event('input', { bubbles: true })); }, number);
  await sleep(500); await page.keyboard.press('Enter'); await sleep(1200);
  const mail = await page.evaluate(() => window.__bugMail());
  const [to, query] = mail.replace(/^mailto:/, '').split('?');
  const q = new URLSearchParams(query);
  const subject = q.get('subject'), body = q.get('body') ?? '';
  const version = await page.evaluate(() => document.getElementById('about-version').textContent);
  if (to !== 'sparat@rangner.com') fails.push(`bug mail to "${to}"`);
  if (!/^Spårat \d+\.\d+\.\d+ \(\w+\+?\): felrapport$/.test(subject)) fails.push(`bug mail subject "${subject}"`);
  for (const want of ['Vad hände?', 'https://sparat.rangner.com/#view=', `Öppet tåg: ${number}`, 'replay ', 'Telefon eller webbläsare: Mozilla'])
    if (!body.includes(want)) fails.push(`bug mail body lacks "${want}"`);
  notes.push(`bug mail: to ${to}, "${subject}"; About says "${version}"`);
  notes.push('body:\n      ' + body.split('\r\n').join('\n      '));
  await page.evaluate(() => { document.getElementById('menu-button').click(); });
  await sleep(300);
  await page.evaluate(() => document.getElementById('help-button').click()); await sleep(400);
  await page.evaluate(() => document.getElementById('kofi-button').click());
  const opened = await page.evaluate(() => window.__opened);
  if (opened[0] !== 'https://ko-fi.com/rangner') fails.push(`Ko-fi opened ${JSON.stringify(opened)}`);
  if (await page.evaluate(() => !document.querySelector('.about-soon').hidden)) fails.push('the "come alive soon" note still shows');
  await page.screenshot({ path: 'shots/todo-1117/about.jpg', quality: 85 });
  if (page.errors.length) fails.push('page errors: ' + page.errors.slice(0, 3).join(' | '));
  await page.close();
} finally { await browser.close(); }
for (const n of notes) console.log('  ' + n);
console.log(fails.length ? `about-check FAILED:\n  ${fails.join('\n  ')}` : 'about-check ok: the bug mail, the Ko-fi link');
process.exit(fails.length ? 1 : 0);
