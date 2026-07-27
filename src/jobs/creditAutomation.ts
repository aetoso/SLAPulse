import { withTenant } from "@/lib/db";
import { appendAuditEvent } from "@/lib/auditLog";
import { listActiveVendorIds } from "@/lib/vendors";
import { listCustomers } from "@/lib/customers";
import { currentMonthKey } from "./slaCalculator";

// F7 SLA Credit Automation (Section 6, P1) -- "deliberately sequenced
// late; legal-exposure feature needing real contract-language variance
// understood first." Credits stay DRAFT until a human issues them
// (Section 8.7-style second-look, even though there's no second-approver
// requirement in the spec for this specific action) -- this job never
// auto-sends a credit to a customer.
//
// Formula v1 (not specified in the master spec -- a common SaaS tiered
// schedule, documented here so it can be swapped per real contract
// language before this ever leaves DRAFT):
//   shortfall = contract_sla_pct - uptime_pct
//   shortfall <  1.0 pts -> 10% of monthly fee
//   shortfall <  5.0 pts -> 25% of monthly fee
//   shortfall >= 5.0 pts -> 50% of monthly fee
const FORMULA_VERSION = "v1";

function creditPctForShortfall(shortfall: number): number {
  if (shortfall < 1.0) return 10;
  if (shortfall < 5.0) return 25;
  return 50;
}

export interface CreditSummary {
  memosCreated: number;
}

export async function computeCreditsForBreached(actor: string, now: Date = new Date()): Promise<CreditSummary> {
  const vendorIds = await listActiveVendorIds();
  const month = currentMonthKey(now);
  let memosCreated = 0;

  for (const vendorId of vendorIds) {
    const customers = await listCustomers(vendorId, { activeOnly: true });
    for (const customer of customers) {
      if (customer.monthlyFeeUsd === null) continue;

      const created = await withTenant(vendorId, async (client) => {
        const { rows: statusRows } = await client.query(
          `SELECT id, uptime_pct, contract_sla_pct FROM customer_sla_status
           WHERE vendor_id = $1 AND customer_id = $2 AND month = $3
             AND is_active_for_display = true AND status = 'BREACHED'`,
          [vendorId, customer.customerId, month]
        );
        const status = statusRows[0];
        if (!status || status.uptime_pct === null) return false;

        const { rows: existing } = await client.query(
          `SELECT id FROM sla_credit_memos WHERE vendor_id = $1 AND customer_id = $2 AND month = $3`,
          [vendorId, customer.customerId, month]
        );
        if (existing.length > 0) return false; // idempotent per month

        const shortfall = Number(status.contract_sla_pct) - Number(status.uptime_pct);
        const creditPct = creditPctForShortfall(shortfall);
        const creditAmount = Math.round((customer.monthlyFeeUsd! * (creditPct / 100)) * 100) / 100;

        await client.query(
          `INSERT INTO sla_credit_memos
             (vendor_id, customer_id, month, sla_status_id, credit_amount_usd, credit_pct_of_fee, formula_version, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'DRAFT')`,
          [vendorId, customer.customerId, month, status.id, creditAmount, creditPct, FORMULA_VERSION]
        );
        await client.query(
          `UPDATE customer_sla_status SET credits_owed_usd = $1, credit_formula_version = $2 WHERE id = $3`,
          [creditAmount, FORMULA_VERSION, status.id]
        );
        await appendAuditEvent(client, {
          vendorId,
          customerId: customer.customerId,
          eventType: "CREDIT_ISSUED",
          actor,
          description: `Draft SLA credit memo created: $${creditAmount} (${creditPct}% of monthly fee) for ${month}`,
          metadata: { month, creditAmount, creditPct, shortfall, formulaVersion: FORMULA_VERSION },
        });
        return true;
      });

      if (created) memosCreated++;
    }
  }

  return { memosCreated };
}

export async function issueCreditMemo(vendorId: string, memoId: string, actor: string): Promise<void> {
  await withTenant(vendorId, async (client) => {
    const { rows } = await client.query(
      `UPDATE sla_credit_memos SET status = 'ISSUED', issued_at = NOW()
       WHERE vendor_id = $1 AND id = $2 AND status = 'DRAFT'
       RETURNING customer_id, month, credit_amount_usd`,
      [vendorId, memoId]
    );
    if (rows.length === 0) return;
    await appendAuditEvent(client, {
      vendorId,
      customerId: rows[0].customer_id,
      eventType: "CREDIT_ISSUED",
      actor,
      description: `SLA credit memo issued: $${rows[0].credit_amount_usd} for ${rows[0].month}`,
      metadata: { memoId, issued: true },
    });
  });
}
