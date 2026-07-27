import { NextResponse } from "next/server";
import { requireIdentity, requirePermission, isResponse } from "@/lib/apiHelpers";
import { withTenant } from "@/lib/db";

export async function GET() {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "viewAuditLog");
  if (forbidden) return forbidden;

  const events = await withTenant(identity.vendorId, async (client) => {
    const { rows } = await client.query(
      `SELECT p.*, c.customer_name FROM portal_audit_log p
       JOIN customers c ON c.vendor_id = p.vendor_id AND c.customer_id = p.customer_id
       WHERE p.vendor_id = $1 ORDER BY p.event_timestamp DESC LIMIT 100`,
      [identity.vendorId]
    );
    return rows;
  });

  return NextResponse.json({ events });
}
