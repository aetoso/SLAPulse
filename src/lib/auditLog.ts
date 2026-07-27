import crypto from "crypto";
import type { PoolClient, Client } from "pg";

// Accepts either a pooled transaction client (the app's normal path,
// Section 11.5) or a plain Client (used by scripts/seed.ts, which
// connects as the owner role and bypasses RLS entirely).
type QueryExecutor = PoolClient | Client;

// Section 11.2: hash chain provides TAMPER-EVIDENCE, not immutability.
// data_hash = SHA256(JSON.stringify(payload))
// previous_hash = the previous row's data_hash for this (vendor_id, customer_id)
// A verifier who holds a prior copy of the chain can detect any row that
// was altered or deleted after the fact.

export type AuditEventType =
  | "CUSTOMER_REGISTERED"
  | "COLLECTION_RUN"
  | "SLA_STATUS_COMPUTED"
  | "SLA_STATUS_DATA_INCOMPLETE"
  | "REPORT_GENERATED"
  | "BREACH_PREDICTED"
  | "CORRECTION_RAISED"
  | "CORRECTION_APPROVED"
  | "DISAGREEMENT_IDENTIFIED"
  | "DISAGREEMENT_RESOLVED"
  | "DRIFT_DETECTED"
  | "DRIFT_RESOLVED"
  | "CREDIT_ISSUED"
  | "CROSS_ACCOUNT_ROLE_ASSUMED"
  | "RENEWAL_RISK_FLAGGED"
  | "INCIDENT_ATTRIBUTED"
  | "AUDIT_CHAIN_ANCHORED";

export interface AppendAuditEventInput {
  vendorId: string;
  customerId: string;
  eventType: AuditEventType;
  actor: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export async function appendAuditEvent(
  client: QueryExecutor,
  input: AppendAuditEventInput
): Promise<{ id: string; dataHash: string }> {
  const { vendorId, customerId, eventType, actor, description, metadata } = input;

  const prevResult = await client.query<{ data_hash: string }>(
    `SELECT data_hash FROM sla_audit_log
     WHERE vendor_id = $1 AND customer_id = $2
     ORDER BY event_timestamp DESC, created_at DESC
     LIMIT 1`,
    [vendorId, customerId]
  );
  const previousHash = prevResult.rows[0]?.data_hash ?? null;

  const eventTimestamp = new Date().toISOString();
  const payload = JSON.stringify({
    vendorId,
    customerId,
    eventType,
    actor,
    description: description ?? null,
    metadata: metadata ?? {},
    eventTimestamp,
    previousHash,
  });
  const dataHash = sha256(payload);

  const insertResult = await client.query<{ id: string }>(
    `INSERT INTO sla_audit_log
       (vendor_id, customer_id, event_type, event_timestamp, actor, description, data_hash, previous_hash, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      vendorId,
      customerId,
      eventType,
      eventTimestamp,
      actor,
      description ?? null,
      dataHash,
      previousHash,
      JSON.stringify(metadata ?? {}),
    ]
  );

  return { id: insertResult.rows[0].id, dataHash };
}

/**
 * Verifies the hash chain for a given (vendor_id, customer_id) by
 * recomputing each row's expected previous_hash linkage. Used by the
 * SLA Evidence Explorer (F-EVID) to show verifiers the chain is intact.
 */
export async function verifyAuditChain(
  client: QueryExecutor,
  vendorId: string,
  customerId: string
): Promise<{ intact: boolean; brokenAtId: string | null }> {
  const { rows } = await client.query<{
    id: string;
    data_hash: string;
    previous_hash: string | null;
  }>(
    `SELECT id, data_hash, previous_hash FROM sla_audit_log
     WHERE vendor_id = $1 AND customer_id = $2
     ORDER BY event_timestamp ASC, created_at ASC`,
    [vendorId, customerId]
  );

  let expectedPrevious: string | null = null;
  for (const row of rows) {
    if (row.previous_hash !== expectedPrevious) {
      return { intact: false, brokenAtId: row.id };
    }
    expectedPrevious = row.data_hash;
  }
  return { intact: true, brokenAtId: null };
}
