/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  // ---------------------------------------------------------------------
  // vendor_accounts
  // ---------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE vendor_accounts (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vendor_id       VARCHAR(100) UNIQUE NOT NULL,
        vendor_name     VARCHAR(255) NOT NULL,
        plan_tier       VARCHAR(20) DEFAULT 'STARTER',
        status          VARCHAR(20) DEFAULT 'ACTIVE',
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // ---------------------------------------------------------------------
  // customers
  // ---------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE customers (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vendor_id       VARCHAR(100) NOT NULL REFERENCES vendor_accounts(vendor_id),
        customer_id     VARCHAR(100) NOT NULL,
        customer_name   VARCHAR(255) NOT NULL,
        contract_sla_pct    DECIMAL(7,4) NOT NULL CHECK (contract_sla_pct > 0 AND contract_sla_pct <= 100),
        contract_start_date DATE NOT NULL,
        contract_end_date   DATE,
        renewal_date        DATE,
        sla_tier        VARCHAR(20) DEFAULT 'STANDARD',
        contractual_notification_hours INTEGER,
        region          VARCHAR(20) NOT NULL,
        alb_arn         VARCHAR(255),
        ecs_cluster     VARCHAR(255),
        ecs_service     VARCHAR(255),
        route53_hc_id   VARCHAR(100),
        maintenance_windows JSONB DEFAULT '[]',
        contact_emails  TEXT[],
        assigned_csm_user_id VARCHAR(100),
        status          VARCHAR(20) DEFAULT 'ACTIVE',
        deleted_at      TIMESTAMPTZ,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(vendor_id, customer_id)
    );
  `);
  pgm.sql(`CREATE INDEX idx_customers_vendor_status ON customers(vendor_id, status);`);
  pgm.sql(`CREATE INDEX idx_customers_vendor_renewal ON customers(vendor_id, renewal_date);`);

  // ---------------------------------------------------------------------
  // availability_minutes (partitioned, replaces Timestream per Section 9.3)
  // ---------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE availability_minutes (
        vendor_id           VARCHAR(100) NOT NULL,
        customer_id         VARCHAR(100) NOT NULL,
        minute_timestamp    TIMESTAMPTZ NOT NULL,
        is_available        BOOLEAN NOT NULL,
        classification      VARCHAR(20) NOT NULL,
        route53_status      VARCHAR(20),
        alb_5xx_pct         DOUBLE PRECISION,
        alb_total_requests  INTEGER,
        ecs_running_tasks   INTEGER,
        ecs_desired_tasks   INTEGER,
        ecs_health_status   VARCHAR(20),
        is_maintenance_window BOOLEAN DEFAULT false,
        collection_run_id   VARCHAR(100) NOT NULL,
        PRIMARY KEY (vendor_id, customer_id, minute_timestamp)
    ) PARTITION BY RANGE (minute_timestamp);
  `);
  pgm.sql(`
    CREATE UNIQUE INDEX idx_avail_dedup ON availability_minutes(vendor_id, customer_id, minute_timestamp, collection_run_id);
  `);

  // Helper to create a monthly partition idempotently. Mirrors the
  // "scheduled job" referenced in the spec's schema comments (Section
  // 23.2 flags this as needing concrete automation) -- the worker calls
  // this once per day for the current + next month.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION ensure_availability_minutes_partition(part_month DATE)
    RETURNS void AS $$
    DECLARE
        part_start DATE := date_trunc('month', part_month);
        part_end DATE := part_start + INTERVAL '1 month';
        part_name TEXT := 'availability_minutes_' || to_char(part_start, 'YYYY_MM');
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
            EXECUTE format(
                'CREATE TABLE %I PARTITION OF availability_minutes FOR VALUES FROM (%L) TO (%L)',
                part_name, part_start, part_end
            );
        END IF;
    END;
    $$ LANGUAGE plpgsql;
  `);
  // Seed partitions for the months this local-dev build is likely to need.
  pgm.sql(`SELECT ensure_availability_minutes_partition(d::date) FROM generate_series(date_trunc('month', now()) - INTERVAL '2 months', date_trunc('month', now()) + INTERVAL '2 months', INTERVAL '1 month') AS d;`);

  // ---------------------------------------------------------------------
  // customer_sla_status (official monthly record, append-only)
  // ---------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE customer_sla_status (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vendor_id           VARCHAR(100) NOT NULL,
        customer_id         VARCHAR(100) NOT NULL,
        month               VARCHAR(7) NOT NULL,
        total_minutes       INTEGER NOT NULL,
        downtime_minutes    INTEGER NOT NULL DEFAULT 0,
        maintenance_minutes INTEGER NOT NULL DEFAULT 0,
        data_completeness_pct DECIMAL(5,2) NOT NULL,
        uptime_pct          DECIMAL(8,5) CHECK (uptime_pct BETWEEN 0 AND 100),
        contract_sla_pct    DECIMAL(7,4) NOT NULL,
        projected_uptime    DECIMAL(8,5),
        status              VARCHAR(20) NOT NULL,
        breach_predicted_date DATE,
        report_generated_at   TIMESTAMPTZ,
        report_email_sent_at  TIMESTAMPTZ,
        ses_message_id        VARCHAR(255),
        credits_owed_usd      DECIMAL(10,2),
        credit_formula_version VARCHAR(20),
        formula_version        VARCHAR(20) NOT NULL DEFAULT 'v1',
        is_active_for_display  BOOLEAN NOT NULL DEFAULT true,
        created_at          TIMESTAMPTZ DEFAULT NOW(),
        updated_at          TIMESTAMPTZ DEFAULT NOW(),
        FOREIGN KEY (vendor_id, customer_id) REFERENCES customers(vendor_id, customer_id)
    );
  `);
  // Note: UNIQUE(vendor_id, customer_id, month) intentionally omitted --
  // Section 8.7 requires superseding rows to coexist with the original
  // (append-only correction trail). Uniqueness of the *displayed* row is
  // enforced by is_active_for_display + application logic instead.
  pgm.sql(`CREATE INDEX idx_sla_status_vendor_customer_month ON customer_sla_status(vendor_id, customer_id, month);`);
  pgm.sql(`CREATE UNIQUE INDEX idx_sla_status_one_active_per_month ON customer_sla_status(vendor_id, customer_id, month) WHERE is_active_for_display;`);

  // ---------------------------------------------------------------------
  // sla_intraday_status (non-official hourly rollup)
  // ---------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE sla_intraday_status (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vendor_id           VARCHAR(100) NOT NULL,
        customer_id         VARCHAR(100) NOT NULL,
        computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        uptime_pct_mtd      DECIMAL(8,5),
        downtime_minutes_mtd INTEGER,
        status              VARCHAR(20) NOT NULL,
        source_data_complete BOOLEAN DEFAULT true,
        FOREIGN KEY (vendor_id, customer_id) REFERENCES customers(vendor_id, customer_id)
    );
  `);
  pgm.sql(`CREATE INDEX idx_intraday_vendor_customer ON sla_intraday_status(vendor_id, customer_id);`);
  pgm.sql(`CREATE INDEX idx_intraday_vendor_customer_ts ON sla_intraday_status(vendor_id, customer_id, computed_at);`);

  // ---------------------------------------------------------------------
  // sla_audit_log (hash-chained, insert-only)
  // ---------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE sla_audit_log (
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
  pgm.sql(`CREATE INDEX idx_audit_log_vendor_customer_ts ON sla_audit_log(vendor_id, customer_id, event_timestamp);`);

  // ---------------------------------------------------------------------
  // sla_corrections (Section 8.7 Ops-Initiated Correction)
  // ---------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE sla_corrections (
        id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vendor_id               VARCHAR(100) NOT NULL,
        customer_id             VARCHAR(100) NOT NULL,
        month                   VARCHAR(7) NOT NULL,
        original_status_id      UUID NOT NULL REFERENCES customer_sla_status(id),
        corrected_status_id     UUID REFERENCES customer_sla_status(id),
        reason                  TEXT NOT NULL,
        raised_by               VARCHAR(100) NOT NULL,
        raised_at               TIMESTAMPTZ DEFAULT NOW(),
        approved_by             VARCHAR(100),
        approved_at             TIMESTAMPTZ,
        customer_notified_at    TIMESTAMPTZ,
        FOREIGN KEY (vendor_id, customer_id) REFERENCES customers(vendor_id, customer_id),
        CONSTRAINT no_self_approval CHECK (approved_by IS NULL OR approved_by != raised_by)
    );
  `);

  // ---------------------------------------------------------------------
  // notifications (local-dev stand-in for Slack/PagerDuty, Section 13.4)
  // ---------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE notifications (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vendor_id       VARCHAR(100) NOT NULL,
        customer_id     VARCHAR(100),
        channel         VARCHAR(20) NOT NULL, -- SLACK | PAGERDUTY
        severity        VARCHAR(20) NOT NULL, -- LOW | MEDIUM | HIGH | CRITICAL
        message         TEXT NOT NULL,
        created_at      TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  pgm.sql(`CREATE INDEX idx_notifications_vendor_ts ON notifications(vendor_id, created_at DESC);`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS notifications;`);
  pgm.sql(`DROP TABLE IF EXISTS sla_corrections;`);
  pgm.sql(`DROP TABLE IF EXISTS sla_audit_log;`);
  pgm.sql(`DROP TABLE IF EXISTS sla_intraday_status;`);
  pgm.sql(`DROP TABLE IF EXISTS customer_sla_status;`);
  pgm.sql(`DROP FUNCTION IF EXISTS ensure_availability_minutes_partition(DATE);`);
  pgm.sql(`DROP TABLE IF EXISTS availability_minutes;`);
  pgm.sql(`DROP TABLE IF EXISTS customers;`);
  pgm.sql(`DROP TABLE IF EXISTS vendor_accounts;`);
};
