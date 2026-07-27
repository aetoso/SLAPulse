import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireIdentity, requirePermission, isResponse } from "@/lib/apiHelpers";
import { withTenant } from "@/lib/db";

// PF6 Vendor Admin Console: branding + disclosure rule configuration.

export async function GET() {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const config = await withTenant(identity.vendorId, async (client) => {
    const { rows } = await client.query(`SELECT * FROM portal_vendor_config WHERE vendor_id = $1`, [identity.vendorId]);
    return rows[0] ?? null;
  });
  return NextResponse.json({ config });
}

const ConfigSchema = z.object({
  logoUrl: z.string().url().optional().nullable(),
  primaryColor: z.string().min(1).optional(),
  footerText: z.string().optional().nullable(),
  hideSlapulseBranding: z.boolean().optional(),
  disclosureDelayHours: z.number().int().positive().optional(),
  attestations: z.array(z.object({ name: z.string(), date: z.string(), url: z.string().optional() })).optional(),
});

export async function PUT(req: NextRequest) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "manageCustomers"); // ADMIN only
  if (forbidden) return forbidden;

  const parsed = ConfigSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const config = await withTenant(identity.vendorId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO portal_vendor_config
         (vendor_id, logo_url, primary_color, footer_text, hide_slapulse_branding, disclosure_delay_hours, attestations, updated_at)
       VALUES ($1,$2,COALESCE($3,'#0f172a'),$4,COALESCE($5,false),COALESCE($6,24),COALESCE($7::jsonb,'[]'::jsonb),NOW())
       ON CONFLICT (vendor_id) DO UPDATE SET
         logo_url = COALESCE($2, portal_vendor_config.logo_url),
         primary_color = COALESCE($3, portal_vendor_config.primary_color),
         footer_text = COALESCE($4, portal_vendor_config.footer_text),
         hide_slapulse_branding = COALESCE($5, portal_vendor_config.hide_slapulse_branding),
         disclosure_delay_hours = COALESCE($6, portal_vendor_config.disclosure_delay_hours),
         attestations = COALESCE($7::jsonb, portal_vendor_config.attestations),
         updated_at = NOW()
       RETURNING *`,
      [
        identity.vendorId,
        parsed.data.logoUrl ?? null,
        parsed.data.primaryColor ?? null,
        parsed.data.footerText ?? null,
        parsed.data.hideSlapulseBranding ?? null,
        parsed.data.disclosureDelayHours ?? null,
        parsed.data.attestations ? JSON.stringify(parsed.data.attestations) : null,
      ]
    );
    return rows[0];
  });

  return NextResponse.json({ config });
}
