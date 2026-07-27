import type { EcsHealthStatus, MinuteSignals, Route53Status } from "./detection";

// LOCAL-DEV SUBSTITUTION for Section 8.2's real CloudWatch/Route53/ECS
// calls (cloudwatch:GetMetricData, route53:GetHealthCheckStatus,
// ecs:DescribeServices). No AWS account is available for local dev, so
// this module produces synthetic per-minute signals instead. The shape
// of MinuteSignals matches exactly what the real collector would produce,
// so swapping this module for a real AWS SDK client is the only change
// needed to point at a real environment -- downstream code (detection,
// calculation, evidence explorer) is identical either way.

export type DemoProfile = "stable" | "flaky" | "degrading" | "breached" | "data_gap" | "app_outage";

// Deterministic PRNG (mulberry32) seeded from customerId + minute, so the
// same customer/timestamp always reproduces the same signal -- collection
// re-runs and the evidence explorer see consistent history instead of
// re-rolling randomness on every read.
function seededRandom(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

/**
 * Generates the signals for a single customer-minute according to the
 * customer's demo_profile. Returns null for `dataGap` minutes so the
 * caller can simulate a collector that produced no data (Section 9.4
 * fail-closed completeness logic).
 */
export function generateMinuteSignals(
  customerId: string,
  minuteTimestamp: Date,
  profile: DemoProfile,
  syntheticMonitoringEnabled = false
): { signals: MinuteSignals; dataGap: boolean } {
  const seed = hashString(`${customerId}:${minuteTimestamp.getTime()}`);
  const rand = seededRandom(seed);

  if (profile === "data_gap") {
    // ~15% of minutes silently missing -- pushes completeness below the
    // 98% fail-closed threshold (Section 9.4) for at least part of the month.
    if (rand() < 0.15) {
      return {
        dataGap: true,
        signals: {
          route53Status: null,
          alb5xxPct: null,
          albTotalRequests: null,
          ecsRunningTasks: null,
          ecsDesiredTasks: null,
          ecsHealthStatus: null,
        },
      };
    }
  }

  const desiredTasks = 3;
  let route53Status: Route53Status = "SUCCESS";
  let alb5xxPct = roundTo(rand() * 1.5, 2); // healthy baseline noise
  let ecsRunningTasks = desiredTasks;
  let ecsHealthStatus: EcsHealthStatus = "HEALTHY";

  switch (profile) {
    case "stable":
    case "data_gap": {
      // Rare, brief blips only.
      if (rand() < 0.003) {
        alb5xxPct = roundTo(15 + rand() * 20, 2);
        ecsRunningTasks = desiredTasks - 1;
      }
      break;
    }
    case "flaky": {
      // Frequent DEGRADED, occasional real DOWNTIME.
      const r = rand();
      if (r < 0.02) {
        route53Status = "FAILURE";
        alb5xxPct = roundTo(55 + rand() * 40, 2);
        ecsRunningTasks = 0;
        ecsHealthStatus = "UNHEALTHY";
      } else if (r < 0.12) {
        alb5xxPct = roundTo(12 + rand() * 30, 2);
        ecsRunningTasks = desiredTasks - 1;
      }
      break;
    }
    case "degrading": {
      // Trends worse as the "day" progresses (approximated via minute
      // timestamp so trajectory extrapolation has something real to chew on).
      const minuteOfMonth = minuteTimestamp.getDate() * 1440 + minuteTimestamp.getHours() * 60 + minuteTimestamp.getMinutes();
      const monthProgress = Math.min(1, minuteOfMonth / (28 * 1440));
      const downtimeChance = 0.005 + monthProgress * 0.03;
      if (rand() < downtimeChance) {
        route53Status = "FAILURE";
        alb5xxPct = roundTo(55 + rand() * 40, 2);
        ecsRunningTasks = 0;
        ecsHealthStatus = "UNHEALTHY";
      }
      break;
    }
    case "breached": {
      // A sustained, unambiguous outage window early each day plus
      // background flakiness -- guarantees BREACHED status well before
      // month end so the dashboard has something to show immediately.
      const minuteOfDay = minuteTimestamp.getHours() * 60 + minuteTimestamp.getMinutes();
      const inDailyOutageWindow = minuteOfDay >= 120 && minuteOfDay < 165; // 45 min/day
      if (inDailyOutageWindow || rand() < 0.01) {
        route53Status = "FAILURE";
        alb5xxPct = roundTo(60 + rand() * 35, 2);
        ecsRunningTasks = 0;
        ecsHealthStatus = "UNHEALTHY";
      }
      break;
    }
    case "app_outage": {
      // Section 9.2's documented gap made concrete: infra signals stay
      // green the whole time (no route53/alb/ecs failure), so a customer
      // on this profile with synthetic monitoring OFF shows COMPLIANT
      // even during the daily "outage window" below -- switching
      // synthetic_monitoring_enabled on is what surfaces it.
      break;
    }
  }

  // F-SYN: independent synthetic transaction signal, only produced for
  // customers with synthetic monitoring enabled (Section 6 trigger
  // criteria -- not collected speculatively for everyone).
  let syntheticFailed: boolean | null = null;
  let syntheticResponseTimeMs: number | null = null;
  if (syntheticMonitoringEnabled) {
    const minuteOfDay = minuteTimestamp.getHours() * 60 + minuteTimestamp.getMinutes();
    if (profile === "app_outage") {
      const inDailyAppOutageWindow = minuteOfDay >= 540 && minuteOfDay < 570; // 30 min/day
      syntheticFailed = inDailyAppOutageWindow || rand() < 0.005;
    } else {
      syntheticFailed = rand() < 0.002;
    }
    syntheticResponseTimeMs = syntheticFailed ? 0 : 120 + Math.floor(rand() * 200);
  }

  return {
    dataGap: false,
    signals: {
      route53Status,
      alb5xxPct,
      albTotalRequests: 800 + Math.floor(rand() * 400),
      ecsRunningTasks,
      ecsDesiredTasks: desiredTasks,
      ecsHealthStatus,
      syntheticFailed,
      syntheticResponseTimeMs,
    },
  };
}

function roundTo(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}
