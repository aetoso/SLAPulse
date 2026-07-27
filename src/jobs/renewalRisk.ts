import { withTenant } from "@/lib/db";
import { appendAuditEvent } from "@/lib/auditLog";
import { listActiveVendorIds } from "@/lib/vendors";
import { listCustomers } from "@/lib/customers";

// F11 Renewal Risk Scoring (Section 6, P2): customers approaching renewal
// with recent breach history are flagged for CS. Flags once per renewal
// date (re-flags only if renewal_date changes) rather than re-notifying
// on every tick.

const RENEWAL_WINDOW_DAYS = 60;
const BREACH_LOOKBACK_MONTHS = 3;

export interface RenewalRiskSummary {
  flagsIssued: number;
}

export async function runRenewalRiskCheck(actor: string, now: Date = new Date()): Promise<RenewalRiskSummary> {
  const vendorIds = await listActiveVendorIds();
  let flagsIssued = 0;

  for (const vendorId of vendorIds) {
    const customers = await listCustomers(vendorId, { activeOnly: true });
    for (const customer of customers) {
      if (!customer.renewalDate) continue;

      const renewalDate = new Date(customer.renewalDate);
      const daysUntilRenewal = Math.round((renewalDate.getTime() - now.getTime()) / 86_400_000);
      if (daysUntilRenewal < 0 || daysUntilRenewal > RENEWAL_WINDOW_DAYS) continue;

      const flagged = await withTenant(vendorId, async (client) => {
        const lookbackStart = new Date(now.getFullYear(), now.getMonth() - BREACH_LOOKBACK_MONTHS, 1)
          .toISOString()
          .slice(0, 7);

        const { rows: breaches } = await client.query(
          `SELECT COUNT(*) as cnt FROM customer_sla_status
           WHERE vendor_id = $1 AND customer_id = $2 AND is_active_for_display = true
             AND status = 'BREACHED' AND month >= $3`,
          [vendorId, customer.customerId, lookbackStart]
        );
        if (Number(breaches[0].cnt) === 0) return false;

        const { rows: alreadyFlagged } = await client.query(
          `SELECT id FROM sla_audit_log
           WHERE vendor_id = $1 AND customer_id = $2 AND event_type = 'RENEWAL_RISK_FLAGGED'
             AND metadata->>'renewalDate' = $3`,
          [vendorId, customer.customerId, customer.renewalDate]
        );
        if (alreadyFlagged.length > 0) return false;

        await client.query(
          `INSERT INTO notifications (vendor_id, customer_id, channel, severity, message)
           VALUES ($1,$2,'SLACK','MEDIUM',$3)`,
          [
            vendorId,
            customer.customerId,
            `${customer.customerName} renews in ${daysUntilRenewal} days and has a BREACHED month in the last ${BREACH_LOOKBACK_MONTHS} months -- flagged for CS follow-up.`,
          ]
        );
        await appendAuditEvent(client, {
          vendorId,
          customerId: customer.customerId,
          eventType: "RENEWAL_RISK_FLAGGED",
          actor,
          description: `Renewal risk: ${daysUntilRenewal} days to renewal with recent breach history`,
          metadata: { renewalDate: customer.renewalDate, daysUntilRenewal },
        });
        return true;
      });

      if (flagged) flagsIssued++;
    }
  }

  return { flagsIssued };
}
