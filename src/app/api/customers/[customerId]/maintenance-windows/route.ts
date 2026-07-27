import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireIdentity, requirePermission, isResponse } from "@/lib/apiHelpers";
import { getCustomer } from "@/lib/customers";
import { withTenant } from "@/lib/db";
import { appendAuditEvent } from "@/lib/auditLog";

// F8 Multi-Tier SLA Support: "ad hoc maintenance-window edits via
// self-service API." Section 11.2 schema comment requires application-
// layer JSON schema validation before write -- that's WindowSchema below.

const WindowSchema = z.object({ start: z.string().datetime(), end: z.string().datetime() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ customerId: string }> }) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "triggerCorrections");
  if (forbidden) return forbidden;

  const { customerId } = await params;
  const parsed = WindowSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  if (new Date(parsed.data.end) <= new Date(parsed.data.start)) {
    return NextResponse.json({ error: "end must be after start" }, { status: 400 });
  }

  const customer = await getCustomer(identity.vendorId, customerId);
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  const windows = await withTenant(identity.vendorId, async (client) => {
    const updated = [...customer.maintenanceWindows, parsed.data];
    await client.query(`UPDATE customers SET maintenance_windows = $1 WHERE vendor_id = $2 AND customer_id = $3`, [
      JSON.stringify(updated),
      identity.vendorId,
      customerId,
    ]);
    await appendAuditEvent(client, {
      vendorId: identity.vendorId,
      customerId,
      eventType: "SLA_STATUS_COMPUTED", // reuse: maintenance edits affect the next calc, no dedicated type needed
      actor: identity.actor,
      description: `Maintenance window added: ${parsed.data.start} - ${parsed.data.end}`,
      metadata: { action: "MAINTENANCE_WINDOW_ADDED", window: parsed.data },
    });
    return updated;
  });

  return NextResponse.json({ maintenanceWindows: windows });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ customerId: string }> }) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "triggerCorrections");
  if (forbidden) return forbidden;

  const { customerId } = await params;
  const { searchParams } = new URL(req.url);
  const index = Number(searchParams.get("index"));

  const customer = await getCustomer(identity.vendorId, customerId);
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  if (Number.isNaN(index) || index < 0 || index >= customer.maintenanceWindows.length) {
    return NextResponse.json({ error: "Invalid index" }, { status: 400 });
  }

  const windows = await withTenant(identity.vendorId, async (client) => {
    const updated = customer.maintenanceWindows.filter((_, i) => i !== index);
    await client.query(`UPDATE customers SET maintenance_windows = $1 WHERE vendor_id = $2 AND customer_id = $3`, [
      JSON.stringify(updated),
      identity.vendorId,
      customerId,
    ]);
    return updated;
  });

  return NextResponse.json({ maintenanceWindows: windows });
}
