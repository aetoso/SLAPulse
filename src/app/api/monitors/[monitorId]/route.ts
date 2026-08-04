import { NextRequest, NextResponse } from "next/server";
import { requireIdentity, isResponse } from "@/lib/apiHelpers";
import { getMonitor } from "@/lib/monitors";
import { withTenant } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ monitorId: string }> }) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const { monitorId } = await params;
  const monitor = await getMonitor(identity.vendorId, monitorId);
  if (!monitor) return NextResponse.json({ error: "Monitor not found" }, { status: 404 });

  const data = await withTenant(identity.vendorId, async (client) => {
    const [history, recentMinutes] = await Promise.all([
      client.query(
        `SELECT month, status, uptime_pct, downtime_minutes, data_completeness_pct, avg_response_time_ms, formula_version
         FROM monitor_sla_status WHERE vendor_id = $1 AND monitor_id = $2 AND is_active_for_display = true
         ORDER BY month DESC LIMIT 24`,
        [identity.vendorId, monitorId]
      ),
      client.query(
        `SELECT minute_timestamp, is_up, classification, regions_checked, regions_up, avg_response_time_ms
         FROM monitor_availability_minutes WHERE vendor_id = $1 AND monitor_id = $2
         ORDER BY minute_timestamp DESC LIMIT 180`,
        [identity.vendorId, monitorId]
      ),
    ]);
    return { history: history.rows, recentMinutes: recentMinutes.rows.reverse() };
  });

  return NextResponse.json({ monitor, ...data });
}
