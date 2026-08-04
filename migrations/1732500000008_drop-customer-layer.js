/* eslint-disable camelcase */

// Product pivot: SLAPulse is single-tenant per company -- one vendor
// account, one login, N monitored endpoints directly under it. There is
// no "book of the vendor's own customers" anymore, so the entire
// customer-contract apparatus (per-customer SLA tracking, credits,
// corrections/disputes, the customer-facing Trust Portal, renewal risk,
// drift detection, reports) is removed along with the `customers` table
// it was built around. Product 1 (uptime_monitors and everything under
// it) is untouched -- it was already vendor-scoped, never customer-scoped.
//
// `notifications` is NOT dropped -- it's already vendor-scoped
// (customer_id was always nullable) and is actively written by
// uptimeChecker.ts (Product 1) for webhook-confirmation alerts.
//
// Destructive and irreversible by design: this is local-dev-only data,
// so the rollback path is a full `db:down -v && db:up && migrate && seed`
// reset, not an `exports.down` that reconstructs the old schema.

exports.shorthands = undefined;

const DROP_TABLES_IN_ORDER = [
  "sla_corrections",
  "incident_downtime_attribution",
  "sla_credit_memos",
  "cross_account_role_assumptions",
  "audit_chain_anchors",
  "portal_disputes",
  "portal_disclosure_status",
  "portal_users",
  "portal_vendor_config",
  "portal_audit_log",
  "customer_sla_status",
  "sla_intraday_status",
  "sla_audit_log",
  "availability_minutes",
  "customers",
];

exports.up = (pgm) => {
  for (const table of DROP_TABLES_IN_ORDER) {
    pgm.sql(`DROP TABLE IF EXISTS ${table} CASCADE;`);
  }

  pgm.sql(`DROP FUNCTION IF EXISTS ensure_availability_minutes_partition(DATE);`);
  pgm.sql(`DROP FUNCTION IF EXISTS find_portal_user_by_token(TEXT);`);
  pgm.sql(`DROP FUNCTION IF EXISTS find_portal_user_by_api_key(TEXT);`);

  pgm.sql(`ALTER TABLE uptime_monitors DROP COLUMN IF EXISTS linked_customer_id;`);
};

exports.down = (pgm) => {
  pgm.sql(`-- Destructive migration; not reversible. Reset the local
    Postgres volume (npm run db:down -- -v && db:up && migrate && seed)
    instead of trying to migrate back down past this point.`);
};
