import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireIdentity, requirePermission, isResponse } from "@/lib/apiHelpers";
import { raiseCorrection, listCorrections } from "@/lib/corrections";

const RaiseSchema = z.object({
  customerId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  originalStatusId: z.string().uuid(),
  reason: z.string().min(1),
});

export async function GET() {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "viewAuditLog");
  if (forbidden) return forbidden;

  const corrections = await listCorrections(identity.vendorId);
  return NextResponse.json({ corrections });
}

export async function POST(req: NextRequest) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "triggerCorrections");
  if (forbidden) return forbidden;

  const parsed = RaiseSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const correction = await raiseCorrection(
    identity.vendorId,
    parsed.data.customerId,
    parsed.data.month,
    parsed.data.originalStatusId,
    parsed.data.reason,
    identity.actor
  );
  return NextResponse.json({ correction }, { status: 201 });
}
