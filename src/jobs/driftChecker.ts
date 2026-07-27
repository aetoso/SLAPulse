import { withTenant } from "@/lib/db";
import { appendAuditEvent } from "@/lib/auditLog";
import { listActiveVendorIds } from "@/lib/vendors";
import { listCustomers } from "@/lib/customers";

// Section 8.6 Drift Detection: verify tagged AWS resources still exist,
// mark CONFIG_ERROR and skip SLA calc until resolved. Runs daily in
// production; the worker's accelerated local-dev cadence (Section
// 9.1/worker.ts) calls this on every "daily" tick instead of gating on
// calendar days -- otherwise a 2-minute-tick local demo would rarely see
// it fire at all.
//
// LOCAL-DEV SUBSTITUTION: there's no real ALB/ECS/Route53 to check, so
// "drift" is a small per-tick probability instead of an actual
// DescribeServices/GetHealthCheckStatus call. Swapping this module for
// real AWS resource-existence checks is the only change needed.

const DRIFT_PROBABILITY = 0.015;

export interface DriftCheckSummary {
  customersChecked: number;
  driftsDetected: number;
}

export async function runDriftCheck(actor: string): Promise<DriftCheckSummary> {
  const vendorIds = await listActiveVendorIds();
  let customersChecked = 0;
  let driftsDetected = 0;

  for (const vendorId of vendorIds) {
    const customers = await listCustomers(vendorId, { activeOnly: true });
    for (const customer of customers) {
      customersChecked++;
      const drifted = Math.random() < DRIFT_PROBABILITY;

      await withTenant(vendorId, async (client) => {
        if (drifted) {
          await client.query(
            `UPDATE customers SET status = 'CONFIG_ERROR', last_drift_check_at = NOW()
             WHERE vendor_id = $1 AND customer_id = $2`,
            [vendorId, customer.customerId]
          );
          await client.query(
            `INSERT INTO notifications (vendor_id, customer_id, channel, severity, message)
             VALUES ($1,$2,'SLACK','HIGH',$3)`,
            [
              vendorId,
              customer.customerId,
              `Drift detected for ${customer.customerName}: a tagged AWS resource (ALB/ECS/Route53 HC) is no longer reachable. SLA calculation paused until resolved.`,
            ]
          );
          await appendAuditEvent(client, {
            vendorId,
            customerId: customer.customerId,
            eventType: "DRIFT_DETECTED",
            actor,
            description: `Resource drift detected -- customer marked CONFIG_ERROR, SLA calculation paused`,
          });
        } else {
          await client.query(
            `UPDATE customers SET last_drift_check_at = NOW()
             WHERE vendor_id = $1 AND customer_id = $2`,
            [vendorId, customer.customerId]
          );
        }
      });

      if (drifted) driftsDetected++;
    }
  }

  return { customersChecked, driftsDetected };
}

export async function resolveDrift(vendorId: string, customerId: string, actor: string): Promise<void> {
  await withTenant(vendorId, async (client) => {
    await client.query(
      `UPDATE customers SET status = 'ACTIVE' WHERE vendor_id = $1 AND customer_id = $2 AND status = 'CONFIG_ERROR'`,
      [vendorId, customerId]
    );
    await appendAuditEvent(client, {
      vendorId,
      customerId,
      eventType: "DRIFT_RESOLVED",
      actor,
      description: `Resource drift resolved -- customer reactivated`,
    });
  });
}
