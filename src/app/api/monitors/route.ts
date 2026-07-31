import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireIdentity, requirePermission, isResponse } from "@/lib/apiHelpers";
import { listMonitors, createMonitor } from "@/lib/monitors";
import { withTenant } from "@/lib/db";
import { currentMonthKey } from "@/jobs/monitorSlaCalculator";

// Product 1: independent uptime monitoring. No AWS access required --
// this is the zero-friction entry point (Section: two-product split).

const CreateSchema = z.object({
  monitorId: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  targetUrl: z.string().min(1),
  checkType: z.enum(["HTTPS", "TCP", "PING", "KEYWORD", "HEARTBEAT"]),
  port: z.number().int().positive().optional().nullable(),
  intervalSeconds: z.number().int().min(30).max(3600).optional(),
  contractSlaPct: z.number().gt(0).lte(100),
  linkedCustomerId: z.string().optional().nullable(),
  regions: z.array(z.enum(["us-east-1", "eu-west-1", "ap-southeast-1"])).min(1).optional(),
  keyword: z.string().max(255).optional().nullable(),
  keywordMode: z.enum(["PRESENT", "ABSENT"]).optional().nullable(),
  sslCheckEnabled: z.boolean().optional(),
  sslExpiryWarningDays: z.number().int().positive().max(90).optional(),
  confirmationMinutes: z.number().int().min(1).max(10).optional(),
  webhookUrl: z.string().url().optional().nullable().or(z.literal("")),
  heartbeatExpectedIntervalSeconds: z.number().int().positive().optional().nullable(),
  heartbeatGraceSeconds: z.number().int().nonnegative().optional().nullable(),
  showOnStatusPage: z.boolean().optional(),
});

export async function GET() {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const monitors = await listMonitors(identity.vendorId, { activeOnly: false });
  const month = currentMonthKey();

  const withStatus = await withTenant(identity.vendorId, async (client) => {
    const { rows: statusRows } = await client.query(
      `SELECT * FROM monitor_sla_status WHERE vendor_id = $1 AND month = $2 AND is_active_for_display = true`,
      [identity.vendorId, month]
    );
    const { rows: latestMinute } = await client.query(
      `SELECT DISTINCT ON (monitor_id) monitor_id, is_up, classification, minute_timestamp, avg_response_time_ms
       FROM monitor_availability_minutes WHERE vendor_id = $1 ORDER BY monitor_id, minute_timestamp DESC`,
      [identity.vendorId]
    );
    const statusByMonitor = new Map(statusRows.map((r) => [r.monitor_id, r]));
    const latestByMonitor = new Map(latestMinute.map((r) => [r.monitor_id, r]));

    return monitors.map((m) => {
      const status = statusByMonitor.get(m.monitorId);
      const latest = latestByMonitor.get(m.monitorId);
      return {
        ...m,
        uptimePct: status?.uptime_pct != null ? Number(status.uptime_pct) : null,
        slaStatus: status?.status ?? "DATA_INCOMPLETE",
        currentlyUp: latest?.is_up ?? null,
        lastCheckedAt: latest?.minute_timestamp ?? null,
        avgResponseTimeMs: latest?.avg_response_time_ms ?? null,
      };
    });
  });

  return NextResponse.json({ month, monitors: withStatus });
}

export async function POST(req: NextRequest) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "manageMonitors");
  if (forbidden) return forbidden;

  const parsed = CreateSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const monitor = await createMonitor(identity.vendorId, identity.actor, {
      ...parsed.data,
      webhookUrl: parsed.data.webhookUrl || null,
    });
    return NextResponse.json({ monitor }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create monitor";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
