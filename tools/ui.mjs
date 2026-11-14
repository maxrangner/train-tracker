// Drive the page like a phone, step by step, and take pictures on the way.
// Run (with `npm run dev` going):
//   node tools/ui.mjs <picture-prefix> "<address settings>" <step> <step> ...
//   e.g. node tools/ui.mjs shots/menu- "replay=1&view=12/59.33/18.06&train=toy&lang=sv" click:#menu-button wait:500 shot:open
// The address settings go after the # (replay=1 plays the rush-hour recording). Steps:
//   wait:<ms>        wait
//   click:<css>      tap an element, e.g. click:#menu-button   (a card's × : "click:#panel .panel-close")
//   type:<text>      type into the focused field
//   tapat:<lon>,<lat>  tap the map at a place
//   tapgroup         tap the first "N trains" label on screen
//   taptrain         tap the moving train nearest the middle
//   drag:<dx>,<dy>   drag the map with the mouse by that many pixels
//   shot:<name>      save <picture-prefix><name>.jpg
//   json:<js>        run a line in the page and print its result
import { launch, openMap, sleep, RUSH_HOUR } from './lib/browser.mjs';

const [prefix, hashText = '', ...steps] = process.argv.slice(2);
if (!prefix) { console.log('see the top of tools/ui.mjs'); process.exit(1); }
const hash = Object.fromEntries(new URLSearchParams(hashText));
if (hash.replay === '1') hash.replay = RUSH_HOUR;

const browser = await launch();
const page = await openMap(browser, hash);
for (const step of steps) {
  const [kind, ...rest] = step.split(':');
  const v = rest.join(':');
  if (kind === 'wait') await sleep(Number(v));
  else if (kind === 'click') await page.click(v);
  else if (kind === 'type') await page.keyboard.type(v, { delay: 60 });
  else if (kind === 'tapat') {
    const [lon, lat] = v.split(',').map(Number);
    const pt = await page.evaluate((lon, lat) => window.__map.project([lon, lat]), lon, lat);
    await page.mouse.click(pt.x, pt.y);
  } else if (kind === 'tapgroup') {
    const pt = await page.evaluate(() => ([...document.querySelectorAll('.near-label.group')].map((e) => { const r = e.getBoundingClientRect();
      return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2, n: parseInt(e.textContent, 10) }; }))[0] ?? null);   // close in, the labels are page elements
    console.log('group', JSON.stringify(pt));
    if (pt) await page.mouse.click(pt.x, pt.y);
  } else if (kind === 'taptrain') {
    await page.evaluate(() => {
      const m = window.__map, c = m.project(m.getCenter());
      const d = f => { const q = m.project(f.geometry.coordinates); return Math.hypot(q.x - c.x, q.y - c.y); };
      const f = m.queryRenderedFeatures({ layers: ['train-dots'] }).filter(f => !f.properties.stale).sort((a, b) => d(a) - d(b))[0];
      const q = m.project(f.geometry.coordinates);
      m.fire('click', { point: q, lngLat: m.unproject(q), originalEvent: new MouseEvent('click') });
    });
  } else if (kind === 'drag') {
    // A mouse drag from the middle of the map by dx, dy pixels, in 20 small moves.
    const [dx, dy] = v.split(',').map(Number);
    const vp = page.viewport(), x = vp.width / 2, y = vp.height / 3;
    await page.mouse.move(x, y); await page.mouse.down();
    for (let i = 1; i <= 20; i++) { await page.mouse.move(x + dx * i / 20, y + dy * i / 20); await sleep(16); }
    await page.mouse.up();
  } else if (kind === 'shot') {
    await page.screenshot({ path: `${prefix}${v}.jpg`, quality: 82 });
    console.log('shot', `${prefix}${v}.jpg`);
  } else if (kind === 'json') console.log(JSON.stringify(await page.evaluate(v)));
  else console.log('unknown step:', step);
}
if (page.errors.length) console.log('page errors:', page.errors);
await browser.close();
