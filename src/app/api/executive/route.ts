import { NextResponse } from "next/server";
import { requireIdentity, requirePermission, isResponse } from "@/lib/apiHelpers";
import { withTenant } from "@/lib/db";
import { currentMonthKey } from "@/jobs/slaCalculator";

// Section 6 F-EXEC: Executive SLA Portfolio Dashboard. Read-side
// aggregation only -- no new data collection. Auth-gated to EXECUTIVE
// (and ADMIN/SRE, who can see everything) per Section 14.5.

export async function GET() {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "viewExecutiveDashboard");
  if (forbidden) return forbidden;

  const month = currentMonthKey();

  const data = await withTenant(identity.vendorId, async (client) => {
    const { rows: current } = await client.query(
      `SELECT s.status, s.uptime_pct, s.projected_uptime, s.breach_predicted_date,
              c.customer_id, c.customer_name, c.contract_sla_pct
       FROM customer_sla_status s
       JOIN customers c ON c.vendor_id = s.vendor_id AND c.customer_id = s.customer_id
       WHERE s.vendor_id = $1 AND s.month = $2 AND s.is_active_for_display = true AND c.status = 'ACTIVE'`,
      [identity.vendorId, month]
    );

    const { rows: trend } = await client.query(
      `SELECT month,
              COUNT(*) FILTER (WHERE status = 'COMPLIANT') as compliant,
              COUNT(*) FILTER (WHERE status = 'AT_RISK') as at_risk,
              COUNT(*) FILTER (WHERE status = 'BREACHED') as breached,
              COUNT(*) FILTER (WHERE status = 'DATA_INCOMPLETE') as data_incomplete,
              AVG(uptime_pct) as avg_uptime_pct
       FROM customer_sla_status
       WHERE vendor_id = $1 AND is_active_for_display = true
         AND month >= to_char((CURRENT_DATE - INTERVAL '12 months'), 'YYYY-MM')
       GROUP BY month
       ORDER BY month ASC`,
      [identity.vendorId]
    );

    const { rows: recentCorrections } = await client.query(
      `SELECT event_type, description, event_timestamp, customer_id
       FROM sla_audit_log
       WHERE vendor_id = $1 AND event_type IN
         ('CORRECTION_RAISED','CORRECTION_APPROVED','DISAGREEMENT_IDENTIFIED','DISAGREEMENT_RESOLVED')
       ORDER BY event_timestamp DESC
       LIMIT 10`,
      [identity.vendorId]
    );

    return { current, trend, recentCorrections };
  });

  const counts = { COMPLIANT: 0, AT_RISK: 0, BREACHED: 0, DATA_INCOMPLETE: 0 };
  for (const row of data.current) {
    counts[row.status as keyof typeof counts] = (counts[row.status as keyof typeof counts] ?? 0) + 1;
  }
  const total = data.current.length;

  const topAtRisk = data.current
    .filter((r) => r.status === "AT_RISK" || r.status === "BREACHED")
    .sort((a, b) => (a.uptime_pct ?? 100) - (b.uptime_pct ?? 100))
    .slice(0, 5)
    .map((r) => ({
      customerId: r.customer_id,
      customerName: r.customer_name,
      status: r.status,
      uptimePct: r.uptime_pct,
      contractSlaPct: r.contract_sla_pct,
      breachPredictedDate: r.breach_predicted_date,
    }));

  return NextResponse.json({
    month,
    totalCustomers: total,
    counts,
    trend: data.trend,
    topAtRisk,
    recentCorrections: data.recentCorrections,
  });
}
