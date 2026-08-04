import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireIdentity, requirePermission, isResponse } from "@/lib/apiHelpers";
import { getAwsConnection, saveAwsConnectionConfig, getPlatformAccountId } from "@/lib/awsConnection";

export async function GET() {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const [connection, platformAccountId] = await Promise.all([
    getAwsConnection(identity.vendorId),
    getPlatformAccountId(),
  ]);
  return NextResponse.json({ connection, platformAccountId });
}

const Schema = z.object({
  roleArn: z.string().min(20).max(500),
  region: z.string().min(1).max(20),
});

export async function POST(req: NextRequest) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "manageAwsConnection");
  if (forbidden) return forbidden;

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const connection = await saveAwsConnectionConfig(identity.vendorId, parsed.data);
  return NextResponse.json({ connection });
}
