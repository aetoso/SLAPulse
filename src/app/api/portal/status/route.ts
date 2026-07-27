import { NextResponse } from "next/server";
import { requirePortalIdentity, isResponse } from "@/lib/portalApiHelpers";
import { withTenant } from "@/lib/db";

// PF3 Live SLA Status View (freshness sourced from the hourly intraday
// rollup, never the official record path) + PF4 Historical Compliance
// Record (12-24 month history, same hash the Core Platform already
// generated -- the Portal never recomputes).

export async function GET() {
  const identity = await requirePortalIdentity();
  if (isResponse(identity)) return identity;

  const data = await withTenant(identity.vendorId, async (client) => {
    const [intraday, history, config, customer] = await Promise.all([
      client.query(
        `SELECT uptime_pct_mtd, downtime_minutes_mtd, status, computed_at, source_data_complete
         FROM sla_intraday_status WHERE vendor_id = $1 AND customer_id = $2
         ORDER BY computed_at DESC LIMIT 1`,
        [identity.vendorId, identity.customerId]
      ),
      client.query(
        `SELECT month, status, uptime_pct, contract_sla_pct, downtime_minutes, formula_version
         FROM customer_sla_status
         WHERE vendor_id = $1 AND customer_id = $2 AND is_active_for_display = true
         ORDER BY month DESC LIMIT 24`,
        [identity.vendorId, identity.customerId]
      ),
      client.query(`SELECT * FROM portal_vendor_config WHERE vendor_id = $1`, [identity.vendorId]),
      client.query(`SELECT customer_name, renewal_date, contract_sla_pct FROM customers WHERE vendor_id = $1 AND customer_id = $2`, [
        identity.vendorId,
        identity.customerId,
      ]),
    ]);
    return {
      intraday: intraday.rows[0] ?? null,
      history: history.rows,
      config: config.rows[0] ?? null,
      customer: customer.rows[0] ?? null,
    };
  });

  return NextResponse.json(data);
}
