import { NextResponse } from "next/server";
import { requireIdentity, isResponse } from "@/lib/apiHelpers";
import { listCustomers } from "@/lib/customers";
import { withTenant } from "@/lib/db";
import { currentMonthKey } from "@/jobs/slaCalculator";

// Section 6 F5: Internal SLA Dashboard. Table view: uptime %, threshold,
// status, risk. Role-scoped per Section 14.5 (CSM sees assigned only).

export async function GET() {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  let customers = await listCustomers(identity.vendorId, { activeOnly: true });
  if (identity.role === "CSM") {
    customers = customers.filter((c) => c.assignedCsmUserId === identity.actor);
  }

  const month = currentMonthKey();

  const rows = await withTenant(identity.vendorId, async (client) => {
    const { rows: statusRows } = await client.query(
      `SELECT * FROM customer_sla_status
       WHERE vendor_id = $1 AND month = $2 AND is_active_for_display = true`,
      [identity.vendorId, month]
    );
    const { rows: freshnessRows } = await client.query(
      `SELECT DISTINCT ON (customer_id) customer_id, computed_at, uptime_pct_mtd, status as intraday_status
       FROM sla_intraday_status
       WHERE vendor_id = $1
       ORDER BY customer_id, computed_at DESC`,
      [identity.vendorId]
    );
    return { statusRows, freshnessRows };
  });

  const statusByCustomer = new Map(rows.statusRows.map((r) => [r.customer_id, r]));
  const freshnessByCustomer = new Map(rows.freshnessRows.map((r) => [r.customer_id, r]));

  const dashboard = customers.map((c) => {
    const status = statusByCustomer.get(c.customerId);
    const freshness = freshnessByCustomer.get(c.customerId);
    return {
      customerId: c.customerId,
      customerName: c.customerName,
      contractSlaPct: c.contractSlaPct,
      status: status?.status ?? "DATA_INCOMPLETE",
      uptimePct: status?.uptime_pct ?? null,
      projectedUptime: status?.projected_uptime ?? null,
      breachPredictedDate: status?.breach_predicted_date ?? null,
      dataCompletenessPct: status?.data_completeness_pct ?? null,
      lastCollectedAt: freshness?.computed_at ?? null,
      assignedCsmUserId: c.assignedCsmUserId,
    };
  });

  return NextResponse.json({ month, customers: dashboard });
}
