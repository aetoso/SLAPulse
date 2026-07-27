import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requestMagicLink } from "@/lib/portalAuth";

const Schema = z.object({
  vendorId: z.string().min(1),
  customerId: z.string().min(1),
  email: z.string().email(),
});

export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const origin = new URL(req.url).origin;
  const { link, expiresAt } = await requestMagicLink(
    parsed.data.vendorId,
    parsed.data.customerId,
    parsed.data.email,
    origin
  );

  // LOCAL-DEV ONLY: a real deployment would never return the link in the
  // API response -- it would only go out via the email itself. Returned
  // here so the local demo doesn't require reading the mock outbox file.
  return NextResponse.json({ link, expiresAt });
}
