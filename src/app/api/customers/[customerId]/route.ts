import { NextRequest, NextResponse } from "next/server";
import { requireIdentity, isResponse } from "@/lib/apiHelpers";
import { getCustomer } from "@/lib/customers";
import { withTenant } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ customerId: string }> }
) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const { customerId } = await params;
  const customer = await getCustomer(identity.vendorId, customerId);
  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }
  if (identity.role === "CSM" && customer.assignedCsmUserId !== identity.actor) {
    return NextResponse.json({ error: "Not assigned to this customer" }, { status: 403 });
  }

  const statusHistory = await withTenant(identity.vendorId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM customer_sla_status
       WHERE vendor_id = $1 AND customer_id = $2
       ORDER BY month DESC, created_at DESC
       LIMIT 24`,
      [identity.vendorId, customerId]
    );
    return rows;
  });

  return NextResponse.json({ customer, statusHistory });
}
