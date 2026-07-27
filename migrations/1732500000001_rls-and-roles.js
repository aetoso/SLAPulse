/* eslint-disable camelcase */

// Section 11.1 / 11.5: Row-Level Security as a database-enforced isolation
// backstop, independent of application-layer vendor_id filtering. Also
// creates a least-privilege runtime role so that UPDATE/DELETE on the
// hash-chained audit log is rejected by the database itself (Section
// 11.2), not just by application logic.

const TENANT_TABLES = [
  'customers',
  'availability_minutes',
  'customer_sla_status',
  'sla_intraday_status',
  'sla_audit_log',
  'sla_corrections',
  'notifications',
];

exports.shorthands = undefined;

exports.up = (pgm) => {
  // Least-privilege runtime role used by the app (see src/lib/db.ts).
  // Migrations themselves run as the superuser-ish `slapulse` role so
  // they can ALTER/CREATE freely.
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'slapulse_app') THEN
        CREATE ROLE slapulse_app LOGIN PASSWORD 'slapulse_app_local_dev';
      END IF;
    END
    $$;
  `);

  pgm.sql(`GRANT CONNECT ON DATABASE slapulse TO slapulse_app;`);
  pgm.sql(`GRANT USAGE ON SCHEMA public TO slapulse_app;`);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO slapulse_app;`);
  pgm.sql(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO slapulse_app;`);
  pgm.sql(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO slapulse_app;`);

  for (const table of TENANT_TABLES) {
    pgm.sql(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    pgm.sql(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
    pgm.sql(`
      CREATE POLICY tenant_isolation ON ${table}
        USING (vendor_id = current_setting('app.current_vendor_id', true));
    `);
  }

  // sla_audit_log: append-only at the database-grant level (Section 11.2).
  // The hash chain provides tamper-evidence; this revocation is the MVP
  // layer that reduces the attack surface to privileged DB roles only.
  pgm.sql(`REVOKE UPDATE, DELETE ON sla_audit_log FROM slapulse_app;`);
};

exports.down = (pgm) => {
  for (const table of TENANT_TABLES) {
    pgm.sql(`DROP POLICY IF EXISTS tenant_isolation ON ${table};`);
    pgm.sql(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY;`);
  }
  pgm.sql(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM slapulse_app;`);
  pgm.sql(`DROP ROLE IF EXISTS slapulse_app;`);
};
