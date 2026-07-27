import { NextResponse } from "next/server";
import { getPortalIdentity, portalCookieName } from "@/lib/portalAuth";
import { withTenant } from "@/lib/db";

export async function GET() {
  const identity = await getPortalIdentity();
  if (!identity) return NextResponse.json({ identity: null });

  const customerName = await withTenant(identity.vendorId, async (client) => {
    const { rows } = await client.query(`SELECT customer_name FROM customers WHERE vendor_id = $1 AND customer_id = $2`, [
      identity.vendorId,
      identity.customerId,
    ]);
    return rows[0]?.customer_name ?? identity.customerId;
  });

  return NextResponse.json({ identity: { ...identity, customerName } });
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(portalCookieName());
  return res;
}
