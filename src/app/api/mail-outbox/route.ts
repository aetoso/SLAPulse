import { NextResponse } from "next/server";
import { requireIdentity, isResponse } from "@/lib/apiHelpers";
import { listOutbox } from "@/lib/reportStorage";

// LOCAL-DEV SUBSTITUTION for an SES sending log -- lets Admin/SRE see
// what would have been emailed to the vendor's enterprise customers.
export async function GET() {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const emails = await listOutbox(identity.vendorId);
  return NextResponse.json({ emails });
}
