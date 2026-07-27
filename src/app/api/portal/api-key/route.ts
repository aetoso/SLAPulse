import crypto from "crypto";
import { NextResponse } from "next/server";
import { requirePortalIdentity, isResponse } from "@/lib/portalApiHelpers";
import { withTenant } from "@/lib/db";

// PF10 Read-Only Customer API: lets a signed-in portal user mint a
// long-lived key for their own systems to pull SLA status without a
// human clicking a magic link each time.

export async function POST() {
  const identity = await requirePortalIdentity();
  if (isResponse(identity)) return identity;

  const apiKey = "tg_" + crypto.randomBytes(24).toString("hex");
  await withTenant(identity.vendorId, async (client) => {
    await client.query(
      `UPDATE portal_users SET api_key = $1 WHERE vendor_id = $2 AND customer_id = $3 AND email = $4`,
      [apiKey, identity.vendorId, identity.customerId, identity.email]
    );
  });

  return NextResponse.json({ apiKey });
}

export async function GET() {
  const identity = await requirePortalIdentity();
  if (isResponse(identity)) return identity;

  const apiKey = await withTenant(identity.vendorId, async (client) => {
    const { rows } = await client.query(
      `SELECT api_key FROM portal_users WHERE vendor_id = $1 AND customer_id = $2 AND email = $3`,
      [identity.vendorId, identity.customerId, identity.email]
    );
    return rows[0]?.api_key ?? null;
  });

  return NextResponse.json({ apiKey });
}
