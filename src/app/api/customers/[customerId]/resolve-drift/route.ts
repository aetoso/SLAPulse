import { NextRequest, NextResponse } from "next/server";
import { requireIdentity, requirePermission, isResponse } from "@/lib/apiHelpers";
import { resolveDrift } from "@/jobs/driftChecker";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ customerId: string }> }) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "triggerCorrections");
  if (forbidden) return forbidden;

  const { customerId } = await params;
  await resolveDrift(identity.vendorId, customerId, identity.actor);
  return NextResponse.json({ ok: true });
}
