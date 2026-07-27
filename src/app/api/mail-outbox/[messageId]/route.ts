import { NextRequest, NextResponse } from "next/server";
import { requireIdentity, isResponse } from "@/lib/apiHelpers";
import { readOutboxEmailHtml } from "@/lib/reportStorage";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const { messageId } = await params;
  const html = await readOutboxEmailHtml(identity.vendorId, messageId);
  if (!html) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(html, { headers: { "Content-Type": "text/html" } });
}
