import { NextResponse } from "next/server";
import { requireIdentity, requirePermission, isResponse } from "@/lib/apiHelpers";
import { getAwsConnection, testAwsConnection, recordTestResult } from "@/lib/awsConnection";

export async function POST() {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "manageAwsConnection");
  if (forbidden) return forbidden;

  const connection = await getAwsConnection(identity.vendorId);
  if (!connection.roleArn || !connection.region) {
    return NextResponse.json({ error: "Enter a role ARN and region before testing." }, { status: 400 });
  }

  const result = await testAwsConnection(connection.roleArn, connection.externalId, connection.region);
  const updated = await recordTestResult(identity.vendorId, result);

  return NextResponse.json({ connection: updated, ...result });
}
