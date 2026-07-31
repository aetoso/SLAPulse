"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Globe, ArrowUpRight } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { useIdentity } from "@/components/IdentityContext";

interface MonitorDetail {
  monitorId: string;
  name: string;
  targetUrl: string;
  checkType: string;
  contractSlaPct: number;
  intervalSeconds: number;
  linkedCustomerId: string | null;
  sslCheckEnabled: boolean;
  sslValidUntil: string | null;
  sslIssuer: string | null;
  sslLastCheckedAt: string | null;
  sslExpiryWarningDays: number;
  heartbeatToken: string | null;
  heartbeatExpectedIntervalSeconds: number | null;
  heartbeatGraceSeconds: number | null;
  lastHeartbeatAt: string | null;
  maintenanceWindows: { start: string; end: string }[];
  regions: string[];
}

interface HistoryRow {
  month: string;
  status: string;
  uptime_pct: number | null;
  downtime_minutes: number;
  data_completeness_pct: string;
  avg_response_time_ms: number | null;
}

interface MinuteRow {
  minute_timestamp: string;
  is_up: boolean;
  classification: string;
  regions_checked: number;
  regions_up: number;
  avg_response_time_ms: number | null;
}

interface RegionCheck {
  region: string;
  check_timestamp: string;
  is_up: boolean;
  response_time_ms: number | null;
  status_code: number | null;
  error_message: string | null;
}

interface Incident {
  start: string;
  end: string;
  minutes: number;
  regionsUpAtWorst: number;
}

export default function MonitorDetailPage() {
  const params = useParams<{ monitorId: string }>();
  const { identity, loading: identityLoading } = useIdentity();
  const [monitor, setMonitor] = useState<MonitorDetail | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [minutes, setMinutes] = useState<MinuteRow[]>([]);
  const [linkedCustomer, setLinkedCustomer] = useState<{ customer_id: string; customer_name: string } | null>(null);
  const [regions, setRegions] = useState<RegionCheck[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);

  const load = useCallback(async () => {
    const [detailRes, checksRes, incidentsRes] = await Promise.all([
      fetch(`/api/monitors/${params.monitorId}`),
      fetch(`/api/monitors/${params.monitorId}/checks`),
      fetch(`/api/monitors/${params.monitorId}/incidents`),
    ]);
    if (detailRes.ok) {
      const d = await detailRes.json();
      setMonitor(d.monitor);
      setHistory(d.history);
      setMinutes(d.recentMinutes);
      setLinkedCustomer(d.linkedCustomer);
    }
    if (checksRes.ok) setRegions((await checksRes.json()).regions);
    if (incidentsRes.ok) setIncidents((await incidentsRes.json()).incidents);
  }, [params.monitorId]);

  useEffect(() => {
    if (identity) load();
  }, [identity, load]);

  if (identityLoading) return null;
  if (!identity) return null;
  if (!monitor) return <p className="text-slate-500">Loading…</p>;

  const chartData = minutes.map((m) => ({
    time: m.minute_timestamp.slice(11, 16),
    responseTime: m.avg_response_time_ms,
    isUp: m.is_up,
  }));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">{monitor.name}</h1>
          <p className="text-sm text-slate-500 mt-0.5 flex items-center gap-1">
            <Globe className="h-3.5 w-3.5" />
            {monitor.checkType === "HEARTBEAT" ? monitor.name : monitor.targetUrl} · {monitor.checkType}
            {monitor.checkType !== "HEARTBEAT" && ` · checked every ${monitor.intervalSeconds}s from ${monitor.regions.join(", ")}`}
          </p>
        </div>
        {linkedCustomer && (
          <Link
            href={`/evidence?customerId=${linkedCustomer.customer_id}`}
            className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 px-3 py-2 text-sm font-medium hover:bg-indigo-100"
          >
            View AWS evidence for {linkedCustomer.customer_name}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>

      {monitor.checkType === "HEARTBEAT" ? (
        <HeartbeatCard monitor={monitor} />
      ) : (
        <div className="grid grid-cols-3 gap-4 mb-6">
          {regions.map((r) => (
            <div key={r.region} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{r.region}</span>
                <StatusBadge status={r.is_up ? "UP" : "DOWNTIME"} />
              </div>
              <p className="text-lg font-semibold text-slate-900">
                {r.response_time_ms !== null ? `${r.response_time_ms}ms` : "—"}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {r.error_message ?? (r.status_code ? `HTTP ${r.status_code}` : "reachable")} ·{" "}
                {new Date(r.check_timestamp).toLocaleTimeString()}
              </p>
            </div>
          ))}
          {regions.length === 0 && <p className="text-sm text-slate-500 col-span-3">No checks recorded yet.</p>}
        </div>
      )}

      {monitor.sslCheckEnabled && (monitor.checkType === "HTTPS" || monitor.checkType === "KEYWORD") && (
        <SslCard monitor={monitor} />
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm mb-6">
        <h2 className="text-sm font-semibold text-slate-800 mb-4">Response time (last 3 hours)</h2>
        {chartData.length === 0 ? (
          <p className="text-sm text-slate-500">No data yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="time" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} minTickGap={30} />
              <YAxis tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => `${v}ms`} />
              <Tooltip
                formatter={(v) => [`${v}ms`, "Response time"]}
                labelFormatter={(l) => `${l} UTC`}
                contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }}
              />
              <Line type="monotone" dataKey="responseTime" stroke="#6366f1" strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">SLA history</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="py-1 font-medium">Month</th>
                <th className="py-1 font-medium">Status</th>
                <th className="py-1 font-medium">Uptime</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.map((h) => (
                <tr key={h.month}>
                  <td className="py-1.5">{h.month}</td>
                  <td className="py-1.5">
                    <StatusBadge status={h.status} />
                  </td>
                  <td className="py-1.5 tabular-nums">{h.uptime_pct !== null ? `${h.uptime_pct}%` : "—"}</td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-2 text-slate-500">
                    No SLA history yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">Incidents (last 30 days)</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {incidents.map((inc, i) => (
              <li key={i} className="py-2">
                <div className="flex justify-between">
                  <span className="font-medium text-slate-800">{new Date(inc.start).toLocaleString()}</span>
                  <span className="text-slate-500">{inc.minutes} min</span>
                </div>
                <div className="text-xs text-slate-400">
                  {inc.regionsUpAtWorst}/3 regions reachable at worst point
                </div>
              </li>
            ))}
            {incidents.length === 0 && <li className="py-2 text-slate-500">No incidents in this window.</li>}
          </ul>
        </div>
      </div>

      <MaintenanceWindows monitor={monitor} onChange={load} />
    </div>
  );
}

