// The monitor's self-check (plan to beta step 2, 2026-11-17; Codex's review: "exercise both services"), like the
// fetcher's (fetcher/self-check.mjs): run once as yourself (outside) and once inside the real service (the file
// /etc/sparat/self-check present, then restart), and compare. Exit code 78: all as expected; 79: not.
// Inside, a device at home must be blocked; the fetcher's status, the one.com page and the mail server must work.
// (The monitor may reach 127.0.0.1, where its own page is opened, so that is not tried.)
import { connect } from 'node:net';
import { mailCheck } from './mail.mjs';

function tcp(hostPort) {
  const [host, port] = hostPort.split(/:(?=\d+$)/);
  return new Promise(res => {
    const s = connect({ host, port: Number(port) });
    const done = r => { clearTimeout(t); s.destroy(); res(r); };
    const t = setTimeout(() => done('no answer in 4 s'), 4000);
    s.on('connect', () => done('reachable'));
    s.on('error', e => done(e.code === 'EPERM' || e.code === 'EACCES' ? 'blocked by Linux' : e.code ?? e.message));
  });
}

export async function selfCheck(where, cfg, { args, readStatus, dataUrl }) {
  const arg = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
  const inside = where === 'inside', router = arg('--router', '192.168.50.1:80');
  const rows = [];
  const row = (what, got, ok) => { rows.push(ok); console.log(`self-check ${ok ? 'ok  ' : 'FAIL'} ${what}: ${got}`); };
  console.log(`monitor self-check (${inside ? 'inside the service: the device at home must be blocked' : 'outside, as yourself: all must work'})`);
  const r = await tcp(router);
  row(`a device at home (${router})`, r, inside ? r === 'blocked by Linux' : r === 'reachable');
  let st;
  try { const s = await readStatus(); st = `answers (process ${s.pid})`; } catch (e) { st = e.cause?.code ?? e.code ?? e.message; }
  row('the fetcher\'s status', st, st.startsWith('answers'));
  if (dataUrl) {
    let one;
    try { one = `answers (HTTP ${(await fetch(dataUrl, { method: 'HEAD', signal: AbortSignal.timeout(10000), redirect: 'error' })).status})`; } catch (e) { one = e.cause?.code ?? e.message; }
    row(`one.com (${dataUrl})`, one, one.startsWith('answers'));
  } else console.log('self-check      one.com: skipped (no MONITOR_DATA_URL readable here)');
  if (cfg.MAIL_HOST) {
    let mail;
    try { await mailCheck(cfg); mail = 'logged in (nothing sent)'; } catch (e) { mail = e.code ?? e.message; }
    row(`the mail server (${cfg.MAIL_HOST})`, mail, mail.startsWith('logged in'));
  } else console.log('self-check      mail: skipped (no mail settings readable here)');
  const ok = rows.every(Boolean);
  console.log(`self-check ${ok ? 'done: all as expected' : 'done: NOT as expected, see FAIL above'}`);
  return ok ? 78 : 79;
}
