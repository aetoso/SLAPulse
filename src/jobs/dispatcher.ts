import { listActiveVendorIds } from "@/lib/vendors";
import { runUptimeCheckTick, type UptimeCheckSummary } from "./uptimeChecker";
import { computeMonitorSlaStatus, currentMonthKey as monitorMonthKey } from "./monitorSlaCalculator";
import { listMonitors } from "@/lib/monitors";

// Product 1 (the only product): independent external uptime checks +
// monthly SLA rollup, run on their own cadence (checks default to every
// 60s; the calculator can run less often since a monitor's status only
// meaningfully changes minute to minute, not check to check). Invoked
// in-process by src/worker.ts (cron) or via /api/jobs/run (manual).

export async function runMonitorCheckTick(actor: string, now: Date = new Date()): Promise<UptimeCheckSummary> {
  return runUptimeCheckTick(actor, now);
}

export interface MonitorCalculationSummary {
  monitorsProcessed: number;
}

export async function runMonitorCalculationTick(actor: string, now: Date = new Date()): Promise<MonitorCalculationSummary> {
  const vendorIds = await listActiveVendorIds();
  const month = monitorMonthKey(now);
  let monitorsProcessed = 0;

  for (const vendorId of vendorIds) {
    const monitors = await listMonitors(vendorId, { activeOnly: true });
    for (const monitor of monitors) {
      await computeMonitorSlaStatus(vendorId, monitor, month, actor, now);
      monitorsProcessed++;
    }
  }

  return { monitorsProcessed };
}
