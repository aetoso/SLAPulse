import { NextRequest, NextResponse } from "next/server";
import { requireIdentity, requirePermission, isResponse } from "@/lib/apiHelpers";
import {
  runCollectionTick,
  runCalculationTick,
  runDailyOpsTick,
  runMonitorCheckTick,
  runMonitorCalculationTick,
} from "@/jobs/dispatcher";

// LOCAL-DEV manual trigger, standing in for EventBridge's hourly/daily
// schedules (Section 8.2-8.4, 9.1) so the dashboard can offer "run
// collection/calculation now" instead of waiting for the worker's cron.
// SRE/ADMIN only -- this mutates SLA data, not a read.

export async function POST(req: NextRequest) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "triggerCorrections");
  if (forbidden) return forbidden;

  const { type } = (await req.json().catch(() => ({ type: "tick" }))) as { type?: string };

  if (type === "collect") {
    const result = await runCollectionTick();
    return NextResponse.json({ type: "collect", result });
  }
  if (type === "calculate") {
    const result = await runCalculationTick(identity.actor);
    return NextResponse.json({ type: "calculate", result });
  }
  if (type === "dailyOps") {
    const result = await runDailyOpsTick(identity.actor);
    return NextResponse.json({ type: "dailyOps", result });
  }
  if (type === "monitorCheck") {
    const result = await runMonitorCheckTick(identity.actor);
    return NextResponse.json({ type: "monitorCheck", result });
  }
  if (type === "monitorCalculate") {
    const result = await runMonitorCalculationTick(identity.actor);
    return NextResponse.json({ type: "monitorCalculate", result });
  }

  const collectResult = await runCollectionTick();
  const calcResult = await runCalculationTick(identity.actor);
  const opsResult = await runDailyOpsTick(identity.actor);
  const monitorCheckResult = await runMonitorCheckTick(identity.actor);
  const monitorCalcResult = await runMonitorCalculationTick(identity.actor);
  return NextResponse.json({ type: "tick", collectResult, calcResult, opsResult, monitorCheckResult, monitorCalcResult });
}
