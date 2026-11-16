// The monitor in a terminal on the Linux PC: node monitor/top.mjs  (Ctrl+C to leave; --once prints once and ends).
// It reads the running monitor (monitor/main.mjs, http://127.0.0.1:8092/data.json) every 5 s and shows the state now,
// the last hour as small bar lines, the problems and the latest mails.
const URL_ = process.env.MONITOR_PAGE ?? 'http://127.0.0.1:8092/data.json';
const once = process.argv.includes('--once');
const BARS = '▁▂▃▄▅▆▇█';
const ago = s => s === null || s === undefined ? '-' : s < 120 ? `${Math.round(s)} s` : s < 7200 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`;
const kB = b => b === null || b === undefined ? '-' : b < 1000 ? `${Math.round(b)} B` : b < 1e6 ? `${(b / 1000).toFixed(1)} kB` : `${(b / 1e6).toFixed(1)} MB`;
const hm = t => new Date(t).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
const mark = ok => ok === null ? ' - ' : ok ? ' ✓ ' : ' ✕ ';
// The last 60 minutes of one measure as a line of bars (a gap where there is no value), with its highest value.
function spark(rows, get, fmt) {
  const vals = rows.slice(-60).map(get);
  if (vals.every(v => v === null || v === undefined)) return 'no data';
  const top = Math.max(1e-9, ...vals.filter(v => v !== null && v !== undefined));
  return `${vals.map(v => v === null || v === undefined ? ' ' : BARS[Math.min(7, Math.floor(v / top * 7.999))]).join('').padStart(60)}  max ${fmt(top)}`;
}

async function show() {
  let D;
  try { D = await (await fetch(URL_, { signal: AbortSignal.timeout(5000) })).json(); }
  catch (e) { return `The monitor does not answer at ${URL_} (${e.message}).\nIs it running?  systemctl status sparat-monitor`; }
  const r = D.rows.at(-1) ?? {}, f = D.fetcher, today = D.rows.filter(x => x.day === r.day);
  const sum = k => today.reduce((n, x) => n + (x[k] ?? 0), 0);
  const L = [];
  L.push(`Spårat monitor  ${new Date(D.now).toLocaleString('sv-SE')}   (watching since ${new Date(D.startedAt).toLocaleString('sv-SE')})`);
  L.push('');
  L.push(`${mark(f?.up ?? false)}Fetcher        ${f?.up ? `running since ${new Date(f.startedAt).toLocaleString('sv-SE')}` : 'NOT RUNNING'}; ${sum('restarts')} restart(s) today`);
  const one = r.one ?? { status: 'off' };
  const oneLine = () => L.push(`${mark(one.status === 'off' ? null : one.status === 200 && one.age <= 60)}one.com file   ${one.status === 'off' ? 'not watched (MONITOR_DATA_URL)' : one.age !== null ? `${ago(one.age)} old` : one.status === 404 ? 'none recent' : one.status === 'error' ? 'no answer' : `answer ${one.status}`}`);
  if (f?.up) {
    L.push(`${mark(f.feeds.positions.mode === 'stream' && f.feeds.passings.mode === 'stream')}Streams        positions ${f.feeds.positions.mode}, passings ${f.feeds.passings.mode}`);
    L.push(`${mark(r.reportAge === undefined ? null : r.reportAge !== null && r.reportAge <= 600)}Train reports  newest ${ago(r.reportAge)} old; ${r.trains ?? '-'} trains`);
    oneLine();
    L.push(`${mark(!(r.refused > 0) && !(r.asks > 20))}Trafikverket   ${r.asks ?? '-'} questions last minute; ${sum('refused')} "too many requests" today; ${kB(r.bytesIn)} in last minute`);
    L.push(`${mark(r.uploads ? r.upAgo !== null && r.upAgo < 120 : null)}Uploads        ${r.uploads ? `${r.upOk} last minute, last good ${ago(r.upAgo)} ago; ${sum('upFailed')} failed today; ${kB(r.bytesOut)} out last minute` : 'off'}`);
    L.push(`   Memory / CPU   ${r.memMB ?? '-'} MB, ${r.cpuPct ?? '-'} %`);
  } else {
    oneLine();
    L.push('   (streams, train reports, Trafikverket, uploads, memory: not shown while the fetcher is not running)');
  }
  L.push(`   Mail           ${D.mail ? `to ${D.mailTo}: ${D.mail.sent} sent, ${D.mail.waiting} waiting` : 'off'}`);
  L.push('');
  L.push('Last hour (one bar a minute):');
  L.push(`  file age      ${spark(D.rows, x => x.one?.age, ago)}`);
  L.push(`  questions     ${spark(D.rows, x => x.up ? x.asks : null, v => Math.round(v))}`);
  L.push(`  uploads       ${spark(D.rows, x => x.uploads ? x.upOk : null, v => Math.round(v))}`);
  L.push(`  data in       ${spark(D.rows, x => x.up ? x.bytesIn : null, kB)}`);
  L.push(`  live file     ${spark(D.rows, x => x.sizes?.live, kB)}`);
  L.push('');
  if (r.offline) {
    const from = [...D.rows].reverse().find((x, i, a) => !a[i + 1]?.offline) ?? r;
    L.push(`! THE INTERNET SEEMS OUT since about ${hm(from.t - 60000)} (the monitor can't reach one.com; a mail follows when it is back)`);
  }
  L.push(D.open.length ? `PROBLEMS NOW:\n${D.open.map(o => `  ✕ ${o.subject} (since ${hm(o.since)})`).join('\n')}` : 'Problems now: none');
  L.push('');
  L.push('Latest mails:');
  for (const m of D.mails.slice(-5).reverse()) L.push(`  ${new Date(m.t).toLocaleString('sv-SE')}  ${m.subject}`);
  if (!D.mails.length) L.push('  none yet');
  L.push('');
  L.push(once ? '' : 'Updates every 5 s. Ctrl+C to leave (the monitor keeps running). The page: http://127.0.0.1:8092/ in this PC\'s browser.');
  return L.join('\n');
}

if (once) console.log(await show());
else {
  const draw = async () => process.stdout.write('\x1b[2J\x1b[H' + await show() + '\n');
  await draw();
  setInterval(draw, 5000);
}
