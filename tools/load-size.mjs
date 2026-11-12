// How much does a phone download to start the map, and from where? Opens the page with an empty cache and sums
// what arrives per server for 25 s.
// (2026-11-12: `npm run dev` sends 13 MB from this computer, mostly unpacked map and 3D code; `npm run phone` 1 MB.)
// Run: node tools/load-size.mjs [address]      default http://localhost:5173/ ; the packed app: http://localhost:4173/
import { launch, PHONE, PAGE, sleep } from './lib/browser.mjs';

const url = process.argv[2] ?? PAGE;
const browser = await launch();
const page = await browser.newPage();
await page.setViewport(PHONE);
const cdp = await page.createCDPSession();
await cdp.send('Network.enable');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
const requests = new Map();
const at = id => requests.get(id) ?? requests.set(id, {}).get(id);
cdp.on('Network.responseReceived', (e) => { at(e.requestId).url = e.response.url; });
cdp.on('Network.loadingFinished', (e) => { at(e.requestId).bytes = e.encodedDataLength; });
cdp.on('Network.dataReceived', (e) => { const r = at(e.requestId); r.stream = (r.stream ?? 0) + e.encodedDataLength; });
await page.goto(url, { waitUntil: 'domcontentloaded' });
await sleep(25000);
await browser.close();

const perHost = new Map(), files = [];
for (const r of requests.values()) {
  if (!r.url || r.url.startsWith('data:')) continue;
  const host = new URL(r.url).host, mb = (r.bytes ?? r.stream ?? 0) / 1048576;
  const h = perHost.get(host) ?? perHost.set(host, { n: 0, mb: 0 }).get(host);
  h.n++; h.mb += mb;
  files.push([mb, r.url.replace(/\?.*/, '').slice(-70)]);
}
for (const [host, v] of perHost) console.log(host.padEnd(36), String(v.n).padStart(4), 'files', v.mb.toFixed(2).padStart(7), 'MB');
console.log('largest:');
for (const [mb, name] of files.sort((a, b) => b[0] - a[0]).slice(0, 6)) console.log(mb.toFixed(2).padStart(7), 'MB', name);
