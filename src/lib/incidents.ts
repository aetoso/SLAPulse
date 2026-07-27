import { withTenant } from "./db";
import { appendAuditEvent } from "./auditLog";

// F6 Incident-to-Downtime Attribution (Section 6, P1). No real
// PagerDuty/OpsGenie account locally, so incidents are entered manually
// (or via a mock webhook payload) and linked to a downtime window by
// counting DOWNTIME-classified minutes in that window from the same
// availability_minutes table the evidence explorer reads.

export interface AttributeIncidentInput {
  incidentId: string;
  incidentSource: string; // PAGERDUTY | OPSGENIE | MANUAL
  severity: string;
  downtimeStart: string;
  downtimeEnd: string;
}

export async function attributeIncident(
  vendorId: string,
  customerId: string,
  input: AttributeIncidentInput,
  actor: string
) {
  return withTenant(vendorId, async (client) => {
    const { rows: countRows } = await client.query<{ cnt: string }>(
      `SELECT COUNT(*) as cnt FROM availability_minutes
       WHERE vendor_id = $1 AND customer_id = $2 AND classification = 'DOWNTIME'
         AND minute_timestamp >= $3 AND minute_timestamp < $4`,
      [vendorId, customerId, input.downtimeStart, input.downtimeEnd]
    );
    const downtimeMinutes = Number(countRows[0].cnt);

    const { rows } = await client.query(
      `INSERT INTO incident_downtime_attribution
         (vendor_id, customer_id, incident_id, incident_source, severity, downtime_start, downtime_end, downtime_minutes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        vendorId,
        customerId,
        input.incidentId,
        input.incidentSource,
        input.severity,
        input.downtimeStart,
        input.downtimeEnd,
        downtimeMinutes,
      ]
    );

    await appendAuditEvent(client, {
      vendorId,
      customerId,
      eventType: "INCIDENT_ATTRIBUTED",
      actor,
      description: `Incident ${input.incidentId} (${input.incidentSource}) attributed to ${downtimeMinutes} downtime minutes`,
      metadata: { incidentId: input.incidentId, downtimeMinutes },
    });

    return rows[0];
  });
}

export async function listIncidentAttributions(vendorId: string, customerId: string) {
  return withTenant(vendorId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM incident_downtime_attribution
       WHERE vendor_id = $1 AND customer_id = $2
       ORDER BY downtime_start DESC`,
      [vendorId, customerId]
    );
    return rows;
  });
}
