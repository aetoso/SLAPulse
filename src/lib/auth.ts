import { cookies } from "next/headers";

// Section 14.5 simplified MVP access model: 4 roles, application-layer
// enforcement only (no DB-level role enforcement at pilot scale).
//
// LOCAL-DEV SUBSTITUTION: the spec calls for Cognito/Clerk OIDC/SSO with
// RS256 JWTs carrying vendor_id + role claims (Section 14.1, 17). Running
// a real IdP is out of scope for bringing this up locally, so this module
// is a stand-in: a cookie holds {vendorId, actor, role}, and every API
// route reads identity through here instead of trusting request bodies.
// Swapping this file for real JWT verification is the only change needed
// to move to production auth -- callers already treat identity as opaque.

export type Role = "ADMIN" | "SRE" | "CSM" | "EXECUTIVE";

export interface Identity {
  vendorId: string;
  actor: string;
  role: Role;
}

const COOKIE_NAME = "slapulse_identity";

export async function getIdentity(): Promise<Identity | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.vendorId || !parsed.actor || !parsed.role) return null;
    return parsed as Identity;
  } catch {
    return null;
  }
}

export function identityCookieName() {
  return COOKIE_NAME;
}

export const ROLE_PERMISSIONS: Record<
  Role,
  {
    manageCustomers: boolean;
    viewAllCustomers: boolean;
    viewEvidence: boolean;
    triggerCorrections: boolean;
    viewAuditLog: boolean;
    viewExecutiveDashboard: boolean;
    manageMonitors: boolean;
  }
> = {
  ADMIN: {
    manageCustomers: true,
    viewAllCustomers: true,
    viewEvidence: true,
    triggerCorrections: true,
    viewAuditLog: true,
    viewExecutiveDashboard: true,
    manageMonitors: true,
  },
  SRE: {
    manageCustomers: false,
    viewAllCustomers: true,
    viewEvidence: true,
    triggerCorrections: true,
    viewAuditLog: true,
    viewExecutiveDashboard: true,
    manageMonitors: true,
  },
  CSM: {
    manageCustomers: false,
    viewAllCustomers: false,
    viewEvidence: true,
    triggerCorrections: false,
    viewAuditLog: false,
    viewExecutiveDashboard: false,
    manageMonitors: false,
  },
  EXECUTIVE: {
    manageCustomers: false,
    viewAllCustomers: false,
    viewEvidence: false,
    triggerCorrections: false,
    viewAuditLog: false,
    viewExecutiveDashboard: true,
    manageMonitors: false,
  },
};

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function requireIdentity(identity: Identity | null): asserts identity is Identity {
  if (!identity) {
    throw new ForbiddenError("No identity - sign in via the role switcher");
  }
}
