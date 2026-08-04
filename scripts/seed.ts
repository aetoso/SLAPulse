import "dotenv/config";
import { Client } from "pg";

// Seeds one local-dev vendor account (single-tenant: one company, one
// login) plus a handful of monitored endpoints so the dashboard has
// something to show immediately after `npm run worker` runs its first
// tick. github-down.example is a deliberately nonexistent domain so the
// demo has one monitor that genuinely goes DOWNTIME on the very first
// check, not just in theory.
//
// Uses DATABASE_URL (the migration/owner role, which is a Postgres
// superuser under the docker-compose image and therefore bypasses RLS)
// rather than DATABASE_URL_APP, since seeding needs to write without an
// app.current_vendor_id session var set.

const VENDOR_ID = process.env.LOCAL_DEV_VENDOR_ID ?? "acme-saas-co";

const MONITORS = [
  {
    monitorId: "beta-inc-app",
    name: "Main app",
    targetUrl: "https://example.com",
    checkType: "HTTPS" as const,
    contractSlaPct: 99.9,
  },
  {
    monitorId: "gamma-corp-api",
    name: "Public API",
    targetUrl: "https://api.github.com",
    checkType: "HTTPS" as const,
    contractSlaPct: 99.9,
  },
  {
    monitorId: "public-status-page",
    name: "Marketing site",
    targetUrl: "https://www.github.com",
    checkType: "HTTPS" as const,
    contractSlaPct: 99.95,
  },
  {
    monitorId: "broken-endpoint-demo",
    name: "Broken endpoint (demo: genuinely down)",
    targetUrl: "https://this-domain-should-not-exist-slapulse-demo.com",
    checkType: "HTTPS" as const,
    contractSlaPct: 99.9,
  },
] as const;

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO vendor_accounts (vendor_id, vendor_name, plan_tier, status)
       VALUES ($1, $2, 'STARTER', 'ACTIVE')
       ON CONFLICT (vendor_id) DO NOTHING`,
      [VENDOR_ID, "Acme SaaS Co (local dev)"]
    );

    for (const m of MONITORS) {
      const { rows } = await client.query(
        `INSERT INTO uptime_monitors
           (vendor_id, monitor_id, name, target_url, check_type, contract_sla_pct)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (vendor_id, monitor_id) DO NOTHING
         RETURNING monitor_id`,
        [VENDOR_ID, m.monitorId, m.name, m.targetUrl, m.checkType, m.contractSlaPct]
      );
      console.log(rows.length > 0 ? `  + monitor: ${m.name}` : `  = monitor ${m.name} already exists, skipped`);
    }

    await client.query("COMMIT");
    console.log(`\nSeeded vendor "${VENDOR_ID}" with ${MONITORS.length} uptime monitors.`);
    console.log(`Next: npm run worker   (or the "Check now" button on /monitors) to generate SLA data.`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
