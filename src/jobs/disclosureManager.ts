import { withTenant } from "@/lib/db";
import { appendPortalAuditEvent } from "@/lib/portalAuditLog";
import { listActiveVendorIds } from "@/lib/vendors";
import { listCustomers } from "@/lib/customers";
import { currentMonthKey } from "./slaCalculator";

// Section 8.8 Disclosure-Delayed Incident Reveal. One disclosure record
// per BREACHED month per customer (Section 9.4/6 treats the monthly
// status as the unit of official record; the incident being disclosed
// here is "this customer breached SLA this month", not each individual
// downtime window -- keeps volume sane for a Portal viewer).

const PLATFORM_MINIMUM_DELAY_HOURS = 4;
const SAFETY_BUFFER_HOURS = 1;

async function getVendorDisclosureDelay(vendorId: string): Promise<number> {
  return withTenant(vendorId, async (client) => {
    const { rows } = await client.query(`SELECT disclosure_delay_hours FROM portal_vendor_config WHERE vendor_id = $1`, [
      vendorId,
    ]);
    return rows[0]?.disclosure_delay_hours ?? 24;
  });
}

export async function createDisclosuresForBreaches(actor: string, now: Date = new Date()): Promise<{ created: number }> {
  const vendorIds = await listActiveVendorIds();
  const month = currentMonthKey(now);
  let created = 0;

  for (const vendorId of vendorIds) {
    const vendorDelay = await getVendorDisclosureDelay(vendorId);
    const customers = await listCustomers(vendorId, { activeOnly: true });

    for (const customer of customers) {
      const didCreate = await withTenant(vendorId, async (client) => {
        const { rows: statusRows } = await client.query(
          `SELECT downtime_minutes FROM customer_sla_status
           WHERE vendor_id = $1 AND customer_id = $2 AND month = $3
             AND is_active_for_display = true AND status = 'BREACHED'`,
          [vendorId, customer.customerId, month]
        );
        if (statusRows.length === 0) return false;

        const summary = `SLA breach — ${month}`;
        const { rows: existing } = await client.query(
          `SELECT id FROM portal_disclosure_status WHERE vendor_id = $1 AND customer_id = $2 AND incident_summary = $3`,
          [vendorId, customer.customerId, summary]
        );
        if (existing.length > 0) return false;

        let effectiveDelay: number;
        if (customer.contractualNotificationHours === null) {
          effectiveDelay = PLATFORM_MINIMUM_DELAY_HOURS;
          await client.query(
            `INSERT INTO notifications (vendor_id, customer_id, channel, severity, message)
             VALUES ($1,$2,'SLACK','MEDIUM',$3)`,
            [
              vendorId,
              customer.customerId,
              `${customer.customerName} has no contractual_notification_hours set -- disclosure delay defaulted to the platform minimum (${PLATFORM_MINIMUM_DELAY_HOURS}h). Set the contract value to use the real ceiling.`,
            ]
          );
        } else {
          effectiveDelay = Math.min(vendorDelay, customer.contractualNotificationHours - SAFETY_BUFFER_HOURS);
        }

        await client.query(
          `INSERT INTO portal_disclosure_status
             (vendor_id, customer_id, incident_started_at, incident_summary, effective_delay_hours, portal_visible)
           VALUES ($1,$2,NOW(),$3,$4,false)`,
          [vendorId, customer.customerId, summary, effectiveDelay]
        );
        await appendPortalAuditEvent(client, {
          vendorId,
          customerId: customer.customerId,
          eventType: "DISCLOSURE_CREATED",
          actor,
          description: `Disclosure record created for ${month} breach, effective delay ${effectiveDelay}h`,
          metadata: { month, effectiveDelay },
        });
        return true;
      });

      if (didCreate) created++;
    }
  }

  return { created };
}

export async function publishEligibleDisclosures(now: Date = new Date()): Promise<{ published: number }> {
  const vendorIds = await listActiveVendorIds();
  let published = 0;

  for (const vendorId of vendorIds) {
    const count = await withTenant(vendorId, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE portal_disclosure_status
         SET portal_visible = true
         WHERE vendor_id = $1 AND portal_visible = false AND force_hold = false AND disputed_internally = false
           AND $2::timestamptz >= incident_started_at + (effective_delay_hours || ' hours')::interval`,
        [vendorId, now.toISOString()]
      );
      return rowCount ?? 0;
    });
    published += count;
  }

  return { published };
}

export async function setForceHold(
  vendorId: string,
  disclosureId: string,
  requestedBy: string,
  approvedBy: string
): Promise<void> {
  if (requestedBy === approvedBy) {
    throw new Error("Force-hold requires a second approver different from the requester");
  }

  await withTenant(vendorId, async (client) => {
    const { rows } = await client.query(
      `SELECT incident_started_at, effective_delay_hours FROM portal_disclosure_status WHERE vendor_id = $1 AND id = $2`,
      [vendorId, disclosureId]
    );
    if (rows.length === 0) throw new Error("Disclosure record not found");

    const ceiling = new Date(rows[0].incident_started_at).getTime() + rows[0].effective_delay_hours * 3_600_000;
    if (Date.now() > ceiling) {
      // FORCE_HOLD past the contractual ceiling is blocked outright (Section 8.8).
      throw new Error("Cannot force-hold: already past the contractual disclosure ceiling");
    }

    await client.query(
      `UPDATE portal_disclosure_status SET force_hold = true, force_hold_approved_by = $1 WHERE vendor_id = $2 AND id = $3`,
      [approvedBy, vendorId, disclosureId]
    );
    await appendPortalAuditEvent(client, {
      vendorId,
      customerId: (
        await client.query(`SELECT customer_id FROM portal_disclosure_status WHERE id = $1`, [disclosureId])
      ).rows[0].customer_id,
      eventType: "FORCE_HOLD_APPLIED",
      actor: requestedBy,
      description: `Force-hold applied to disclosure ${disclosureId}, approved by ${approvedBy}`,
      metadata: { disclosureId, approvedBy, severity: "HIGH" },
    });
  });
}

export async function releaseForceHold(vendorId: string, disclosureId: string, actor: string): Promise<void> {
  await withTenant(vendorId, async (client) => {
    await client.query(
      `UPDATE portal_disclosure_status SET force_hold = false, force_hold_approved_by = NULL
       WHERE vendor_id = $1 AND id = $2`,
      [vendorId, disclosureId]
    );
    await appendPortalAuditEvent(client, {
      vendorId,
      customerId: (
        await client.query(`SELECT customer_id FROM portal_disclosure_status WHERE id = $1`, [disclosureId])
      ).rows[0].customer_id,
      eventType: "FORCE_HOLD_RELEASED",
      actor,
      description: `Force-hold released on disclosure ${disclosureId}`,
      metadata: { disclosureId },
    });
  });
}