function HeartbeatCard({ monitor }: { monitor: MonitorDetail }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined" ? `${window.location.origin}/api/public/v1/heartbeat/${monitor.heartbeatToken}` : "";
  const lastBeat = monitor.lastHeartbeatAt ? new Date(monitor.lastHeartbeatAt) : null;
  const expected = (monitor.heartbeatExpectedIntervalSeconds ?? 300) + (monitor.heartbeatGraceSeconds ?? 60);
  const stale = lastBeat ? Date.now() - lastBeat.getTime() > expected * 1000 : true;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm mb-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-slate-800">Heartbeat / cron monitoring</h2>
        <StatusBadge status={stale ? "DOWNTIME" : "UP"} />
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Have your job call this URL (GET or POST) on every successful run. If no ping arrives within{" "}
        {monitor.heartbeatExpectedIntervalSeconds}s + {monitor.heartbeatGraceSeconds}s grace, this monitor goes DOWNTIME.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-xs bg-slate-50 rounded-lg px-3 py-2 break-all">{url}</code>
        <button
          onClick={() => {
            navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="text-xs rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-100 shrink-0"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="text-xs text-slate-400 mt-2">
        Last ping: {lastBeat ? lastBeat.toLocaleString() : "never received"}
      </p>
    </div>
  );
}

function SslCard({ monitor }: { monitor: MonitorDetail }) {
  const validTo = monitor.sslValidUntil ? new Date(monitor.sslValidUntil) : null;
  const daysLeft = validTo ? Math.round((validTo.getTime() - Date.now()) / 86_400_000) : null;
  const warning = daysLeft !== null && daysLeft <= monitor.sslExpiryWarningDays;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm mb-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-slate-800">SSL certificate</h2>
        {daysLeft !== null && (
          <span className={`text-xs font-medium ${warning ? "text-red-600" : "text-emerald-600"}`}>
            {daysLeft > 0 ? `expires in ${daysLeft} days` : "expired"}
          </span>
        )}
      </div>
      {validTo ? (
        <p className="text-xs text-slate-500">
          Issued by {monitor.sslIssuer ?? "unknown"} · valid until {validTo.toLocaleDateString()} · last checked{" "}
          {monitor.sslLastCheckedAt ? new Date(monitor.sslLastCheckedAt).toLocaleString() : "—"}
        </p>
      ) : (
        <p className="text-xs text-slate-500">Not checked yet — runs automatically on the next check tick.</p>
      )}
    </div>
  );
}

function MaintenanceWindows({ monitor, onChange }: { monitor: MonitorDetail; onChange: () => void }) {
  const [form, setForm] = useState({ start: "", end: "" });
  const [busy, setBusy] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await fetch(`/api/monitors/${monitor.monitorId}/maintenance-windows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start: new Date(form.start).toISOString(), end: new Date(form.end).toISOString() }),
      });
      setForm({ start: "", end: "" });
      onChange();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (index: number) => {
    setBusy(true);
    try {
      await fetch(`/api/monitors/${monitor.monitorId}/maintenance-windows?index=${index}`, { method: "DELETE" });
      onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm mt-6">
      <h2 className="text-sm font-semibold text-slate-800 mb-3">Maintenance windows</h2>
      <p className="text-xs text-slate-500 mb-3">Minutes inside a window are excluded from downtime and the SLA calculation.</p>
      <form onSubmit={add} className="flex flex-wrap gap-2 items-end text-sm mb-3">
        <label className="flex flex-col gap-1">
          Start
          <input
            required
            type="datetime-local"
            value={form.start}
            onChange={(e) => setForm({ ...form, start: e.target.value })}
            className="border border-slate-200 rounded-lg px-2.5 py-1.5"
          />
        </label>
        <label className="flex flex-col gap-1">
          End
          <input
            required
            type="datetime-local"
            value={form.end}
            onChange={(e) => setForm({ ...form, end: e.target.value })}
            className="border border-slate-200 rounded-lg px-2.5 py-1.5"
          />
        </label>
        <button type="submit" disabled={busy} className="rounded-lg bg-slate-900 text-white px-3 py-1.5 disabled:opacity-50">
          {busy ? "…" : "Add window"}
        </button>
      </form>
      <ul className="divide-y divide-slate-100 text-sm">
        {monitor.maintenanceWindows.map((w, i) => (
          <li key={i} className="py-1.5 flex justify-between items-center">
            <span>
              {new Date(w.start).toLocaleString()} → {new Date(w.end).toLocaleString()}
            </span>
            <button onClick={() => remove(i)} disabled={busy} className="text-xs text-red-700 hover:underline disabled:opacity-50">
              Remove
            </button>
          </li>
        ))}
        {monitor.maintenanceWindows.length === 0 && <li className="py-2 text-slate-500">No maintenance windows configured.</li>}
      </ul>
    </div>
  );
}
