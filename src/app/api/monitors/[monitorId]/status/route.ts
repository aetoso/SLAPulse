import { NextRequest, NextResponse } from "next/server";
import { requireIdentity, requirePermission, isResponse } from "@/lib/apiHelpers";
import { setMonitorStatus } from "@/lib/monitors";

export async function POST(req: NextRequest, { params }: { params: Promise<{ monitorId: string }> }) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "manageMonitors");
  if (forbidden) return forbidden;

  const { monitorId } = await params;
  const { status } = (await req.json()) as { status: "ACTIVE" | "PAUSED" };
  if (status !== "ACTIVE" && status !== "PAUSED") {
    return NextResponse.json({ error: "status must be ACTIVE or PAUSED" }, { status: 400 });
  }

  await setMonitorStatus(identity.vendorId, monitorId, status, identity.actor);
  return NextResponse.json({ ok: true });
}
