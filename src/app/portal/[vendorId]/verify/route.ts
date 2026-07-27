import { NextRequest, NextResponse } from "next/server";
import { verifyMagicLink, setPortalSession } from "@/lib/portalAuth";

// Route Handler, not a page: Next.js only allows cookies() mutation
// inside a Server Action or Route Handler, not a plain Server Component
// render -- this used to be page.tsx and threw "Cookies can only be
// modified in a Server Action or Route Handler" at runtime.
export async function GET(req: NextRequest, { params }: { params: Promise<{ vendorId: string }> }) {
  const { vendorId } = await params;
  const token = new URL(req.url).searchParams.get("token");

  if (!token) {
    return NextResponse.redirect(new URL(`/portal/${vendorId}/login?error=missing_token`, req.url));
  }

  const identity = await verifyMagicLink(token);
  if (!identity) {
    return NextResponse.redirect(new URL(`/portal/${vendorId}/login?error=invalid_or_expired`, req.url));
  }

  await setPortalSession(identity);
  return NextResponse.redirect(new URL(`/portal/${vendorId}/dashboard`, req.url));
}
