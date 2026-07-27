import { NextResponse } from "next/server";
import { requirePortalIdentity, isResponse } from "@/lib/portalApiHelpers";
import { withTenant } from "@/lib/db";
import { verifyAnchors } from "@/lib/auditAnchor";

// PF4: exportable historical compliance record, using the same hash
// chain the Core Platform already generated -- the Portal never
// recomputes an SLA number, it only re-serves what customer_sla_status
// already holds.

export async function GET() {
  const identity = await requirePortalIdentity();
  if (isResponse(identity)) return identity;

  const [history, anchorStatus] = await Promise.all([
    withTenant(identity.vendorId, async (client) => {
      const { rows } = await client.query(
        `SELECT month, status, uptime_pct, contract_sla_pct, downtime_minutes, formula_version, created_at
         FROM customer_sla_status
         WHERE vendor_id = $1 AND customer_id = $2 AND is_active_for_display = true
         ORDER BY month ASC`,
        [identity.vendorId, identity.customerId]
      );
      return rows;
    }),
    verifyAnchors(identity.vendorId, identity.customerId),
  ]);

  const bundle = {
    exportedAt: new Date().toISOString(),
    customerId: identity.customerId,
    chainIntact: anchorStatus.chainIntact,
    anchorsMatchExternalLog: anchorStatus.anchorsMatchExternalLog,
    history,
  };

  return new NextResponse(JSON.stringify(bundle, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${identity.customerId}-compliance-history.json"`,
    },
  });
}
