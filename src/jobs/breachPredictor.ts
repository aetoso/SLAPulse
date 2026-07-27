import type { PoolClient } from "pg";
import { withTenant } from "@/lib/db";
import { appendAuditEvent } from "@/lib/auditLog";
import type { Customer } from "@/lib/customers";
import type { SlaCalculationResult } from "./slaCalculator";

// Section 8.4 Breach Prediction & Early Warning. Linear extrapolation,
// explicitly labeled conservative per Section 6 (F3) -- do not fully
// trust this until real incident history exists to calibrate against.
//
// LOCAL-DEV SUBSTITUTION: Section 13.4 requires Slack + PagerDuty for
// real alerting. Locally there is no Slack/PagerDuty account to hit, so
// alerts are written to the `notifications` table and rendered in the
// dashboard instead -- same content, different delivery channel.

export interface BreachPrediction {
  customerId: string;
  daysUntilBreach: number | null;
  dailyBurnMinutes: number;
  remainingBudgetMinutes: number;
}

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

export async function predictBreach(
  vendorId: string,
  customer: Customer,
  slaResult: SlaCalculationResult,
  actor: string,
  now: Date = new Date()
): Promise<BreachPrediction | null> {
  if (slaResult.status !== "AT_RISK" && slaResult.status !== "BREACHED") return null;

  return withTenant(vendorId, async (client: PoolClient) => {
    const [year, monthNum] = slaResult.month.split("-").map(Number);
    const fullMonthMinutes = daysInMonth(year, monthNum - 1) * 1440;
    const allowedDowntimeMinutes = fullMonthMinutes * (1 - customer.contractSlaPct / 100);
    const remainingBudgetMinutes = allowedDowntimeMinutes - slaResult.downtimeMinutes;

    const dayOfMonth = Math.max(1, now.getUTCDate());
    const dailyBurnMinutes = slaResult.downtimeMinutes / dayOfMonth;

    let daysUntilBreach: number | null = null;
    if (dailyBurnMinutes > 0) {
      daysUntilBreach = Math.max(0, Math.round((remainingBudgetMinutes / dailyBurnMinutes) * 10) / 10);
    }

    const severity = slaResult.status === "BREACHED" ? "CRITICAL" : "HIGH";
    const message =
      slaResult.status === "BREACHED"
        ? `${customer.customerName} has already BREACHED its ${customer.contractSlaPct}% SLA for ${slaResult.month} (uptime ${slaResult.uptimePct ?? "n/a"}%).`
        : `${customer.customerName} is AT_RISK of breaching its ${customer.contractSlaPct}% SLA. Linear model (conservative estimate): ~${daysUntilBreach ?? "?"} days until breach at current burn rate.`;

    await client.query(
      `INSERT INTO notifications (vendor_id, customer_id, channel, severity, message)
       VALUES ($1,$2,'SLACK',$3,$4)`,
      [vendorId, customer.customerId, severity, message]
    );

    if (daysUntilBreach !== null) {
      const predictedDate = new Date(now.getTime() + daysUntilBreach * 86_400_000);
      await client.query(
        `UPDATE customer_sla_status SET breach_predicted_date = $1
         WHERE vendor_id = $2 AND customer_id = $3 AND month = $4 AND is_active_for_display = true`,
        [predictedDate.toISOString().slice(0, 10), vendorId, customer.customerId, slaResult.month]
      );
    }

    await appendAuditEvent(client, {
      vendorId,
      customerId: customer.customerId,
      eventType: "BREACH_PREDICTED",
      actor,
      description: message,
      metadata: { daysUntilBreach, dailyBurnMinutes, remainingBudgetMinutes, status: slaResult.status },
    });

    return {
      customerId: customer.customerId,
      daysUntilBreach,
      dailyBurnMinutes,
      remainingBudgetMinutes,
    };
  });
}
