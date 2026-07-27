import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireIdentity, requirePermission, isResponse } from "@/lib/apiHelpers";
import { getCustomer } from "@/lib/customers";
import { attributeIncident, listIncidentAttributions } from "@/lib/incidents";

const AttributeSchema = z.object({
  customerId: z.string().min(1),
  incidentId: z.string().min(1),
  incidentSource: z.enum(["PAGERDUTY", "OPSGENIE", "MANUAL"]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  downtimeStart: z.string(),
  downtimeEnd: z.string(),
});

export async function GET(req: NextRequest) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const customerId = new URL(req.url).searchParams.get("customerId");
  if (!customerId) return NextResponse.json({ error: "customerId is required" }, { status: 400 });

  const customer = await getCustomer(identity.vendorId, customerId);
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  if (identity.role === "CSM" && customer.assignedCsmUserId !== identity.actor) {
    return NextResponse.json({ error: "Not assigned to this customer" }, { status: 403 });
  }

  const incidents = await listIncidentAttributions(identity.vendorId, customerId);
  return NextResponse.json({ incidents });
}

export async function POST(req: NextRequest) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "triggerCorrections");
  if (forbidden) return forbidden;

  const parsed = AttributeSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const customer = await getCustomer(identity.vendorId, parsed.data.customerId);
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  const incident = await attributeIncident(identity.vendorId, parsed.data.customerId, parsed.data, identity.actor);
  return NextResponse.json({ incident }, { status: 201 });
}
