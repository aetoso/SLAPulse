import type { PoolClient } from "pg";
import { withTenant } from "@/lib/db";
import { appendAuditEvent } from "@/lib/auditLog";
import type { Customer } from "@/lib/customers";

// Section 8.3 Daily SLA Status Calculation (Fail-Closed) + Section 9.4.
//
// The official customer_sla_status record is NEVER computed on an
// incomplete data window: below 98% completeness the status is
// DATA_INCOMPLETE, not a guess at COMPLIANT/BREACHED. This is the fail-
// closed guarantee the spec calls out repeatedly (Sections 5.2, 9.4, 11.2).

const COMPLETENESS_THRESHOLD_PCT = 98.0;

export type SlaStatus = "COMPLIANT" | "AT_RISK" | "BREACHED" | "DATA_INCOMPLETE";

export interface SlaCalculationResult {
  month: string;
  status: SlaStatus;
  uptimePct: number | null;
  projectedUptime: number | null;
  completenessPct: number;
  totalMinutes: number;
  downtimeMinutes: number;
  maintenanceMinutes: number;
}

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

export async function computeSlaStatus(
  vendorId: string,
  customer: Customer,
  month: string, // "YYYY-MM"
  actor: string,
  now: Date = new Date()
): Promise<SlaCalculationResult | null> {
  return withTenant(vendorId, async (client: PoolClient) => {
    const [year, monthNum] = month.split("-").map(Number);
    const monthIndex0 = monthNum - 1;
    const monthStart = new Date(Date.UTC(year, monthIndex0, 1));
    const monthEndExclusive = new Date(Date.UTC(year, monthIndex0 + 1, 1));
    const elapsedEnd = now < monthEndExclusive ? floorToMinute(now) : monthEndExclusive;

    const expectedMinutes = Math.max(0, Math.round((elapsedEnd.getTime() - monthStart.getTime()) / 60_000));
    if (expectedMinutes === 0) return null;

    const { rows } = await client.query<{ classification: string; cnt: string }>(
      `SELECT classification, COUNT(*) as cnt
       FROM availability_minutes
       WHERE vendor_id = $1 AND customer_id = $2
         AND minute_timestamp >= $3 AND minute_timestamp < $4
       GROUP BY classification`,
      [vendorId, customer.customerId, monthStart.toISOString(), elapsedEnd.toISOString()]
    );

    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.classification] = Number(r.cnt);
    const unknownMinutes = counts["UNKNOWN"] ?? 0;
    const downtimeMinutes = counts["DOWNTIME"] ?? 0;
    const maintenanceMinutes = counts["MAINTENANCE"] ?? 0;

    const actualRecordedMinutes = expectedMinutes - unknownMinutes;
    const completenessPct = round2((actualRecordedMinutes / expectedMinutes) * 100);

    const totalMinutes = Math.max(0, expectedMinutes - maintenanceMinutes);
    const uptimePct = totalMinutes > 0 ? round5(((totalMinutes - downtimeMinutes) / totalMinutes) * 100) : 100;

    const fullMonthMinutes = daysInMonth(year, monthIndex0) * 1440;
    const projectedDowntime = totalMinutes > 0 ? (downtimeMinutes / totalMinutes) * fullMonthMinutes : 0;
    const projectedUptime = round5(((fullMonthMinutes - projectedDowntime) / fullMonthMinutes) * 100);

    let status: SlaStatus;
    if (completenessPct < COMPLETENESS_THRESHOLD_PCT) {
      status = "DATA_INCOMPLETE";
    } else if (uptimePct < customer.contractSlaPct) {
      status = "BREACHED";
    } else if (projectedUptime < customer.contractSlaPct) {
      status = "AT_RISK";
    } else {
      status = "COMPLIANT";
    }

    // Append-only: deactivate the previously-active row for this month
    // (if any) before inserting the new one. Both remain in the trail --
    // Section 8.3/8.7 never edits a published row in place.
    await client.query(
      `UPDATE customer_sla_status SET is_active_for_display = false, updated_at = NOW()
       WHERE vendor_id = $1 AND customer_id = $2 AND month = $3 AND is_active_for_display = true`,
      [vendorId, customer.customerId, month]
    );

    await client.query(
      `INSERT INTO customer_sla_status
         (vendor_id, customer_id, month, total_minutes, downtime_minutes, maintenance_minutes,
          data_completeness_pct, uptime_pct, contract_sla_pct, projected_uptime, status,
          formula_version, is_active_for_display)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'v1',true)`,
      [
        vendorId,
        customer.customerId,
        month,
        totalMinutes,
        downtimeMinutes,
        maintenanceMinutes,
        completenessPct,
        status === "DATA_INCOMPLETE" ? null : uptimePct,
        customer.contractSlaPct,
        status === "DATA_INCOMPLETE" ? null : projectedUptime,
        status,
      ]
    );

    await appendAuditEvent(client, {
      vendorId,
      customerId: customer.customerId,
      eventType: status === "DATA_INCOMPLETE" ? "SLA_STATUS_DATA_INCOMPLETE" : "SLA_STATUS_COMPUTED",
      actor,
      description: `SLA status for ${month}: ${status}`,
      metadata: { status, uptimePct, projectedUptime, completenessPct, downtimeMinutes, totalMinutes },
    });

    // Non-official freshness rollup (Section 11.2 sla_intraday_status).
    await client.query(
      `INSERT INTO sla_intraday_status
         (vendor_id, customer_id, uptime_pct_mtd, downtime_minutes_mtd, status, source_data_complete)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        vendorId,
        customer.customerId,
        uptimePct,
        downtimeMinutes,
        status,
        completenessPct >= COMPLETENESS_THRESHOLD_PCT,
      ]
    );

    return {
      month,
      status,
      uptimePct: status === "DATA_INCOMPLETE" ? null : uptimePct,
      projectedUptime: status === "DATA_INCOMPLETE" ? null : projectedUptime,
      completenessPct,
      totalMinutes,
      downtimeMinutes,
      maintenanceMinutes,
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
