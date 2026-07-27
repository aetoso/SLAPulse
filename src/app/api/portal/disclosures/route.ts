import { NextResponse } from "next/server";
import { requirePortalIdentity, isResponse } from "@/lib/portalApiHelpers";
import { withTenant } from "@/lib/db";

// PF5 Incident/Downtime Detail (Disclosure-Controlled). Only rows the
// disclosure-delay algorithm (Section 8.8) has marked portal_visible are
// ever returned here -- the Portal has no path to see a held-back
// incident, by construction (the query itself filters, not just the UI).

export async function GET() {
  const identity = await requirePortalIdentity();
  if (isResponse(identity)) return identity;

  const disclosures = await withTenant(identity.vendorId, async (client) => {
    const { rows } = await client.query(
      `SELECT incident_started_at, incident_summary, detected_at
       FROM portal_disclosure_status
       WHERE vendor_id = $1 AND customer_id = $2 AND portal_visible = true
       ORDER BY incident_started_at DESC`,
      [identity.vendorId, identity.customerId]
    );
    return rows;
  });

  return NextResponse.json({ disclosures });
}
