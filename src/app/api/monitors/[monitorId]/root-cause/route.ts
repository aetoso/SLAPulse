import { NextRequest, NextResponse } from "next/server";
import { requireIdentity, isResponse } from "@/lib/apiHelpers";
import { checkMonitorRootCause } from "@/lib/awsRootCause";

// Side-effecting (a real, live AWS AssumeRole + describe calls each time)
// so this is a POST, not a cacheable GET.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ monitorId: string }> }) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const { monitorId } = await params;
  const snapshot = await checkMonitorRootCause(identity.vendorId, monitorId);
  return NextResponse.json({ snapshot });
}
