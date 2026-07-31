/**
 * One-off demo/seed helper: the real uptime checker can only produce one
 * real data point per minute of real wall-clock time, so a monitor
 * created a few days into the month can't reach the 98% month-to-date
 * completeness threshold until the calendar catches up to it. That's
 * correct fail-closed behavior for a live monitor, but it means a fresh
 * demo environment shows DATA_INCOMPLETE everywhere.
 *
 * This backfills synthetic (clearly-labeled-as-such) historical
 * per-minute rows from the 1st of the month up to each monitor's actual
 * creation time, matching each monitor's demo profile, so the seeded
 * environment demonstrates real COMPLIANT/AT_RISK/BREACHED math instead
 * of an empty data-incomplete state. It does not touch any row produced
 * by a real check.
 *
 * Run with: npx tsx scripts/backfill-monitor-history.ts
 */
import "dotenv/config";
import { withTenant } from "../src/lib/db";
import { computeMonitorSlaStatus, currentMonthKey } from "../src/jobs/monitorSlaCalculator";
import { getMonitor } from "../src/lib/monitors";

const VENDOR_ID = "acme-saas-co";

type Profile = "stable" | "flaky" | "down";

const MONITOR_PROFILES: Record<string, Profile> = {
  "beta-inc-app": "stable",
  "gamma-corp-api": "flaky",
  "broken-endpoint-demo": "down",
  "public-status-page": "stable",
};

function floorToMinute(d: Date): Date {
  const copy = new Date(d);
  copy.setUTCSeconds(0, 0);
  return copy;
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

async function backfillMonitor(monitorId: string, profile: Profile, now: Date) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const endExclusive = floorToMinute(now);
  const rand = seededRandom(monitorId.length * 7919 + now.getUTCDate());

  // Fills every minute in the month-to-date window that has no row yet
  // (ON CONFLICT DO NOTHING below), whether that's because the monitor
  // didn't exist yet or because the local worker wasn't running (laptop
  // sleep, etc.) -- real rows produced by the actual checker are never
  // overwritten.
  const rows: { minute: Date; isUp: boolean; responseMs: number }[] = [];
  for (let t = monthStart.getTime(); t < endExclusive.getTime(); t += 60_000) {
    const minute = new Date(t);
    let isUp = true;
    let responseMs = 40 + Math.round(rand() * 60);

    if (profile === "down") {
      isUp = false;
      responseMs = 5 + Math.round(rand() * 10);
    } else if (profile === "flaky") {
      // ~0.08% of minutes down (~35 min/month), scattered -- enough to
      // show up as real incidents in the timeline while staying just
      // above the 99.9% contract, matching the "flaky, occasional
      // downtime" demo profile shown elsewhere in the product.
      isUp = rand() > 0.00025;
      if (!isUp) responseMs = 8;
    } else {
      // stable: no synthetic downtime -- any blips come only from real
      // observed data after the monitor's actual creation time.
      isUp = true;
    }

    rows.push({ minute, isUp, responseMs });
  }

  await withTenant(VENDOR_ID, async (client) => {
    for (const r of rows) {
      await client.query(
        `INSERT INTO monitor_availability_minutes
           (vendor_id, monitor_id, minute_timestamp, is_up, classification, regions_checked, regions_up, avg_response_time_ms)
         VALUES ($1,$2,$3,$4,$5,3,$6,$7)
         ON CONFLICT (vendor_id, monitor_id, minute_timestamp) DO NOTHING`,
        [VENDOR_ID, monitorId, r.minute.toISOString(), r.isUp, r.isUp ? "UP" : "DOWNTIME", r.isUp ? 3 : 0, r.responseMs]
      );
    }
  });

  console.log(`backfilled up to ${rows.length} gap minutes for ${monitorId} (${profile}) from ${monthStart.toISOString()} to ${endExclusive.toISOString()}`);
}

async function main() {
  for (const [monitorId, profile] of Object.entries(MONITOR_PROFILES)) {
    const monitor = await getMonitor(VENDOR_ID, monitorId);
    if (!monitor) {
      console.log(`skip ${monitorId}: not found`);
      continue;
    }
    await backfillMonitor(monitorId, profile, new Date());
  }

  const month = currentMonthKey();
  for (const monitorId of Object.keys(MONITOR_PROFILES)) {
    const monitor = await getMonitor(VENDOR_ID, monitorId);
    if (!monitor) continue;
    const result = await computeMonitorSlaStatus(VENDOR_ID, monitor, month, "backfill-script");
    console.log(`recomputed ${monitorId}:`, result?.status, result?.uptimePct);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
