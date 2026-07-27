"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useIdentity } from "@/components/IdentityContext";
import { StatusBadge } from "@/components/StatusBadge";

interface CustomerOption {
  customerId: string;
  customerName: string;
}

interface MinuteRow {
  minute_timestamp: string;
  is_available: boolean;
  classification: string;
  route53_status: string | null;
  alb_5xx_pct: number | null;
  ecs_running_tasks: number | null;
  ecs_desired_tasks: number | null;
  ecs_health_status: string | null;
  is_maintenance_window: boolean;
  synthetic_failed: boolean | null;
  synthetic_response_time_ms: number | null;
}

interface AuditEvent {
  id: string;
  event_type: string;
  event_timestamp: string;
  actor: string;
  description: string | null;
  data_hash: string;
  previous_hash: string | null;
}

interface EvidenceData {
  customer: { customerId: string; customerName: string };
  date: string;
  formulaVersion: string;
  monthStatus: string | null;
  monthUptimePct: number | null;
  minutes: MinuteRow[];
  summary: Record<string, number>;
  auditEvents: AuditEvent[];
  auditChainIntact: boolean;
}

function EvidenceExplorer() {
  const { identity, loading: identityLoading } = useIdentity();
  const searchParams = useSearchParams();

  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerId, setCustomerId] = useState(searchParams.get("customerId") ?? "");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<EvidenceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!identity) return;
    fetch("/api/customers")
      .then((r) => r.json())
      .then((d) => {
        setCustomers(d.customers);
        if (!customerId && d.customers[0]) setCustomerId(d.customers[0].customerId);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  const load = async () => {
    if (!customerId || !date) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/evidence?customerId=${customerId}&date=${date}`);
      if (!res.ok) {
        setError((await res.json()).error);
        setData(null);
        return;
      }
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (customerId && date) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  if (identityLoading) return null;
  if (!identity) return <p className="text-slate-500">Sign in to view the evidence explorer.</p>;

  const nonUpMinutes = data?.minutes.filter((m) => m.classification !== "UP") ?? [];

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">SLA Evidence Explorer</h1>
      <p className="text-sm text-slate-500 mb-6">
        Drills into a bounded day window to show the exact raw signals, classification, formula
        version, and audit trail behind SLAPulse&apos;s uptime calculation (Section 8.10 default
        evidence package).
      </p>

      <div className="flex gap-3 items-end mb-6">
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          Customer
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="border border-slate-300 rounded px-2 py-1.5"
          >
            {customers.map((c) => (
              <option key={c.customerId} value={c.customerId}>
                {c.customerName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border border-slate-300 rounded px-2 py-1.5"
          />
        </label>
        <button
          onClick={load}
          disabled={loading}
          className="rounded bg-slate-900 text-white px-3 py-1.5 text-sm hover:bg-slate-700 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load evidence"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {data && (
        <div className="space-y-6">
          <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap gap-6 items-center text-sm">
            <div>
              <div className="text-slate-500">Month status</div>
              <div className="mt-1">
                {data.monthStatus ? <StatusBadge status={data.monthStatus} /> : "—"}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Month uptime</div>
              <div className="font-medium">
                {data.monthUptimePct !== null ? `${data.monthUptimePct}%` : "—"}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Formula version</div>
              <div className="font-medium">{data.formulaVersion}</div>
            </div>
            <div>
              <div className="text-slate-500">Audit chain</div>
              <div className={`font-medium ${data.auditChainIntact ? "text-emerald-700" : "text-red-700"}`}>
                {data.auditChainIntact ? "Intact" : "BROKEN — tampering detected"}
              </div>
            </div>
            <div className="flex gap-3 ml-auto">
              {Object.entries(data.summary).map(([k, v]) => (
                <div key={k} className="text-center">
                  <div className="text-slate-500 text-xs">{k}</div>
                  <div className="font-semibold">{v}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h2 className="font-medium mb-2">
              Non-UP minutes ({nonUpMinutes.length} of {data.minutes.length})
            </h2>
            {nonUpMinutes.length === 0 ? (
              <p className="text-sm text-slate-500">
                Every minute this day classified as UP — nothing to drill into.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-500 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 font-medium">Minute (UTC)</th>
                      <th className="px-3 py-2 font-medium">Classification</th>
                      <th className="px-3 py-2 font-medium">Route53</th>
                      <th className="px-3 py-2 font-medium">ALB 5xx %</th>
                      <th className="px-3 py-2 font-medium">ECS tasks</th>
                      <th className="px-3 py-2 font-medium">ECS health</th>
                      <th className="px-3 py-2 font-medium">Synthetic (F-SYN)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {nonUpMinutes.map((m) => (
                      <tr key={m.minute_timestamp}>
                        <td className="px-3 py-1.5 font-mono text-xs">
                          {m.minute_timestamp.slice(11, 16)}
                        </td>
                        <td className="px-3 py-1.5">
                          <StatusBadge status={m.classification} />
                        </td>
                        <td className="px-3 py-1.5">{m.route53_status ?? "—"}</td>
                        <td className="px-3 py-1.5">{m.alb_5xx_pct ?? "—"}</td>
                        <td className="px-3 py-1.5">
                          {m.ecs_running_tasks ?? "—"}/{m.ecs_desired_tasks ?? "—"}
                        </td>
                        <td className="px-3 py-1.5">{m.ecs_health_status ?? "—"}</td>
                        <td className="px-3 py-1.5">
                          {m.synthetic_failed === null
                            ? "n/a"
                            : m.synthetic_failed
                              ? "FAILED"
                              : `OK (${m.synthetic_response_time_ms}ms)`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <h2 className="font-medium mb-2">Linked audit events</h2>
            <ul className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
              {data.auditEvents.map((e) => (
                <li key={e.id} className="px-4 py-2 text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium">{e.event_type}</span>
                    <span className="text-slate-400 text-xs">
                      {new Date(e.event_timestamp).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-slate-600">{e.description}</div>
                  <div className="text-slate-400 text-xs font-mono">
                    actor: {e.actor} · hash: {e.data_hash.slice(0, 12)}…
                  </div>
                </li>
              ))}
              {data.auditEvents.length === 0 && (
                <li className="px-4 py-3 text-sm text-slate-500">No audit events yet for this customer.</li>
              )}
            </ul>
          </div>

          <IncidentAttribution customerId={customerId} date={date} />
        </div>
      )}
    </div>
  );
}

interface IncidentRow {
  id: string;
  incident_id: string;
  incident_source: string;
  severity: string;
  downtime_start: string;
  downtime_end: string;
  downtime_minutes: number;
}

function IncidentAttribution({ customerId, date }: { customerId: string; date: string }) {
  const { identity } = useIdentity();
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    incidentId: "",
    incidentSource: "PAGERDUTY",
    severity: "HIGH",
    downtimeStart: `${date}T00:00`,
    downtimeEnd: `${date}T23:59`,
  });
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    const res = await fetch(`/api/incidents?customerId=${customerId}`);
    if (res.ok) setIncidents((await res.json()).incidents);
  };

  useEffect(() => {
    if (customerId) load();
    setForm((f) => ({ ...f, downtimeStart: `${date}T00:00`, downtimeEnd: `${date}T23:59` }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, date]);

  const canAttribute = identity?.role === "ADMIN" || identity?.role === "SRE";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await fetch("/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          incidentId: form.incidentId,
          incidentSource: form.incidentSource,
          severity: form.severity,
          downtimeStart: new Date(form.downtimeStart).toISOString(),
          downtimeEnd: new Date(form.downtimeEnd).toISOString(),
        }),
      });
      setForm((f) => ({ ...f, incidentId: "" }));
      setShowForm(false);
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-medium">Linked incidents (F6)</h2>
        {canAttribute && (
          <button
            onClick={() => setShowForm((s) => !s)}
            className="text-xs rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
          >
            {showForm ? "Cancel" : "Attribute incident"}
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={submit} className="mb-3 rounded-lg border border-slate-200 bg-white p-3 flex flex-wrap gap-2 items-end text-sm">
          <label className="flex flex-col gap-1">
            Incident ID
            <input
              required
              value={form.incidentId}
              onChange={(e) => setForm({ ...form, incidentId: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1"
              placeholder="PD-1234"
            />
          </label>
          <label className="flex flex-col gap-1">
            Source
            <select
              value={form.incidentSource}
              onChange={(e) => setForm({ ...form, incidentSource: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1"
            >
              <option value="PAGERDUTY">PagerDuty</option>
              <option value="OPSGENIE">OpsGenie</option>
              <option value="MANUAL">Manual</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Severity
            <select
              value={form.severity}
              onChange={(e) => setForm({ ...form, severity: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1"
            >
              <option>LOW</option>
              <option>MEDIUM</option>
              <option>HIGH</option>
              <option>CRITICAL</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Window start
            <input
              type="datetime-local"
              value={form.downtimeStart}
              onChange={(e) => setForm({ ...form, downtimeStart: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1">
            Window end
            <input
              type="datetime-local"
              value={form.downtimeEnd}
              onChange={(e) => setForm({ ...form, downtimeEnd: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1"
            />
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-slate-900 text-white px-3 py-1.5 disabled:opacity-50"
          >
            {submitting ? "…" : "Attribute"}
          </button>
        </form>
      )}

      <ul className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
        {incidents.length === 0 && (
          <li className="px-4 py-3 text-sm text-slate-500">No incidents attributed to this customer yet.</li>
        )}
        {incidents.map((inc) => (
          <li key={inc.id} className="px-4 py-2 text-sm flex justify-between">
            <div>
              <span className="font-medium">{inc.incident_id}</span>{" "}
              <span className="text-slate-400 text-xs">
                {inc.incident_source} · {inc.severity}
              </span>
              <div className="text-slate-500 text-xs">
                {new Date(inc.downtime_start).toLocaleString()} → {new Date(inc.downtime_end).toLocaleString()}
              </div>
            </div>
            <div className="text-slate-600">{inc.downtime_minutes} min attributed</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function EvidencePage() {
  return (
    <Suspense fallback={null}>
      <EvidenceExplorer />
    </Suspense>
  );
}
