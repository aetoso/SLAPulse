"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useIdentity } from "@/components/IdentityContext";

interface Window {
  start: string;
  end: string;
}

interface CustomerDetail {
  customerId: string;
  customerName: string;
  slaTier: string;
  deploymentModel: string;
  maintenanceWindows: Window[];
}

interface CrossAccountEntry {
  simulated_role_arn: string;
  assumed_at: string;
}

export default function CustomerDetailPage() {
  const params = useParams<{ customerId: string }>();
  const { identity, loading: identityLoading } = useIdentity();
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [crossAccountLog, setCrossAccountLog] = useState<CrossAccountEntry[]>([]);
  const [form, setForm] = useState({ start: "", end: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/customers/${params.customerId}`);
    if (res.ok) setCustomer((await res.json()).customer);
    const logRes = await fetch(`/api/customers/${params.customerId}/cross-account-log`);
    if (logRes.ok) setCrossAccountLog((await logRes.json()).log);
  }, [params.customerId]);

  useEffect(() => {
    if (identity) load();
  }, [identity, load]);

  if (identityLoading) return null;
  if (!identity) return <p className="text-slate-500">Sign in to view this customer.</p>;
  if (!customer) return <p className="text-slate-500">Loading…</p>;

  const canManage = identity.role === "ADMIN" || identity.role === "SRE";

  const addWindow = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await fetch(`/api/customers/${customer.customerId}/maintenance-windows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: new Date(form.start).toISOString(),
          end: new Date(form.end).toISOString(),
        }),
      });
      setForm({ start: "", end: "" });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const removeWindow = async (index: number) => {
    setBusy(true);
    try {
      await fetch(`/api/customers/${customer.customerId}/maintenance-windows?index=${index}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">{customer.customerName}</h1>
      <p className="text-sm text-slate-500 mb-6">
        SLA tier: {customer.slaTier} · Deployment: {customer.deploymentModel}
      </p>

      <h2 className="font-medium mb-2">Maintenance windows (F8, self-service)</h2>
      <p className="text-xs text-slate-500 mb-3">
        Minutes inside a maintenance window are excluded from the SLA calculation (Section 9.2) —
        classified MAINTENANCE, not counted as downtime or uptime.
      </p>

      {canManage && (
        <form onSubmit={addWindow} className="mb-4 flex flex-wrap gap-2 items-end text-sm">
          <label className="flex flex-col gap-1">
            Start
            <input
              required
              type="datetime-local"
              value={form.start}
              onChange={(e) => setForm({ ...form, start: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1">
            End
            <input
              required
              type="datetime-local"
              value={form.end}
              onChange={(e) => setForm({ ...form, end: e.target.value })}
              className="border border-slate-300 rounded px-2 py-1"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-slate-900 text-white px-3 py-1.5 disabled:opacity-50"
          >
            {busy ? "…" : "Add window"}
          </button>
        </form>
      )}

      <ul className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
        {customer.maintenanceWindows.length === 0 && (
          <li className="px-4 py-3 text-sm text-slate-500">No maintenance windows configured.</li>
        )}
        {customer.maintenanceWindows.map((w, i) => (
          <li key={i} className="px-4 py-2 text-sm flex justify-between items-center">
            <span>
              {new Date(w.start).toLocaleString()} → {new Date(w.end).toLocaleString()}
            </span>
            {canManage && (
              <button
                onClick={() => removeWindow(i)}
                disabled={busy}
                className="text-xs text-red-700 hover:underline disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>

      {customer.deploymentModel === "MODEL_B" && (
        <div className="mt-8">
          <h2 className="font-medium mb-2">Cross-account access log (F9)</h2>
          <p className="text-xs text-slate-500 mb-3">
            Simulated STS AssumeRole calls — Model B customers each sit in their own AWS account
            (Section 10.3); every collection run assumes a role scoped to that account.
          </p>
          <ul className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100 font-mono text-xs">
            {crossAccountLog.length === 0 && (
              <li className="px-4 py-3 text-slate-500 font-sans">No role assumptions logged yet.</li>
            )}
            {crossAccountLog.map((e, i) => (
              <li key={i} className="px-4 py-2 flex justify-between">
                <span>{e.simulated_role_arn}</span>
                <span className="text-slate-400">{new Date(e.assumed_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
