/* eslint-disable camelcase */

// Real AWS integration: one cross-account IAM role connection per
// vendor (single-tenant company, not per-customer). external_id is
// generated server-side and shown in the setup wizard's trust-policy
// JSON so the customer's role trust condition can require it (the
// standard cross-account confused-deputy mitigation). status/last_*
// fields reflect the outcome of the most recent real STS AssumeRole
// test -- never a simulated value.
//
// aws_* columns on uptime_monitors are optional per-endpoint resource
// tags so a specific monitor can be correlated to specific AWS
// resources for the on-demand root-cause snapshot (src/lib/awsRootCause.ts).

const TENANT_TABLES = ["vendor_aws_connections"];

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE vendor_aws_connections (
        vendor_id             VARCHAR(100) PRIMARY KEY REFERENCES vendor_accounts(vendor_id),
        role_arn              VARCHAR(500),
        external_id           VARCHAR(64) NOT NULL,
        region                VARCHAR(20),
        status                VARCHAR(20) NOT NULL DEFAULT 'NOT_CONFIGURED'
                                 CHECK (status IN ('NOT_CONFIGURED', 'CONNECTED', 'ERROR')),
        last_tested_at        TIMESTAMPTZ,
        last_test_ok          BOOLEAN,
        last_error            TEXT,
        connected_account_id  VARCHAR(20),
        created_at             TIMESTAMPTZ DEFAULT NOW(),
        updated_at             TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  for (const table of TENANT_TABLES) {
    pgm.sql(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    pgm.sql(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
    pgm.sql(`
      CREATE POLICY tenant_isolation ON ${table}
        USING (vendor_id = current_setting('app.current_vendor_id', true));
    `);
  }

  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO slapulse_app;`);

  pgm.sql(`
    ALTER TABLE uptime_monitors
      ADD COLUMN aws_alb_target_group_arn   VARCHAR(500),
      ADD COLUMN aws_ecs_cluster_name       VARCHAR(255),
      ADD COLUMN aws_ecs_service_name       VARCHAR(255),
      ADD COLUMN aws_route53_health_check_id VARCHAR(64);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE uptime_monitors
      DROP COLUMN IF EXISTS aws_alb_target_group_arn,
      DROP COLUMN IF EXISTS aws_ecs_cluster_name,
      DROP COLUMN IF EXISTS aws_ecs_service_name,
      DROP COLUMN IF EXISTS aws_route53_health_check_id;
  `);
  pgm.sql(`DROP TABLE IF EXISTS vendor_aws_connections;`);
};
