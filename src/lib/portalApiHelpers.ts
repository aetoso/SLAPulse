import { NextResponse } from "next/server";
import { getPortalIdentity, type PortalIdentity } from "./portalAuth";

export async function requirePortalIdentity(): Promise<PortalIdentity | NextResponse> {
  const identity = await getPortalIdentity();
  if (!identity) {
    return NextResponse.json({ error: "Not signed in to the Trust Portal" }, { status: 401 });
  }
  return identity;
}

export function isResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse;
}
