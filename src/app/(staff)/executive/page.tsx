"use client";

import { useEffect, useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle } from "lucide-react";
import { useIdentity } from "@/components/IdentityContext";
import { StatusBadge } from "@/components/StatusBadge";
import { StatCard } from "@/components/StatCard";

interface ExecutiveData {
  month: string;
  totalCustomers: number;
  counts: Record<string, number>;
  trend: {
    month: string;
    compliant: string;
    at_risk: string;
    breached: string;
    data_incomplete: string;
    avg_uptime_pct: string | null;
  }[];
  topAtRisk: {
    customerId: string;
    customerName: string;
    status: string;
    uptimePct: number | null;
    contractSlaPct: number;
    breachPredictedDate: string | null;
  }[];
}

const DONUT_COLORS: Record<string, string> = {
  Compliant: "#10b981",
  "At risk": "#f59e0b",
  Breached: "#ef4444",
  "Data incomplete": "#94a3b8",
};

export default function ExecutivePage() {
  const { identity, loading: identityLoading } = useIdentity();
  const [data, setData] = useState<ExecutiveData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!identity) return;
    fetch("/api/executive")
      .then(async (res) => {
        if (!res.ok) {
          setError((await res.json()).error);
          return;
        }
        setData(await res.json());
      });
  }, [identity]);

  if (identityLoading) return null;
  if (!identity) return null;
  if (error) return <p className="text-red-600 text-sm">{error}</p>;
  if (!data) return <p className="text-slate-500">Loading…</p>;

  const { counts, totalCustomers } = data;
  const pct = (n: number) => (totalCustomers > 0 ? Math.round((n / totalCustomers) * 100) : 0);

  const donutData = [
    { name: "Compliant", value: counts.COMPLIANT ?? 0 },
    { name: "At risk", value: counts.AT_RISK ?? 0 },
    { name: "Breached", value: counts.BREACHED ?? 0 },
    { name: "Data incomplete", value: counts.DATA_INCOMPLETE ?? 0 },
  ].filter((d) => d.value > 0);

  const trendData = data.trend.map((t) => ({
    month: t.month.slice(2),
    uptime: t.avg_uptime_pct ? Number(Number(t.avg_uptime_pct).toFixed(3)) : null,
  }));

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900 tracking-tight mb-1">Executive Portfolio</h1>
      <p className="text-sm text-slate-500 mb-6">
        {data.month} · {totalCustomers} active customer environments
      </p>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="Compliant" value={counts.COMPLIANT ?? 0} sublabel={`${pct(counts.COMPLIANT ?? 0)}% of portfolio`} icon={CheckCircle2} tone="emerald" />
        <StatCard label="At risk" value={counts.AT_RISK ?? 0} sublabel={`${pct(counts.AT_RISK ?? 0)}% of portfolio`} icon={AlertTriangle} tone="amber" />
        <StatCard label="Breached" value={counts.BREACHED ?? 0} sublabel={`${pct(counts.BREACHED ?? 0)}% of portfolio`} icon={XCircle} tone="red" />
        <StatCard label="Data incomplete" value={counts.DATA_INCOMPLETE ?? 0} sublabel={`${pct(counts.DATA_INCOMPLETE ?? 0)}% of portfolio`} icon={HelpCircle} tone="slate" />
      </div>

      <div className="grid grid-cols-5 gap-6 mb-6">
        <div className="col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-800 mb-4">Portfolio distribution</h2>
          {donutData.length === 0 ? (
            <p className="text-sm text-slate-500">No active statuses yet.</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={75} paddingAngle={3} strokeWidth={0}>
                    {donutData.map((d) => (
                      <Cell key={d.name} fill={DONUT_COLORS[d.name]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2 justify-center">
                {donutData.map((d) => (
                  <span key={d.name} className="flex items-center gap-1.5 text-xs text-slate-600">
                    <span className="h-2 w-2 rounded-full" style={{ background: DONUT_COLORS[d.name] }} />
                    {d.name} ({d.value})
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="col-span-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-800 mb-4">12-month uptime trend</h2>
          {trendData.length === 0 ? (
            <p className="text-sm text-slate-500">No history yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={trendData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
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
                <Tooltip formatter={(v) => [`${v}%`, "Avg uptime"]} contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }} />
                <Line type="monotone" dataKey="uptime" stroke="#6366f1" strokeWidth={2} dot={{ r: 3, fill: "#6366f1" }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-800 mb-3">Top at-risk customers</h2>
        {data.topAtRisk.length === 0 ? (
          <p className="text-sm text-slate-500">Nobody is at risk right now.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.topAtRisk.map((c) => (
              <li key={c.customerId} className="py-3 flex items-center justify-between text-sm">
                <div>
                  <div className="font-medium text-slate-800">{c.customerName}</div>
                  <div className="text-slate-500 text-xs mt-0.5">
                    {c.uptimePct !== null ? `${c.uptimePct}%` : "—"} uptime vs {c.contractSlaPct}% contract
                    {c.breachPredictedDate ? ` · predicted breach ${c.breachPredictedDate}` : ""}
                  </div>
                </div>
                <StatusBadge status={c.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
