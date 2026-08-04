import { STSClient, AssumeRoleCommand, type Credentials } from "@aws-sdk/client-sts";
import { ElasticLoadBalancingV2Client, DescribeTargetHealthCommand } from "@aws-sdk/client-elastic-load-balancing-v2";
import { ECSClient, DescribeServicesCommand } from "@aws-sdk/client-ecs";
import { Route53Client, GetHealthCheckStatusCommand } from "@aws-sdk/client-route-53";
import { getAwsConnection } from "./awsConnection";
import { getMonitor, type Monitor } from "./monitors";
import { classifyMinute, type MinuteSignals, type EcsHealthStatus, type Classification } from "./detection";

// On-demand real root-cause snapshot: "why is this monitor down right
// now" using the vendor's own connected AWS account, scoped to whatever
// resources they've tagged on the monitor. Deliberately NOT a historical
// time-series (no new table, no cron job) -- this reuses the existing
// STS AssumeRole connection and detection.ts's classifier for a single,
// manually-triggered live snapshot.

export interface RootCauseSnapshot {
  available: boolean;
  reason?: string;
  classification?: Classification;
  checkedAt?: string;
  alb?: { targetGroupArn: string; healthy: number; unhealthy: number; other: number; error?: string };
  ecs?: { cluster: string; service: string; runningCount: number; desiredCount: number; error?: string };
  route53?: { healthCheckId: string; status: string; error?: string };
}

export async function checkMonitorRootCause(vendorId: string, monitorId: string): Promise<RootCauseSnapshot> {
  const monitor = await getMonitor(vendorId, monitorId);
  if (!monitor) return { available: false, reason: "Monitor not found." };

  const hasAnyTag = monitor.awsAlbTargetGroupArn || (monitor.awsEcsClusterName && monitor.awsEcsServiceName) || monitor.awsRoute53HealthCheckId;
  if (!hasAnyTag) {
    return { available: false, reason: "This monitor has no AWS resource tags configured yet." };
  }

  const connection = await getAwsConnection(vendorId);
  if (connection.status !== "CONNECTED" || !connection.roleArn || !connection.region) {
    return { available: false, reason: "AWS is not connected for this account yet. Set it up under AWS Integration." };
  }

  const sts = new STSClient({ region: connection.region });
  let credentials: Credentials | undefined;
  try {
    const assumed = await sts.send(
      new AssumeRoleCommand({
        RoleArn: connection.roleArn,
        RoleSessionName: "slapulse-root-cause",
        ExternalId: connection.externalId,
        DurationSeconds: 900,
      })
    );
    credentials = assumed.Credentials;
  } catch (err) {
    return { available: false, reason: `Could not assume the connected AWS role: ${(err as Error).message}` };
  } finally {
    sts.destroy();
  }

  if (!credentials?.AccessKeyId || !credentials.SecretAccessKey) {
    return { available: false, reason: "AssumeRole returned no usable credentials." };
  }

  const awsCreds = {
    accessKeyId: credentials.AccessKeyId,
    secretAccessKey: credentials.SecretAccessKey,
    sessionToken: credentials.SessionToken,
  };

  const [alb, ecs, route53] = await Promise.all([
    checkAlb(monitor, connection.region, awsCreds),
    checkEcs(monitor, connection.region, awsCreds),
    checkRoute53(monitor, connection.region, awsCreds),
  ]);

  const signals: MinuteSignals = {
    route53Status: route53 ? (route53.error ? null : route53.status === "Success" ? "SUCCESS" : "FAILURE") : null,
    // No real per-request 5xx metric without CloudWatch (out of MVP
    // scope) -- proxy with the unhealthy-target ratio from ALB target
    // health, which the classifier treats the same way.
    alb5xxPct: alb && !alb.error ? (alb.unhealthy / Math.max(1, alb.healthy + alb.unhealthy + alb.other)) * 100 : null,
    albTotalRequests: null,
    ecsRunningTasks: ecs && !ecs.error ? ecs.runningCount : null,
    ecsDesiredTasks: ecs && !ecs.error ? ecs.desiredCount : null,
    ecsHealthStatus: ecs && !ecs.error ? ecsHealthStatus(ecs) : null,
  };

  const { classification } = classifyMinute(signals, false);

  return {
    available: true,
    checkedAt: new Date().toISOString(),
    classification,
    alb: alb ?? undefined,
    ecs: ecs ?? undefined,
    route53: route53 ?? undefined,
  };
}

