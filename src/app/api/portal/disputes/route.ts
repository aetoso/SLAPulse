import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePortalIdentity, isResponse } from "@/lib/portalApiHelpers";
import { withTenant } from "@/lib/db";
import { appendPortalAuditEvent } from "@/lib/portalAuditLog";

// PF7 Dispute Flagging Workflow: customer-raised, routed to CSM/Ops,
// tracked to resolution (src/app/api/portal-admin/disputes handles the
// Ops side).

const Schema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), description: z.string().min(1) });

export async function POST(req: NextRequest) {
  const identity = await requirePortalIdentity();
  if (isResponse(identity)) return identity;

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const dispute = await withTenant(identity.vendorId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO portal_disputes (vendor_id, customer_id, raised_by_email, month, description, status)
       VALUES ($1,$2,$3,$4,$5,'OPEN') RETURNING *`,
      [identity.vendorId, identity.customerId, identity.email, parsed.data.month, parsed.data.description]
    );
    await client.query(
      `INSERT INTO notifications (vendor_id, customer_id, channel, severity, message)
       VALUES ($1,$2,'SLACK','MEDIUM',$3)`,
      [
        identity.vendorId,
        identity.customerId,
        `Portal dispute raised by ${identity.email} for ${parsed.data.month}: ${parsed.data.description}`,
      ]
    );
    await appendPortalAuditEvent(client, {
      vendorId: identity.vendorId,
      customerId: identity.customerId,
      eventType: "DISPUTE_RAISED",
      actor: identity.email,
      description: parsed.data.description,
      metadata: { month: parsed.data.month },
    });
    return rows[0];
  });

  return NextResponse.json({ dispute }, { status: 201 });
}
