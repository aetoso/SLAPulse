import { NextRequest, NextResponse } from "next/server";
import { requireIdentity, isResponse } from "@/lib/apiHelpers";
import { getCustomer } from "@/lib/customers";
import { getOrRenderHtml, getOrRenderPdf } from "@/jobs/reportGenerator";

export async function GET(req: NextRequest) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId");
  const month = searchParams.get("month");
  const format = searchParams.get("format") === "pdf" ? "pdf" : "html";

  if (!customerId || !month) {
    return NextResponse.json({ error: "customerId and month are required" }, { status: 400 });
  }

  const customer = await getCustomer(identity.vendorId, customerId);
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  if (identity.role === "CSM" && customer.assignedCsmUserId !== identity.actor) {
    return NextResponse.json({ error: "Not assigned to this customer" }, { status: 403 });
  }

  if (format === "pdf") {
    const pdf = await getOrRenderPdf(identity.vendorId, customer, month, identity.actor);
    if (!pdf) {
      return NextResponse.json({ error: "No SLA status computed yet for this month" }, { status: 409 });
    }
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${customerId}-${month}-sla-report.pdf"`,
      },
    });
  }

  const html = await getOrRenderHtml(identity.vendorId, customer, month, identity.actor);
  if (!html) {
    return NextResponse.json({ error: "No SLA status computed yet for this month" }, { status: 409 });
  }
  return new NextResponse(html, { headers: { "Content-Type": "text/html" } });
}
