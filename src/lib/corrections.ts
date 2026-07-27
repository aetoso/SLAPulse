import { withTenant } from "./db";
import { appendAuditEvent } from "./auditLog";
import { getCustomer } from "./customers";
import { computeSlaStatus } from "@/jobs/slaCalculator";

// Section 8.7 Ops-Initiated Correction. The original row is never
// touched; the correction only becomes visible once a SECOND user
// approves it, at which point the calculator re-runs and its normal
// append-only behavior (Section 8.3) produces the new active row --
// this module never edits customer_sla_status directly.

export async function raiseCorrection(
  vendorId: string,
  customerId: string,
  month: string,
  originalStatusId: string,
  reason: string,
  actor: string
) {
  return withTenant(vendorId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO sla_corrections (vendor_id, customer_id, month, original_status_id, reason, raised_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [vendorId, customerId, month, originalStatusId, reason, actor]
    );
    await appendAuditEvent(client, {
      vendorId,
      customerId,
      eventType: "CORRECTION_RAISED",
      actor,
      description: `Correction raised for ${month}: ${reason}`,
      metadata: { correctionId: rows[0].id, originalStatusId },
    });
    return rows[0];
  });
}

export async function approveCorrection(vendorId: string, correctionId: string, approver: string) {
  const correction = await withTenant(vendorId, async (client) => {
    const { rows } = await client.query(`SELECT * FROM sla_corrections WHERE vendor_id = $1 AND id = $2`, [
      vendorId,
      correctionId,
    ]);
    return rows[0] ?? null;
  });
  if (!correction) throw new Error("Correction not found");
  if (correction.raised_by === approver) {
    throw new Error("Approver must differ from the user who raised the correction (no self-approval)");
  }
  if (correction.approved_at) throw new Error("Already approved");

  const customer = await getCustomer(vendorId, correction.customer_id);
  if (!customer) throw new Error("Customer not found");

  const result = await computeSlaStatus(vendorId, customer, correction.month, approver);
  if (!result) throw new Error("Recompute produced no result -- check availability_minutes for this month");

  return withTenant(vendorId, async (client) => {
    const { rows: newStatus } = await client.query(
      `SELECT id FROM customer_sla_status
       WHERE vendor_id = $1 AND customer_id = $2 AND month = $3 AND is_active_for_display = true`,
      [vendorId, correction.customer_id, correction.month]
    );
    await client.query(
      `UPDATE sla_corrections SET corrected_status_id = $1, approved_by = $2, approved_at = NOW() WHERE id = $3`,
      [newStatus[0]?.id ?? null, approver, correctionId]
    );
    await appendAuditEvent(client, {
      vendorId,
      customerId: correction.customer_id,
      eventType: "CORRECTION_APPROVED",
      actor: approver,
      description: `Correction approved and recomputed for ${correction.month}: new status ${result.status}`,
      metadata: { correctionId, newStatus: result.status },
    });
    return { correction, result };
  });
}

export async function listCorrections(vendorId: string) {
  return withTenant(vendorId, async (client) => {
    const { rows } = await client.query(
      `SELECT sc.*, c.customer_name FROM sla_corrections sc
       JOIN customers c ON c.vendor_id = sc.vendor_id AND c.customer_id = sc.customer_id
       WHERE sc.vendor_id = $1 ORDER BY sc.raised_at DESC`,
      [vendorId]
    );
    return rows;
  });
}
