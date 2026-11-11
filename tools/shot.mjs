// Open the running page in Edge (no window), wait in real time, save a picture and print the console.
// Run (with `npm run dev` going): node tools/shot.mjs [seconds=25] [out=shots/shot.png] [width=900] [height=1100]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [seconds = '25', out = 'shots/shot.png', width = '900', height = '1100'] = process.argv.slice(2);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: Number(width), height: Number(height) });
page.on('console', m => console.log(`[console.${m.type()}] ${m.text()}`));
page.on('pageerror', e => console.log(`[page error] ${e.message}`));
page.on('response', r => { if (r.status() >= 400) console.log(`[http ${r.status()}] ${r.url().slice(0, 120)}`); });
page.on('requestfailed', r => console.log(`[request failed] ${r.url().slice(0, 120)} ${r.failure()?.errorText}`));

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, Number(seconds) * 1000));
console.log('status line:', await page.$eval('#status', el => el.textContent));
mkdirSync(dirname(out), { recursive: true });
await page.screenshot({ path: out });
console.log('picture:', out);
await browser.close();
