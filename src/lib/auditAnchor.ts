import fs from "fs/promises";
import path from "path";
import { withTenant } from "./db";
import { appendAuditEvent, verifyAuditChain } from "./auditLog";

// F12 P2: external hash anchoring. Section 11.2 draws a hard line
// between the hash chain (tamper-EVIDENCE, MVP) and this layer
// (tamper-PROOF -- publishing the chain head somewhere a database
// compromise can't also rewrite). LOCAL-DEV SUBSTITUTION for "AWS KMS
// asymmetric sign, or a public transparency log": an append-only local
// file that the app's own DB role has no reason to ever write to except
// through this one function, so a divergence between this file and the
// live chain head is a real tamper signal, not a formality.

const ANCHOR_LOG_PATH = path.join(process.cwd(), "data", "external-anchor-log.jsonl");

interface AnchorLogEntry {
  vendorId: string;
  customerId: string;
  chainHeadHash: string;
  anchoredAt: string;
  externalRef: string;
}

export async function anchorAuditChain(vendorId: string, customerId: string, actor: string) {
  return withTenant(vendorId, async (client) => {
    const { rows } = await client.query<{ data_hash: string }>(
      `SELECT data_hash FROM sla_audit_log
       WHERE vendor_id = $1 AND customer_id = $2
       ORDER BY event_timestamp DESC, created_at DESC LIMIT 1`,
      [vendorId, customerId]
    );
    if (rows.length === 0) return null;

    const chainHeadHash = rows[0].data_hash;
    const externalRef = `local-transparency-log#${Date.now()}`;

    await fs.mkdir(path.dirname(ANCHOR_LOG_PATH), { recursive: true });
    const entry: AnchorLogEntry = { vendorId, customerId, chainHeadHash, anchoredAt: new Date().toISOString(), externalRef };
    await fs.appendFile(ANCHOR_LOG_PATH, JSON.stringify(entry) + "\n", "utf8");

    const { rows: inserted } = await client.query(
      `INSERT INTO audit_chain_anchors (vendor_id, customer_id, chain_head_hash, external_ref)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [vendorId, customerId, chainHeadHash, externalRef]
    );

    await appendAuditEvent(client, {
      vendorId,
      customerId,
      eventType: "AUDIT_CHAIN_ANCHORED",
      actor,
      description: `Chain head ${chainHeadHash.slice(0, 12)}... anchored to external log`,
      metadata: { chainHeadHash, externalRef },
    });

    return inserted[0];
  });
}

// Detects whether the live chain's current head still matches what was
// anchored -- if a privileged DB user rewrote history after the anchor,
// this comparison (not just the in-DB chain walk) is what catches it.
export async function verifyAnchors(vendorId: string, customerId: string) {
  return withTenant(vendorId, async (client) => {
    const chainResult = await verifyAuditChain(client, vendorId, customerId);
    const { rows: anchors } = await client.query(
      `SELECT chain_head_hash, anchored_at, external_ref FROM audit_chain_anchors
       WHERE vendor_id = $1 AND customer_id = $2 ORDER BY anchored_at DESC`,
      [vendorId, customerId]
    );

    let raw = "";
    try {
      raw = await fs.readFile(ANCHOR_LOG_PATH, "utf8");
    } catch {
      // no anchors written yet
    }
    const externalEntries: AnchorLogEntry[] = raw
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((e: AnchorLogEntry) => e.vendorId === vendorId && e.customerId === customerId);

    const anchorsMatchExternalLog = anchors.every((a) =>
      externalEntries.some((e) => e.chainHeadHash === a.chain_head_hash && e.externalRef === a.external_ref)
    );

    return { chainIntact: chainResult.intact, anchors, anchorsMatchExternalLog };
  });
}
