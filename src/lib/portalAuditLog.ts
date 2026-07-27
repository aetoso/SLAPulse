import crypto from "crypto";
import type { PoolClient } from "pg";

// Portal-specific hash-chained audit log (Section 11.3 portal_audit_log),
// kept separate from sla_audit_log so Portal-surface events (magic-link
// logins, disputes, force-hold decisions) don't mix with Core Platform
// SLA calculation events -- same tamper-evidence pattern as
// src/lib/auditLog.ts, deliberately duplicated rather than parameterized
// to keep each table's chain independently verifiable.

export type PortalAuditEventType =
  | "PORTAL_LOGIN_REQUESTED"
  | "PORTAL_LOGIN_VERIFIED"
  | "DISCLOSURE_CREATED"
  | "DISCLOSURE_PUBLISHED"
  | "FORCE_HOLD_APPLIED"
  | "FORCE_HOLD_RELEASED"
  | "DISPUTE_RAISED"
  | "DISPUTE_ROUTED"
  | "DISPUTE_RESOLVED"
  | "BRANDING_UPDATED";

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export async function appendPortalAuditEvent(
  client: PoolClient,
  input: {
    vendorId: string;
    customerId: string;
    eventType: PortalAuditEventType;
    actor: string;
    description?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const { vendorId, customerId, eventType, actor, description, metadata } = input;

  const { rows: prevRows } = await client.query<{ data_hash: string }>(
    `SELECT data_hash FROM portal_audit_log
     WHERE vendor_id = $1 AND customer_id = $2
     ORDER BY event_timestamp DESC, created_at DESC LIMIT 1`,
    [vendorId, customerId]
  );
  const previousHash = prevRows[0]?.data_hash ?? null;

  const eventTimestamp = new Date().toISOString();
  const dataHash = sha256(
    JSON.stringify({ vendorId, customerId, eventType, actor, description: description ?? null, metadata: metadata ?? {}, eventTimestamp, previousHash })
  );

  await client.query(
    `INSERT INTO portal_audit_log
       (vendor_id, customer_id, event_type, event_timestamp, actor, description, data_hash, previous_hash, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [vendorId, customerId, eventType, eventTimestamp, actor, description ?? null, dataHash, previousHash, JSON.stringify(metadata ?? {})]
  );
}
