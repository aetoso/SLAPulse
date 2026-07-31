import type { PoolClient } from "pg";
import { withTenant } from "@/lib/db";
import { listActiveVendorIds } from "@/lib/vendors";
import { listMonitors, type Monitor } from "@/lib/monitors";
import { runProbe, checkSslCertificate, parseHost } from "@/lib/uptimeProbe";
import { appendMonitorAuditEvent } from "@/lib/monitorAuditLog";

// Product 1 core loop: real external checks from N labeled probe
// "regions" (configurable per monitor), 2-of-3-style quorum required
// before a minute is classified DOWNTIME -- the same false-positive
// guard real uptime monitors (UptimeRobot, Pingdom) use so one flaky
// network blip doesn't read as a customer-visible outage.
//
// HONEST LIMITATION: this process runs from one machine, so the labeled
// "regions" are independent concurrent probe attempts, not requests
// actually originating from different points on the internet. Real
// geographic diversity would mean running this same job from separate
// deployed workers (e.g. Lambda@Edge per region) -- the aggregation
// logic below is unchanged either way, only WHERE the fetch runs differs.
const QUORUM_FRACTION = 0.5; // >50% of configured regions must agree

function floorToMinute(d: Date): Date {
  const copy = new Date(d);
  copy.setUTCSeconds(0, 0);
  return copy;
}

function inMaintenanceWindow(monitor: Monitor, now: Date): boolean {
  return monitor.maintenanceWindows.some((w) => {
    const start = new Date(w.start).getTime();
    const end = new Date(w.end).getTime();
    const t = now.getTime();
    return t >= start && t < end;
  });
}

async function sendWebhook(url: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
  } catch {
    // Webhook delivery is best-effort -- a customer's endpoint being
    // down doesn't get retried indefinitely here; that's a job for a
    // dedicated delivery queue with backoff, out of scope for v1.
  }
}

async function maybeCheckSsl(client: PoolClient, vendorId: string, monitor: Monitor, now: Date) {
  if (!monitor.sslCheckEnabled) return;
  if (monitor.checkType !== "HTTPS" && monitor.checkType !== "KEYWORD") return;
  const lastChecked = monitor.sslLastCheckedAt ? new Date(monitor.sslLastCheckedAt) : null;
  if (lastChecked && now.getTime() - lastChecked.getTime() < 3_600_000) return; // once/hour is plenty

  const { host, port } = parseHost(monitor.targetUrl);
  const ssl = await checkSslCertificate(host, port);

  await client.query(
    `UPDATE uptime_monitors SET ssl_valid_until = $1, ssl_issuer = $2, ssl_last_checked_at = NOW() WHERE vendor_id = $3 AND monitor_id = $4`,
    [ssl.validTo, ssl.issuer, vendorId, monitor.monitorId]
  );

  if (ssl.daysUntilExpiry !== null && ssl.daysUntilExpiry <= monitor.sslExpiryWarningDays) {
    await client.query(
      `INSERT INTO notifications (vendor_id, channel, severity, message) VALUES ($1,'SLACK','HIGH',$2)`,
      [vendorId, `SSL certificate for ${monitor.name} (${host}) expires in ${ssl.daysUntilExpiry} days`]
    );
    if (monitor.webhookUrl) {
      await sendWebhook(monitor.webhookUrl, {
        monitorId: monitor.monitorId,
        name: monitor.name,
        event: "ssl_expiry_warning",
        daysUntilExpiry: ssl.daysUntilExpiry,
        validTo: ssl.validTo,
      });
    }
  }
}

