import { NextRequest, NextResponse } from "next/server";
import { requireIdentity, requirePermission, isResponse } from "@/lib/apiHelpers";
import { runMonitorCheckTick, runMonitorCalculationTick } from "@/jobs/dispatcher";

// Manual trigger so the Monitors page can offer "check now / recalc SLA"
// instead of waiting for the worker's cron. SRE/ADMIN only -- this mutates
// SLA data, not a read.

export async function POST(req: NextRequest) {
  const identity = await requireIdentity();
  if (isResponse(identity)) return identity;

  const forbidden = requirePermission(identity, "manageMonitors");
  if (forbidden) return forbidden;

  const { type } = (await req.json().catch(() => ({ type: "tick" }))) as { type?: string };

  if (type === "monitorCheck") {
    const result = await runMonitorCheckTick(identity.actor);
    return NextResponse.json({ type: "monitorCheck", result });
  }
  if (type === "monitorCalculate") {
    const result = await runMonitorCalculationTick(identity.actor);
    return NextResponse.json({ type: "monitorCalculate", result });
  }

  const monitorCheckResult = await runMonitorCheckTick(identity.actor);
  const monitorCalcResult = await runMonitorCalculationTick(identity.actor);
  return NextResponse.json({ type: "tick", monitorCheckResult, monitorCalcResult });
}
