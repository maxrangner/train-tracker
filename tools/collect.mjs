// Listen to Trafikverket's live stream of train positions for a while and save every message.
// Run: node tools/collect.mjs [minutes]   -> data/positions-<time>.jsonl (one position per line)
import { readFileSync, mkdirSync, appendFileSync } from 'node:fs';

const minutes = Number(process.argv[2] ?? 10);
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=')).map(l => l.trim().split('=')));
const key = env.VITE_TRV_KEY;

mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
const out = new URL(`../data/positions-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`, import.meta.url);
const save = (p, via) => appendFileSync(out, JSON.stringify({ got: new Date().toISOString(), via, ...p }) + '\n');

// 1. The positions reported in the last 2 minutes, and a stream address for everything after.
const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
const body = `<REQUEST>
  <LOGIN authenticationkey="${key}"/>
  <QUERY objecttype="TrainPosition" namespace="järnväg.trafikinfo" schemaversion="1.1" sseurl="true">
    <FILTER><GT name="TimeStamp" value="${since}"/></FILTER>
  </QUERY>
</REQUEST>`;
const res = await fetch('https://api.trafikinfo.trafikverket.se/v2/data.json', {
  method: 'POST', headers: { 'Content-Type': 'text/xml' }, body,
});
if (!res.ok) { console.error('HTTP', res.status, await res.text()); process.exit(1); }
const result = (await res.json()).RESPONSE.RESULT[0];
for (const p of result.TrainPosition ?? []) save(p, 'start');
console.log(`start: ${result.TrainPosition?.length ?? 0} positions; streaming ${minutes} min -> ${out.pathname}`);

// 2. The stream (Server-Sent Events): lines "data: {...}" separated by blank lines.
const ctrl = new AbortController();
setTimeout(() => ctrl.abort(), minutes * 60 * 1000);
let count = 0;
try {
  const stream = await fetch(result.INFO.SSEURL, { signal: ctrl.signal, headers: { Accept: 'text/event-stream' } });
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of stream.body) {
    buf += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');   // Trafikverket sends \r\n
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const event = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = event.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5)).join('');
      if (!data) continue;
      for (const r of JSON.parse(data).RESPONSE.RESULT)
        for (const p of r.TrainPosition ?? []) { save(p, 'stream'); count++; }
    }
  }
} catch (e) {
  if (e.name !== 'AbortError') throw e;
}
console.log(`done: ${count} positions from the stream`);
