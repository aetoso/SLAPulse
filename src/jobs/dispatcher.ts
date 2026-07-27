import { listActiveVendorIds } from "@/lib/vendors";
import { listCustomers } from "@/lib/customers";
import { withAdmin } from "@/lib/db";
import { collectForCustomer } from "./collection";
import { computeSlaStatus, currentMonthKey } from "./slaCalculator";
import { predictBreach } from "./breachPredictor";
import { runDriftCheck, type DriftCheckSummary } from "./driftChecker";
import { computeCreditsForBreached, type CreditSummary } from "./creditAutomation";
import { runRenewalRiskCheck, type RenewalRiskSummary } from "./renewalRisk";
import { createDisclosuresForBreaches, publishEligibleDisclosures } from "./disclosureManager";

// Section 8.1/9.1: the dispatcher discovers active customers from the
// customers table on every tick rather than maintaining a per-customer
// EventBridge schedule (Section 8.2, 9.6, 16 -- proliferation risk fixed
// in v3.0). This module is the local-dev equivalent of
// tg-collection-dispatcher + tg-sla-calculator + tg-breach-predictor,
// invoked in-process by src/worker.ts (cron) or via /api/jobs/* (manual).

export interface TickSummary {
  vendorsProcessed: number;
  customersProcessed: number;
  minutesWritten: number;
}

export async function runCollectionTick(now: Date = new Date()): Promise<TickSummary> {
  await ensurePartitions(now);

  const vendorIds = await listActiveVendorIds();
  let customersProcessed = 0;
  let minutesWritten = 0;

  for (const vendorId of vendorIds) {
    const customers = await listCustomers(vendorId, { activeOnly: true });
    for (const customer of customers) {
      const result = await collectForCustomer(vendorId, customer, now);
      customersProcessed++;
      minutesWritten += result.minutesWritten;
    }
  }

  return { vendorsProcessed: vendorIds.length, customersProcessed, minutesWritten };
}

export interface CalculationSummary {
  vendorsProcessed: number;
  customersProcessed: number;
  breachPredictionsIssued: number;
}

export async function runCalculationTick(
  actor: string,
  now: Date = new Date()
): Promise<CalculationSummary> {
  const vendorIds = await listActiveVendorIds();
  const month = currentMonthKey(now);
  let customersProcessed = 0;
  let breachPredictionsIssued = 0;

  for (const vendorId of vendorIds) {
    const customers = await listCustomers(vendorId, { activeOnly: true });
    for (const customer of customers) {
      const result = await computeSlaStatus(vendorId, customer, month, actor, now);
      customersProcessed++;
      if (result) {
        const prediction = await predictBreach(vendorId, customer, result, actor, now);
        if (prediction) breachPredictionsIssued++;
      }
    }
  }

  return { vendorsProcessed: vendorIds.length, customersProcessed, breachPredictionsIssued };
}

export interface DailyOpsSummary {
  drift: DriftCheckSummary;
  credits: CreditSummary;
  renewalRisk: RenewalRiskSummary;
  disclosuresCreated: number;
  disclosuresPublished: number;
}

// Section 8.6 (drift), F7 (credit automation), F11 (renewal risk),
// Section 8.8 (disclosure creation + eligible auto-publish) -- bundled as
// one "daily" tick, same accelerated-cadence substitution as
// collection/calculation (Section 9.1, worker.ts).
export async function runDailyOpsTick(actor: string, now: Date = new Date()): Promise<DailyOpsSummary> {
  const drift = await runDriftCheck(actor);
  const credits = await computeCreditsForBreached(actor, now);
  const renewalRisk = await runRenewalRiskCheck(actor, now);
  const { created } = await createDisclosuresForBreaches(actor, now);
  const { published } = await publishEligibleDisclosures(now);
  return { drift, credits, renewalRisk, disclosuresCreated: created, disclosuresPublished: published };
}

async function ensurePartitions(now: Date): Promise<void> {
  await withAdmin(async (client) => {
    const cur = now.toISOString().slice(0, 10);
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
    await client.query(`SELECT ensure_availability_minutes_partition($1::date)`, [cur]);
    await client.query(`SELECT ensure_availability_minutes_partition($1::date)`, [next]);
  });
}
