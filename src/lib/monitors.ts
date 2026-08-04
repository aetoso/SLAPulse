import crypto from "crypto";
import { withTenant } from "./db";
import { appendMonitorAuditEvent } from "./monitorAuditLog";
import type { CheckType } from "./uptimeProbe";

export interface MaintenanceWindow {
  start: string;
  end: string;
}

export interface Monitor {
  id: string;
  vendorId: string;
  monitorId: string;
  name: string;
  targetUrl: string;
  checkType: CheckType;
  port: number | null;
  intervalSeconds: number;
  contractSlaPct: number;
  status: string;
  createdAt: string;
  regions: string[];
  keyword: string | null;
  keywordMode: "PRESENT" | "ABSENT" | null;
  sslCheckEnabled: boolean;
  sslExpiryWarningDays: number;
  sslValidUntil: string | null;
  sslIssuer: string | null;
  sslLastCheckedAt: string | null;
  confirmationMinutes: number;
  webhookUrl: string | null;
  heartbeatToken: string | null;
  heartbeatExpectedIntervalSeconds: number | null;
  heartbeatGraceSeconds: number | null;
  lastHeartbeatAt: string | null;
  maintenanceWindows: MaintenanceWindow[];
  showOnStatusPage: boolean;
  lastNotifiedStatus: string | null;
  // Optional AWS resource tags -- when set (and the vendor has a
  // CONNECTED AWS integration), the monitor detail page can run an
  // on-demand real root-cause lookup against these resources.
  awsAlbTargetGroupArn: string | null;
  awsEcsClusterName: string | null;
  awsEcsServiceName: string | null;
  awsRoute53HealthCheckId: string | null;
}

function mapRow(r: Record<string, unknown>): Monitor {
  return {
    id: r.id as string,
    vendorId: r.vendor_id as string,
    monitorId: r.monitor_id as string,
    name: r.name as string,
    targetUrl: r.target_url as string,
    checkType: r.check_type as CheckType,
    port: (r.port as number) ?? null,
    intervalSeconds: r.interval_seconds as number,
    contractSlaPct: Number(r.contract_sla_pct),
    status: r.status as string,
    createdAt: r.created_at as string,
    regions: (r.regions as string[]) ?? [],
    keyword: (r.keyword as string) ?? null,
    keywordMode: (r.keyword_mode as "PRESENT" | "ABSENT") ?? null,
    sslCheckEnabled: r.ssl_check_enabled as boolean,
    sslExpiryWarningDays: r.ssl_expiry_warning_days as number,
    sslValidUntil: (r.ssl_valid_until as string) ?? null,
    sslIssuer: (r.ssl_issuer as string) ?? null,
    sslLastCheckedAt: (r.ssl_last_checked_at as string) ?? null,
    confirmationMinutes: r.confirmation_minutes as number,
    webhookUrl: (r.webhook_url as string) ?? null,
    heartbeatToken: (r.heartbeat_token as string) ?? null,
    heartbeatExpectedIntervalSeconds: (r.heartbeat_expected_interval_seconds as number) ?? null,
    heartbeatGraceSeconds: (r.heartbeat_grace_seconds as number) ?? null,
    lastHeartbeatAt: (r.last_heartbeat_at as string) ?? null,
    maintenanceWindows: (r.maintenance_windows as MaintenanceWindow[]) ?? [],
    showOnStatusPage: r.show_on_status_page as boolean,
    lastNotifiedStatus: (r.last_notified_status as string) ?? null,
    awsAlbTargetGroupArn: (r.aws_alb_target_group_arn as string) ?? null,
    awsEcsClusterName: (r.aws_ecs_cluster_name as string) ?? null,
    awsEcsServiceName: (r.aws_ecs_service_name as string) ?? null,
    awsRoute53HealthCheckId: (r.aws_route53_health_check_id as string) ?? null,
  };
}

export async function listMonitors(vendorId: string, opts: { activeOnly?: boolean } = {}): Promise<Monitor[]> {
  return withTenant(vendorId, async (client) => {
    const where = opts.activeOnly ? "WHERE status = 'ACTIVE'" : "";
    const { rows } = await client.query(`SELECT * FROM uptime_monitors ${where} ORDER BY name`);
    return rows.map(mapRow);
  });
}

export async function getMonitor(vendorId: string, monitorId: string): Promise<Monitor | null> {
  return withTenant(vendorId, async (client) => {
    const { rows } = await client.query(`SELECT * FROM uptime_monitors WHERE monitor_id = $1`, [monitorId]);
    return rows[0] ? mapRow(rows[0]) : null;
  });
}

