import { NextRequest, NextResponse } from "next/server";
import { withAdmin, withTenant } from "@/lib/db";

// PF10 Read-Only Customer API: `GET /api/public/v1/sla?apiKey=...`.
// Unauthenticated except for the API key itself -- same
// SECURITY DEFINER pattern as the magic-link token lookup (the key IS
// the auth), see migrations/*_portal-api-key.js.

export async function GET(req: NextRequest) {
  const apiKey = new URL(req.url).searchParams.get("apiKey");
  if (!apiKey) return NextResponse.json({ error: "apiKey is required" }, { status: 400 });

  const owner = await withAdmin(async (client) => {
    const { rows } = await client.query(`SELECT * FROM find_portal_user_by_api_key($1)`, [apiKey]);
    return rows[0] ?? null;
  });
  if (!owner) return NextResponse.json({ error: "Invalid API key" }, { status: 401 });

  const status = await withTenant(owner.vendor_id, async (client) => {
    await client.query(
      `UPDATE portal_users SET api_key_last_used_at = NOW() WHERE vendor_id = $1 AND customer_id = $2 AND email = $3`,
      [owner.vendor_id, owner.customer_id, owner.email]
    );
    const { rows } = await client.query(
      `SELECT uptime_pct_mtd, downtime_minutes_mtd, status, computed_at, source_data_complete
       FROM sla_intraday_status WHERE vendor_id = $1 AND customer_id = $2
       ORDER BY computed_at DESC LIMIT 1`,
      [owner.vendor_id, owner.customer_id]
    );
    return rows[0] ?? null;
  });

  return NextResponse.json({ customerId: owner.customer_id, status });
}
