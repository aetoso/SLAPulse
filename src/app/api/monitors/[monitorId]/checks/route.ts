import { NextRequest, NextResponse } from "next/server";
import { requireIdentity, isResponse } from "@/lib/apiHelpers";
import { withTenant } from "@/lib/db";

// Latest raw per-region probe result -- backs the "live status by region"
// panel (Section: 2-of-3 quorum transparency, not just the aggregate).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ monitorId: string }> }) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const { monitorId } = await params;

  const regions = await withTenant(identity.vendorId, async (client) => {
    const { rows } = await client.query(
      `SELECT DISTINCT ON (region) region, check_timestamp, is_up, response_time_ms, status_code, error_message
       FROM uptime_check_results
       WHERE vendor_id = $1 AND monitor_id = $2
       ORDER BY region, check_timestamp DESC`,
      [identity.vendorId, monitorId]
    );
    return rows;
  });

  return NextResponse.json({ regions });
}
