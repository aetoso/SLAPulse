import { NextRequest, NextResponse } from "next/server";
import { requireIdentity, requirePermission, isResponse } from "@/lib/apiHelpers";
import { withTenant } from "@/lib/db";
import { verifyAnchors } from "@/lib/auditAnchor";

// PF11 / F12 P2: Formal Audit/Dispute Export Package -- everything a
// verifier needs to independently check the hash chain and see the full
// correction/dispute trail for a customer, bundled as one downloadable
// JSON document.

export async function GET(req: NextRequest) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "viewAuditLog");
  if (forbidden) return forbidden;

  const customerId = new URL(req.url).searchParams.get("customerId");
  if (!customerId) return NextResponse.json({ error: "customerId is required" }, { status: 400 });

  const [bundle, anchorStatus] = await Promise.all([
    withTenant(identity.vendorId, async (client) => {
      const [auditLog, corrections, statusHistory, disputes, portalAuditLog] = await Promise.all([
        client.query(
          `SELECT event_type, event_timestamp, actor, description, data_hash, previous_hash, metadata
           FROM sla_audit_log WHERE vendor_id = $1 AND customer_id = $2 ORDER BY event_timestamp ASC`,
          [identity.vendorId, customerId]
        ),
        client.query(`SELECT * FROM sla_corrections WHERE vendor_id = $1 AND customer_id = $2 ORDER BY raised_at ASC`, [
          identity.vendorId,
          customerId,
        ]),
        client.query(
          `SELECT month, status, uptime_pct, is_active_for_display, created_at FROM customer_sla_status
           WHERE vendor_id = $1 AND customer_id = $2 ORDER BY month ASC, created_at ASC`,
          [identity.vendorId, customerId]
        ),
        client.query(`SELECT * FROM portal_disputes WHERE vendor_id = $1 AND customer_id = $2 ORDER BY created_at ASC`, [
          identity.vendorId,
          customerId,
        ]),
        client.query(
          `SELECT event_type, event_timestamp, actor, description, data_hash, previous_hash, metadata
           FROM portal_audit_log WHERE vendor_id = $1 AND customer_id = $2 ORDER BY event_timestamp ASC`,
          [identity.vendorId, customerId]
        ),
      ]);
      return {
        auditLog: auditLog.rows,
        corrections: corrections.rows,
        statusHistory: statusHistory.rows,
        disputes: disputes.rows,
        portalAuditLog: portalAuditLog.rows,
      };
    }),
    verifyAnchors(identity.vendorId, customerId),
  ]);

  const exportPackage = {
    exportedAt: new Date().toISOString(),
    exportedBy: identity.actor,
    vendorId: identity.vendorId,
    customerId,
    chainIntact: anchorStatus.chainIntact,
    anchorsMatchExternalLog: anchorStatus.anchorsMatchExternalLog,
    anchors: anchorStatus.anchors,
    ...bundle,
  };

  return new NextResponse(JSON.stringify(exportPackage, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${customerId}-audit-export.json"`,
    },
  });
}
