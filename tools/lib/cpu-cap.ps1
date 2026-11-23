# Holds the tests to at most -Percent of this PC's CPU, below normal priority, so the PC stays usable while they run
# (Max, 2026-11-23: "The tests run the CPU at 100%. Make a rule to limit to at least 90% so I can at least browse").
# The processes named are put into a Windows job object ("Local\<Name>"): a hard cap on the CPU time of the whole job
# (all its processes together) and the below-normal priority class. A process started later by one in the job (a
# check's tools, their browsers, fetchers) is in the job by itself. The job lives while any process is in it; the next
# call finds it by its name. One job per check (tools/lib/cpu-cap.mjs names it by the check's process): Windows puts a
# process only into a job that can sit inside the one it is already in, and each session's commands run in a job of
# their own, so one job for every session's processes was refused (error 5, 2026-11-23). Only one check runs at a time
# (tools/check.mjs waits for another), so together they stay under the cap too.
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/lib/cpu-cap.ps1 -Pids 123,456 [-Percent 90] [-Name X]
# Prints one line per process: "capped <pid>" or "not capped <pid>: <why>". tools/lib/cpu-cap.mjs calls it.
param([string]$Pids, [int]$Percent = 90, [string]$Name = "SparatTests")
# (one string "123,456": -File hands a list over as one word)
$ids = [int[]]($Pids -split '[,\s]+' | Where-Object { $_ -ne '' })

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SparatJob {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr attrs, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int cls, ref Cpu info, uint len);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int cls, ref Basic info, uint len);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct Cpu { public uint ControlFlags; public uint CpuRate; }
  [StructLayout(LayoutKind.Sequential)] public struct Basic {
    public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit;
    public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass;
  }
  public static string[] Cap(int[] pids, int percent, string name) {
    IntPtr job = CreateJobObject(IntPtr.Zero, "Local\\" + name);   // (the job of that name when there is one)
    if (job == IntPtr.Zero) return new[] { "no job: error " + Marshal.GetLastWin32Error() };
    // JOB_OBJECT_CPU_RATE_CONTROL_ENABLE | _HARD_CAP; the rate in 1/100 % of all the PC's processors
    Cpu cpu = new Cpu { ControlFlags = 0x1 | 0x4, CpuRate = (uint)(percent * 100) };
    bool cpuOk = SetInformationJobObject(job, 15, ref cpu, (uint)Marshal.SizeOf(typeof(Cpu)));
    // JOB_OBJECT_LIMIT_PRIORITY_CLASS: BELOW_NORMAL_PRIORITY_CLASS
    Basic basic = new Basic { LimitFlags = 0x20, PriorityClass = 0x4000 };
    bool prioOk = SetInformationJobObject(job, 2, ref basic, (uint)Marshal.SizeOf(typeof(Basic)));
    var lines = new System.Collections.Generic.List<string>();
    if (!cpuOk || !prioOk) lines.Add("job limits: cpu " + cpuOk + ", priority " + prioOk + " (error " + Marshal.GetLastWin32Error() + ")");
    foreach (int pid in pids) {
      IntPtr p = OpenProcess(0x0100 | 0x0001, false, pid);   // PROCESS_SET_QUOTA | PROCESS_TERMINATE
      if (p == IntPtr.Zero) { lines.Add("not capped " + pid + ": cannot open (error " + Marshal.GetLastWin32Error() + ")"); continue; }
      bool ok = AssignProcessToJobObject(job, p);
      lines.Add(ok ? "capped " + pid : "not capped " + pid + ": error " + Marshal.GetLastWin32Error());
      CloseHandle(p);
    }
    CloseHandle(job);   // (the job stays while processes are in it)
    return lines.ToArray();
  }
}
'@
[SparatJob]::Cap($ids, $Percent, $Name) | ForEach-Object { $_ }
