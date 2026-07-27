import { NextRequest, NextResponse } from "next/server";
import { requireIdentity, requirePermission, isResponse } from "@/lib/apiHelpers";
import { getCustomer } from "@/lib/customers";
import { generateMonthlyReport } from "@/jobs/reportGenerator";

export async function POST(req: NextRequest) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "triggerCorrections"); // SRE/ADMIN gate, reused
  if (forbidden) return forbidden;

  const { customerId, month, send } = (await req.json()) as {
    customerId?: string;
    month?: string;
    send?: boolean;
  };
  if (!customerId || !month) {
    return NextResponse.json({ error: "customerId and month are required" }, { status: 400 });
  }

  const customer = await getCustomer(identity.vendorId, customerId);
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  const result = await generateMonthlyReport(identity.vendorId, customer, month, identity.actor, {
    send: send ?? true,
  });
  if (!result) {
    return NextResponse.json(
      { error: `No SLA status computed yet for ${month} -- run SLA calculation first` },
      { status: 409 }
    );
  }
  return NextResponse.json(result);
}
