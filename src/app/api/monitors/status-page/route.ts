import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireIdentity, requirePermission, isResponse } from "@/lib/apiHelpers";
import { withTenant } from "@/lib/db";

export async function GET() {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const config = await withTenant(identity.vendorId, async (client) => {
    const { rows } = await client.query(`SELECT * FROM monitor_status_page_config WHERE vendor_id = $1`, [identity.vendorId]);
    return rows[0] ?? { title: "Status", is_public: true };
  });

  return NextResponse.json({ config });
}

const Schema = z.object({ title: z.string().min(1).max(255), isPublic: z.boolean() });

export async function PUT(req: NextRequest) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "manageMonitors");
  if (forbidden) return forbidden;

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const config = await withTenant(identity.vendorId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO monitor_status_page_config (vendor_id, title, is_public, updated_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (vendor_id) DO UPDATE SET title = $2, is_public = $3, updated_at = NOW()
       RETURNING *`,
      [identity.vendorId, parsed.data.title, parsed.data.isPublic]
    );
    return rows[0];
  });

  return NextResponse.json({ config });
}
