import { withAdmin } from "./db";

export interface VendorAccount {
  vendorId: string;
  vendorName: string;
  planTier: string;
  status: string;
}

// vendor_accounts is the one table that is NOT tenant-scoped (it IS the
// tenant list), so this is the only place withAdmin() (no RLS context) is
// appropriate to read from.
export async function listActiveVendorIds(): Promise<string[]> {
  return withAdmin(async (client) => {
    const { rows } = await client.query<{ vendor_id: string }>(
      `SELECT vendor_id FROM vendor_accounts WHERE status = 'ACTIVE' ORDER BY vendor_id`
    );
    return rows.map((r) => r.vendor_id);
  });
}

export async function getVendor(vendorId: string): Promise<VendorAccount | null> {
  return withAdmin(async (client) => {
    const { rows } = await client.query(
      `SELECT vendor_id, vendor_name, plan_tier, status FROM vendor_accounts WHERE vendor_id = $1`,
      [vendorId]
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return { vendorId: r.vendor_id, vendorName: r.vendor_name, planTier: r.plan_tier, status: r.status };
  });
}
