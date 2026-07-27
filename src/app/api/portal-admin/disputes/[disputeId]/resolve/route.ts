import { NextRequest, NextResponse } from "next/server";
import { requireIdentity, requirePermission, isResponse } from "@/lib/apiHelpers";
import { withTenant } from "@/lib/db";
import { appendPortalAuditEvent } from "@/lib/portalAuditLog";

export async function POST(req: NextRequest, { params }: { params: Promise<{ disputeId: string }> }) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "triggerCorrections");
  if (forbidden) return forbidden;

  const { disputeId } = await params;
  const { action } = (await req.json()) as { action: "route" | "resolve" };
  const newStatus = action === "route" ? "ROUTED" : "RESOLVED";

  await withTenant(identity.vendorId, async (client) => {
    const { rows } = await client.query(
      `UPDATE portal_disputes SET status = $1, resolved_at = CASE WHEN $1 = 'RESOLVED' THEN NOW() ELSE resolved_at END
       WHERE vendor_id = $2 AND id = $3 RETURNING customer_id, month`,
      [newStatus, identity.vendorId, disputeId]
    );
    if (rows.length === 0) return;
    await appendPortalAuditEvent(client, {
      vendorId: identity.vendorId,
      customerId: rows[0].customer_id,
      eventType: action === "route" ? "DISPUTE_ROUTED" : "DISPUTE_RESOLVED",
      actor: identity.actor,
      description: `Dispute for ${rows[0].month} marked ${newStatus}`,
      metadata: { disputeId },
    });
  });

  return NextResponse.json({ ok: true });
}
