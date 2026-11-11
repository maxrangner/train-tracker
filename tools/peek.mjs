// Look at the raw live stream for 30 seconds: status, headers, and the first bytes exactly as sent.
// Run: node tools/peek.mjs
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=')).map(l => l.trim().split('=')));

const body = `<REQUEST>
  <LOGIN authenticationkey="${env.VITE_TRV_KEY}"/>
  <QUERY objecttype="TrainPosition" namespace="järnväg.trafikinfo" schemaversion="1.1" sseurl="true" limit="0"/>
</REQUEST>`;
const res = await fetch('https://api.trafikinfo.trafikverket.se/v2/data.json', {
  method: 'POST', headers: { 'Content-Type': 'text/xml' }, body,
});
const json = await res.json();
const url = json.RESPONSE.RESULT[0].INFO?.SSEURL;
console.log('query HTTP', res.status, 'INFO:', JSON.stringify(json.RESPONSE.RESULT[0].INFO));
if (!url) process.exit(1);

const ctrl = new AbortController();
setTimeout(() => ctrl.abort(), 30000);
const s = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'text/event-stream' } });
console.log('stream HTTP', s.status, s.headers.get('content-type'));
let raw = '', chunks = 0;
try {
  for await (const c of s.body) { chunks++; raw += new TextDecoder().decode(c); if (raw.length > 600) break; }
} catch (e) { if (e.name !== 'AbortError') throw e; }
console.log('chunks', chunks, 'bytes', raw.length);
console.log(JSON.stringify(raw.slice(0, 600)));
