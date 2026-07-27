"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle, Play, RefreshCw, Zap } from "lucide-react";
import { useIdentity } from "@/components/IdentityContext";
import { StatusBadge } from "@/components/StatusBadge";
import { StatCard } from "@/components/StatCard";

interface DashboardRow {
  customerId: string;
  customerName: string;
  contractSlaPct: number;
  status: string;
  uptimePct: number | null;
  projectedUptime: number | null;
  breachPredictedDate: string | null;
  dataCompletenessPct: number | null;
  lastCollectedAt: string | null;
}

interface TrendPoint {
  month: string;
  avg_uptime_pct: string | null;
  compliant: string;
  at_risk: string;
  breached: string;
}

const RANGE_OPTIONS = [
  { label: "3 months", value: 3 },
  { label: "6 months", value: 6 },
  { label: "12 months", value: 12 },
];

export default function DashboardPage() {
  const { identity, loading: identityLoading } = useIdentity();
  const [rows, setRows] = useState<DashboardRow[] | null>(null);
  const [month, setMonth] = useState<string>("");
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [range, setRange] = useState(6);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSeeTrend = identity && identity.role !== "CSM";

  const load = useCallback(async () => {
    const res = await fetch("/api/dashboard");
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to load dashboard");
      return;
    }
    const data = await res.json();
    setRows(data.customers);
    setMonth(data.month);
    setError(null);
  }, []);

  useEffect(() => {
    if (identity) load();
  }, [identity, load]);

  useEffect(() => {
    if (!canSeeTrend) return;
    fetch("/api/executive")
      .then((r) => r.json())
      .then((d) => setTrend(d.trend ?? []));
  }, [canSeeTrend]);

  const runJob = async (type: "collect" | "calculate" | "dailyOps" | "tick") => {
    setRunning(type);
    try {
      const res = await fetch("/api/jobs/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "Job failed");
      } else {
        await load();
      }
    } finally {
      setRunning(null);
    }
  };

  const kpis = useMemo(() => {
    if (!rows) return null;
    return {
      total: rows.length,
      compliant: rows.filter((r) => r.status === "COMPLIANT").length,
      atRisk: rows.filter((r) => r.status === "AT_RISK").length,
      breached: rows.filter((r) => r.status === "BREACHED").length,
      incomplete: rows.filter((r) => r.status === "DATA_INCOMPLETE").length,
    };
  }, [rows]);

  const chartData = useMemo(
    () =>
      trend.slice(-range).map((t) => ({
        month: t.month.slice(2),
        uptime: t.avg_uptime_pct ? Number(Number(t.avg_uptime_pct).toFixed(3)) : null,
      })),
    [trend, range]
  );

  if (identityLoading) return null;
  if (!identity) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">SLA Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">Current reporting month: {month || "…"}</p>
        </div>
        {(identity.role === "ADMIN" || identity.role === "SRE") && (
          <div className="flex gap-2">
            <JobButton label="Collect" icon={RefreshCw} busy={running === "collect"} onClick={() => runJob("collect")} />
            <JobButton label="Calculate" icon={Zap} busy={running === "calculate"} onClick={() => runJob("calculate")} />
            <JobButton label="Daily ops" icon={RefreshCw} busy={running === "dailyOps"} onClick={() => runJob("dailyOps")} />
            <JobButton label="Run full tick" icon={Play} busy={running === "tick"} onClick={() => runJob("tick")} primary />
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-2.5 mb-6">{error}</div>
      )}

      {kpis && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <StatCard label="Customer environments" value={kpis.total} icon={CheckCircle2} tone="indigo" />
          <StatCard label="Compliant" value={kpis.compliant} icon={CheckCircle2} tone="emerald" />
          <StatCard label="At risk" value={kpis.atRisk} icon={AlertTriangle} tone="amber" />
          <StatCard
            label="Breached"
            value={kpis.breached}
            sublabel={kpis.incomplete > 0 ? `${kpis.incomplete} data incomplete` : undefined}
            icon={XCircle}
            tone="red"
          />
        </div>
      )}

      {canSeeTrend && chartData.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-800">Average uptime trend</h2>
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
              {RANGE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setRange(opt.value)}
                  className={`text-xs font-medium px-2.5 py-1 rounded-md transition-colors ${
                    range === opt.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="uptimeGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis
                domain={["dataMin - 0.5", 100]}
                tick={{ fontSize: 12, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
                width={44}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                formatter={(v) => [`${v}%`, "Avg uptime"]}
                contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }}
              />
              <Area type="monotone" dataKey="uptime" stroke="#6366f1" strokeWidth={2} fill="url(#uptimeGradient)" connectNulls />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {rows === null ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-left text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-5 py-3 font-medium">Customer</th>
                <th className="px-5 py-3 font-medium">Contract SLA</th>
                <th className="px-5 py-3 font-medium">Uptime (MTD)</th>
                <th className="px-5 py-3 font-medium">Projected</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Completeness</th>
                <th className="px-5 py-3 font-medium">Breach predicted</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.customerId} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-5 py-3 font-medium text-slate-800">{r.customerName}</td>
                  <td className="px-5 py-3 text-slate-600 tabular-nums">{r.contractSlaPct}%</td>
                  <td className="px-5 py-3 text-slate-600 tabular-nums">
                    {r.uptimePct !== null ? `${r.uptimePct}%` : "—"}
                  </td>
                  <td className="px-5 py-3 text-slate-600 tabular-nums">
                    {r.projectedUptime !== null ? `${r.projectedUptime}%` : "—"}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-5 py-3 text-slate-600 tabular-nums">
                    {r.dataCompletenessPct !== null ? `${r.dataCompletenessPct}%` : "—"}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{r.breachPredictedDate ?? "—"}</td>
                  <td className="px-5 py-3">
                    <Link
                      href={`/evidence?customerId=${r.customerId}`}
                      className="text-indigo-600 hover:text-indigo-700 font-medium text-xs"
                    >
                      Evidence →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function JobButton({
  label,
  busy,
  onClick,
  primary,
  icon: Icon,
}: {
  label: string;
  busy: boolean;
  onClick: () => void;
  primary?: boolean;
  icon: React.ElementType;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 transition-colors ${
        primary
          ? "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm"
          : "border border-slate-200 text-slate-600 hover:bg-slate-100"
      }`}
    >
      <Icon className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
      {label}
    </button>
  );
}

function TableSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="h-11 bg-slate-50 border-b border-slate-200" />
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-14 border-b border-slate-100 px-5 flex items-center gap-6 animate-pulse">
          <div className="h-3 w-28 bg-slate-100 rounded" />
          <div className="h-3 w-12 bg-slate-100 rounded" />
          <div className="h-3 w-16 bg-slate-100 rounded" />
          <div className="h-5 w-20 bg-slate-100 rounded-full" />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
      <HelpCircle className="h-8 w-8 text-slate-300 mx-auto mb-3" />
      <p className="text-slate-500 mb-1">No customers registered yet.</p>
      <Link href="/customers" className="text-indigo-600 hover:text-indigo-700 font-medium text-sm">
        Register your first customer environment →
      </Link>
    </div>
  );
}
