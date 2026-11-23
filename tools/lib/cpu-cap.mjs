// The tests leave this PC usable (Max, 2026-11-23: "The tests run the CPU at 100%. Make a rule to limit to at least
// 90% so I can at least browse in the meantime"):
// - capSelf(): this process, and everything it starts from now on (the checks' tools, their test browsers, fetchers),
//   at most CAP_PERCENT of the PC's CPU together, at below-normal priority (a Windows job object; tools/lib/cpu-cap.ps1).
//   Called by tools/check.mjs at its start and by launch() in tools/lib/browser.mjs (a tool run by itself); once per
//   process tree (SPARAT_CPU_CAPPED is handed down). Not on Linux or a Mac (nothing done there).
// - oneCheckAtATime(): tools/check.mjs waits while another check runs on this PC (any folder, any session), so two
//   checks never share the PC (each would be capped alone).
// SPARAT_CPU_CAP=100 lifts the cap (the priority stays below normal).
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CAP_PERCENT = Math.max(10, Math.min(100, Number(process.env.SPARAT_CPU_CAP) || 90));
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'cpu-cap.ps1');

export function capSelf() {
  if (process.platform !== 'win32' || process.env.SPARAT_CPU_CAPPED) return;
  process.env.SPARAT_CPU_CAPPED = '1';   // (its children: already in the job)
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT,
    '-Pids', String(process.pid), '-Percent', String(CAP_PERCENT), '-Name', `SparatCheck-${process.pid}`], { encoding: 'utf8', timeout: 30000 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  if (!/^capped /m.test(out)) console.log(`note the CPU cap could not be set (${out.split('\n')[0] || r.error?.message || 'no answer'}): this run may fill the CPU`);
}

const LOCK = join(tmpdir(), 'sparat-check.lock');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// Waits (a line every minute) until no other check runs, then holds the PC's check lock until this process ends.
export async function oneCheckAtATime() {
  let said = 0;
  for (;;) {
    let other = null;
    try { other = JSON.parse(readFileSync(LOCK, 'utf8')); } catch { other = null; }
    if (!other || other.pid === process.pid || !alive(other.pid)) break;
    if (Date.now() - said > 60000) {
      console.log(`waiting: another check runs on this PC (process ${other.pid}, in ${other.cwd}, since ${new Date(other.at).toTimeString().slice(0, 5)})`);
      said = Date.now();
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  writeFileSync(LOCK, JSON.stringify({ pid: process.pid, cwd: process.cwd(), at: Date.now() }));
  const free = () => {
    try { if (JSON.parse(readFileSync(LOCK, 'utf8')).pid === process.pid) unlinkSync(LOCK); } catch { /* gone already */ }
  };
  process.on('exit', free);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, () => { free(); process.exit(130); });
}
