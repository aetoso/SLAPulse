import { NextRequest, NextResponse } from "next/server";
import { requireIdentity, requirePermission, isResponse } from "@/lib/apiHelpers";
import { approveCorrection } from "@/lib/corrections";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ correctionId: string }> }) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "triggerCorrections");
  if (forbidden) return forbidden;

  const { correctionId } = await params;
  try {
    const result = await approveCorrection(identity.vendorId, correctionId, identity.actor);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to approve correction";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
