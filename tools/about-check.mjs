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

  // ---- The map credit: phone and PC, light and dark; there at start, clear of the buttons, gone after 5 s / a drag ----
  const credit = p => p.evaluate(() => {
    const c = document.getElementById('credit'), b = document.querySelector('.maplibregl-ctrl-bottom-right')?.getBoundingClientRect();
    if (!c) return null;
    const r = c.getBoundingClientRect(), shown = !c.hidden && getComputedStyle(c).opacity > 0.5;
    const hit = b && r.right > b.left && r.left < b.right && r.bottom > b.top && r.top < b.bottom;
    return { shown, text: c.textContent, hit: Boolean(hit), w: Math.round(r.width), clipped: c.scrollWidth > c.clientWidth };
  });
  for (const [size, theme] of [[PHONE, 'light'], [PHONE, 'dark'], [{ width: 1280, height: 800 }, 'light']]) {
    const p = await open(size, { lang: 'sv', theme, view: '9/59.33/18.06' });
    await sleep(2500);
    const c = await credit(p);
    const name = `${size.width}px ${theme}`;
    if (!c?.shown) fails.push(`credit not shown at start (${name})`);
    else {
      if (c.hit) fails.push(`credit over the map's buttons (${name})`);
      if (c.clipped) fails.push(`credit cut off (${name}): "${c.text}"`);
      notes.push(`credit at start (${name}): "${c.text}", ${c.w} px wide`);
    }
    await p.screenshot({ path: `shots/todo-1117/credit-${size.width}-${theme}.jpg`, quality: 85 });
    if (size === PHONE && theme === 'light') {   // waits out the 5 s
      await sleep(6500);
      if ((await credit(p))?.shown) fails.push('credit still shown after 5 s');
    } else if (size === PHONE) {                 // a drag fades it at once
      await p.mouse.move(200, 400); await p.mouse.down(); await p.mouse.move(150, 350, { steps: 5 }); await p.mouse.up();
      await sleep(900);
      if ((await credit(p))?.shown) fails.push('credit still shown after a drag');
    }
    if (p.errors.length) fails.push(`page errors (${name}): ` + p.errors.slice(0, 2).join(' | '));
    await p.close();
  }
} finally { await browser.close(); }
for (const n of notes) console.log('  ' + n);
console.log(fails.length ? `about-check FAILED:\n  ${fails.join('\n  ')}` : 'about-check ok: the bug mail, the Ko-fi link, the map credit (shown, clear of the buttons, fades)');
process.exit(fails.length ? 1 : 0);
