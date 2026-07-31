import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireIdentity, requirePermission, isResponse } from "@/lib/apiHelpers";
import { addMaintenanceWindow, removeMaintenanceWindow } from "@/lib/monitors";

const WindowSchema = z.object({ start: z.string().datetime(), end: z.string().datetime() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ monitorId: string }> }) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "manageMonitors");
  if (forbidden) return forbidden;

  const parsed = WindowSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  if (new Date(parsed.data.end) <= new Date(parsed.data.start)) {
    return NextResponse.json({ error: "end must be after start" }, { status: 400 });
  }

  const { monitorId } = await params;
  const maintenanceWindows = await addMaintenanceWindow(identity.vendorId, monitorId, parsed.data);
  return NextResponse.json({ maintenanceWindows });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ monitorId: string }> }) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "manageMonitors");
  if (forbidden) return forbidden;

  const { monitorId } = await params;
  const index = Number(new URL(req.url).searchParams.get("index"));
  if (Number.isNaN(index)) return NextResponse.json({ error: "index is required" }, { status: 400 });

  const maintenanceWindows = await removeMaintenanceWindow(identity.vendorId, monitorId, index);
  return NextResponse.json({ maintenanceWindows });
}
