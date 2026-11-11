// One small call to Trafikverket: is the key good, and what does a train position look like?
// Run: node tools/ping.mjs
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=')).map(l => l.trim().split('=')));
const key = env.VITE_TRV_KEY;

const body = `<REQUEST>
  <LOGIN authenticationkey="${key}"/>
  <QUERY objecttype="TrainPosition" namespace="järnväg.trafikinfo" schemaversion="1.1" limit="3" orderby="TimeStamp desc">
  </QUERY>
</REQUEST>`;

const res = await fetch('https://api.trafikinfo.trafikverket.se/v2/data.json', {
  method: 'POST',
  headers: { 'Content-Type': 'text/xml' },
  body,
});
console.log('HTTP', res.status);
console.log(JSON.stringify(await res.json(), null, 2));
