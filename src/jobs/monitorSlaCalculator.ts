import { withTenant } from "@/lib/db";
import { appendMonitorAuditEvent } from "@/lib/monitorAuditLog";
import type { Monitor } from "@/lib/monitors";

// Fail-closed monthly SLA calculation: never guess COMPLIANT/BREACHED on
// an incomplete data window. Completeness here assumes the default 60s
// check interval (one row per minute); a monitor
// configured with a longer interval will show lower completeness, which
// is the correct fail-closed behavior, not a bug -- v1 is scoped around
// the 60s default.

const COMPLETENESS_THRESHOLD_PCT = 98.0;

export type MonitorSlaStatus = "COMPLIANT" | "AT_RISK" | "BREACHED" | "DATA_INCOMPLETE";

export interface MonitorSlaResult {
  month: string;
  status: MonitorSlaStatus;
  uptimePct: number | null;
  completenessPct: number;
  totalMinutes: number;
  downtimeMinutes: number;
  avgResponseTimeMs: number | null;
}

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

export async function computeMonitorSlaStatus(
  vendorId: string,
  monitor: Monitor,
  month: string,
  actor: string,
  now: Date = new Date()
): Promise<MonitorSlaResult | null> {
  return withTenant(vendorId, async (client) => {
    const [year, monthNum] = month.split("-").map(Number);
    const monthIndex0 = monthNum - 1;
    const monthStart = new Date(Date.UTC(year, monthIndex0, 1));
    const monthEndExclusive = new Date(Date.UTC(year, monthIndex0 + 1, 1));
    const elapsedEnd = now < monthEndExclusive ? floorToMinute(now) : monthEndExclusive;

    const expectedMinutes = Math.max(0, Math.round((elapsedEnd.getTime() - monthStart.getTime()) / 60_000));
    if (expectedMinutes === 0) return null;

    const { rows } = await client.query<{
      cnt: string;
      downtime: string;
      avg_rt: string | null;
    }>(
      `SELECT COUNT(*) as cnt,
              COUNT(*) FILTER (WHERE classification = 'DOWNTIME') as downtime,
              AVG(avg_response_time_ms) as avg_rt
       FROM monitor_availability_minutes
       WHERE vendor_id = $1 AND monitor_id = $2
         AND minute_timestamp >= $3 AND minute_timestamp < $4`,
      [vendorId, monitor.monitorId, monthStart.toISOString(), elapsedEnd.toISOString()]
    );

    const actualRecordedMinutes = Number(rows[0].cnt);
    const downtimeMinutes = Number(rows[0].downtime);
    const avgResponseTimeMs = rows[0].avg_rt ? Math.round(Number(rows[0].avg_rt)) : null;
    const completenessPct = round2((actualRecordedMinutes / expectedMinutes) * 100);

    const uptimePct = expectedMinutes > 0 ? round5(((expectedMinutes - downtimeMinutes) / expectedMinutes) * 100) : 100;

    const fullMonthMinutes = daysInMonth(year, monthIndex0) * 1440;
    const projectedDowntime = expectedMinutes > 0 ? (downtimeMinutes / expectedMinutes) * fullMonthMinutes : 0;
    const projectedUptime = round5(((fullMonthMinutes - projectedDowntime) / fullMonthMinutes) * 100);

    let status: MonitorSlaStatus;
    if (completenessPct < COMPLETENESS_THRESHOLD_PCT) {
      status = "DATA_INCOMPLETE";
    } else if (uptimePct < monitor.contractSlaPct) {
      status = "BREACHED";
    } else if (projectedUptime < monitor.contractSlaPct) {
      status = "AT_RISK";
    } else {
      status = "COMPLIANT";
    }

    await client.query(
      `UPDATE monitor_sla_status SET is_active_for_display = false, updated_at = NOW()
       WHERE vendor_id = $1 AND monitor_id = $2 AND month = $3 AND is_active_for_display = true`,
      [vendorId, monitor.monitorId, month]
    );

    await client.query(
      `INSERT INTO monitor_sla_status
         (vendor_id, monitor_id, month, total_minutes, downtime_minutes, data_completeness_pct,
          uptime_pct, contract_sla_pct, avg_response_time_ms, status, formula_version, is_active_for_display)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'v1',true)`,
      [
        vendorId,
        monitor.monitorId,
        month,
        expectedMinutes,
        downtimeMinutes,
        completenessPct,
        status === "DATA_INCOMPLETE" ? null : uptimePct,
        monitor.contractSlaPct,
        avgResponseTimeMs,
        status,
      ]
    );

    await appendMonitorAuditEvent(client, {
      vendorId,
      monitorId: monitor.monitorId,
      eventType: status === "DATA_INCOMPLETE" ? "SLA_STATUS_DATA_INCOMPLETE" : "SLA_STATUS_COMPUTED",
      actor,
      description: `SLA status for ${month}: ${status}`,
      metadata: { status, uptimePct, completenessPct, downtimeMinutes, expectedMinutes },
    });

    return {
      month,
      status,
      uptimePct: status === "DATA_INCOMPLETE" ? null : uptimePct,
      completenessPct,
      totalMinutes: expectedMinutes,
      downtimeMinutes,
      avgResponseTimeMs,
    };
  });
}

function floorToMinute(d: Date): Date {
  const copy = new Date(d);
  copy.setUTCSeconds(0, 0);
  return copy;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round5(n: number): number {
  return Math.round(n * 100_000) / 100_000;
}

export function currentMonthKey(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
