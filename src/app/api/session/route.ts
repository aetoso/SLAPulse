import { NextRequest, NextResponse } from "next/server";
import { getIdentity, identityCookieName, type Role } from "@/lib/auth";

// LOCAL-DEV SUBSTITUTION for Cognito/Clerk OIDC/SSO (Section 14.1, 17).
// Sets a cookie carrying {vendorId, actor, role} instead of issuing a
// real RS256 JWT. Every other route reads identity via getIdentity() and
// never trusts vendor_id from the request body (Section 14.3).

const VALID_ROLES: Role[] = ["ADMIN", "SRE", "CSM", "EXECUTIVE"];

export async function GET() {
  const identity = await getIdentity();
  return NextResponse.json({ identity });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { actor, role } = body as { actor?: string; role?: string };

  if (!actor || typeof actor !== "string") {
    return NextResponse.json({ error: "actor is required" }, { status: 400 });
  }
  if (!role || !VALID_ROLES.includes(role as Role)) {
    return NextResponse.json({ error: `role must be one of ${VALID_ROLES.join(", ")}` }, { status: 400 });
  }

  const vendorId = process.env.LOCAL_DEV_VENDOR_ID;
  if (!vendorId) {
    return NextResponse.json({ error: "LOCAL_DEV_VENDOR_ID is not configured" }, { status: 500 });
  }

  const res = NextResponse.json({ identity: { vendorId, actor, role } });
  res.cookies.set(identityCookieName(), JSON.stringify({ vendorId, actor, role }), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(identityCookieName());
  return res;
}
