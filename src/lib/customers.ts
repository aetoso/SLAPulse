import type { PoolClient } from "pg";
import { withTenant } from "./db";
import type { DemoProfile } from "./mockCollector";

export interface Customer {
  id: string;
  vendorId: string;
  customerId: string;
  customerName: string;
  contractSlaPct: number;
  contractStartDate: string;
  renewalDate: string | null;
  slaTier: string;
  contractualNotificationHours: number | null;
  region: string;
  assignedCsmUserId: string | null;
  status: string;
  demoProfile: DemoProfile;
  maintenanceWindows: { start: string; end: string }[];
  createdAt: string;
  monthlyFeeUsd: number | null;
  deploymentModel: "MODEL_A" | "MODEL_B";
  syntheticMonitoringEnabled: boolean;
  lastDriftCheckAt: string | null;
}

function mapRow(r: Record<string, unknown>): Customer {
  return {
    id: r.id as string,
    vendorId: r.vendor_id as string,
    customerId: r.customer_id as string,
    customerName: r.customer_name as string,
    contractSlaPct: Number(r.contract_sla_pct),
    contractStartDate: r.contract_start_date as string,
    renewalDate: (r.renewal_date as string) ?? null,
    slaTier: r.sla_tier as string,
    contractualNotificationHours: (r.contractual_notification_hours as number) ?? null,
    region: r.region as string,
    assignedCsmUserId: (r.assigned_csm_user_id as string) ?? null,
    status: r.status as string,
    demoProfile: r.demo_profile as DemoProfile,
    maintenanceWindows: (r.maintenance_windows as { start: string; end: string }[]) ?? [],
    createdAt: r.created_at as string,
    monthlyFeeUsd: r.monthly_fee_usd !== null && r.monthly_fee_usd !== undefined ? Number(r.monthly_fee_usd) : null,
    deploymentModel: r.deployment_model as "MODEL_A" | "MODEL_B",
    syntheticMonitoringEnabled: r.synthetic_monitoring_enabled as boolean,
    lastDriftCheckAt: (r.last_drift_check_at as string) ?? null,
  };
}

export async function listCustomers(
  vendorId: string,
  opts: { activeOnly?: boolean; customerIds?: string[] } = {}
): Promise<Customer[]> {
  return withTenant(vendorId, async (client) => {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (opts.activeOnly) {
      conditions.push(`status = 'ACTIVE'`);
    }
    if (opts.customerIds && opts.customerIds.length > 0) {
      params.push(opts.customerIds);
      conditions.push(`customer_id = ANY($${params.length})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await client.query(
      `SELECT * FROM customers ${where} ORDER BY customer_name`,
      params
    );
    return rows.map(mapRow);
  });
}

export async function getCustomer(vendorId: string, customerId: string): Promise<Customer | null> {
  return withTenant(vendorId, async (client) => {
    const { rows } = await client.query(`SELECT * FROM customers WHERE customer_id = $1`, [customerId]);
    return rows[0] ? mapRow(rows[0]) : null;
  });
}

export interface RegisterCustomerInput {
  customerId: string;
  customerName: string;
  contractSlaPct: number;
  contractStartDate: string;
  renewalDate?: string | null;
  slaTier?: string;
  contractualNotificationHours?: number | null;
  region: string;
  assignedCsmUserId?: string | null;
  demoProfile?: DemoProfile;
  monthlyFeeUsd?: number | null;
  deploymentModel?: "MODEL_A" | "MODEL_B";
  syntheticMonitoringEnabled?: boolean;
}

// Section 8.1 Customer Environment Registration. vendor_id comes from the
// caller's identity (JWT in production, session identity here) -- never
// from the request payload (Section 14.3 mass-assignment control).
export async function registerCustomer(
  vendorId: string,
  actor: string,
  input: RegisterCustomerInput
): Promise<Customer> {
  return withTenant(vendorId, async (client: PoolClient) => {
    const { rows } = await client.query(
      `INSERT INTO customers
         (vendor_id, customer_id, customer_name, contract_sla_pct, contract_start_date,
          renewal_date, sla_tier, contractual_notification_hours, region,
          assigned_csm_user_id, demo_profile, monthly_fee_usd, deployment_model,
          synthetic_monitoring_enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        vendorId,
        input.customerId,
        input.customerName,
        input.contractSlaPct,
        input.contractStartDate,
        input.renewalDate ?? null,
        input.slaTier ?? "STANDARD",
        input.contractualNotificationHours ?? null,
        input.region,
        input.assignedCsmUserId ?? null,
        input.demoProfile ?? "stable",
        input.monthlyFeeUsd ?? null,
        input.deploymentModel ?? "MODEL_A",
        input.syntheticMonitoringEnabled ?? false,
      ]
    );

    const { appendAuditEvent } = await import("./auditLog");
    await appendAuditEvent(client, {
      vendorId,
      customerId: input.customerId,
      eventType: "CUSTOMER_REGISTERED",
      actor,
      description: `Customer ${input.customerName} registered with ${input.contractSlaPct}% SLA`,
      metadata: { contractSlaPct: input.contractSlaPct, region: input.region },
    });

    return mapRow(rows[0]);
  });
}
