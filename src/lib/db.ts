import { Pool, type PoolClient, types } from "pg";

// node-postgres parses DATE columns (OID 1082) into JS Date objects by
// default, which then serialize as full ISO timestamps ("2026-07-24T18:30:00.000Z")
// instead of the plain "YYYY-MM-DD" the column actually stores. Keep dates
// as raw strings -- callers that need a Date can parse it themselves.
types.setTypeParser(1082, (val: string) => val);

// Section 11.5: RLS is only effective if the app sets the session's
// vendor context on every transaction and never leaks it across pooled
// connections. This module is the single place that is allowed to talk
// to Postgres -- every other module goes through withTenant()/withAdmin().

const connectionString = process.env.DATABASE_URL_APP;
if (!connectionString) {
  throw new Error("DATABASE_URL_APP is not set");
}

const pool = new Pool({ connectionString, max: 10 });

/**
 * Runs `fn` inside a transaction with `app.current_vendor_id` set via
 * SET LOCAL, so Postgres RLS policies scope every query to this vendor --
 * even if application code forgets a WHERE clause. SET LOCAL (not SET) is
 * mandatory: it is transaction-scoped, so a pooled connection can't leak
 * one vendor's context into the next request that reuses it.
 */
export async function withTenant<T>(
  vendorId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  if (!vendorId) {
    // Fail-closed (Section 11.5, item 2): never proceed with an empty
    // or missing vendor context.
    throw new Error("withTenant() called without a vendorId");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // SET LOCAL does not support bind parameters (it's not a DML
    // statement) -- set_config(..., true) is the parameterized
    // equivalent, still scoped to the current transaction.
    await client.query("SELECT set_config('app.current_vendor_id', $1, true)", [vendorId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Cross-tenant operations only (e.g. resolving which vendor a login
 * belongs to). No RLS context is set, so this only works against
 * non-tenant tables (vendor_accounts) -- tenant tables will return zero
 * rows under FORCE ROW LEVEL SECURITY without app.current_vendor_id set.
 */
export async function withAdmin<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export default pool;
