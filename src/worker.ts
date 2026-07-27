import "dotenv/config";
import cron from "node-cron";
import { runCollectionTick, runCalculationTick, runDailyOpsTick } from "./jobs/dispatcher";

// LOCAL-DEV SUBSTITUTION for EventBridge (Section 8.2-8.4, 9.1). The real
// architecture uses 6 platform-level EventBridge rules (hourly collection,
// daily drift/calc/predict, monthly report, 2h freshness) that fan out via
// SQS/Lambda. Running actual EventBridge+SQS locally would need LocalStack
// or real AWS -- out of scope for bringing this up on a laptop. Instead
// this single Node process ticks on an ACCELERATED local-dev cadence so a
// demo doesn't require waiting real hours between collection and
// calculation: every 30s pull the mock signal source, every 2min recompute
// SLA status. The job functions themselves (src/jobs/*) are cadence-
// agnostic and are exactly what a real Lambda would call.

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
  await tick("collection", () => runCollectionTick());
  await tick("calculation", () => runCalculationTick(ACTOR));
  await tick("dailyOps", () => runDailyOpsTick(ACTOR));
}

console.log("[worker] SLAPulse local-dev worker starting");
console.log("[worker] Running an initial tick immediately...");
runOnce();

// Section 8.2: hourly in production -> every 30s locally.
cron.schedule("*/30 * * * * *", () => tick("collection", () => runCollectionTick()));
// Section 8.3/8.4: daily in production -> every 2 minutes locally.
cron.schedule("*/2 * * * *", () => tick("calculation", () => runCalculationTick(ACTOR)));
// Section 8.6/F7/F11/Section 8.8: daily ops (drift, credits, renewal risk,
// disclosure creation + publish) -> every 3 minutes locally.
cron.schedule("*/3 * * * *", () => tick("dailyOps", () => runDailyOpsTick(ACTOR)));

console.log("[worker] Scheduled: collection every 30s, SLA calculation every 2min, daily ops every 3min.");
