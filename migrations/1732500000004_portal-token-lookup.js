/* eslint-disable camelcase */

// PF2 magic-link verification needs to look up a portal_users row by an
// opaque token BEFORE knowing which vendor it belongs to -- normal RLS
// (Section 11.1) can't be satisfied because there's no vendor_id to set
// yet. Rather than bypass RLS wholesale for the app role, this is a
// narrow SECURITY DEFINER function: the only cross-tenant read
// slapulse_app can perform, and only by presenting a valid unexpired
// token (a capability, not a role -- the same trust model as a
// password-reset link).

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION find_portal_user_by_token(p_token VARCHAR)
    RETURNS TABLE(vendor_id VARCHAR, customer_id VARCHAR, email VARCHAR, magic_link_expires_at TIMESTAMPTZ)
    SECURITY DEFINER
    SET search_path = public
    LANGUAGE sql
    AS $$
      SELECT vendor_id, customer_id, email, magic_link_expires_at
      FROM portal_users
      WHERE magic_link_token = p_token;
    $$;
  `);
  pgm.sql(`GRANT EXECUTE ON FUNCTION find_portal_user_by_token(VARCHAR) TO slapulse_app;`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP FUNCTION IF EXISTS find_portal_user_by_token(VARCHAR);`);
};
