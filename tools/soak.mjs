// Keep the running page open for a long time and print its status line every few minutes.
// Run (with `npm run dev` going): node tools/soak.mjs [minutes=60] [every=5]
import puppeteer from 'puppeteer-core';

const [minutes = '60', every = '5'] = process.argv.slice(2);
import { BROWSER_PATH as EDGE, PAGE } from './lib/browser.mjs';

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 1100 });
page.on('pageerror', e => console.log(`${new Date().toTimeString().slice(0, 8)} [page error] ${e.message}`));
page.on('console', m => { if (m.type() === 'warn' || m.type() === 'error') console.log(`${new Date().toTimeString().slice(0, 8)} [console.${m.type()}] ${m.text()}`); });

await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
const end = Date.now() + Number(minutes) * 60000;
const line = async () => console.log(`${new Date().toTimeString().slice(0, 8)} ${await page.$eval('#status', el => el.title || el.textContent)}`);
await new Promise(r => setTimeout(r, 20000));
await line();
while (Date.now() < end) {
  await new Promise(r => setTimeout(r, Math.min(Number(every) * 60000, Math.max(0, end - Date.now()))));
  await line();
}
await page.screenshot({ path: 'shots/soak-end.png' });
await browser.close();
console.log('done');