function ecsHealthStatus(ecs: { runningCount: number; desiredCount: number }): EcsHealthStatus {
  return ecs.runningCount >= ecs.desiredCount && ecs.runningCount > 0 ? "HEALTHY" : "UNHEALTHY";
}

type AwsCreds = { accessKeyId: string; secretAccessKey: string; sessionToken?: string };

async function checkAlb(
  monitor: Monitor,
  region: string,
  credentials: AwsCreds
): Promise<RootCauseSnapshot["alb"] | null> {
  if (!monitor.awsAlbTargetGroupArn) return null;
  const client = new ElasticLoadBalancingV2Client({ region, credentials });
  try {
    const result = await client.send(new DescribeTargetHealthCommand({ TargetGroupArn: monitor.awsAlbTargetGroupArn }));
    const states = (result.TargetHealthDescriptions ?? []).map((t) => t.TargetHealth?.State);
    return {
      targetGroupArn: monitor.awsAlbTargetGroupArn,
      healthy: states.filter((s) => s === "healthy").length,
      unhealthy: states.filter((s) => s === "unhealthy").length,
      other: states.filter((s) => s !== "healthy" && s !== "unhealthy").length,
    };
  } catch (err) {
    return { targetGroupArn: monitor.awsAlbTargetGroupArn, healthy: 0, unhealthy: 0, other: 0, error: (err as Error).message };
  } finally {
    client.destroy();
  }
}

async function checkEcs(monitor: Monitor, region: string, credentials: AwsCreds): Promise<RootCauseSnapshot["ecs"] | null> {
  if (!monitor.awsEcsClusterName || !monitor.awsEcsServiceName) return null;
  const client = new ECSClient({ region, credentials });
  try {
    const result = await client.send(
      new DescribeServicesCommand({ cluster: monitor.awsEcsClusterName, services: [monitor.awsEcsServiceName] })
    );
    const service = result.services?.[0];
    if (!service) {
      return {
        cluster: monitor.awsEcsClusterName,
        service: monitor.awsEcsServiceName,
        runningCount: 0,
        desiredCount: 0,
        error: "Service not found in that cluster.",
      };
    }
    return {
      cluster: monitor.awsEcsClusterName,
      service: monitor.awsEcsServiceName,
      runningCount: service.runningCount ?? 0,
      desiredCount: service.desiredCount ?? 0,
    };
  } catch (err) {
    return {
      cluster: monitor.awsEcsClusterName,
      service: monitor.awsEcsServiceName,
      runningCount: 0,
      desiredCount: 0,
      error: (err as Error).message,
    };
  } finally {
    client.destroy();
  }
}

async function checkRoute53(monitor: Monitor, region: string, credentials: AwsCreds): Promise<RootCauseSnapshot["route53"] | null> {
  if (!monitor.awsRoute53HealthCheckId) return null;
  // Route 53 is a global service; the API is only served from us-east-1.
  const client = new Route53Client({ region: "us-east-1", credentials });
  try {
    const result = await client.send(new GetHealthCheckStatusCommand({ HealthCheckId: monitor.awsRoute53HealthCheckId }));
    const latest = result.HealthCheckObservations?.[0]?.StatusReport?.Status ?? "Unknown";
    return { healthCheckId: monitor.awsRoute53HealthCheckId, status: latest };
  } catch (err) {
    return { healthCheckId: monitor.awsRoute53HealthCheckId, status: "Unknown", error: (err as Error).message };
  } finally {
    client.destroy();
  }
}
