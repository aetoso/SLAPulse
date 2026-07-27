import { NextResponse } from "next/server";
import { requireIdentity, isResponse } from "@/lib/apiHelpers";
import { withTenant } from "@/lib/db";

export async function GET() {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const memos = await withTenant(identity.vendorId, async (client) => {
    const { rows } = await client.query(
      `SELECT m.*, c.customer_name FROM sla_credit_memos m
       JOIN customers c ON c.vendor_id = m.vendor_id AND c.customer_id = m.customer_id
       WHERE m.vendor_id = $1
       ORDER BY m.created_at DESC`,
      [identity.vendorId]
    );
    return rows;
  });

  const scoped = identity.role === "CSM" ? [] : memos; // CSM has no write access to SLA data (Section 14.5)
  return NextResponse.json({ memos: scoped });
}
