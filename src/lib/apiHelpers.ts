import { NextResponse } from "next/server";
import { getIdentity, ROLE_PERMISSIONS, type Identity, type Role } from "./auth";

export async function requireIdentity(): Promise<Identity | NextResponse> {
  const identity = await getIdentity();
  if (!identity) {
    return NextResponse.json(
      { error: "Not signed in. Use the role switcher to pick a role first." },
      { status: 401 }
    );
  }
  return identity;
}

export function isResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse;
}

export function requirePermission(
  identity: Identity,
  permission: keyof (typeof ROLE_PERMISSIONS)[Role]
): NextResponse | null {
  if (!ROLE_PERMISSIONS[identity.role][permission]) {
    return NextResponse.json(
      { error: `Role ${identity.role} does not have permission: ${permission}` },
      { status: 403 }
    );
  }
  return null;
}
