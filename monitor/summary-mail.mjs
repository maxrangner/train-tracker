// The daily summary as a page in the mail (Max, 2026-11-23: "I want as much data as possible in the email. Make it easy
// to read, well formatted, and graphs if possible"). Built from the same minute rows as the text (monitor/rules.mjs
// summary), the days before (days.jsonl) and the viewer count (fetcher/viewers.mjs).
// Mail programs show only simple HTML: tables and inline styles, no scripts, no pictures; the graphs are bars made of
// table cells (they show in Gmail, Outlook, phones; a program set to dark may turn the colours). Kept well under
// Gmail's 102 kB, past which it cuts a mail. The footer is filled in by monitor/mail.mjs (<!--foot-->).
import { swedishParts } from '../src/clock.js';

const H = 3600000;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hm = t => new Date(t).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Stockholm' });
const dayName = day => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayOf = t => swedishParts(t).day;
const med = a => { const s = a.filter(x => x !== null && x !== undefined).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const max = a => { const s = a.filter(x => x !== null && x !== undefined); return s.length ? Math.max(...s) : null; };
const sum = a => a.reduce((n, x) => n + (x ?? 0), 0);
const n0 = v => (v === null || v === undefined ? '–' : Math.round(v).toLocaleString('sv-SE'));
const MB = b => (b === null || b === undefined ? '–' : `${(b / 1e6).toFixed(b < 1e7 ? 1 : 0)} MB`);
const kB = b => (b === null || b === undefined ? '–' : b < 1000 ? `${Math.round(b)} B` : `${(b / 1000).toFixed(1)} kB`);
const secs = s => (s === null || s === undefined ? '–' : s < 120 ? `${s} s` : `${Math.round(s / 60)} min`);

const C = {
  ink: '#1f2937', muted: '#6b7280', line: '#e5e7eb', card: '#ffffff', page: '#f3f4f6',
  bar: '#2563eb', barLight: '#bfd3fb', good: '#16a34a', warn: '#d97706', bad: '#dc2626', none: '#d1d5db',
  goodBg: '#dcfce7', badBg: '#fee2e2',
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// The 24 hours before the summary, one bucket an hour (Swedish time; on the clock-change days the buckets stay real hours).
export function hourBuckets(rows, end) {
  const last = end - (end % H);
  const out = [];
  for (let s = last - 24 * H; s < last; s += H) out.push({ t: s, hour: String(swedishParts(s).hour).padStart(2, '0'), rows: [] });
  for (const r of rows) { const b = out[Math.floor((r.t - (last - 24 * H)) / H)]; if (b) b.rows.push(r); }
  return out;
}

// A bar graph: one column an hour. values: numbers (null: not watched), or for stacked graphs arrays of [value, colour].
function graph(title, note, buckets, values, { colour = C.bar, top = null, fmt = n0, stacked = false } = {}) {
  const HGT = 64;
  const peak = top ?? Math.max(1e-9, ...values.map(v => (stacked ? sum((v ?? []).map(p => p[0])) : v ?? 0)));
  // Kept short: 240 bars a mail, and Gmail cuts a mail past 102 kB (the first try was 106 kB).
  const bar = (h, c) => `<div style="height:${h}px;background:${c};font-size:0">&nbsp;</div>`;
  const cells = buckets.map((b, i) => {
    const v = values[i];
    const tip = stacked ? '' : ` title="${b.hour}: ${v === null ? '–' : esc(fmt(v))}"`;
    let inner;
    if (v === null || (stacked && !v)) inner = bar(2, C.none);
    else if (stacked) inner = [...v].reverse().filter(p => p[0] > 0).map(([n, c]) => bar(Math.max(1, Math.round(n / peak * HGT)), c)).join('');
    else inner = bar(Math.max(v > 0 ? 2 : 1, Math.round(v / peak * HGT)), v > 0 ? colour : C.line);
    return `<td valign="bottom"${tip} style="padding:0 1px">${inner}</td>`;
  }).join('');
  // A label every 3 hours, each over 3 columns.
  const labels = buckets.filter((b, i) => i % 3 === 0).map(b => `<td colspan="3" style="font-size:10px;color:${C.muted};padding:0 1px">${b.hour}</td>`).join('');
  return `<tr><td style="padding:14px 16px 4px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
<td style="font:600 14px ${FONT};color:${C.ink}">${esc(title)}</td>
<td style="font:12px ${FONT};color:${C.muted};text-align:right">${note}</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed;margin-top:6px"><tr height="${HGT}" style="height:${HGT}px">${cells}</tr>
<tr><td colspan="24" style="height:1px;background:${C.line};font-size:0">&nbsp;</td></tr><tr>${labels}</tr></table>
</td></tr>`;
}
const key = (items) => items.map(([c, t]) => `<span style="display:inline-block;width:8px;height:8px;background:${c};border-radius:2px;margin:0 3px 0 8px"></span>${esc(t)}`).join('');

function tile(label, value, note, tone = null) {
  const colour = tone === 'bad' ? C.bad : tone === 'warn' ? C.warn : C.ink;
  return `<td width="50%" valign="top" style="padding:6px">
<div style="border:1px solid ${C.line};border-radius:10px;padding:10px 12px;background:${C.card}">
<div style="font:12px ${FONT};color:${C.muted}">${esc(label)}</div>
<div style="font:700 22px/1.2 ${FONT};color:${colour};margin-top:2px">${esc(value)}</div>
<div style="font:12px/1.35 ${FONT};color:${C.muted};margin-top:2px">${note}</div></div></td>`;
}
const section = (title, body) => `<tr><td style="padding:18px 16px 4px;font:700 16px ${FONT};color:${C.ink}">${esc(title)}</td></tr>${body}`;

// The problems mailed in the 24 hours, each with when it was over (its "OK again" mail), or still open.
function problemList(mails, openKeys) {
  const problems = mails.filter(m => m.kind === 'problem' || m.kind === 'offline');
  if (!problems.length && !openKeys.length) return `<tr><td style="padding:4px 16px;font:14px ${FONT};color:${C.good}">No problems.</td></tr>`;
  const li = problems.map(m => {
    const ok = m.kind === 'problem' ? mails.find(x => x.kind === 'ok' && x.key === m.key && x.t > m.t) : null;
    const how = m.kind === 'offline' ? '' : ok ? ` · over ${hm(ok.t)} (${Math.max(1, Math.round((ok.t - m.t) / 60000))} min)` : ' · <b>still open</b>';
    return `<li style="margin:3px 0"><b>${hm(m.t)}</b> ${esc(m.subject)}${how}</li>`;
  }).join('');
  const open = openKeys.length ? `<li style="margin:3px 0;color:${C.bad}">Still open now: ${esc(openKeys.join(', '))}</li>` : '';
  return `<tr><td style="padding:2px 16px;font:14px/1.4 ${FONT};color:${C.ink}"><ul style="margin:0;padding-left:18px">${li}${open}</ul></td></tr>`;
}

// The days before: the best line of each day in days.jsonl (most minutes; a restart writes a part line), with the
// fetcher's viewer counts where it has them.
function weekRows(days, viewers, today) {
  const best = new Map();
  for (const d of days ?? []) if (d?.day && d.day < today && (!best.has(d.day) || (d.minutes ?? 0) > (best.get(d.day).minutes ?? 0))) best.set(d.day, d);
  for (const v of viewers?.days ?? []) if (v.day < today) best.set(v.day, { ...(best.get(v.day) ?? { day: v.day }), viewers: v });
  return [...best.values()].sort((a, b) => (a.day < b.day ? -1 : 1)).slice(-7);
}
function weekTable(list) {
  if (!list.length) return `<tr><td style="padding:4px 16px;font:13px ${FONT};color:${C.muted}">No days kept yet.</td></tr>`;
  const vMax = Math.max(1, ...list.map(d => d.viewers?.people ?? 0)), tMax = Math.max(1, ...list.map(d => d.trainsMax ?? 0));
  const bar = (v, m, c) => (v === null || v === undefined ? '' : `<div style="height:4px;width:${Math.max(2, Math.round(v / m * 100))}%;background:${c};border-radius:2px;margin-top:2px"></div>`);
  // Narrow enough for a phone (390 px): headers may wrap, the units in the headers, the day short.
  const th = s => `<th align="right" style="font:600 11px ${FONT};color:${C.muted};padding:4px 3px;border-bottom:1px solid ${C.line}">${s}</th>`;
  const td = (s, extra = '') => `<td align="right" style="font:13px ${FONT};color:${C.ink};padding:5px 3px;border-bottom:1px solid ${C.line};white-space:nowrap${extra}">${s}</td>`;
  const mb = b => (b === null || b === undefined ? '–' : n0(b / 1e6));
  const short = day => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
  const body = list.map(d => `<tr>
<td style="font:13px ${FONT};color:${C.ink};padding:5px 3px;border-bottom:1px solid ${C.line};white-space:nowrap">${esc(short(d.day))}${d.partial ? ` <span style="color:${C.muted}">${Math.round((d.minutes ?? 0) / 60)}h</span>` : ''}</td>
${td(`${n0(d.viewers?.people)}${bar(d.viewers?.people, vMax, C.bar)}`)}
${td(`${n0(d.trainsMax)}${bar(d.trainsMax, tMax, C.barLight)}`)}
${td(mb(d.bytesIn))}${td(mb(d.bytesOut))}${td(d.memMax ? `${d.memMax}` : '–')}
${td(d.problems === undefined ? '–' : d.problems ? `<b style="color:${C.bad}">${d.problems}</b>` : '0')}</tr>`).join('');
  return `<tr><td style="padding:4px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
<tr><th align="left" style="font:600 11px ${FONT};color:${C.muted};padding:4px;border-bottom:1px solid ${C.line}">Day</th>${th('People')}${th('Trains')}${th('In MB')}${th('Out MB')}${th('Memory MB')}${th('Prob&shy;lems')}</tr>
${body}</table></td></tr>`;
}

// Everything: d is dayNumbers(rows) (monitor/rules.mjs), fine says all OK.
export function summaryHtml({ rows, mails, openKeys, ctx = {}, d, day, fine, problemsCount, watchedH }) {
  const end = rows.at(-1)?.t ?? Date.now();
  const buckets = hourBuckets(rows, end);
  const per = f => buckets.map(b => (b.rows.length ? f(b.rows) : null));
  const V = ctx.viewers ?? null;
  const today = dayOf(end);
  const vDay = V?.days?.find(x => x.day === dayOf(end - 12 * H)) ?? V?.days?.filter(x => x.day < today).at(-1) ?? null;
  const vToday = V?.days?.find(x => x.day === today) ?? null;
  const vHours = new Map((V?.hours ?? []).map(h => [h.t, h]));
  const viewersOn = Boolean(V && (V.days?.length || V.hours?.length));

  // Tiles.
  const upMin = rows.filter(r => r.up).length;
  const cpuAvg = rows.length ? Math.round(10 * sum(rows.map(r => r.cpuPct)) / rows.filter(r => r.cpuPct !== null && r.cpuPct !== undefined).length) / 10 : null;
  const tiles = [
    tile(`People ${vDay ? dayName(vDay.day) : 'yesterday'}`, viewersOn ? n0(vDay?.people ?? 0) : '–',
      viewersOn ? `app ${n0(vDay?.app ?? 0)} · site ${n0(vDay?.site ?? 0)}${vToday ? ` · today so far ${n0(vToday.people)}` : ''}` : 'counted from the next release'),
    tile('Most at once', viewersOn ? n0(vDay?.peak ?? 0) : '–', viewersOn && vDay?.peakAt ? `at ${hm(vDay.peakAt)}` : 'people in the same 5 minutes'),
    tile('Trains at once', n0(d.trainsMax), `most in the 24 hours`),
    tile('Data freshness', d.fileAgeMed === null ? '–' : `${d.fileAgeMed} s`, `the file viewers read, middle; worst ${secs(d.fileAgeMax)}${d.fileMissingMin ? `; none recent ${d.fileMissingMin} min` : ''}`, d.fileAgeMax > 60 ? 'warn' : null),
    tile('Fetcher running', d.upPct === null ? '–' : `${d.upPct} %`, `${d.restarts} restart(s)${d.offlineMin ? ` · internet out ${d.offlineMin} min` : ''}`, d.upPct !== null && d.upPct < 99 ? 'bad' : null),
    tile('Uploads to one.com', n0(d.upOk), `${d.upFailed} failed · ${d.reconnects} reconnects · ${MB(d.bytesOut)}${d.oneRefused ? ` · "too many requests" ${d.oneRefused}` : ''}`, d.upFailed ? 'warn' : null),
    tile('Trafikverket', `${(d.asks / Math.max(1, d.minutes)).toFixed(1)} /min`, `${n0(d.asks)} questions, most ${d.asksMax ?? '–'} in a minute · ${d.refused} refused · ${d.trvFailed} failed · ${d.streamsOpened} stream(s) opened · ${MB(d.bytesIn)}`, d.refused ? 'warn' : null),
    tile('Fetcher memory', d.memMax === null ? '–' : `${d.memMax} MB`, `most · CPU ${cpuAvg ?? '–'} % average, ${max(rows.map(r => r.cpuPct)) ?? '–'} % most`, d.memMax > 500 ? 'warn' : null),
  ];
  const tileRows = [];
  for (let i = 0; i < tiles.length; i += 2) tileRows.push(`<tr>${tiles[i]}${tiles[i + 1] ?? '<td></td>'}</tr>`);

  // Graphs.
  const status = per(rs => [[rs.filter(r => r.up && !r.offline).length, C.good], [rs.filter(r => r.offline).length, C.warn], [rs.filter(r => !r.up).length, C.bad]]);
  const statusAll = buckets.map((b, i) => (status[i] ? [...status[i], [60 - b.rows.length, C.none]] : [[60, C.none]]));
  const ageMed = per(rs => med(rs.map(r => r.one?.age))), ageMax = per(rs => max(rs.map(r => r.one?.age)));
  const ageStack = buckets.map((b, i) => (ageMax[i] === null ? null : [[ageMed[i] ?? 0, C.bar], [(ageMax[i] ?? 0) - (ageMed[i] ?? 0), C.barLight]]));
  const trains = per(rs => max(rs.map(r => r.trains)));
  const vPeak = buckets.map(b => (vHours.has(b.t) ? vHours.get(b.t).peak : viewersOn ? 0 : null));
  const vPeople = buckets.map(b => vHours.get(b.t)?.people ?? null);
  const inMB = per(rs => sum(rs.map(r => r.bytesIn))), outMB = per(rs => sum(rs.map(r => r.bytesOut)));
  const asks = per(rs => sum(rs.map(r => r.asks)));
  const mem = per(rs => max(rs.map(r => r.memMB))), cpu = per(rs => { const c = rs.map(r => r.cpuPct).filter(x => x !== null && x !== undefined); return c.length ? sum(c) / c.length : null; });
  const peakHour = (vals, fmt = n0) => { let i = -1; vals.forEach((v, j) => { if (v !== null && (i < 0 || v > vals[i])) i = j; }); return i < 0 ? '' : `most ${fmt(vals[i])} at ${buckets[i].hour}:00`; };

  const graphs = [
    viewersOn ? graph('People at once', peakHour(vPeak), buckets, vPeak) : '',
    viewersOn ? graph('People in the hour', `${n0(sum(vPeople))} visits of an hour`, buckets, vPeople, { colour: C.barLight }) : '',
    graph('Trains on the map', peakHour(trains), buckets, trains),
    graph('Running', key([[C.good, 'running'], [C.warn, 'internet out'], [C.bad, 'fetcher down'], [C.none, 'not watched']]), buckets, statusAll, { stacked: true, top: 60 }),
    graph('Age of the file viewers read', key([[C.bar, 'middle'], [C.barLight, 'worst']]), buckets, ageStack, { stacked: true }),
    graph('Questions to Trafikverket', peakHour(asks), buckets, asks),
    graph('Data from Trafikverket', `${MB(d.bytesIn)} in all`, buckets, inMB, { fmt: MB }),
    graph('Data to one.com', `${MB(d.bytesOut)} in all`, buckets, outMB, { fmt: MB }),
    graph('Fetcher memory', peakHour(mem, v => `${v} MB`), buckets, mem, { fmt: v => `${v} MB` }),
    graph('Fetcher CPU', peakHour(cpu, v => `${v.toFixed(1)} %`), buckets, cpu, { fmt: v => `${v.toFixed(1)} %` }),
  ].join('');

  const sizes = Object.entries(d.sizes ?? {}).map(([k, s]) => `<tr><td style="font:13px ${FONT};color:${C.ink};padding:3px 4px;border-bottom:1px solid ${C.line}">${esc(k)}</td><td align="right" style="font:13px ${FONT};color:${C.ink};padding:3px 4px;border-bottom:1px solid ${C.line}">${kB(s.med)}</td><td align="right" style="font:13px ${FONT};color:${C.muted};padding:3px 4px;border-bottom:1px solid ${C.line}">${kB(s.max)}</td></tr>`).join('');

  const head = fine
    ? `<span style="display:inline-block;background:${C.goodBg};color:${C.good};font:700 13px ${FONT};padding:3px 10px;border-radius:999px">All OK</span>`
    : `<span style="display:inline-block;background:${C.badBg};color:${C.bad};font:700 13px ${FONT};padding:3px 10px;border-radius:999px">${problemsCount} problem(s)${openKeys.length ? ', some still open' : ''}</span>`;
  const from = rows[0]?.t ?? end;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Spårat daily summary ${esc(day)}</title></head>
<body style="margin:0;padding:0;background:${C.page}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page}"><tr><td align="center" style="padding:12px 8px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:${C.card};color:${C.ink};border-radius:12px;border:1px solid ${C.line}">
<tr><td style="padding:16px 16px 4px">
<div style="font:700 20px ${FONT};color:${C.ink}">Spårat · ${esc(dayName(day))}</div>
<div style="margin-top:6px">${head}</div>
<div style="font:12px/1.5 ${FONT};color:${C.muted};margin-top:8px">${hm(from)} ${esc(dayName(dayOf(from)))} – ${hm(end)} ${esc(dayName(dayOf(end)))} · watched ${watchedH} h of 24${ctx.versionText ? ` · ${esc(ctx.versionText)}` : ''}</div>
</td></tr>
<tr><td style="padding:6px 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${tileRows.join('')}</table></td></tr>
${section('Problems', problemList(mails, openKeys))}
${section('The 24 hours, hour by hour', '')}
${graphs}
${section('The days before', weekTable(weekRows(ctx.days, V, today)))}
${section('File sizes (as viewers get them)', `<tr><td style="padding:4px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr><th align="left" style="font:600 11px ${FONT};color:${C.muted};padding:4px;border-bottom:1px solid ${C.line}">File</th><th align="right" style="font:600 11px ${FONT};color:${C.muted};padding:4px;border-bottom:1px solid ${C.line}">Middle</th><th align="right" style="font:600 11px ${FONT};color:${C.muted};padding:4px;border-bottom:1px solid ${C.line}">Largest</th></tr>${sizes}</table></td></tr>`)}
<tr><td style="padding:16px;font:11px/1.5 ${FONT};color:${C.muted};border-top:1px solid ${C.line}"><!--foot--></td></tr>
</table></td></tr></table></body></html>`;
}
