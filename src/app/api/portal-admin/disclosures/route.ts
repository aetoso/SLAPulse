import { NextRequest, NextResponse } from "next/server";
import { requireIdentity, requirePermission, isResponse } from "@/lib/apiHelpers";
import { withTenant } from "@/lib/db";
import { setForceHold, releaseForceHold } from "@/jobs/disclosureManager";

export async function GET() {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "viewAuditLog");
  if (forbidden) return forbidden;

  const disclosures = await withTenant(identity.vendorId, async (client) => {
    const { rows } = await client.query(
      `SELECT d.*, c.customer_name FROM portal_disclosure_status d
       JOIN customers c ON c.vendor_id = d.vendor_id AND c.customer_id = d.customer_id
       WHERE d.vendor_id = $1 ORDER BY d.detected_at DESC`,
      [identity.vendorId]
    );
    return rows;
  });
  return NextResponse.json({ disclosures });
}

export async function POST(req: NextRequest) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "triggerCorrections");
  if (forbidden) return forbidden;

  const { disclosureId, action, approvedBy } = (await req.json()) as {
    disclosureId?: string;
    action?: "force-hold" | "release";
    approvedBy?: string;
  };
  if (!disclosureId || !action) {
    return NextResponse.json({ error: "disclosureId and action are required" }, { status: 400 });
  }

  try {
    if (action === "force-hold") {
      if (!approvedBy) return NextResponse.json({ error: "approvedBy is required for force-hold" }, { status: 400 });
      await setForceHold(identity.vendorId, disclosureId, identity.actor, approvedBy);
    } else {
      await releaseForceHold(identity.vendorId, disclosureId, identity.actor);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
