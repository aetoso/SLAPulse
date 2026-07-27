/* eslint-disable camelcase */

// Schema for the P1/P2 Core Platform features (F6-F12) and the full
// Trust Portal (Section 7, 11.3). Portal tables follow the same
// tenant_isolation RLS pattern as Section 11.1/11.5 -- vendor_id is
// still the isolation key even though the Portal's own "user" is the
// vendor's customer, not the vendor's staff.

const NEW_TENANT_TABLES = [
  "incident_downtime_attribution",
  "sla_credit_memos",
  "cross_account_role_assumptions",
  "audit_chain_anchors",
  "portal_users",
  "portal_disclosure_status",
  "portal_disputes",
  "portal_audit_log",
];

exports.shorthands = undefined;

exports.up = (pgm) => {
  // ---------------------------------------------------------------------
  // Customer additions: F7 credit calc input, F9 deployment model,
  // F-SYN toggle, F-drift tracking, F11 renewal risk needs renewal_date
  // (already exists).
  // ---------------------------------------------------------------------
  pgm.sql(`
    ALTER TABLE customers
      ADD COLUMN monthly_fee_usd DECIMAL(10,2),
      ADD COLUMN deployment_model VARCHAR(10) NOT NULL DEFAULT 'MODEL_A'
        CHECK (deployment_model IN ('MODEL_A', 'MODEL_B')),
      ADD COLUMN synthetic_monitoring_enabled BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN last_drift_check_at TIMESTAMPTZ;
  `);

  pgm.sql(`ALTER TABLE customers DROP CONSTRAINT demo_profile_check;`);
  pgm.sql(`
    ALTER TABLE customers ADD CONSTRAINT demo_profile_check
      CHECK (demo_profile IN ('stable', 'flaky', 'degrading', 'breached', 'data_gap', 'app_outage'));
  `);

  // ---------------------------------------------------------------------
  // F-SYN: 4th detection signal columns on availability_minutes.
  // ---------------------------------------------------------------------
  pgm.sql(`
    ALTER TABLE availability_minutes
      ADD COLUMN synthetic_failed BOOLEAN,
      ADD COLUMN synthetic_response_time_ms INTEGER;
  `);

  // ---------------------------------------------------------------------
  // F6: Incident-to-Downtime Attribution (Section 11.2, already spec'd).
  // ---------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE incident_downtime_attribution (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vendor_id       VARCHAR(100) NOT NULL,
        customer_id     VARCHAR(100) NOT NULL,
        incident_id     VARCHAR(100),
        incident_source VARCHAR(50),
        severity        VARCHAR(20),
        downtime_start  TIMESTAMPTZ,
        downtime_end    TIMESTAMPTZ,
        downtime_minutes INTEGER,
        attributed_at   TIMESTAMPTZ DEFAULT NOW(),
        FOREIGN KEY (vendor_id, customer_id) REFERENCES customers(vendor_id, customer_id)
    );
  `);
  pgm.sql(`CREATE INDEX idx_incident_attr_vendor_customer ON incident_downtime_attribution(vendor_id, customer_id);`);

  // ---------------------------------------------------------------------
  // F7: SLA Credit Automation -- credit memo trail (not in the spec's
  // literal DDL block, but customer_sla_status.credits_owed_usd /
  // credit_formula_version imply a memo record; this is that record).
  // ---------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE sla_credit_memos (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vendor_id           VARCHAR(100) NOT NULL,
        customer_id         VARCHAR(100) NOT NULL,
        month               VARCHAR(7) NOT NULL,
        sla_status_id       UUID NOT NULL REFERENCES customer_sla_status(id),
        credit_amount_usd   DECIMAL(10,2) NOT NULL,
        credit_pct_of_fee   DECIMAL(5,2) NOT NULL,
        formula_version     VARCHAR(20) NOT NULL DEFAULT 'v1',
        status              VARCHAR(20) NOT NULL DEFAULT 'DRAFT', -- DRAFT | ISSUED
        issued_at           TIMESTAMPTZ,
        created_at          TIMESTAMPTZ DEFAULT NOW(),
        FOREIGN KEY (vendor_id, customer_id) REFERENCES customers(vendor_id, customer_id)
    );
  `);
  pgm.sql(`CREATE UNIQUE INDEX idx_credit_memo_one_per_month ON sla_credit_memos(vendor_id, customer_id, month);`);

  // ---------------------------------------------------------------------
  // F9: simulated STS AssumeRole log for Model B (cross-account) customers.
  // ---------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE cross_account_role_assumptions (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vendor_id       VARCHAR(100) NOT NULL,
        customer_id     VARCHAR(100) NOT NULL,
        simulated_role_arn VARCHAR(255) NOT NULL,
        assumed_at      TIMESTAMPTZ DEFAULT NOW(),
        FOREIGN KEY (vendor_id, customer_id) REFERENCES customers(vendor_id, customer_id)
    );
  `);

  // ---------------------------------------------------------------------
  // F12 P2: external hash anchoring simulation. Section 11.2 draws a
  // hard line between tamper-evidence (hash chain, MVP) and provable
  // non-forgery (external anchor, P2) -- this table is that P2 layer,
  // anchoring a chain-head hash to a simulated external log (local file,
  // see src/lib/auditAnchor.ts) instead of a real transparency log/KMS.
  // ---------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE audit_chain_anchors (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vendor_id           VARCHAR(100) NOT NULL,
        customer_id         VARCHAR(100) NOT NULL,
        chain_head_hash     VARCHAR(64) NOT NULL,
        anchored_at         TIMESTAMPTZ DEFAULT NOW(),
        external_ref        VARCHAR(255) NOT NULL,
        FOREIGN KEY (vendor_id, customer_id) REFERENCES customers(vendor_id, customer_id)
    );
  `);

  // ---------------------------------------------------------------------
  // Trust Portal schema (Section 11.3 -- delegated to the prior Portal
  // doc's DDL; reconstructed here since that doc isn't available in this
  // repo).
  // ---------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE portal_vendor_config (
        vendor_id                 VARCHAR(100) PRIMARY KEY REFERENCES vendor_accounts(vendor_id),
        custom_domain             VARCHAR(255),
        logo_url                  VARCHAR(500),
        primary_color             VARCHAR(20) DEFAULT '#0f172a',
        footer_text               VARCHAR(500),
        hide_slapulse_branding   BOOLEAN NOT NULL DEFAULT false,
        disclosure_delay_hours    INTEGER NOT NULL DEFAULT 24,
        attestations              JSONB NOT NULL DEFAULT '[]', -- PF12: [{name, date, url}]
        updated_at                TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  pgm.sql(`
    CREATE TABLE portal_users (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vendor_id       VARCHAR(100) NOT NULL,
        customer_id     VARCHAR(100) NOT NULL,
        email           VARCHAR(255) NOT NULL,
        magic_link_token    VARCHAR(100),
        magic_link_expires_at TIMESTAMPTZ,
        last_login_at   TIMESTAMPTZ,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        FOREIGN KEY (vendor_id, customer_id) REFERENCES customers(vendor_id, customer_id),
        UNIQUE (vendor_id, customer_id, email)
    );
  `);

  pgm.sql(`
    CREATE TABLE portal_disclosure_status (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vendor_id           VARCHAR(100) NOT NULL,
        customer_id         VARCHAR(100) NOT NULL,
        incident_started_at TIMESTAMPTZ NOT NULL,
        incident_summary    TEXT NOT NULL,
        detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        effective_delay_hours INTEGER NOT NULL,
        portal_visible      BOOLEAN NOT NULL DEFAULT false,
        force_hold          BOOLEAN NOT NULL DEFAULT false,
        force_hold_approved_by VARCHAR(100),
        disputed_internally BOOLEAN NOT NULL DEFAULT false,
        FOREIGN KEY (vendor_id, customer_id) REFERENCES customers(vendor_id, customer_id)
    );
  `);

  pgm.sql(`
    CREATE TABLE portal_disputes (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vendor_id       VARCHAR(100) NOT NULL,
        customer_id     VARCHAR(100) NOT NULL,
        raised_by_email VARCHAR(255) NOT NULL,
        month           VARCHAR(7) NOT NULL,
        description     TEXT NOT NULL,
        status          VARCHAR(20) NOT NULL DEFAULT 'OPEN', -- OPEN | ROUTED | RESOLVED
        linked_correction_id UUID REFERENCES sla_corrections(id),
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        resolved_at     TIMESTAMPTZ,
        FOREIGN KEY (vendor_id, customer_id) REFERENCES customers(vendor_id, customer_id)
    );
  `);

  pgm.sql(`
    CREATE TABLE portal_audit_log (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vendor_id       VARCHAR(100) NOT NULL,
        customer_id     VARCHAR(100) NOT NULL,
        event_type      VARCHAR(50) NOT NULL,
        event_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actor           VARCHAR(100) NOT NULL,
        description     TEXT,
        data_hash       VARCHAR(64) NOT NULL,
        previous_hash   VARCHAR(64),
        metadata        JSONB DEFAULT '{}',
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        FOREIGN KEY (vendor_id, customer_id) REFERENCES customers(vendor_id, customer_id)
    );
  `);
  pgm.sql(`CREATE INDEX idx_portal_audit_vendor_customer_ts ON portal_audit_log(vendor_id, customer_id, event_timestamp);`);
  pgm.sql(`REVOKE UPDATE, DELETE ON portal_audit_log FROM slapulse_app;`);

  // ---------------------------------------------------------------------
  // RLS: same tenant_isolation pattern as Section 11.1 for every new
  // per-customer table, plus portal_vendor_config (vendor-only key).
  // ---------------------------------------------------------------------
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO slapulse_app;`);
  pgm.sql(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO slapulse_app;`);
  pgm.sql(`REVOKE UPDATE, DELETE ON portal_audit_log FROM slapulse_app;`);
  pgm.sql(`REVOKE UPDATE, DELETE ON audit_chain_anchors FROM slapulse_app;`);

  for (const table of NEW_TENANT_TABLES) {
    pgm.sql(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    pgm.sql(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
    pgm.sql(`
      CREATE POLICY tenant_isolation ON ${table}
        USING (vendor_id = current_setting('app.current_vendor_id', true));
    `);
  }

  pgm.sql(`ALTER TABLE portal_vendor_config ENABLE ROW LEVEL SECURITY;`);
  pgm.sql(`ALTER TABLE portal_vendor_config FORCE ROW LEVEL SECURITY;`);
  pgm.sql(`
    CREATE POLICY tenant_isolation ON portal_vendor_config
      USING (vendor_id = current_setting('app.current_vendor_id', true));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS portal_audit_log;`);
  pgm.sql(`DROP TABLE IF EXISTS portal_disputes;`);
  pgm.sql(`DROP TABLE IF EXISTS portal_disclosure_status;`);
  pgm.sql(`DROP TABLE IF EXISTS portal_users;`);
  pgm.sql(`DROP TABLE IF EXISTS portal_vendor_config;`);
  pgm.sql(`DROP TABLE IF EXISTS audit_chain_anchors;`);
  pgm.sql(`DROP TABLE IF EXISTS cross_account_role_assumptions;`);
  pgm.sql(`DROP TABLE IF EXISTS sla_credit_memos;`);
  pgm.sql(`DROP TABLE IF EXISTS incident_downtime_attribution;`);
  pgm.sql(`ALTER TABLE availability_minutes DROP COLUMN IF EXISTS synthetic_failed, DROP COLUMN IF EXISTS synthetic_response_time_ms;`);
  pgm.sql(`
    ALTER TABLE customers
      DROP COLUMN IF EXISTS monthly_fee_usd,
      DROP COLUMN IF EXISTS deployment_model,
      DROP COLUMN IF EXISTS synthetic_monitoring_enabled,
      DROP COLUMN IF EXISTS last_drift_check_at;
  `);
};
