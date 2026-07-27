import { NextRequest, NextResponse } from "next/server";
import { requireIdentity, requirePermission, isResponse } from "@/lib/apiHelpers";
import { issueCreditMemo } from "@/jobs/creditAutomation";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ memoId: string }> }) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "manageCustomers"); // ADMIN only -- legal-exposure action
  if (forbidden) return forbidden;

  const { memoId } = await params;
  await issueCreditMemo(identity.vendorId, memoId, identity.actor);
  return NextResponse.json({ ok: true });
}
