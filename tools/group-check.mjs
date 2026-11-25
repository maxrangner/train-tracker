// A tap on a train shown inside a "N trains" group opens the group's list, not the train (2026-11-18, Max: "Should
// only show the menu for choosing all n number of trains"); a train with its own label still opens its card.
// Far out (the map's grouped labels) and close in (the page's bubbles), on the rush-hour replay. Also: close in no
// bubble lies over a station's name (Max's pick B, 2026-11-19).
// node tools/group-check.mjs (with npm run dev; PAGE= for another port).
import { launch, address, sleep, PHONE, CARD_HOUR, RUSH_HOUR } from './lib/browser.mjs';

const fails = [], notes = [];
const expect = (ok, what) => { (ok ? notes : fails).push(what); };
const browser = await launch();
try {
  const page = await browser.newPage();
  await page.setViewport(PHONE);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(address({ replay: CARD_HOUR, lang: 'en', view: '7/59.3/17.9' }), { waitUntil: 'domcontentloaded' });
  for (let t0 = Date.now(); Date.now() - t0 < 40000; await sleep(400)) {
    if (await page.evaluate(() => (window.__trains?.count ?? 0) > 0 && Boolean(window.__map?.loaded())).catch(() => false)) break;
  }
  await sleep(3000);
  // (the pickers' and the train's pages closed, one step back each, as their × did)
  const shut = () => page.evaluate(() => {
    for (let i = 0; i < 12 && /^(pick|train):/.test(window.__stack.top() ?? ''); i++) window.__stack.back();
    for (const id of ['picker', 'panel']) document.getElementById(id).hidden = true;
  });
  const state = () => page.evaluate(() => ({ picker: !document.getElementById('picker').hidden, rows: document.querySelectorAll('#picker [data-i]').length,
    card: !document.getElementById('panel').hidden && document.querySelector('#panel .panel-head strong')?.textContent }));

  // ---- Far out: a grouped label's trains ----
  const far = await page.evaluate(async () => {
    const m = window.__map, g = m.queryRenderedFeatures({ layers: ['train-labels'] }).find(f => f.properties.cluster_id !== undefined && f.properties.point_count >= 2);
    if (!g) return null;
    const leaves = await m.getSource('train-groups').getClusterLeaves(g.properties.cluster_id, 200, 0);
    const ids = new Set(leaves.map(l => l.properties.id));
    const dot = m.queryRenderedFeatures({ layers: ['train-dots'] }).find(f => ids.has(f.properties.id));
    if (!dot) return { count: leaves.length, none: true };
    const q = m.project(dot.geometry.coordinates);
    m.fire('click', { point: q, lngLat: m.unproject(q), originalEvent: new MouseEvent('click') });
    return { count: leaves.length, id: dot.properties.id };
  });
  if (!far || far.none) notes.push(`far out: no grouped train to tap (${far ? 'its dots not drawn' : 'no group on screen'}): not checked`);
  else {
    await sleep(1500);
    const s = await state();
    expect(s.picker && s.rows === far.count && !s.card, `far out: a tap on a train in a "${far.count} trains" group lists ${s.rows} (card ${s.card || 'not opened'})`);
    await shut(); await sleep(500);
  }
  // A train with its own label far out still opens.
  const lone = await page.evaluate(() => {
    const m = window.__map, own = new Set(m.queryRenderedFeatures({ layers: ['train-labels'] }).filter(f => f.properties.id).map(f => f.properties.id));
    // With no other train within 24 px (the nearest dot wins a tap, rightly).
    // Nor under another train's label (a label wins a tap, as before).
    const clear = f => { const q = m.project(f.geometry.coordinates);
      return m.queryRenderedFeatures([[q.x - 24, q.y - 24], [q.x + 24, q.y + 24]], { layers: ['train-dots'] }).length === 1
        && !m.queryRenderedFeatures([[q.x - 4, q.y - 4], [q.x + 4, q.y + 4]], { layers: ['train-labels'] }).some(l => l.properties.id !== f.properties.id); };
    const dot = m.queryRenderedFeatures({ layers: ['train-dots'] }).find(f => own.has(f.properties.id) && clear(f));
    if (!dot) return null;
    const q = m.project(dot.geometry.coordinates);
    m.fire('click', { point: q, lngLat: m.unproject(q), originalEvent: new MouseEvent('click') });
    return String(window.__trains.get(dot.properties.id).number);
  });
  if (lone) {
    await sleep(2000);
    const s = await state();
    expect(s.card && String(s.card).startsWith(lone) && !s.picker, `far out: a train on its own (${lone}) opens its card ("${s.card}")`);
    await shut(); await sleep(800);
  } else notes.push('far out: no train on its own to tap: not checked');

  // ---- Close in: the page's "N trains" bubbles ----
  await page.evaluate(() => window.__map.jumpTo({ center: [18.06, 59.33], zoom: 12.5 }));
  await sleep(3500);
  const near = await page.evaluate(() => {
    const b = document.querySelector('.near-label.group');
    if (!b) return null;
    const n = parseInt(b.textContent, 10), r = b.getBoundingClientRect(), box = window.__map.getContainer().getBoundingClientRect();
    // The group's trains are next to its bubble: 16 px above it (src/map.js LABEL_DY), below it when it is above them
    // ('up'), 22 px to its left or right when it is beside them (SIDE_DX): the nearest dot there.
    const c = b.classList, mx = (r.left + r.right) / 2, my = (r.top + r.bottom) / 2;
    const x = (c.contains('right') ? r.left - 22 : c.contains('left') ? r.right + 22 : mx) - box.left;
    const y = (c.contains('up') ? r.bottom + 16 : c.contains('right') || c.contains('left') ? my : r.top - 16) - box.top;
    const m = window.__map, dot = m.queryRenderedFeatures([[x - 30, y - 30], [x + 30, y + 30]], { layers: ['train-dots'] })[0];
    if (!dot) return { n, none: true };
    const q = m.project(dot.geometry.coordinates);
    m.fire('click', { point: q, lngLat: m.unproject(q), originalEvent: new MouseEvent('click') });
    return { n };
  });
  if (!near || near.none) notes.push(`close in: no "N trains" bubble with a dot to tap at Stockholm C: not checked`);
  else {
    await sleep(1500);
    const s = await state();
    expect(s.picker && s.rows === near.n && !s.card, `close in: a tap on a train under a "${near.n} trains" bubble lists ${s.rows} (card ${s.card || 'not opened'})`);
  }
  expect(!errors.length, `page errors: ${errors.slice(0, 3).join(' | ') || 'none'}`);

  // ---- Close in: no bubble over a station's name (Max's pick B, 2026-11-19) ----
  // In the morning rush at 07:01 a "2 trains" bubble at Stockholm C lay under the name "Stockholm C" (before:
  // 40 looks of 40): now the bubble moves beside its train. Watched for 10 s.
  const rush = await browser.newPage();
  await rush.setViewport(PHONE);
  const rushErrors = [];
  rush.on('pageerror', e => rushErrors.push(e.message));
  await rush.goto(address({ replay: RUSH_HOUR, lang: 'en', theme: 'light', view: '14/59.3308/18.0585' }), { waitUntil: 'domcontentloaded' });
  for (let t0 = Date.now(); Date.now() - t0 < 40000; await sleep(400)) {
    if (await rush.evaluate(() => (window.__trains?.count ?? 0) > 0 && Boolean(window.__map?.getLayer('trains-3d'))).catch(() => false)) break;
  }
  await sleep(2000);
  let looks = 0, over = 0, beside = 0;
  for (let i = 0; i < 20; i++, await sleep(500)) {
    const r = await rush.evaluate(() => {
      const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const names = [...document.querySelectorAll('.station-name')].map(n => n.getBoundingClientRect());
      return [...document.querySelectorAll('.near-label:not(.out)')].map(b => ({ over: names.some(n => hit(b.getBoundingClientRect(), n)),
        beside: b.classList.contains('right') || b.classList.contains('left') }));
    });
    for (const b of r) { looks++; over += b.over; beside += b.beside; }
  }
  expect(looks > 0 && over === 0, `close in at Stockholm C (rush 07:01): bubbles over a station's name ${over} of ${looks} looks (${beside} beside their trains)`);
  expect(!rushErrors.length, `page errors (rush): ${rushErrors.slice(0, 3).join(' | ') || 'none'}`);
} finally { await browser.close(); }

for (const n of notes) console.log(`  ok   ${n}`);
for (const f of fails) console.log(`  FAIL ${f}`);
console.log(fails.length ? `group-check: ${fails.length} failed` : 'group-check ok: a tap on a grouped train lists the group; a train on its own opens');
process.exit(fails.length ? 1 : 0);
