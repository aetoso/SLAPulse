import { NextRequest, NextResponse } from "next/server";
import { requireIdentity, isResponse } from "@/lib/apiHelpers";
import { withTenant } from "@/lib/db";

interface Incident {
  start: string;
  end: string;
  minutes: number;
  regionsUpAtWorst: number;
}

// Computed, not stored -- groups contiguous DOWNTIME minutes into
// incident windows, same gaps-and-islands approach as the downtime log
// in src/jobs/reportGenerator.ts (Product 2's report downtime table).
export async function GET(req: NextRequest, { params }: { params: Promise<{ monitorId: string }> }) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const { monitorId } = await params;
  const days = Number(new URL(req.url).searchParams.get("days") ?? "30");
  const since = new Date(Date.now() - days * 86_400_000);

  const incidents = await withTenant(identity.vendorId, async (client) => {
    const { rows } = await client.query<{ minute_timestamp: string; regions_up: number }>(
      `SELECT minute_timestamp, regions_up FROM monitor_availability_minutes
       WHERE vendor_id = $1 AND monitor_id = $2 AND classification = 'DOWNTIME' AND minute_timestamp >= $3
       ORDER BY minute_timestamp ASC`,
      [identity.vendorId, monitorId, since.toISOString()]
    );

    const result: Incident[] = [];
    let current: { start: Date; end: Date; count: number; minRegionsUp: number } | null = null;

    for (const row of rows) {
      const t = new Date(row.minute_timestamp);
      if (current && t.getTime() - current.end.getTime() === 60_000) {
        current.end = t;
        current.count++;
        current.minRegionsUp = Math.min(current.minRegionsUp, row.regions_up);
      } else {
        if (current) {
          result.push({
            start: current.start.toISOString(),
            end: new Date(current.end.getTime() + 60_000).toISOString(),
            minutes: current.count,
            regionsUpAtWorst: current.minRegionsUp,
          });
        }
        current = { start: t, end: t, count: 1, minRegionsUp: row.regions_up };
      }
    }
    if (current) {
      result.push({
        start: current.start.toISOString(),
        end: new Date(current.end.getTime() + 60_000).toISOString(),
        minutes: current.count,
        regionsUpAtWorst: current.minRegionsUp,
      });
    }
    return result.reverse();
  });

  return NextResponse.json({ incidents });
}