export interface CreateMonitorInput {
  monitorId: string;
  name: string;
  targetUrl: string;
  checkType: CheckType;
  port?: number | null;
  intervalSeconds?: number;
  contractSlaPct: number;
  regions?: string[];
  keyword?: string | null;
  keywordMode?: "PRESENT" | "ABSENT" | null;
  sslCheckEnabled?: boolean;
  sslExpiryWarningDays?: number;
  confirmationMinutes?: number;
  webhookUrl?: string | null;
  heartbeatExpectedIntervalSeconds?: number | null;
  heartbeatGraceSeconds?: number | null;
  showOnStatusPage?: boolean;
  awsAlbTargetGroupArn?: string | null;
  awsEcsClusterName?: string | null;
  awsEcsServiceName?: string | null;
  awsRoute53HealthCheckId?: string | null;
}

const ALL_REGIONS = ["us-east-1", "eu-west-1", "ap-southeast-1"];

export async function createMonitor(vendorId: string, actor: string, input: CreateMonitorInput): Promise<Monitor> {
  return withTenant(vendorId, async (client) => {
    const heartbeatToken = input.checkType === "HEARTBEAT" ? "hb_" + crypto.randomBytes(20).toString("hex") : null;

    const { rows } = await client.query(
      `INSERT INTO uptime_monitors
         (vendor_id, monitor_id, name, target_url, check_type, port, interval_seconds, contract_sla_pct,
          regions, keyword, keyword_mode, ssl_check_enabled, ssl_expiry_warning_days,
          confirmation_minutes, webhook_url, heartbeat_token, heartbeat_expected_interval_seconds,
          heartbeat_grace_seconds, show_on_status_page,
          aws_alb_target_group_arn, aws_ecs_cluster_name, aws_ecs_service_name, aws_route53_health_check_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       RETURNING *`,
      [
        vendorId,
        input.monitorId,
        input.name,
        input.targetUrl,
        input.checkType,
        input.port ?? null,
        input.intervalSeconds ?? 60,
        input.contractSlaPct,
        input.regions && input.regions.length > 0 ? input.regions : ALL_REGIONS,
        input.keyword ?? null,
        input.keywordMode ?? null,
        input.sslCheckEnabled ?? true,
        input.sslExpiryWarningDays ?? 14,
        input.confirmationMinutes ?? 1,
        input.webhookUrl ?? null,
        heartbeatToken,
        input.heartbeatExpectedIntervalSeconds ?? null,
        input.heartbeatGraceSeconds ?? null,
        input.showOnStatusPage ?? true,
        input.awsAlbTargetGroupArn ?? null,
        input.awsEcsClusterName ?? null,
        input.awsEcsServiceName ?? null,
        input.awsRoute53HealthCheckId ?? null,
      ]
    );
    await appendMonitorAuditEvent(client, {
      vendorId,
      monitorId: input.monitorId,
      eventType: "MONITOR_CREATED",
      actor,
      description: `Monitor "${input.name}" created for ${input.targetUrl} (${input.checkType})`,
      metadata: { targetUrl: input.targetUrl, checkType: input.checkType, contractSlaPct: input.contractSlaPct },
    });
    return mapRow(rows[0]);
  });
}

export async function setMonitorStatus(vendorId: string, monitorId: string, status: "ACTIVE" | "PAUSED", actor: string): Promise<void> {
  await withTenant(vendorId, async (client) => {
    await client.query(`UPDATE uptime_monitors SET status = $1, updated_at = NOW() WHERE vendor_id = $2 AND monitor_id = $3`, [
      status,
      vendorId,
      monitorId,
    ]);
    await appendMonitorAuditEvent(client, {
      vendorId,
      monitorId,
      eventType: status === "ACTIVE" ? "MONITOR_RESUMED" : "MONITOR_PAUSED",
      actor,
      description: `Monitor ${status === "ACTIVE" ? "resumed" : "paused"}`,
    });
  });
}

export async function addMaintenanceWindow(vendorId: string, monitorId: string, window: MaintenanceWindow): Promise<MaintenanceWindow[]> {
  return withTenant(vendorId, async (client) => {
    const { rows } = await client.query(`SELECT maintenance_windows FROM uptime_monitors WHERE vendor_id = $1 AND monitor_id = $2`, [
      vendorId,
      monitorId,
    ]);
    const updated = [...(rows[0]?.maintenance_windows ?? []), window];
    await client.query(`UPDATE uptime_monitors SET maintenance_windows = $1 WHERE vendor_id = $2 AND monitor_id = $3`, [
      JSON.stringify(updated),
      vendorId,
      monitorId,
    ]);
    return updated;
  });
}

export async function removeMaintenanceWindow(vendorId: string, monitorId: string, index: number): Promise<MaintenanceWindow[]> {
  return withTenant(vendorId, async (client) => {
    const { rows } = await client.query(`SELECT maintenance_windows FROM uptime_monitors WHERE vendor_id = $1 AND monitor_id = $2`, [
      vendorId,
      monitorId,
    ]);
    const updated = (rows[0]?.maintenance_windows ?? []).filter((_: unknown, i: number) => i !== index);
    await client.query(`UPDATE uptime_monitors SET maintenance_windows = $1 WHERE vendor_id = $2 AND monitor_id = $3`, [
      JSON.stringify(updated),
      vendorId,
      monitorId,
    ]);
    return updated;
  });
}
