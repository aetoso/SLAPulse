// Downtime classification, reused by the on-demand AWS root-cause
// snapshot (src/lib/awsRootCause.ts): a monitor's endpoint is
// classified DOWNTIME when Route53 health checks are failing AND the
// ALB target group is unhealthy AND ECS has no healthy running tasks --
// three independent signals have to agree before calling it downtime,
// so a single flaky signal doesn't produce a false DOWNTIME verdict.
//
// Infrastructure Downtime = (route53_status == "FAILURE")
//                        AND (alb_5xx_pct > 50.0)
//                        AND (ecs_running_tasks == 0 OR ecs_health_status == "UNHEALTHY")

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

  if (infrastructureDowntime) {
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
