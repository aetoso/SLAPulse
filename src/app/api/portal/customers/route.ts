import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/db";

// Public (unauthenticated) endpoint backing the Portal login page's
// "which company are you" picker. Local-dev simplification -- a real
// deployment would route each customer to a distinct login link/
// subdomain rather than asking them to pick from a list (Section 7 PF1
// custom domain per vendor is the real mechanism this stands in for).
// Only id/name are exposed, nothing sensitive.

export async function GET(req: NextRequest) {
  const vendorId = new URL(req.url).searchParams.get("vendorId");
  if (!vendorId) return NextResponse.json({ error: "vendorId is required" }, { status: 400 });

  const customers = await withTenant(vendorId, async (client) => {
    const { rows } = await client.query(
      `SELECT customer_id, customer_name FROM customers WHERE vendor_id = $1 AND status = 'ACTIVE' ORDER BY customer_name`,
      [vendorId]
    );
    return rows;
  });

  return NextResponse.json({ customers });
}
