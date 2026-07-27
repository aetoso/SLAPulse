import { NextRequest, NextResponse } from "next/server";
import { requireIdentity, isResponse } from "@/lib/apiHelpers";
import { withTenant } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ customerId: string }> }) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const { customerId } = await params;
  const log = await withTenant(identity.vendorId, async (client) => {
    const { rows } = await client.query(
      `SELECT simulated_role_arn, assumed_at FROM cross_account_role_assumptions
       WHERE vendor_id = $1 AND customer_id = $2 ORDER BY assumed_at DESC LIMIT 20`,
      [identity.vendorId, customerId]
    );
    return rows;
  });

  return NextResponse.json({ log });
}
