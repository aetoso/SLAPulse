// Section 9.2 — Downtime Detection Algorithm (corrected), extended by
// F-SYN (Section 6) for customers with synthetic_monitoring_enabled.
//
// Infrastructure Downtime = (route53_status == "FAILURE")
//                        AND (alb_5xx_pct > 50.0)
//                        AND (ecs_running_tasks == 0 OR ecs_health_status == "UNHEALTHY")
//
// Application Downtime = (synthetic_failed == true)
//                     AND (route53_status != "FAILURE")
//                     AND (alb_5xx_pct <= 50.0)
//
// downtime_minute = Infrastructure Downtime OR Application Downtime
//
// These are two INDEPENDENT paths, not merged into a single expression --
// mixing synthetic_failed into the infra conditions would let a synthetic
// failure get masked by healthy infra signals, which is the exact gap
// F-SYN exists to close (Section 6, F-SYN architecture note). This
// function is the credibility moat referenced in Section 19.5 — keep it
// exactly as specified, do not "improve" it without going through the spec.

export type Route53Status = "SUCCESS" | "FAILURE";
export type EcsHealthStatus = "HEALTHY" | "UNHEALTHY";
export type Classification = "UP" | "DEGRADED" | "DOWNTIME" | "MAINTENANCE" | "UNKNOWN";

export interface MinuteSignals {
  route53Status: Route53Status | null;
  alb5xxPct: number | null;
  albTotalRequests: number | null;
  ecsRunningTasks: number | null;
  ecsDesiredTasks: number | null;
  ecsHealthStatus: EcsHealthStatus | null;
  syntheticFailed?: boolean | null;
  syntheticResponseTimeMs?: number | null;
}

export interface ClassificationResult {
  classification: Classification;
  isAvailable: boolean;
}

const DOWNTIME_5XX_THRESHOLD = 50.0;

export function classifyMinute(
  signals: MinuteSignals,
  isMaintenanceWindow: boolean
): ClassificationResult {
  const { route53Status, alb5xxPct, ecsRunningTasks, ecsDesiredTasks, ecsHealthStatus } = signals;

  // No data from any source -> collector failure, not silently UP.
  const hasNoData =
    route53Status === null && alb5xxPct === null && ecsRunningTasks === null && ecsHealthStatus === null;
  if (hasNoData) {
    return { classification: "UNKNOWN", isAvailable: false };
  }

  if (isMaintenanceWindow) {
    return { classification: "MAINTENANCE", isAvailable: true };
  }

  const route53Failed = route53Status === "FAILURE";
  const alb5xxOverThreshold = (alb5xxPct ?? 0) > DOWNTIME_5XX_THRESHOLD;
  const ecsUnhealthy = ecsRunningTasks === 0 || ecsHealthStatus === "UNHEALTHY";

  const infrastructureDowntime = route53Failed && alb5xxOverThreshold && ecsUnhealthy;
  const applicationDowntime =
    signals.syntheticFailed === true && !route53Failed && (alb5xxPct ?? 0) <= DOWNTIME_5XX_THRESHOLD;

  if (infrastructureDowntime || applicationDowntime) {
    return { classification: "DOWNTIME", isAvailable: false };
  }

  // Partial-signal degradation (Section 9.2 table).
  const alb5xxElevated = (alb5xxPct ?? 0) >= 10 && (alb5xxPct ?? 0) <= 50;
  const ecsCapacityShort =
    ecsRunningTasks !== null && ecsDesiredTasks !== null && ecsRunningTasks < ecsDesiredTasks;

  if (route53Failed || alb5xxElevated || ecsCapacityShort) {
    return { classification: "DEGRADED", isAvailable: true };
  }

  return { classification: "UP", isAvailable: true };
}
