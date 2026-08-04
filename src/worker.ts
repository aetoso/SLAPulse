import "dotenv/config";
import cron from "node-cron";
import { runMonitorCheckTick, runMonitorCalculationTick } from "./jobs/dispatcher";

// Uptime Monitoring runs on its own, REAL cadence -- checks every 30s (a
// monitor only actually probes once its own interval_seconds has elapsed,
// checked inside runMonitorCheckTick), SLA rollup every 2min. The network
// calls underneath are real, not simulated.

const ACTOR = "slapulse-worker";

async function tick(label: string, fn: () => Promise<unknown>) {
  const start = Date.now();
  try {
    const result = await fn();
    console.log(`[worker] ${label} ok in ${Date.now() - start}ms`, result);
  } catch (err) {
    console.error(`[worker] ${label} FAILED`, err);
  }
}

async function runOnce() {
  await tick("monitorCheck", () => runMonitorCheckTick(ACTOR));
  await tick("monitorCalculation", () => runMonitorCalculationTick(ACTOR));
}

console.log("[worker] SLAPulse local-dev worker starting");
console.log("[worker] Running an initial tick immediately...");
runOnce();

// Real external checks -- every 30s (per-monitor interval enforced inside
// the job itself).
cron.schedule("*/30 * * * * *", () => tick("monitorCheck", () => runMonitorCheckTick(ACTOR)));
// Monthly SLA rollup from the checks above -> every 2 minutes.
cron.schedule("*/2 * * * *", () => tick("monitorCalculation", () => runMonitorCalculationTick(ACTOR)));

console.log("[worker] Scheduled: monitor checks every 30s, monitor calc every 2min.");
