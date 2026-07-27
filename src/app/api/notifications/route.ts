import { NextResponse } from "next/server";
import { requireIdentity, isResponse } from "@/lib/apiHelpers";
import { withTenant } from "@/lib/db";

// LOCAL-DEV SUBSTITUTION for Slack/PagerDuty (Section 13.4). Every alert
// the jobs would have posted externally is written here instead.

export async function GET() {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const notifications = await withTenant(identity.vendorId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, customer_id, channel, severity, message, created_at
       FROM notifications
       WHERE vendor_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [identity.vendorId]
    );
    return rows;
  });

  return NextResponse.json({ notifications });
}
