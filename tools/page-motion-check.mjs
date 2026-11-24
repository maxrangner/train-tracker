// How a page comes into the sheet (Debug → Page change; Max, 2026-11-24: "Do A, B and F and put them in debug
// options"; "They slide in AND fade in. Remove the fade on all"): for each way ('side', 'rise', 'strip'), on a phone and
// a computer, a train opened from Home and Störningar opened: the pages move along their way's axis (sideways for side,
// up and down for rise and strip), nothing in them fades while they come in, the page arrives. Replay CARD_HOUR.
// node tools/page-motion-check.mjs (with npm run dev; PAGE= for another port).
import { launch, sleep, CARD_HOUR } from './lib/browser.mjs';
import * as S from './lib/screen.mjs';
const browser = await launch();
const fails = [];
const ok = (c, w) => { console.log(c ? 'ok  ' : 'FAIL', w); if (!c) fails.push(w); };
for (const motion of ['side', 'rise', 'strip']) {
  for (const pc of [false, true]) {
    const page = await S.waitForMap(browser, { replay: CARD_HOUR, theme: 'dark', lang: 'sv', motion, ...(pc ? { size: { width: 1280, height: 800 } } : {}) });
    await sleep(2500);
    await S.setLevel(page, 1);
    await sleep(800);
    const id = await page.evaluate(() => window.__trains.reports().map(r => r.id)[3]);
    for (const what of ['train', 'list']) {
      if (what === 'list') { await page.evaluate(() => window.__stack.home(1)); await sleep(1200); }
      const r = await page.evaluate(async (what, id) => {
        const fades = new Set(), axes = new Set(); let on = true;
        // (elements that are see-through by design, always: not a fade)
        const always = new Set(['st-sub', 'st-mini']);
        const look = () => {
          if (!on) return;
          for (const pg of document.querySelectorAll('#sheet .sh-pages > .pg')) {
            const m = new DOMMatrixReadOnly(getComputedStyle(pg).transform);
            if (Math.abs(m.m41) > 1) axes.add('x'); if (Math.abs(m.m42) > 1) axes.add('y');
            for (const e of [pg, ...pg.querySelectorAll('*')].slice(0, 400)) {
              if (Number(getComputedStyle(e).opacity) < 0.98 && e.getBoundingClientRect().height > 0 && ![...e.classList].some(c => always.has(c))) fades.add(e.className?.toString().split(' ')[0] || e.tagName);
            }
          }
          requestAnimationFrame(look);
        };
        requestAnimationFrame(look);
        if (what === 'train') window.__stack.open(`train:${id}`, { go: true });
        else document.querySelector('#sheet [data-go="dislist"]')?.click();
        await new Promise(res => setTimeout(res, 900));
        on = false;
        return { fades: [...fades].slice(0, 5), axes: [...axes].join(''), top: window.__stack.top() };
      }, what, id);
      const want = motion === 'side' ? 'x' : 'y';
      const arrived = what === 'train' ? r.top.startsWith('train:') : r.top === 'dislist';
      if (what === 'list' && r.top === 'home') { console.log(`note ${motion} ${pc ? 'PC' : 'phone'}: no "Alla störningar" on Home now (not checked)`); continue; }
      ok(arrived && r.axes === want && !r.fades.length, `${motion} ${pc ? 'PC' : 'phone'} ${what}: on ${r.top}, moved along ${r.axes || 'nothing'} (want ${want}), fading: ${r.fades.join(', ') || 'none'}`);
    }
    await page.close();
  }
}
await browser.close();
console.log(fails.length ? `page-motion-check: ${fails.length} failed` : 'page-motion-check ok: each way moves along its axis, nothing fades');
process.exit(fails.length ? 1 : 0);
