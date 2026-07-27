import { NextRequest, NextResponse } from "next/server";
import { requireIdentity, requirePermission, isResponse } from "@/lib/apiHelpers";
import { getCustomer } from "@/lib/customers";
import { withTenant } from "@/lib/db";
import { verifyAuditChain } from "@/lib/auditLog";

// Section 6 F-EVID: SLA Evidence Explorer. Drills into a bounded time
// window to show raw signals, classification, formula version, and
// linked audit events -- the default evidence package for Section 8.10
// disagreement investigations.
//
// Section 11.2 mandates every availability_minutes query be bounded on
// minute_timestamp for partition pruning -- this route only ever queries
// a single calendar day.

export async function GET(req: NextRequest) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "viewEvidence");
  if (forbidden) return forbidden;

  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId");
  const date = searchParams.get("date"); // YYYY-MM-DD

  if (!customerId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "customerId and date=YYYY-MM-DD are required" }, { status: 400 });
  }

  const customer = await getCustomer(identity.vendorId, customerId);
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  if (identity.role === "CSM" && customer.assignedCsmUserId !== identity.actor) {
    return NextResponse.json({ error: "Not assigned to this customer" }, { status: 403 });
  }

  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const month = date.slice(0, 7);

  const data = await withTenant(identity.vendorId, async (client) => {
    const { rows: minutes } = await client.query(
      `SELECT minute_timestamp, is_available, classification, route53_status, alb_5xx_pct,
              alb_total_requests, ecs_running_tasks, ecs_desired_tasks, ecs_health_status,
              is_maintenance_window, synthetic_failed, synthetic_response_time_ms
       FROM availability_minutes
       WHERE vendor_id = $1 AND customer_id = $2
         AND minute_timestamp >= $3 AND minute_timestamp < $4
       ORDER BY minute_timestamp ASC`,
      [identity.vendorId, customerId, dayStart.toISOString(), dayEnd.toISOString()]
    );

    const { rows: statusRow } = await client.query(
      `SELECT formula_version, status, uptime_pct FROM customer_sla_status
       WHERE vendor_id = $1 AND customer_id = $2 AND month = $3 AND is_active_for_display = true`,
      [identity.vendorId, customerId, month]
    );

    const { rows: auditEvents } = await client.query(
      `SELECT id, event_type, event_timestamp, actor, description, data_hash, previous_hash, metadata
       FROM sla_audit_log
       WHERE vendor_id = $1 AND customer_id = $2
       ORDER BY event_timestamp DESC
       LIMIT 50`,
      [identity.vendorId, customerId]
    );

    const chain = await verifyAuditChain(client, identity.vendorId, customerId);

    return { minutes, statusRow: statusRow[0] ?? null, auditEvents, chain };
  });

  const summary = { UP: 0, DEGRADED: 0, DOWNTIME: 0, MAINTENANCE: 0, UNKNOWN: 0 };
  for (const m of data.minutes) {
    summary[m.classification as keyof typeof summary]++;
  }

  return NextResponse.json({
    customer: { customerId: customer.customerId, customerName: customer.customerName },
    date,
    formulaVersion: data.statusRow?.formula_version ?? "v1",
    monthStatus: data.statusRow?.status ?? null,
    monthUptimePct: data.statusRow?.uptime_pct ?? null,
    minutes: data.minutes,
    summary,
    auditEvents: data.auditEvents,
    auditChainIntact: data.chain.intact,
  });
}
