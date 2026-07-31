import { NextRequest, NextResponse } from "next/server";
import { withAdmin, withTenant } from "@/lib/db";

// Heartbeat/cron monitoring (dead-man's-switch): the monitored system
// (a cron job, a batch worker, anything with no public URL to poll)
// calls this URL itself on each successful run. If no ping arrives
// within expected_interval + grace, src/jobs/uptimeChecker.ts marks the
// monitor DOWNTIME on the next tick. Same SECURITY DEFINER token-lookup
// pattern as magic-link/API-key auth (the token IS the capability).
async function recordHeartbeat(token: string) {
  const owner = await withAdmin(async (client) => {
    const { rows } = await client.query(`SELECT * FROM find_monitor_by_heartbeat_token($1)`, [token]);
    return rows[0] ?? null;
  });
  if (!owner) return null;

  await withTenant(owner.vendor_id, async (client) => {
    await client.query(
      `UPDATE uptime_monitors SET last_heartbeat_at = NOW() WHERE vendor_id = $1 AND monitor_id = $2`,
      [owner.vendor_id, owner.monitor_id]
    );
  });
  return owner.monitor_id as string;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const monitorId = await recordHeartbeat(token);
  if (!monitorId) return NextResponse.json({ error: "Invalid heartbeat token" }, { status: 404 });
  return NextResponse.json({ ok: true, monitorId });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  return GET(req, { params });
}
