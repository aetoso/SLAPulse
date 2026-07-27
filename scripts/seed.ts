import "dotenv/config";
import { Client } from "pg";
import { appendAuditEvent } from "../src/lib/auditLog";

// Seeds one local-dev vendor account (Section 18.4 pilot cohort is
// vendor-side; this is the vendor whose dashboard we're bringing up) plus
// a handful of monitored customer environments (the vendor's own
// enterprise customers) covering every demo_profile so the dashboard,
// executive portfolio, and evidence explorer all have something to show
// immediately after `npm run worker` runs its first tick.
//
// Uses DATABASE_URL (the migration/owner role, which is a Postgres
// superuser under the docker-compose image and therefore bypasses RLS)
// rather than DATABASE_URL_APP, since seeding needs to write across
// tenant boundaries without an app.current_vendor_id session var set.

const VENDOR_ID = process.env.LOCAL_DEV_VENDOR_ID ?? "acme-saas-co";

const CUSTOMERS = [
  {
    customerId: "beta-inc",
    customerName: "Beta Inc",
    contractSlaPct: 99.9,
    region: "us-east-1",
    demoProfile: "stable",
    assignedCsmUserId: "csm-jordan",
    monthlyFeeUsd: 4000,
    deploymentModel: "MODEL_A",
    syntheticMonitoringEnabled: false,
    contractualNotificationHours: 48,
    renewalDate: null as string | null,
  },
  {
    customerId: "gamma-corp",
    customerName: "Gamma Corp",
    contractSlaPct: 99.9,
    region: "us-east-1",
    demoProfile: "flaky",
    assignedCsmUserId: "csm-jordan",
    monthlyFeeUsd: 6000,
    deploymentModel: "MODEL_A",
    syntheticMonitoringEnabled: false,
    contractualNotificationHours: null as number | null,
    renewalDate: null as string | null,
  },
  {
    customerId: "delta-llc",
    customerName: "Delta LLC",
    contractSlaPct: 99.95,
    region: "us-west-2",
    demoProfile: "degrading",
    assignedCsmUserId: null,
    // No monthly fee on file -- demonstrates F7 skipping credit
    // calculation when the contract $ value isn't captured yet.
    monthlyFeeUsd: null as number | null,
    deploymentModel: "MODEL_B",
    syntheticMonitoringEnabled: false,
    contractualNotificationHours: 24,
    // Renewing soon with a breach in-window -- F11 renewal risk demo.
    renewalDate: "P30D",
  },
  {
    customerId: "epsilon-systems",
    customerName: "Epsilon Systems",
    contractSlaPct: 99.9,
    region: "us-east-1",
    demoProfile: "breached",
    assignedCsmUserId: null,
    monthlyFeeUsd: 12000,
    deploymentModel: "MODEL_A",
    syntheticMonitoringEnabled: false,
    contractualNotificationHours: 12,
    renewalDate: null as string | null,
  },
  {
    customerId: "zeta-health",
    customerName: "Zeta Health",
    contractSlaPct: 99.99,
    region: "us-west-2",
    demoProfile: "data_gap",
    assignedCsmUserId: null,
    monthlyFeeUsd: 9000,
    deploymentModel: "MODEL_A",
    syntheticMonitoringEnabled: false,
    contractualNotificationHours: 24,
    renewalDate: null as string | null,
  },
  {
    customerId: "theta-retail",
    customerName: "Theta Retail",
    contractSlaPct: 99.9,
    region: "us-east-1",
    demoProfile: "app_outage",
    assignedCsmUserId: "csm-jordan",
    monthlyFeeUsd: 5000,
    deploymentModel: "MODEL_A",
    // F-SYN demo: infra signals stay green, only synthetic checks catch
    // the daily outage window (Section 9.2's documented blind spot).
    syntheticMonitoringEnabled: true,
    contractualNotificationHours: null as number | null,
    renewalDate: null as string | null,
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

    for (const c of CUSTOMERS) {
      const renewalDate = c.renewalDate === "P30D" ? "CURRENT_DATE + INTERVAL '30 days'" : "NULL";
      const { rows } = await client.query(
        `INSERT INTO customers
           (vendor_id, customer_id, customer_name, contract_sla_pct, contract_start_date,
            region, assigned_csm_user_id, demo_profile, monthly_fee_usd, deployment_model,
            synthetic_monitoring_enabled, contractual_notification_hours, renewal_date)
         VALUES ($1,$2,$3,$4, CURRENT_DATE - INTERVAL '90 days', $5,$6,$7,$8,$9,$10,$11, ${renewalDate})
         ON CONFLICT (vendor_id, customer_id) DO NOTHING
         RETURNING customer_id`,
        [
          VENDOR_ID,
          c.customerId,
          c.customerName,
          c.contractSlaPct,
          c.region,
          c.assignedCsmUserId,
          c.demoProfile,
          c.monthlyFeeUsd,
          c.deploymentModel,
          c.syntheticMonitoringEnabled,
          c.contractualNotificationHours,
        ]
      );

      if (rows.length > 0) {
        await appendAuditEvent(client, {
          vendorId: VENDOR_ID,
          customerId: c.customerId,
          eventType: "CUSTOMER_REGISTERED",
          actor: "seed-script",
          description: `Customer ${c.customerName} registered with ${c.contractSlaPct}% SLA (demo profile: ${c.demoProfile})`,
          metadata: { contractSlaPct: c.contractSlaPct, region: c.region, demoProfile: c.demoProfile },
        });
        console.log(`  + ${c.customerName} (${c.demoProfile})`);
      } else {
        console.log(`  = ${c.customerName} already exists, skipped`);
      }
    }

    await client.query("COMMIT");
    console.log(`\nSeeded vendor "${VENDOR_ID}" with ${CUSTOMERS.length} customer environments.`);
    console.log(`Next: npm run worker   (or POST /api/jobs/run from the dashboard) to generate SLA data.`);
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
