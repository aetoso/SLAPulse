import { NextResponse } from "next/server";
import { requireIdentity, requirePermission, isResponse } from "@/lib/apiHelpers";
import { withTenant } from "@/lib/db";

export async function GET() {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "viewAuditLog");
  if (forbidden) return forbidden;

  const disputes = await withTenant(identity.vendorId, async (client) => {
    const { rows } = await client.query(
      `SELECT d.*, c.customer_name FROM portal_disputes d
       JOIN customers c ON c.vendor_id = d.vendor_id AND c.customer_id = d.customer_id
       WHERE d.vendor_id = $1 ORDER BY d.created_at DESC`,
      [identity.vendorId]
    );
    return rows;
  });

  return NextResponse.json({ disputes });
}
