import crypto from "crypto";
import { cookies } from "next/headers";
import { withTenant } from "./db";
import { sendMockEmail } from "./reportStorage";
import { appendPortalAuditEvent } from "./portalAuditLog";

// PF2 Vendor-Customer Authentication. LOCAL-DEV SUBSTITUTION for real
// SSO/OIDC or a production magic-link email flow (Section 7, PF2): the
// "email" is written to the same mock outbox as report emails, and the
// login page also prints the link directly so local dev doesn't require
// reading a file to test the flow. Swapping sendMockEmail() for a real
// email provider is the only change needed.

const TOKEN_TTL_MINUTES = 15;
const COOKIE_NAME = "slapulse_portal_session";

export interface PortalIdentity {
  vendorId: string;
  customerId: string;
  email: string;
}

export async function requestMagicLink(vendorId: string, customerId: string, email: string, origin: string) {
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000);

  await withTenant(vendorId, async (client) => {
    await client.query(
      `INSERT INTO portal_users (vendor_id, customer_id, email, magic_link_token, magic_link_expires_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (vendor_id, customer_id, email)
       DO UPDATE SET magic_link_token = $4, magic_link_expires_at = $5`,
      [vendorId, customerId, email, token, expiresAt.toISOString()]
    );
    await appendPortalAuditEvent(client, {
      vendorId,
      customerId,
      eventType: "PORTAL_LOGIN_REQUESTED",
      actor: email,
      description: `Magic link requested by ${email}`,
    });
  });

  const link = `${origin}/portal/${vendorId}/verify?token=${token}`;
  await sendMockEmail(vendorId, [email], "Your SLAPulse Trust Portal sign-in link", `<p>Click to sign in: <a href="${link}">${link}</a></p><p>Expires in ${TOKEN_TTL_MINUTES} minutes.</p>`);

  return { link, expiresAt };
}

export async function verifyMagicLink(token: string): Promise<PortalIdentity | null> {
  // Token lookup has no vendor context yet, so it goes through the
  // narrow SECURITY DEFINER function (migrations/*_portal-token-lookup.js)
  // instead of a direct RLS-protected query -- the token itself is the
  // capability, the same trust model as a password-reset link.
  const { withAdmin, withTenant } = await import("./db");
  const row = await withAdmin(async (client) => {
    const { rows } = await client.query(`SELECT * FROM find_portal_user_by_token($1)`, [token]);
    return rows[0] ?? null;
  });
  if (!row) return null;
  if (new Date(row.magic_link_expires_at) < new Date()) return null;

  await withTenant(row.vendor_id, async (client) => {
    await client.query(
      `UPDATE portal_users SET last_login_at = NOW(), magic_link_token = NULL WHERE vendor_id = $1 AND customer_id = $2 AND email = $3`,
      [row.vendor_id, row.customer_id, row.email]
    );
    await appendPortalAuditEvent(client, {
      vendorId: row.vendor_id,
      customerId: row.customer_id,
      eventType: "PORTAL_LOGIN_VERIFIED",
      actor: row.email,
      description: `Portal login verified for ${row.email}`,
    });
  });

  return { vendorId: row.vendor_id, customerId: row.customer_id, email: row.email };
}

export async function setPortalSession(identity: PortalIdentity) {
  const store = await cookies();
  store.set(COOKIE_NAME, JSON.stringify(identity), { httpOnly: true, sameSite: "lax", path: "/" });
}

export async function getPortalIdentity(): Promise<PortalIdentity | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PortalIdentity;
  } catch {
    return null;
  }
}

export function portalCookieName() {
  return COOKIE_NAME;
}
