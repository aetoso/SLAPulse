import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/db";

// Public, unauthenticated status page data -- vendorId comes straight
// from the URL (not an unknown-until-resolved token like magic
// links/API keys), so this is a normal RLS-scoped withTenant() read, not
// a SECURITY DEFINER exception. This is literally what a prospect sees
// before they've signed up for anything (Section: two-product split,
// "how companies will see this before spending their dollar").
export async function GET(_req: NextRequest, { params }: { params: Promise<{ vendorId: string }> }) {
  const { vendorId } = await params;

  const data = await withTenant(vendorId, async (client) => {
    const { rows: config } = await client.query(`SELECT title, is_public FROM monitor_status_page_config WHERE vendor_id = $1`, [
      vendorId,
    ]);
    if (config.length > 0 && !config[0].is_public) return null;

    const { rows: monitors } = await client.query(
      `SELECT monitor_id, name, check_type FROM uptime_monitors
       WHERE vendor_id = $1 AND status = 'ACTIVE' AND show_on_status_page = true ORDER BY name`,
      [vendorId]
    );

    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
    const results = [];
    for (const m of monitors) {
      const { rows: latest } = await client.query(
        `SELECT is_up, classification, minute_timestamp FROM monitor_availability_minutes
         WHERE vendor_id = $1 AND monitor_id = $2 ORDER BY minute_timestamp DESC LIMIT 1`,
        [vendorId, m.monitor_id]
      );
      const { rows: agg } = await client.query(
        `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE classification = 'DOWNTIME') as downtime
         FROM monitor_availability_minutes WHERE vendor_id = $1 AND monitor_id = $2 AND minute_timestamp >= $3`,
        [vendorId, m.monitor_id, monthStart]
      );
      const total = Number(agg[0].total);
      const downtime = Number(agg[0].downtime);
      results.push({
        monitorId: m.monitor_id,
        name: m.name,
        checkType: m.check_type,
        currentlyUp: latest[0]?.is_up ?? null,
        classification: latest[0]?.classification ?? "UNKNOWN",
        uptimePctMtd: total > 0 ? Math.round(((total - downtime) / total) * 100_000) / 1000 : null,
      });
    }

    return { title: config[0]?.title ?? "Status", monitors: results };
  });

  if (data === null) return NextResponse.json({ error: "This status page is private" }, { status: 403 });
  return NextResponse.json(data);
}
