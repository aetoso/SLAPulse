import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireIdentity, requirePermission, isResponse } from "@/lib/apiHelpers";
import { listCustomers, registerCustomer } from "@/lib/customers";

// Section 6 F1: Customer Environment Registry. Section 8.1: vendor_id is
// injected from the caller's identity, never accepted from the payload.

const RegisterSchema = z.object({
  customerId: z.string().min(1).max(100),
  customerName: z.string().min(1).max(255),
  contractSlaPct: z.number().gt(0).lte(100),
  contractStartDate: z.string(),
  renewalDate: z.string().optional().nullable(),
  slaTier: z.string().optional(),
  contractualNotificationHours: z.number().int().positive().optional().nullable(),
  region: z.string().min(1),
  assignedCsmUserId: z.string().optional().nullable(),
  demoProfile: z.enum(["stable", "flaky", "degrading", "breached", "data_gap", "app_outage"]).optional(),
  monthlyFeeUsd: z.number().positive().optional().nullable(),
  deploymentModel: z.enum(["MODEL_A", "MODEL_B"]).optional(),
  syntheticMonitoringEnabled: z.boolean().optional(),
});

export async function GET() {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  let customers = await listCustomers(identity.vendorId, { activeOnly: false });
  if (identity.role === "CSM") {
    customers = customers.filter((c) => c.assignedCsmUserId === identity.actor);
  }
  return NextResponse.json({ customers });
}

export async function POST(req: NextRequest) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "manageCustomers");
  if (forbidden) return forbidden;

  const parsed = RegisterSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const customer = await registerCustomer(identity.vendorId, identity.actor, parsed.data);
    return NextResponse.json({ customer }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to register customer";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