async function checkOneMonitor(vendorId: string, monitor: Monitor, now: Date, actor: string) {
  return withTenant(vendorId, async (client) => {
    const { rows: lastRows } = await client.query<{ max: string | null }>(
      `SELECT MAX(check_timestamp) as max FROM uptime_check_results WHERE vendor_id = $1 AND monitor_id = $2`,
      [vendorId, monitor.monitorId]
    );
    const lastCheck = lastRows[0]?.max ? new Date(lastRows[0].max) : null;
    if (monitor.checkType !== "HEARTBEAT" && lastCheck && now.getTime() - lastCheck.getTime() < monitor.intervalSeconds * 1000) {
      return { checked: false };
    }

    const minute = floorToMinute(now);
    const onMaintenance = inMaintenanceWindow(monitor, now);

    let isUp: boolean;
    let regionsChecked = 0;
    let regionsUp = 0;
    let avgResponseTimeMs: number | null = null;

    if (monitor.checkType === "HEARTBEAT") {
      // Passive check: the monitored system pings us (see
      // /api/public/v1/heartbeat/[token]); we only judge staleness.
      const expected = (monitor.heartbeatExpectedIntervalSeconds ?? 300) + (monitor.heartbeatGraceSeconds ?? 60);
      const lastBeat = monitor.lastHeartbeatAt ? new Date(monitor.lastHeartbeatAt) : null;
      isUp = onMaintenance || (lastBeat !== null && now.getTime() - lastBeat.getTime() <= expected * 1000);
      regionsChecked = 1;
      regionsUp = isUp ? 1 : 0;
    } else if (onMaintenance) {
      isUp = true;
      regionsChecked = monitor.regions.length;
      regionsUp = regionsChecked;
    } else {
      const results = await Promise.all(
        monitor.regions.map(async (region) => ({
          region,
          result: await runProbe(
            monitor.checkType === "PING" ? "TCP" : monitor.checkType,
            monitor.targetUrl,
            monitor.port,
            monitor.keyword,
            monitor.keywordMode
          ),
        }))
      );

      const checkTimestamp = now.toISOString();
      for (const { region, result } of results) {
        await client.query(
          `INSERT INTO uptime_check_results
             (vendor_id, monitor_id, check_timestamp, region, is_up, response_time_ms, status_code, error_message)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (vendor_id, monitor_id, check_timestamp, region) DO NOTHING`,
          [vendorId, monitor.monitorId, checkTimestamp, region, result.isUp, result.responseTimeMs, result.statusCode, result.errorMessage]
        );
      }

      regionsChecked = results.length;
      regionsUp = results.filter((r) => r.result.isUp).length;
      isUp = regionsUp / regionsChecked > QUORUM_FRACTION;
      const responseTimes = results.map((r) => r.result.responseTimeMs).filter((v): v is number => v !== null);
      avgResponseTimeMs = responseTimes.length > 0 ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : null;

      await maybeCheckSsl(client, vendorId, monitor, now);
    }

    const classification = onMaintenance ? "MAINTENANCE" : isUp ? "UP" : "DOWNTIME";

    await client.query(
      `INSERT INTO monitor_availability_minutes
         (vendor_id, monitor_id, minute_timestamp, is_up, classification, regions_checked, regions_up, avg_response_time_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (vendor_id, monitor_id, minute_timestamp) DO UPDATE SET
         is_up = $4, classification = $5, regions_checked = $6, regions_up = $7, avg_response_time_ms = $8`,
      [vendorId, monitor.monitorId, minute.toISOString(), isUp, classification, regionsChecked, regionsUp, avgResponseTimeMs]
    );

    // Confirmation threshold: only fire a notification/webhook once the
    // last N consecutive minutes agree, so a single-minute blip doesn't
    // page anyone even though it's still recorded truthfully in the SLA
    // ledger above.
    if (!onMaintenance) {
      const { rows: recentRows } = await client.query<{ classification: string }>(
        `SELECT classification FROM monitor_availability_minutes
         WHERE vendor_id = $1 AND monitor_id = $2 AND minute_timestamp <= $3
         ORDER BY minute_timestamp DESC LIMIT $4`,
        [vendorId, monitor.monitorId, minute.toISOString(), monitor.confirmationMinutes]
      );
      const confirmedDown =
        recentRows.length === monitor.confirmationMinutes && recentRows.every((r) => r.classification === "DOWNTIME");
      const confirmedUp = classification === "UP";

      if (confirmedDown && monitor.lastNotifiedStatus !== "DOWN") {
        await client.query(`UPDATE uptime_monitors SET last_notified_status = 'DOWN' WHERE vendor_id = $1 AND monitor_id = $2`, [
          vendorId,
          monitor.monitorId,
        ]);
        await client.query(`INSERT INTO notifications (vendor_id, channel, severity, message) VALUES ($1,'SLACK','CRITICAL',$2)`, [
          vendorId,
          `${monitor.name} is DOWN: ${regionsUp}/${regionsChecked} probe regions reachable (confirmed over ${monitor.confirmationMinutes}min)`,
        ]);
        if (monitor.webhookUrl) {
          await sendWebhook(monitor.webhookUrl, {
            monitorId: monitor.monitorId,
            name: monitor.name,
            event: "down",
            regionsUp,
            regionsChecked,
            timestamp: minute.toISOString(),
          });
        }
        await appendMonitorAuditEvent(client, {
          vendorId,
          monitorId: monitor.monitorId,
          eventType: "MINUTE_AGGREGATED",
          actor,
          description: `Confirmed DOWN after ${monitor.confirmationMinutes} consecutive minute(s)`,
          metadata: { minute: minute.toISOString(), regionsUp, regionsChecked },
        });
      } else if (confirmedUp && monitor.lastNotifiedStatus === "DOWN") {
        await client.query(`UPDATE uptime_monitors SET last_notified_status = 'UP' WHERE vendor_id = $1 AND monitor_id = $2`, [
          vendorId,
          monitor.monitorId,
        ]);
        await client.query(`INSERT INTO notifications (vendor_id, channel, severity, message) VALUES ($1,'SLACK','MEDIUM',$2)`, [
          vendorId,
          `${monitor.name} has RECOVERED`,
        ]);
        if (monitor.webhookUrl) {
          await sendWebhook(monitor.webhookUrl, {
            monitorId: monitor.monitorId,
            name: monitor.name,
            event: "up",
            timestamp: minute.toISOString(),
          });
        }
      }
    }

    return { checked: true, isUp };
  });
}

export interface UptimeCheckSummary {
  monitorsChecked: number;
  downNow: number;
}

export async function runUptimeCheckTick(actor: string, now: Date = new Date()): Promise<UptimeCheckSummary> {
  const vendorIds = await listActiveVendorIds();
  let monitorsChecked = 0;
  let downNow = 0;

  for (const vendorId of vendorIds) {
    const monitors = await listMonitors(vendorId, { activeOnly: true });
    for (const monitor of monitors) {
      const result = await checkOneMonitor(vendorId, monitor, now, actor);
      if (result.checked) {
        monitorsChecked++;
        if (!result.isUp) downNow++;
      }
    }
  }

  return { monitorsChecked, downNow };
}
