/* eslint-disable camelcase */

// Feature parity with UptimeRobot/Better Stack for Product 1: region
// selection, SSL expiry monitoring, keyword checks, heartbeat/cron
// monitoring, webhook alerts, maintenance windows, and a public status
// page. Same tenant_isolation RLS pattern as every other table.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE uptime_monitors DROP CONSTRAINT uptime_monitors_check_type_check;`);
  pgm.sql(`
    ALTER TABLE uptime_monitors ADD CONSTRAINT uptime_monitors_check_type_check
      CHECK (check_type IN ('HTTPS', 'TCP', 'PING', 'KEYWORD', 'HEARTBEAT'));
  `);

  pgm.sql(`
    ALTER TABLE uptime_monitors
      ADD COLUMN regions TEXT[] NOT NULL DEFAULT ARRAY['us-east-1','eu-west-1','ap-southeast-1'],
      ADD COLUMN keyword VARCHAR(255),
      ADD COLUMN keyword_mode VARCHAR(10) CHECK (keyword_mode IN ('PRESENT', 'ABSENT')),
      ADD COLUMN ssl_check_enabled BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN ssl_expiry_warning_days INTEGER NOT NULL DEFAULT 14,
      ADD COLUMN ssl_valid_until TIMESTAMPTZ,
      ADD COLUMN ssl_issuer VARCHAR(255),
      ADD COLUMN ssl_last_checked_at TIMESTAMPTZ,
      ADD COLUMN confirmation_minutes INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN webhook_url VARCHAR(500),
      ADD COLUMN heartbeat_token VARCHAR(64) UNIQUE,
      ADD COLUMN heartbeat_expected_interval_seconds INTEGER,
      ADD COLUMN heartbeat_grace_seconds INTEGER,
      ADD COLUMN last_heartbeat_at TIMESTAMPTZ,
      ADD COLUMN maintenance_windows JSONB NOT NULL DEFAULT '[]',
      ADD COLUMN show_on_status_page BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN last_notified_status VARCHAR(10);
  `);

  pgm.sql(`
    CREATE TABLE monitor_status_page_config (
        vendor_id   VARCHAR(100) PRIMARY KEY REFERENCES vendor_accounts(vendor_id),
        title       VARCHAR(255) NOT NULL DEFAULT 'Status',
        is_public   BOOLEAN NOT NULL DEFAULT true,
        updated_at  TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  pgm.sql(`ALTER TABLE monitor_status_page_config ENABLE ROW LEVEL SECURITY;`);
  pgm.sql(`ALTER TABLE monitor_status_page_config FORCE ROW LEVEL SECURITY;`);
  pgm.sql(`
    CREATE POLICY tenant_isolation ON monitor_status_page_config
      USING (vendor_id = current_setting('app.current_vendor_id', true));
  `);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO slapulse_app;`);

  // Heartbeat ping endpoint has no vendor context until the token is
  // resolved -- same SECURITY DEFINER pattern as magic-link/API-key
  // lookup (migrations/*_portal-token-lookup.js, *_portal-api-key.js).
  pgm.sql(`
    CREATE OR REPLACE FUNCTION find_monitor_by_heartbeat_token(p_token VARCHAR)
    RETURNS TABLE(vendor_id VARCHAR, monitor_id VARCHAR)
    SECURITY DEFINER
    SET search_path = public
    LANGUAGE sql
    AS $$
      SELECT vendor_id, monitor_id FROM uptime_monitors WHERE heartbeat_token = p_token;
    $$;
  `);
  pgm.sql(`GRANT EXECUTE ON FUNCTION find_monitor_by_heartbeat_token(VARCHAR) TO slapulse_app;`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP FUNCTION IF EXISTS find_monitor_by_heartbeat_token(VARCHAR);`);
  pgm.sql(`DROP TABLE IF EXISTS monitor_status_page_config;`);
  pgm.sql(`
    ALTER TABLE uptime_monitors
      DROP COLUMN IF EXISTS regions,
      DROP COLUMN IF EXISTS keyword,
      DROP COLUMN IF EXISTS keyword_mode,
      DROP COLUMN IF EXISTS ssl_check_enabled,
      DROP COLUMN IF EXISTS ssl_expiry_warning_days,
      DROP COLUMN IF EXISTS ssl_valid_until,
      DROP COLUMN IF EXISTS ssl_issuer,
      DROP COLUMN IF EXISTS ssl_last_checked_at,
      DROP COLUMN IF EXISTS confirmation_minutes,
      DROP COLUMN IF EXISTS webhook_url,
      DROP COLUMN IF EXISTS heartbeat_token,
      DROP COLUMN IF EXISTS heartbeat_expected_interval_seconds,
      DROP COLUMN IF EXISTS heartbeat_grace_seconds,
      DROP COLUMN IF EXISTS last_heartbeat_at,
      DROP COLUMN IF EXISTS maintenance_windows,
      DROP COLUMN IF EXISTS show_on_status_page,
      DROP COLUMN IF EXISTS last_notified_status;
  `);
};
