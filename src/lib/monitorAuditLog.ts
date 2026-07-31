import crypto from "crypto";
import type { PoolClient } from "pg";

// Same hash-chained, append-only pattern as src/lib/auditLog.ts and
// src/lib/portalAuditLog.ts, scoped to monitor_id -- kept as its own
// table/chain so Product 1 (uptime monitoring) has an independently
// verifiable trail, not mixed with Product 2's AWS-evidence audit log.

export type MonitorAuditEventType =
  | "MONITOR_CREATED"
  | "MONITOR_PAUSED"
  | "MONITOR_RESUMED"
  | "REGION_CHECK_RECORDED"
  | "MINUTE_AGGREGATED"
  | "SLA_STATUS_COMPUTED"
  | "SLA_STATUS_DATA_INCOMPLETE";

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export async function appendMonitorAuditEvent(
  client: PoolClient,
  input: {
    vendorId: string;
    monitorId: string;
    eventType: MonitorAuditEventType;
    actor: string;
    description?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const { vendorId, monitorId, eventType, actor, description, metadata } = input;

  const { rows: prevRows } = await client.query<{ data_hash: string }>(
    `SELECT data_hash FROM monitor_audit_log
     WHERE vendor_id = $1 AND monitor_id = $2
     ORDER BY event_timestamp DESC, created_at DESC LIMIT 1`,
    [vendorId, monitorId]
  );
  const previousHash = prevRows[0]?.data_hash ?? null;

  const eventTimestamp = new Date().toISOString();
  const dataHash = sha256(
    JSON.stringify({ vendorId, monitorId, eventType, actor, description: description ?? null, metadata: metadata ?? {}, eventTimestamp, previousHash })
  );

  await client.query(
    `INSERT INTO monitor_audit_log
       (vendor_id, monitor_id, event_type, event_timestamp, actor, description, data_hash, previous_hash, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [vendorId, monitorId, eventType, eventTimestamp, actor, description ?? null, dataHash, previousHash, JSON.stringify(metadata ?? {})]
  );
}
