"use client";

import { useCallback, useEffect, useState } from "react";
import { useIdentity } from "@/components/IdentityContext";

interface CustomerRow {
  customerId: string;
  customerName: string;
  contractSlaPct: number;
  region: string;
  status: string;
  demoProfile: string;
  assignedCsmUserId: string | null;
  deploymentModel: string;
  syntheticMonitoringEnabled: boolean;
}

const DEMO_PROFILES = [
  { value: "stable", label: "Stable (rare blips)" },
  { value: "flaky", label: "Flaky (frequent degraded, occasional downtime)" },
  { value: "degrading", label: "Degrading (worsens through the month)" },
  { value: "breached", label: "Breached (daily outage window)" },
  { value: "data_gap", label: "Data gap (~15% missing minutes)" },
  { value: "app_outage", label: "App outage (infra green, needs F-SYN to detect)" },
];

export default function CustomersPage() {
  const { identity, loading: identityLoading } = useIdentity();
  const [customers, setCustomers] = useState<CustomerRow[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/customers");
    if (res.ok) setCustomers((await res.json()).customers);
  }, []);

  useEffect(() => {
    if (identity) load();
  }, [identity, load]);

  if (identityLoading) return null;
  if (!identity) return <p className="text-slate-500">Sign in to view the customer registry.</p>;

  const canManage = identity.role === "ADMIN";

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Customer Environment Registry</h1>
        {canManage && (
          <button
            onClick={() => setShowForm((s) => !s)}
            className="rounded bg-slate-900 text-white px-3 py-1.5 text-sm hover:bg-slate-700"
          >
            {showForm ? "Cancel" : "Register customer"}
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {showForm && canManage && (
        <RegisterForm
          onDone={() => {
            setShowForm(false);
            load();
          }}
          onError={setError}
        />
      )}

      {customers === null ? (
        <p className="text-slate-500">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">Contract SLA</th>
                <th className="px-4 py-2 font-medium">Region</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Demo profile</th>
                <th className="px-4 py-2 font-medium">Deployment</th>
                <th className="px-4 py-2 font-medium">F-SYN</th>
                <th className="px-4 py-2 font-medium">Assigned CSM</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {customers.map((c) => (
                <tr key={c.customerId}>
                  <td className="px-4 py-2 font-medium text-slate-800">
                    <a href={`/customers/${c.customerId}`} className="hover:underline text-sky-700">
                      {c.customerName}
                    </a>
                  </td>
                  <td className="px-4 py-2 text-slate-600">{c.contractSlaPct}%</td>
                  <td className="px-4 py-2 text-slate-600">{c.region}</td>
                  <td className="px-4 py-2 text-slate-600">
                    {c.status === "CONFIG_ERROR" ? (
                      <span className="text-red-700 font-medium">CONFIG_ERROR</span>
                    ) : (
                      c.status
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{c.demoProfile}</td>
                  <td className="px-4 py-2 text-slate-600">{c.deploymentModel}</td>
                  <td className="px-4 py-2 text-slate-600">{c.syntheticMonitoringEnabled ? "on" : "off"}</td>
                  <td className="px-4 py-2 text-slate-600">{c.assignedCsmUserId ?? "—"}</td>
                  <td className="px-4 py-2">
                    {c.status === "CONFIG_ERROR" && canManage && (
                      <ResolveDriftButton customerId={c.customerId} onDone={load} />
                    )}
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

function ResolveDriftButton({ customerId, onDone }: { customerId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch(`/api/customers/${customerId}/resolve-drift`, { method: "POST" });
          onDone();
        } finally {
          setBusy(false);
        }
      }}
      className="rounded border border-red-300 text-red-700 px-2 py-1 text-xs hover:bg-red-50 disabled:opacity-50"
    >
      {busy ? "…" : "Resolve drift"}
    </button>
  );
}

function RegisterForm({ onDone, onError }: { onDone: () => void; onError: (e: string) => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    customerId: "",
    customerName: "",
    contractSlaPct: "99.9",
    region: "us-east-1",
    contractStartDate: new Date().toISOString().slice(0, 10),
    assignedCsmUserId: "csm-jordan",
    demoProfile: "stable",
    monthlyFeeUsd: "5000",
    deploymentModel: "MODEL_A",
    syntheticMonitoringEnabled: false,
    renewalDate: "",
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    onError("");
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          contractSlaPct: Number(form.contractSlaPct),
          monthlyFeeUsd: form.monthlyFeeUsd ? Number(form.monthlyFeeUsd) : null,
          renewalDate: form.renewalDate || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        onError(JSON.stringify(d.error));
        return;
      }
      onDone();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="mb-6 rounded-lg border border-slate-200 bg-white p-4 grid grid-cols-2 gap-3">
      <Field label="Customer ID (slug)">
        <input
          required
          value={form.customerId}
          onChange={(e) => setForm({ ...form, customerId: e.target.value })}
          className="input"
          placeholder="beta-inc"
        />
      </Field>
      <Field label="Customer name">
        <input
          required
          value={form.customerName}
          onChange={(e) => setForm({ ...form, customerName: e.target.value })}
          className="input"
          placeholder="Beta Inc"
        />
      </Field>
      <Field label="Contract SLA %">
        <input
          required
          type="number"
          step="0.0001"
          value={form.contractSlaPct}
          onChange={(e) => setForm({ ...form, contractSlaPct: e.target.value })}
          className="input"
        />
      </Field>
      <Field label="Region">
        <input
          required
          value={form.region}
          onChange={(e) => setForm({ ...form, region: e.target.value })}
          className="input"
        />
      </Field>
      <Field label="Contract start date">
        <input
          required
          type="date"
          value={form.contractStartDate}
          onChange={(e) => setForm({ ...form, contractStartDate: e.target.value })}
          className="input"
        />
      </Field>
      <Field label="Assigned CSM">
        <input
          value={form.assignedCsmUserId}
          onChange={(e) => setForm({ ...form, assignedCsmUserId: e.target.value })}
          className="input"
        />
      </Field>
      <Field label="Demo profile (mock signal behavior)">
        <select
          value={form.demoProfile}
          onChange={(e) => setForm({ ...form, demoProfile: e.target.value })}
          className="input"
        >
          {DEMO_PROFILES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Monthly fee USD (F7 credit calc input)">
        <input
          type="number"
          value={form.monthlyFeeUsd}
          onChange={(e) => setForm({ ...form, monthlyFeeUsd: e.target.value })}
          className="input"
        />
      </Field>
      <Field label="Deployment model (F9)">
        <select
          value={form.deploymentModel}
          onChange={(e) => setForm({ ...form, deploymentModel: e.target.value })}
          className="input"
        >
          <option value="MODEL_A">Model A (shared account, tag-based)</option>
          <option value="MODEL_B">Model B (cross-account, STS AssumeRole)</option>
        </select>
      </Field>
      <Field label="Renewal date (F11 renewal risk)">
        <input
          type="date"
          value={form.renewalDate}
          onChange={(e) => setForm({ ...form, renewalDate: e.target.value })}
          className="input"
        />
      </Field>
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={form.syntheticMonitoringEnabled}
          onChange={(e) => setForm({ ...form, syntheticMonitoringEnabled: e.target.checked })}
        />
        Synthetic transaction monitoring (F-SYN)
      </label>
      <div className="col-span-2 flex justify-end">
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-slate-900 text-white px-4 py-2 text-sm hover:bg-slate-700 disabled:opacity-50"
        >
          {submitting ? "Registering…" : "Register"}
        </button>
      </div>
      <style jsx>{`
        .input {
          border: 1px solid #cbd5e1;
          border-radius: 0.375rem;
          padding: 0.375rem 0.5rem;
          font-size: 0.875rem;
          width: 100%;
        }
      `}</style>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-slate-600">
      {label}
      {children}
    </label>
  );
}
