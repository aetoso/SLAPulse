import { NextRequest, NextResponse } from "next/server";
import { requireIdentity, requirePermission, isResponse } from "@/lib/apiHelpers";
import { anchorAuditChain, verifyAnchors } from "@/lib/auditAnchor";

export async function POST(req: NextRequest) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "viewAuditLog");
  if (forbidden) return forbidden;

  const { customerId } = (await req.json()) as { customerId?: string };
  if (!customerId) return NextResponse.json({ error: "customerId is required" }, { status: 400 });

  const anchor = await anchorAuditChain(identity.vendorId, customerId, identity.actor);
  if (!anchor) return NextResponse.json({ error: "No audit events yet for this customer" }, { status: 409 });
  return NextResponse.json({ anchor });
}

export async function GET(req: NextRequest) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "viewAuditLog");
  if (forbidden) return forbidden;

  const customerId = new URL(req.url).searchParams.get("customerId");
  if (!customerId) return NextResponse.json({ error: "customerId is required" }, { status: 400 });

  const result = await verifyAnchors(identity.vendorId, customerId);
  return NextResponse.json(result);
}
