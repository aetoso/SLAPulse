import { NextResponse } from "next/server";
import { requirePortalIdentity, isResponse } from "@/lib/portalApiHelpers";
import { withTenant } from "@/lib/db";

// PF8 Multi-Environment Rollup: if the same portal email has been
// granted access to more than one customer_id under this vendor (e.g. a
// procurement contact overseeing several business units), show an
// aggregate view across all of them instead of just the one in the
// session cookie. Vendor_id is already known from the portal session, so
// this stays inside the normal RLS-scoped withTenant() path -- unlike
// magic-link/API-key lookup, there's no cross-tenant unknown here.

export async function GET() {
  const identity = await requirePortalIdentity();
  if (isResponse(identity)) return identity;

  const rollup = await withTenant(identity.vendorId, async (client) => {
    const { rows: envRows } = await client.query(
      `SELECT DISTINCT customer_id FROM portal_users WHERE vendor_id = $1 AND email = $2`,
      [identity.vendorId, identity.email]
    );
    const environments = envRows.map((r) => r.customer_id as string);
    if (environments.length <= 1) return [];

    const results = [];
    for (const customerId of environments) {
      const { rows } = await client.query(
        `SELECT c.customer_name, s.status, s.uptime_pct_mtd
         FROM sla_intraday_status s
         JOIN customers c ON c.vendor_id = s.vendor_id AND c.customer_id = s.customer_id
         WHERE s.vendor_id = $1 AND s.customer_id = $2
         ORDER BY s.computed_at DESC LIMIT 1`,
        [identity.vendorId, customerId]
      );
      results.push({ customerId, ...rows[0] });
    }
    return results;
  });

  return NextResponse.json({ environments: rollup });
}
