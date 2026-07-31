"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Radar, CheckCircle2, XCircle, Zap, Plus, Globe, RefreshCw } from "lucide-react";
import { useIdentity } from "@/components/IdentityContext";
import { StatusBadge } from "@/components/StatusBadge";
import { StatCard } from "@/components/StatCard";

interface MonitorRow {
  monitorId: string;
  name: string;
  targetUrl: string;
  checkType: string;
  contractSlaPct: number;
  status: string;
  uptimePct: number | null;
  slaStatus: string;
  currentlyUp: boolean | null;
  lastCheckedAt: string | null;
  avgResponseTimeMs: number | null;
  linkedCustomerId: string | null;
}

export default function MonitorsPage() {
  const { identity, loading: identityLoading } = useIdentity();
  const [monitors, setMonitors] = useState<MonitorRow[] | null>(null);
  const [month, setMonth] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/monitors");
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to load monitors");
      return;
    }
    const data = await res.json();
    setMonitors(data.monitors);
    setMonth(data.month);
    setError(null);
  }, []);

  useEffect(() => {
    if (identity) load();
  }, [identity, load]);

  const runJob = async (type: "monitorCheck" | "monitorCalculate") => {
    setRunning(type);
    try {
      const res = await fetch("/api/jobs/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      if (!res.ok) setError((await res.json()).error ?? "Job failed");
      else await load();
    } finally {
      setRunning(null);
    }
  };

  const kpis = useMemo(() => {
    if (!monitors) return null;
    const withData = monitors.filter((m) => m.uptimePct !== null);
    return {
      total: monitors.length,
      up: monitors.filter((m) => m.currentlyUp === true).length,
      down: monitors.filter((m) => m.currentlyUp === false).length,
      avgUptime: withData.length > 0 ? (withData.reduce((s, m) => s + (m.uptimePct ?? 0), 0) / withData.length).toFixed(3) : "—",
    };
  }, [monitors]);

  if (identityLoading) return null;
  if (!identity) return null;

  const canManage = identity.role === "ADMIN" || identity.role === "SRE";

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2">
            <Radar className="h-5 w-5 text-indigo-600" />
            <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Uptime Monitoring</h1>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            Independent external checks — no AWS access required. Current month: {month || "…"}
          </p>
        </div>
        <div className="flex gap-2">
          {canManage && (
            <>
              <JobButton label="Check now" icon={RefreshCw} busy={running === "monitorCheck"} onClick={() => runJob("monitorCheck")} />
              <JobButton label="Recalc SLA" icon={Zap} busy={running === "monitorCalculate"} onClick={() => runJob("monitorCalculate")} />
              <button
                onClick={() => setShowForm((s) => !s)}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 text-white px-3 py-2 text-sm font-medium hover:bg-indigo-700 shadow-sm"
              >
                <Plus className="h-3.5 w-3.5" />
                Add monitor
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-2.5 mb-6">{error}</div>}

      {showForm && canManage && (
        <AddMonitorForm
          onDone={() => {
            setShowForm(false);
            load();
          }}
          onError={setError}
        />
      )}

      {kpis && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <StatCard label="Monitors" value={kpis.total} icon={Radar} tone="indigo" />
          <StatCard label="Up now" value={kpis.up} icon={CheckCircle2} tone="emerald" />
          <StatCard label="Down now" value={kpis.down} icon={XCircle} tone="red" />
          <StatCard label="Avg uptime (MTD)" value={typeof kpis.avgUptime === "string" ? kpis.avgUptime + (kpis.avgUptime !== "—" ? "%" : "") : kpis.avgUptime} icon={Zap} tone="slate" />
        </div>
      )}

      {identity.role === "ADMIN" && <StatusPageSettings />}

      {monitors === null ? (
        <p className="text-slate-500">Loading…</p>
      ) : monitors.length === 0 ? (
        <EmptyState canManage={canManage} onAdd={() => setShowForm(true)} />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-left text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-5 py-3 font-medium">Monitor</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Live status</th>
                <th className="px-5 py-3 font-medium">Response time</th>
                <th className="px-5 py-3 font-medium">Uptime (MTD)</th>
                <th className="px-5 py-3 font-medium">Contract SLA</th>
                <th className="px-5 py-3 font-medium">SLA status</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {monitors.map((m) => (
                <tr key={m.monitorId} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-5 py-3">
                    <div className="font-medium text-slate-800">{m.name}</div>
                    <div className="text-xs text-slate-400 flex items-center gap-1">
                      <Globe className="h-3 w-3" />
                      {m.targetUrl}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{m.checkType}</td>
                  <td className="px-5 py-3">
                    {m.currentlyUp === null ? (
                      <span className="text-xs text-slate-400">checking…</span>
                    ) : (
                      <StatusBadge status={m.currentlyUp ? "UP" : "DOWNTIME"} />
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-600 tabular-nums">
                    {m.avgResponseTimeMs !== null ? `${m.avgResponseTimeMs}ms` : "—"}
                  </td>
                  <td className="px-5 py-3 text-slate-600 tabular-nums">{m.uptimePct !== null ? `${m.uptimePct}%` : "—"}</td>
                  <td className="px-5 py-3 text-slate-600 tabular-nums">{m.contractSlaPct}%</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={m.slaStatus} />
                  </td>
                  <td className="px-5 py-3">
                    <Link href={`/monitors/${m.monitorId}`} className="text-indigo-600 hover:text-indigo-700 font-medium text-xs">
                      Details →
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
  icon: Icon,
}: {
  label: string;
  busy: boolean;
  onClick: () => void;
  icon: React.ElementType;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="flex items-center gap-1.5 rounded-lg border border-slate-200 text-slate-600 px-3 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50 transition-colors"
    >
      <Icon className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
      {label}
    </button>
  );
}

function EmptyState({ canManage, onAdd }: { canManage: boolean; onAdd: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
      <Radar className="h-8 w-8 text-slate-300 mx-auto mb-3" />
      <p className="text-slate-500 mb-1">No monitors yet.</p>
      {canManage && (
        <button onClick={onAdd} className="text-indigo-600 hover:text-indigo-700 font-medium text-sm">
          Add your first monitor →
        </button>
      )}
    </div>
  );
}

const ALL_REGIONS = ["us-east-1", "eu-west-1", "ap-southeast-1"];

function AddMonitorForm({ onDone, onError }: { onDone: () => void; onError: (e: string) => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    monitorId: "",
    name: "",
    targetUrl: "",
    checkType: "HTTPS",
    port: "",
    intervalSeconds: "60",
    contractSlaPct: "99.9",
    linkedCustomerId: "",
    regions: [...ALL_REGIONS],
    keyword: "",
    keywordMode: "PRESENT",
    sslCheckEnabled: true,
    sslExpiryWarningDays: "14",
    confirmationMinutes: "1",
    webhookUrl: "",
    heartbeatExpectedIntervalSeconds: "300",
    heartbeatGraceSeconds: "60",
    showOnStatusPage: true,
  });
  const [customers, setCustomers] = useState<{ customerId: string; customerName: string }[]>([]);

  useEffect(() => {
    fetch("/api/customers")
      .then((r) => r.json())
      .then((d) => setCustomers(d.customers ?? []))
      .catch(() => {});
  }, []);

  const toggleRegion = (region: string) => {
    setForm((f) => ({
      ...f,
      regions: f.regions.includes(region) ? f.regions.filter((r) => r !== region) : [...f.regions, region],
    }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    onError("");
    try {
      const res = await fetch("/api/monitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          port: form.port ? Number(form.port) : null,
          intervalSeconds: Number(form.intervalSeconds),
          contractSlaPct: Number(form.contractSlaPct),
          linkedCustomerId: form.linkedCustomerId || null,
          keyword: form.checkType === "KEYWORD" ? form.keyword : null,
          keywordMode: form.checkType === "KEYWORD" ? form.keywordMode : null,
          sslExpiryWarningDays: Number(form.sslExpiryWarningDays),
          confirmationMinutes: Number(form.confirmationMinutes),
          webhookUrl: form.webhookUrl || null,
          heartbeatExpectedIntervalSeconds: form.checkType === "HEARTBEAT" ? Number(form.heartbeatExpectedIntervalSeconds) : null,
          heartbeatGraceSeconds: form.checkType === "HEARTBEAT" ? Number(form.heartbeatGraceSeconds) : null,
          regions: form.checkType === "HEARTBEAT" ? undefined : form.regions,
        }),
      });
      if (!res.ok) {
        onError(JSON.stringify((await res.json()).error));
        return;
      }
      onDone();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm grid grid-cols-2 gap-3 text-sm">
      <label className="flex flex-col gap-1">
        Monitor ID (slug)
        <input
          required
          value={form.monitorId}
          onChange={(e) => setForm({ ...form, monitorId: e.target.value })}
          className="border border-slate-200 rounded-lg px-2.5 py-1.5"
          placeholder="beta-inc-app"
        />
      </label>
      <label className="flex flex-col gap-1">
        Name
        <input
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="border border-slate-200 rounded-lg px-2.5 py-1.5"
          placeholder="Beta Inc — main app"
        />
      </label>
      <label className="flex flex-col gap-1 col-span-2">
        {form.checkType === "HEARTBEAT" ? "Name of the job (informational only)" : "Target URL (or host for TCP/ping)"}
        <input
          required={form.checkType !== "HEARTBEAT"}
          disabled={form.checkType === "HEARTBEAT"}
          value={form.checkType === "HEARTBEAT" ? "n/a — receives pings, doesn't poll a URL" : form.targetUrl}
          onChange={(e) => setForm({ ...form, targetUrl: e.target.value })}
          className="border border-slate-200 rounded-lg px-2.5 py-1.5 disabled:bg-slate-50 disabled:text-slate-400"
          placeholder="https://example.com"
        />
      </label>
      <label className="flex flex-col gap-1">
        Check type
        <select
          value={form.checkType}
          onChange={(e) => setForm({ ...form, checkType: e.target.value })}
          className="border border-slate-200 rounded-lg px-2.5 py-1.5"
        >
          <option value="HTTPS">HTTPS (status + latency)</option>
          <option value="KEYWORD">Keyword (content must/must not contain text)</option>
          <option value="TCP">TCP port</option>
          <option value="PING">Ping (TCP handshake latency)</option>
          <option value="HEARTBEAT">Heartbeat / cron (dead man's switch)</option>
        </select>
      </label>
      {(form.checkType === "TCP" || form.checkType === "PING") && (
        <label className="flex flex-col gap-1">
          Port
          <input
            value={form.port}
            onChange={(e) => setForm({ ...form, port: e.target.value })}
            className="border border-slate-200 rounded-lg px-2.5 py-1.5"
            placeholder="443"
          />
        </label>
      )}
      {form.checkType === "KEYWORD" && (
        <>
          <label className="flex flex-col gap-1">
            Keyword
            <input
              required
              value={form.keyword}
              onChange={(e) => setForm({ ...form, keyword: e.target.value })}
              className="border border-slate-200 rounded-lg px-2.5 py-1.5"
              placeholder="Welcome back"
            />
          </label>
          <label className="flex flex-col gap-1">
            Mode
            <select
              value={form.keywordMode}
              onChange={(e) => setForm({ ...form, keywordMode: e.target.value })}
              className="border border-slate-200 rounded-lg px-2.5 py-1.5"
            >
              <option value="PRESENT">Must be present</option>
              <option value="ABSENT">Must be absent</option>
            </select>
          </label>
        </>
      )}
      {form.checkType === "HEARTBEAT" ? (
        <>
          <label className="flex flex-col gap-1">
            Expected interval (seconds)
            <input
              type="number"
              value={form.heartbeatExpectedIntervalSeconds}
              onChange={(e) => setForm({ ...form, heartbeatExpectedIntervalSeconds: e.target.value })}
              className="border border-slate-200 rounded-lg px-2.5 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1">
            Grace period (seconds)
            <input
              type="number"
              value={form.heartbeatGraceSeconds}
              onChange={(e) => setForm({ ...form, heartbeatGraceSeconds: e.target.value })}
              className="border border-slate-200 rounded-lg px-2.5 py-1.5"
            />
          </label>
        </>
      ) : (
        <label className="flex flex-col gap-1">
          Check interval (seconds)
          <input
            type="number"
            min={30}
            value={form.intervalSeconds}
            onChange={(e) => setForm({ ...form, intervalSeconds: e.target.value })}
            className="border border-slate-200 rounded-lg px-2.5 py-1.5"
          />
        </label>
      )}
      <label className="flex flex-col gap-1">
        Contract SLA %
        <input
          required
          type="number"
          step="0.0001"
          value={form.contractSlaPct}
          onChange={(e) => setForm({ ...form, contractSlaPct: e.target.value })}
          className="border border-slate-200 rounded-lg px-2.5 py-1.5"
        />
      </label>
      <label className="flex flex-col gap-1">
        Confirm DOWN after (consecutive minutes)
        <input
          type="number"
          min={1}
          max={10}
          value={form.confirmationMinutes}
          onChange={(e) => setForm({ ...form, confirmationMinutes: e.target.value })}
          className="border border-slate-200 rounded-lg px-2.5 py-1.5"
        />
      </label>

      {form.checkType !== "HEARTBEAT" && (
        <div className="col-span-2">
          <p className="text-sm text-slate-600 mb-1">Probe regions (2-of-3 style quorum across whichever you select)</p>
          <div className="flex gap-3">
            {ALL_REGIONS.map((region) => (
              <label key={region} className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={form.regions.includes(region)} onChange={() => toggleRegion(region)} />
                {region}
              </label>
            ))}
          </div>
        </div>
      )}

      {(form.checkType === "HTTPS" || form.checkType === "KEYWORD") && (
        <>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.sslCheckEnabled}
              onChange={(e) => setForm({ ...form, sslCheckEnabled: e.target.checked })}
            />
            Monitor SSL certificate expiry
          </label>
          {form.sslCheckEnabled && (
            <label className="flex flex-col gap-1">
              Warn when expiring within (days)
              <input
                type="number"
                value={form.sslExpiryWarningDays}
                onChange={(e) => setForm({ ...form, sslExpiryWarningDays: e.target.value })}
                className="border border-slate-200 rounded-lg px-2.5 py-1.5"
              />
            </label>
          )}
        </>
      )}

      <label className="flex flex-col gap-1 col-span-2">
        Webhook URL (optional — real HTTP POST on confirmed status change)
        <input
          value={form.webhookUrl}
          onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })}
          className="border border-slate-200 rounded-lg px-2.5 py-1.5"
          placeholder="https://hooks.example.com/slapulse"
        />
      </label>

      <label className="flex flex-col gap-1 col-span-2">
        Link to AWS-monitored customer (optional — enables &quot;why did it go down&quot; evidence)
        <select
          value={form.linkedCustomerId}
          onChange={(e) => setForm({ ...form, linkedCustomerId: e.target.value })}
          className="border border-slate-200 rounded-lg px-2.5 py-1.5"
        >
          <option value="">None</option>
          {customers.map((c) => (
            <option key={c.customerId} value={c.customerId}>
              {c.customerName}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 col-span-2">
        <input
          type="checkbox"
          checked={form.showOnStatusPage}
          onChange={(e) => setForm({ ...form, showOnStatusPage: e.target.checked })}
        />
        Show on public status page
      </label>

      <div className="col-span-2 flex justify-end">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? "Adding…" : "Add monitor"}
        </button>
      </div>
    </form>
  );
}

function StatusPageSettings() {
  const [config, setConfig] = useState<{ title: string; is_public: boolean } | null>(null);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/monitors/status-page")
      .then((r) => r.json())
      .then((d) => setConfig(d.config));
    fetch("/api/session")
      .then((r) => r.json())
      .then((d) => setVendorId(d.identity?.vendorId ?? null));
  }, []);

  if (!config) return null;

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/monitors/status-page", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: config.title, isPublic: config.is_public }),
      });
      if (res.ok) setConfig((await res.json()).config);
    } finally {
      setBusy(false);
    }
  };

  const publicUrl = vendorId ? `${window.location.origin}/status/${vendorId}` : "";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm mb-6">
      <h2 className="text-sm font-semibold text-slate-800 mb-3">Public status page</h2>
      <div className="flex items-end gap-3 mb-2">
        <label className="flex flex-col gap-1 text-sm flex-1">
          Title
          <input
            value={config.title}
            onChange={(e) => setConfig({ ...config, title: e.target.value })}
            className="border border-slate-200 rounded-lg px-2.5 py-1.5"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={config.is_public} onChange={(e) => setConfig({ ...config, is_public: e.target.checked })} />
          Public
        </label>
        <button onClick={save} disabled={busy} className="rounded-lg bg-slate-900 text-white px-3 py-1.5 text-sm disabled:opacity-50">
          {busy ? "…" : "Save"}
        </button>
      </div>
      {publicUrl && (
        <a href={publicUrl} target="_blank" className="text-xs text-indigo-600 hover:underline break-all">
          {publicUrl}
        </a>
      )}
    </div>
  );
}
