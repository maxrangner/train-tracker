// A sketch, not a check: an icon before every card's title on Home (Max, 2026-11-25: "Give each sub card an icon before
// the title. And make it dynamic, like 'störningar' shows correctly colored triangle and number of total störningar"),
// put into the live page by the test browser in two looks, for Max to pick:
//   A: the icon alone in the card's colour, a count chip after the title where there is a number;
//   B: the icon in a small tinted tile (as the disruption rows' icon boxes), the number beside the title.
// node tools/look-card-icons.mjs <out-folder>   (PAGE=, live data: the disruptions are live only)
import { mkdirSync } from 'node:fs';
import { launch, openMap, sleep } from './lib/browser.mjs';

const out = (process.argv[2] ?? 'shots/card-icons').replace(/\/$/, '');
mkdirSync(out, { recursive: true });
const PC = { width: 1400, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
const browser = await launch();
try {
  for (const look of ['A', 'B']) {
    const page = await openMap(browser, { size: PC, lang: 'sv' });
    await sleep(9000);
    await page.evaluate(() => window.__stack.setLevel(2));
    await sleep(2500);
    await page.evaluate((look) => {
      const P = {   // the app's icon paths (src/icons.js) and two more for the sketch
        funnel: '<path d="M4 5h16l-6 7.5V19l-4-2v-4.5z"/>', star: '<path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.6l-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/>',
        locate: '<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22"/>',
        warning: '<path d="M12 4 21 19.5H3z"/><path d="M12 10v4.2M12 16.8v.3"/>', stats: '<path d="M5 19.5V11M10 19.5V5M15 19.5v-6M20 19.5V9"/>',
        train: '<rect x="6" y="3.5" width="12" height="13" rx="3"/><path d="M6 10.5h12M9 20.5l1.5-4M15 20.5l-1.5-4"/><circle cx="9.5" cy="13.5" r=".6"/><circle cx="14.5" cy="13.5" r=".6"/>',
        clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', check: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12.3l2.7 2.7L16 9.5"/>',
        speed: '<path d="M4.5 16a8 8 0 1 1 15 0"/><path d="M12 13.5l4-4.5"/>', busy: '<path d="M4 19.5h16M7 19.5V12M12 19.5V7M17 19.5v-9"/>',
        bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
        server: '<rect x="4" y="4" width="16" height="7" rx="2"/><rect x="4" y="13" width="16" height="7" rx="2"/><path d="M8 7.5h.01M8 16.5h.01"/>',
        company: '<path d="M4 20V8l6-3v15M10 20V10l10 3v7M4 20h16"/>', pause: '<path d="M8 5v14M16 5v14"/>',
      };
      const svg = n => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[n]}</svg>`;
      const css = document.createElement('style');
      css.textContent = `
        .sk-h { display: inline-flex; align-items: center; gap: 8px; }
        .sk-ic { display: inline-grid; place-items: center; flex: none; }
        .sk-a .sk-ic { color: var(--sk, var(--accent)); }
        .sk-b .sk-ic { width: 28px; height: 28px; border-radius: 9px; color: var(--sk, var(--accent)); background: color-mix(in srgb, var(--sk, var(--accent)) 16%, transparent); }
        .sk-n { font-size: 12px; font-weight: 800; line-height: 18px; padding: 0 7px; border-radius: 9px; color: var(--sk, var(--accent)); background: color-mix(in srgb, var(--sk, var(--accent)) 16%, transparent); }
        .sk-b .sk-n { background: none; padding: 0; font-size: 15px; }
        .st-lbl.sk-h { display: inline-flex; }`;
      document.head.append(css);
      const home = document.querySelector('#sheet .pg[data-key="home"]');
      home.classList.add(look === 'A' ? 'sk-a' : 'sk-b');
      // the numbers that are there now
      const dis = [...home.querySelectorAll('.dis-row')];
      const allRow = [...home.querySelectorAll('.dis-row, .dis-all, button')].find(b => /Alla störningar/.test(b.textContent));
      const disN = Number(/(\d+)/.exec(allRow?.textContent ?? '')?.[1] ?? dis.length);
      const disRed = Boolean(home.querySelector('.dis-ic.red')), disOrange = Boolean(home.querySelector('.dis-ic.orange'));
      const saved = home.querySelectorAll('.sec .trip-row, .sec .fav-row, .sec [data-go^="train:"], .sec [data-go^="station:"]').length;
      const filters = document.querySelectorAll('[data-cofilter].on, .lg-p.on').length;
      const lateTop = /\+?(\d+)/.exec(home.querySelector('.most-late .late, .most-late b, .most-late .cd-late')?.textContent ?? '')?.[1];
      const punct = home.querySelector('.st-punct');
      const put = (h, ic, colour, n) => {
        if (!h || h.dataset.sk) return;
        h.dataset.sk = '1';
        h.classList.add('sk-h');
        h.insertAdjacentHTML('afterbegin', `<span class="sk-ic"${colour ? ` style="--sk:${colour}"` : ''}>${svg(ic)}</span>`);
        if (n !== undefined && n !== null && n !== '' && n !== 0) h.insertAdjacentHTML('beforeend', `<span class="sk-n"${colour ? ` style="--sk:${colour}"` : ''}>${n}</span>`);
      };
      for (const h of home.querySelectorAll('h4.lab, h3.big, .st-lbl')) {
        const w = h.textContent.trim();
        if (/^Filter/.test(w)) put(h, 'funnel', null, filters || null);
        else if (/^Sparade/.test(w)) put(h, 'star', null, saved || null);
        else if (/^Nära/.test(w)) put(h, 'locate');
        else if (/^Störningar/.test(w)) put(h, 'warning', disRed ? 'var(--dis-3)' : disOrange ? 'var(--dis-2)' : 'var(--dis-1)', disN);
        else if (/^Sverige/.test(w)) put(h, 'train', null, null);
        else if (/^Mest sena/.test(w)) put(h, 'clock', 'var(--c-late)', lateTop ? `+${lateTop}` : null);
        else if (/^Punktlighet/.test(w)) put(h, 'check', 'var(--c-ontime)', null);
        else if (/^Körda|^Kört/.test(w)) put(h, 'train');
        else if (/^Inställ/.test(w)) put(h, 'pause', 'var(--c-late)');
        else if (/^Tågslag|^Sorts/.test(w)) put(h, 'train');
        else if (/^Bolag/.test(w)) put(h, 'company');
        else if (/^Snabb/.test(w)) put(h, 'speed');
        else if (/^Mest trafik|^Flest/.test(w)) put(h, 'busy');
        else if (/^Kul|^Visste/.test(w)) put(h, 'bulb');
        else if (/^Data|^Källa/.test(w)) put(h, 'server');
        else put(h, 'stats');
      }
      void punct;
    }, look);
    await sleep(600);
    const shot = async (name, scrollTo) => {
      await page.evaluate(y => { document.querySelector('#sheet .pg[data-key="home"]').scrollTop = y; }, scrollTo);
      await sleep(500);
      const r = await page.evaluate(() => { const b = document.getElementById('sheet').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
      await page.screenshot({ path: `${out}/${look}-${name}.jpg`, quality: 88, clip: { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: r.w + 16, height: Math.min(900 - r.y + 8, r.h + 16) } });
    };
    await shot('top', 0);
    await shot('mid', 700);
    await shot('low', 1500);
    await page.close();
  }
} finally { await browser.close(); }
console.log(`pictures in ${out}`);
