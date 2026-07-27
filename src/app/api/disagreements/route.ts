import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireIdentity, requirePermission, isResponse } from "@/lib/apiHelpers";
import { withTenant } from "@/lib/db";
import { appendAuditEvent } from "@/lib/auditLog";

// Section 8.10 SLA Calculation Disagreement Resolution Process, phases 1
// and 5 -- identification and resolution recorded as hash-chained audit
// events (the process itself is procedural; phases 2-4, evidence
// collection and root-cause classification, happen in the Evidence
// Explorer, not as separate database state).

const IdentifySchema = z.object({
  customerId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  description: z.string().min(1),
});

const ResolveSchema = z.object({
  customerId: z.string().min(1),
  classificationCategory: z.enum([
    "SIGNAL_GAP",
    "THRESHOLD_MISMATCH",
    "MAINTENANCE_DISPUTE",
    "APPLICATION_OUTAGE",
    "DATA_COMPLETENESS",
    "CALCULATION_ERROR",
  ]),
  rootCause: z.string().min(1),
  actionTaken: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "triggerCorrections");
  if (forbidden) return forbidden;

  const body = await req.json();
  const isResolve = "classificationCategory" in body;

  if (isResolve) {
    const parsed = ResolveSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    await withTenant(identity.vendorId, async (client) => {
      await appendAuditEvent(client, {
        vendorId: identity.vendorId,
        customerId: parsed.data.customerId,
        eventType: "DISAGREEMENT_RESOLVED",
        actor: identity.actor,
        description: `${parsed.data.classificationCategory}: ${parsed.data.rootCause}`,
        metadata: { classificationCategory: parsed.data.classificationCategory, actionTaken: parsed.data.actionTaken },
      });
    });
    return NextResponse.json({ ok: true });
  }

  const parsed = IdentifySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  await withTenant(identity.vendorId, async (client) => {
    await appendAuditEvent(client, {
      vendorId: identity.vendorId,
      customerId: parsed.data.customerId,
      eventType: "DISAGREEMENT_IDENTIFIED",
      actor: identity.actor,
      description: parsed.data.description,
      metadata: { month: parsed.data.month },
    });
  });
  return NextResponse.json({ ok: true });
}
