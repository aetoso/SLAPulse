/* eslint-disable camelcase */

// PF10 Read-Only Customer API: a portal user can generate a long-lived
// API key so the customer's own systems can pull SLA status without a
// human clicking a magic link each time.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE portal_users
      ADD COLUMN api_key VARCHAR(64) UNIQUE,
      ADD COLUMN api_key_last_used_at TIMESTAMPTZ;
  `);
  pgm.sql(`
    CREATE OR REPLACE FUNCTION find_portal_user_by_api_key(p_api_key VARCHAR)
    RETURNS TABLE(vendor_id VARCHAR, customer_id VARCHAR, email VARCHAR)
    SECURITY DEFINER
    SET search_path = public
    LANGUAGE sql
    AS $$
      SELECT vendor_id, customer_id, email FROM portal_users WHERE api_key = p_api_key;
    $$;
  `);
  pgm.sql(`GRANT EXECUTE ON FUNCTION find_portal_user_by_api_key(VARCHAR) TO slapulse_app;`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP FUNCTION IF EXISTS find_portal_user_by_api_key(VARCHAR);`);
  pgm.sql(`ALTER TABLE portal_users DROP COLUMN IF EXISTS api_key, DROP COLUMN IF EXISTS api_key_last_used_at;`);
};
