/* eslint-disable camelcase */

// Product 1: independent external uptime monitoring (HTTPS/TCP/ping),
// the PRIMARY source of truth for a monitor's official SLA number --
// unlike customer_sla_status (Product 2, AWS-pull evidence), this needs
// no AWS access at all. Same append-only / fail-closed / hash-chained
// patterns as the Core Platform schema (Section 8.3/9.4/11.2), just
// scoped to monitor_id instead of customer_id.

const TENANT_TABLES = [
  "uptime_monitors",
  "uptime_check_results",
  "monitor_availability_minutes",
  "monitor_sla_status",
  "monitor_audit_log",
];

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE uptime_monitors (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vendor_id           VARCHAR(100) NOT NULL REFERENCES vendor_accounts(vendor_id),
        monitor_id          VARCHAR(100) NOT NULL,
        name                VARCHAR(255) NOT NULL,
        target_url          VARCHAR(500) NOT NULL,
        check_type          VARCHAR(10) NOT NULL DEFAULT 'HTTPS'
                              CHECK (check_type IN ('HTTPS', 'TCP', 'PING')),
        port                INTEGER,
        interval_seconds    INTEGER NOT NULL DEFAULT 60,
        contract_sla_pct    DECIMAL(7,4) NOT NULL CHECK (contract_sla_pct > 0 AND contract_sla_pct <= 100),
        -- Product 2 bridge: optionally attach this monitor to an
        -- AWS-monitored customer environment so a detected outage can
        -- link straight into that customer's Evidence Explorer.
        linked_customer_id  VARCHAR(100),
        status              VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        created_at          TIMESTAMPTZ DEFAULT NOW(),
        updated_at          TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(vendor_id, monitor_id)
    );
  `);
  pgm.sql(`CREATE INDEX idx_uptime_monitors_vendor_status ON uptime_monitors(vendor_id, status);`);

  // Raw per-probe-region results. Kept for a rolling window only (no
  // partitioning -- at 3 regions x 1 check/min this is a fraction of
  // availability_minutes' volume even at real scale).
  pgm.sql(`
    CREATE TABLE uptime_check_results (
        vendor_id       VARCHAR(100) NOT NULL,
        monitor_id      VARCHAR(100) NOT NULL,
        check_timestamp TIMESTAMPTZ NOT NULL,
        region          VARCHAR(20) NOT NULL,
        is_up           BOOLEAN NOT NULL,
        response_time_ms INTEGER,
        status_code     INTEGER,
        error_message   VARCHAR(500),
        PRIMARY KEY (vendor_id, monitor_id, check_timestamp, region)
    );
  `);
  pgm.sql(`CREATE INDEX idx_check_results_monitor_ts ON uptime_check_results(vendor_id, monitor_id, check_timestamp DESC);`);

  // Aggregated per-minute status (N-of-M region agreement already
  // applied) -- this is what the SLA calculator reads, analogous to
  // availability_minutes for Product 2.
  pgm.sql(`
    CREATE TABLE monitor_availability_minutes (
        vendor_id            VARCHAR(100) NOT NULL,
        monitor_id           VARCHAR(100) NOT NULL,
        minute_timestamp     TIMESTAMPTZ NOT NULL,
        is_up                BOOLEAN NOT NULL,
        classification       VARCHAR(20) NOT NULL, -- UP | DOWNTIME | UNKNOWN
        regions_checked      INTEGER NOT NULL,
        regions_up           INTEGER NOT NULL,
        avg_response_time_ms INTEGER,
        PRIMARY KEY (vendor_id, monitor_id, minute_timestamp)
    );
  `);

  pgm.sql(`
    CREATE TABLE monitor_sla_status (
        id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vendor_id              VARCHAR(100) NOT NULL,
        monitor_id             VARCHAR(100) NOT NULL,
        month                  VARCHAR(7) NOT NULL,
        total_minutes          INTEGER NOT NULL,
        downtime_minutes       INTEGER NOT NULL DEFAULT 0,
        data_completeness_pct  DECIMAL(5,2) NOT NULL,
        uptime_pct             DECIMAL(8,5) CHECK (uptime_pct BETWEEN 0 AND 100),
        contract_sla_pct       DECIMAL(7,4) NOT NULL,
        avg_response_time_ms   INTEGER,
        status                 VARCHAR(20) NOT NULL, -- COMPLIANT | AT_RISK | BREACHED | DATA_INCOMPLETE
        formula_version        VARCHAR(20) NOT NULL DEFAULT 'v1',
        is_active_for_display  BOOLEAN NOT NULL DEFAULT true,
        created_at             TIMESTAMPTZ DEFAULT NOW(),
        updated_at             TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  pgm.sql(`CREATE INDEX idx_monitor_sla_status_vendor_monitor_month ON monitor_sla_status(vendor_id, monitor_id, month);`);
  pgm.sql(`CREATE UNIQUE INDEX idx_monitor_sla_one_active_per_month ON monitor_sla_status(vendor_id, monitor_id, month) WHERE is_active_for_display;`);

  pgm.sql(`
    CREATE TABLE monitor_audit_log (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vendor_id       VARCHAR(100) NOT NULL,
        monitor_id      VARCHAR(100) NOT NULL,
        event_type      VARCHAR(50) NOT NULL,
        event_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actor           VARCHAR(100) NOT NULL,
        description     TEXT,
        data_hash       VARCHAR(64) NOT NULL,
        previous_hash   VARCHAR(64),
        metadata        JSONB DEFAULT '{}',
        created_at      TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  pgm.sql(`CREATE INDEX idx_monitor_audit_vendor_monitor_ts ON monitor_audit_log(vendor_id, monitor_id, event_timestamp);`);
  pgm.sql(`REVOKE UPDATE, DELETE ON monitor_audit_log FROM slapulse_app;`);

  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO slapulse_app;`);
  pgm.sql(`REVOKE UPDATE, DELETE ON monitor_audit_log FROM slapulse_app;`);

  for (const table of TENANT_TABLES) {
    pgm.sql(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    pgm.sql(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
    pgm.sql(`
      CREATE POLICY tenant_isolation ON ${table}
        USING (vendor_id = current_setting('app.current_vendor_id', true));
    `);
  }
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS monitor_audit_log;`);
  pgm.sql(`DROP TABLE IF EXISTS monitor_sla_status;`);
  pgm.sql(`DROP TABLE IF EXISTS monitor_availability_minutes;`);
  pgm.sql(`DROP TABLE IF EXISTS uptime_check_results;`);
  pgm.sql(`DROP TABLE IF EXISTS uptime_monitors;`);
};
