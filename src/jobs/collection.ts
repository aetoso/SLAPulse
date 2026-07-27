import { randomUUID } from "crypto";
import type { PoolClient } from "pg";
import { withTenant } from "@/lib/db";
import { classifyMinute } from "@/lib/detection";
import { generateMinuteSignals } from "@/lib/mockCollector";
import type { Customer } from "@/lib/customers";

// Section 8.2 Hourly Metrics Collection & Multi-Signal Downtime Detection.
//
// LOCAL-DEV SUBSTITUTION: the real dispatcher fans out one SQS message per
// customer to tg-metrics-collector Lambdas. Here the worker (src/worker.ts)
// calls collectForCustomer() directly, in-process, once per customer --
// same per-customer isolation and idempotency semantics, no SQS needed to
// bring the app up locally.
//
// Each call catches this customer's `availability_minutes` up to "now",
// generating a synthetic collector run for the mock signal source, exactly
// as the real collector would backfill up to 60 x 1-min datapoints via
// GetMetricData(Period=60). Bounded per call so a first-run backfill of a
// month-to-date doesn't block the event loop for too long -- the worker's
// cadence catches the remainder up over subsequent ticks.
const MAX_MINUTES_PER_RUN = 4320; // 3 days per collection tick

function isInMaintenanceWindow(customer: Customer, minute: Date): boolean {
  return customer.maintenanceWindows.some((w) => {
    const start = new Date(w.start).getTime();
    const end = new Date(w.end).getTime();
    const t = minute.getTime();
    return t >= start && t < end;
  });
}

export interface CollectionResult {
  customerId: string;
  minutesWritten: number;
  monthsTouched: string[];
}

export async function collectForCustomer(
  vendorId: string,
  customer: Customer,
  now: Date = new Date()
): Promise<CollectionResult> {
  return withTenant(vendorId, async (client: PoolClient) => {
    const nowFloored = floorToMinute(now);

    const { rows: lastRows } = await client.query<{ max: string | null }>(
      `SELECT MAX(minute_timestamp) as max FROM availability_minutes
       WHERE vendor_id = $1 AND customer_id = $2`,
      [vendorId, customer.customerId]
    );

    const monthStart = new Date(Date.UTC(nowFloored.getUTCFullYear(), nowFloored.getUTCMonth(), 1));
    let cursor = lastRows[0]?.max ? addMinutes(new Date(lastRows[0].max), 1) : monthStart;
    if (cursor < monthStart) cursor = monthStart; // don't backfill previous months
    if (cursor > nowFloored) {
      return { customerId: customer.customerId, minutesWritten: 0, monthsTouched: [] };
    }

    const collectionRunId = randomUUID();
    const monthsTouched = new Set<string>();

    const vendorIds: string[] = [];
    const customerIds: string[] = [];
    const minuteTimestamps: string[] = [];
    const isAvailables: boolean[] = [];
    const classifications: string[] = [];
    const route53Statuses: (string | null)[] = [];
    const alb5xxPcts: (number | null)[] = [];
    const albTotalRequestsArr: (number | null)[] = [];
    const ecsRunningTasksArr: (number | null)[] = [];
    const ecsDesiredTasksArr: (number | null)[] = [];
    const ecsHealthStatuses: (string | null)[] = [];
    const isMaintenanceArr: boolean[] = [];
    const collectionRunIds: string[] = [];
    const syntheticFailedArr: (boolean | null)[] = [];
    const syntheticResponseTimeArr: (number | null)[] = [];

    let minutesWritten = 0;
    let minute = cursor;
    while (minute <= nowFloored && minutesWritten < MAX_MINUTES_PER_RUN) {
      const maintenance = isInMaintenanceWindow(customer, minute);
      const { signals } = generateMinuteSignals(
        customer.customerId,
        minute,
        customer.demoProfile,
        customer.syntheticMonitoringEnabled
      );
      const { classification, isAvailable } = classifyMinute(signals, maintenance);

      vendorIds.push(vendorId);
      customerIds.push(customer.customerId);
      minuteTimestamps.push(minute.toISOString());
      isAvailables.push(isAvailable);
      classifications.push(classification);
      route53Statuses.push(signals.route53Status);
      alb5xxPcts.push(signals.alb5xxPct);
      albTotalRequestsArr.push(signals.albTotalRequests);
      ecsRunningTasksArr.push(signals.ecsRunningTasks);
      ecsDesiredTasksArr.push(signals.ecsDesiredTasks);
      ecsHealthStatuses.push(signals.ecsHealthStatus);
      isMaintenanceArr.push(maintenance);
      collectionRunIds.push(collectionRunId);
      syntheticFailedArr.push(signals.syntheticFailed ?? null);
      syntheticResponseTimeArr.push(signals.syntheticResponseTimeMs ?? null);

      monthsTouched.add(monthKey(minute));
      minutesWritten++;
      minute = addMinutes(minute, 1);
    }

    if (minutesWritten > 0 && customer.deploymentModel === "MODEL_B") {
      // F9: simulated STS AssumeRole for cross-account customers -- real
      // Model B collection assumes a role in the customer's own AWS
      // account before calling CloudWatch/Route53/ECS (Section 10.3).
      await client.query(
        `INSERT INTO cross_account_role_assumptions (vendor_id, customer_id, simulated_role_arn)
         VALUES ($1, $2, $3)`,
        [vendorId, customer.customerId, `arn:aws:iam::${mockAccountId(customer.customerId)}:role/SLAPulseMetricsRole`]
      );
    }

    if (minutesWritten > 0) {
      await client.query(
        `INSERT INTO availability_minutes
           (vendor_id, customer_id, minute_timestamp, is_available, classification,
            route53_status, alb_5xx_pct, alb_total_requests, ecs_running_tasks,
            ecs_desired_tasks, ecs_health_status, is_maintenance_window, collection_run_id,
            synthetic_failed, synthetic_response_time_ms)
         SELECT * FROM UNNEST(
           $1::varchar[], $2::varchar[], $3::timestamptz[], $4::boolean[], $5::varchar[],
           $6::varchar[], $7::float8[], $8::int[], $9::int[],
           $10::int[], $11::varchar[], $12::boolean[], $13::varchar[],
           $14::boolean[], $15::int[]
         )
         ON CONFLICT (vendor_id, customer_id, minute_timestamp) DO NOTHING`,
        [
          vendorIds,
          customerIds,
          minuteTimestamps,
          isAvailables,
          classifications,
          route53Statuses,
          alb5xxPcts,
          albTotalRequestsArr,
          ecsRunningTasksArr,
          ecsDesiredTasksArr,
          ecsHealthStatuses,
          isMaintenanceArr,
          collectionRunIds,
          syntheticFailedArr,
          syntheticResponseTimeArr,
        ]
      );
    }

    return { customerId: customer.customerId, minutesWritten, monthsTouched: [...monthsTouched] };
  });
}

function mockAccountId(customerId: string): string {
  let h = 0;
  for (let i = 0; i < customerId.length; i++) h = (Math.imul(31, h) + customerId.charCodeAt(i)) | 0;
  return String(100000000000 + (Math.abs(h) % 899999999999)).padStart(12, "0");
}

function floorToMinute(d: Date): Date {
  const copy = new Date(d);
  copy.setUTCSeconds(0, 0);
  return copy;
}

function addMinutes(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 60_000);
}

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
