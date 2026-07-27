"use client";

import { useCallback, useEffect, useState } from "react";
import { useIdentity } from "@/components/IdentityContext";

interface CustomerOption {
  customerId: string;
  customerName: string;
}

interface StatusRow {
  id: string;
  month: string;
  status: string;
  is_active_for_display: boolean;
}

interface Correction {
  id: string;
  customer_id: string;
  customer_name: string;
  month: string;
  reason: string;
  raised_by: string;
  raised_at: string;
  approved_by: string | null;
  approved_at: string | null;
}

export default function CorrectionsPage() {
  const { identity, loading: identityLoading } = useIdentity();
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [statusRows, setStatusRows] = useState<StatusRow[]>([]);
  const [reason, setReason] = useState("");
  const [selectedStatusId, setSelectedStatusId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [custRes, corrRes] = await Promise.all([fetch("/api/customers"), fetch("/api/corrections")]);
    if (custRes.ok) {
      const d = await custRes.json();
      setCustomers(d.customers);
      if (!selectedCustomer && d.customers[0]) setSelectedCustomer(d.customers[0].customerId);
    }
    if (corrRes.ok) setCorrections((await corrRes.json()).corrections);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (identity) load();
  }, [identity, load]);

  useEffect(() => {
    if (!selectedCustomer) return;
    fetch(`/api/customers/${selectedCustomer}`)
      .then((r) => r.json())
      .then((d) => setStatusRows(d.statusHistory ?? []));
  }, [selectedCustomer]);

  if (identityLoading) return null;
  if (!identity) return <p className="text-slate-500">Sign in to view corrections and disputes.</p>;

  const raise = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStatusId) return;
    setBusy(true);
    setMessage(null);
    try {
      const row = statusRows.find((r) => r.id === selectedStatusId);
      const res = await fetch("/api/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: selectedCustomer,
          month: row?.month,
          originalStatusId: selectedStatusId,
          reason,
        }),
      });
      if (!res.ok) setMessage((await res.json()).error);
      else {
        setReason("");
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const approve = async (id: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/corrections/${id}/approve`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) setMessage(data.error);
      else {
        setMessage(`Recomputed -- new status: ${data.result.status}`);
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const canAct = identity.role === "ADMIN" || identity.role === "SRE";

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">Corrections &amp; Disputes</h1>
      <p className="text-sm text-slate-500 mb-6">
        Section 8.7 Ops-Initiated Correction: the original row is never edited or deleted. A
        correction only takes effect once a <em>different</em> user approves it, which re-runs the
        calculator and appends a new row — both remain in the trail, visible in the Evidence
        Explorer.
      </p>

      {message && <p className="text-sm text-sky-700 mb-4">{message}</p>}

      {canAct && (
        <form onSubmit={raise} className="mb-8 rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap gap-3 items-end text-sm">
          <label className="flex flex-col gap-1">
            Customer
            <select
              value={selectedCustomer}
              onChange={(e) => setSelectedCustomer(e.target.value)}
              className="border border-slate-300 rounded px-2 py-1"
            >
              {customers.map((c) => (
                <option key={c.customerId} value={c.customerId}>
                  {c.customerName}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Published status to correct
            <select
              value={selectedStatusId}
              onChange={(e) => setSelectedStatusId(e.target.value)}
              className="border border-slate-300 rounded px-2 py-1"
            >
              <option value="">Select…</option>
              {statusRows
                .filter((r) => r.is_active_for_display)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.month} — {r.status}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 flex-1 min-w-[200px]">
            Reason
            <input
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="border border-slate-300 rounded px-2 py-1"
              placeholder="Threshold mismatch found during parallel-run comparison"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !selectedStatusId}
            className="rounded bg-slate-900 text-white px-3 py-1.5 disabled:opacity-50"
          >
            {busy ? "…" : "Raise correction"}
          </button>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white mb-8">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Customer</th>
              <th className="px-4 py-2 font-medium">Month</th>
              <th className="px-4 py-2 font-medium">Reason</th>
              <th className="px-4 py-2 font-medium">Raised by</th>
              <th className="px-4 py-2 font-medium">Approved by</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {corrections.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-3 text-slate-500">
                  No corrections raised yet.
                </td>
              </tr>
            )}
            {corrections.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-2 font-medium text-slate-800">{c.customer_name}</td>
                <td className="px-4 py-2 text-slate-600">{c.month}</td>
                <td className="px-4 py-2 text-slate-600">{c.reason}</td>
                <td className="px-4 py-2 text-slate-600">{c.raised_by}</td>
                <td className="px-4 py-2 text-slate-600">{c.approved_by ?? "—"}</td>
                <td className="px-4 py-2">
                  {!c.approved_by && canAct && c.raised_by !== identity.actor && (
                    <button
                      onClick={() => approve(c.id)}
                      disabled={busy}
                      className="rounded bg-slate-900 text-white px-2.5 py-1 text-xs hover:bg-slate-700 disabled:opacity-50"
                    >
                      Approve &amp; recompute
                    </button>
                  )}
                  {!c.approved_by && c.raised_by === identity.actor && (
                    <span className="text-xs text-slate-400">awaiting a different approver</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AuditChainTools customers={customers} />
    </div>
  );
}

function AuditChainTools({ customers }: { customers: CustomerOption[] }) {
  const [customerId, setCustomerId] = useState("");
  const [status, setStatus] = useState<{ chainIntact: boolean; anchorsMatchExternalLog: boolean; anchors: unknown[] } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!customerId && customers[0]) setCustomerId(customers[0].customerId);
  }, [customers, customerId]);

  const checkStatus = useCallback(async (id: string) => {
    const res = await fetch(`/api/audit/anchor?customerId=${id}`);
    if (res.ok) setStatus(await res.json());
  }, []);

  useEffect(() => {
    if (customerId) checkStatus(customerId);
  }, [customerId, checkStatus]);

  const anchor = async () => {
    setBusy(true);
    try {
      await fetch("/api/audit/anchor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId }),
      });
      await checkStatus(customerId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2 className="font-medium mb-2">Formal audit trail (F12)</h2>
      <p className="text-xs text-slate-500 mb-3">
        Hash chain = tamper-evidence (detectable). External anchor = tamper-proof (a DB compromise
        alone can&apos;t rewrite an already-anchored chain head without the mismatch showing up here).
      </p>
      <div className="flex flex-wrap gap-3 items-end text-sm mb-3">
        <label className="flex flex-col gap-1">
          Customer
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="border border-slate-300 rounded px-2 py-1"
          >
            {customers.map((c) => (
              <option key={c.customerId} value={c.customerId}>
                {c.customerName}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={anchor}
          disabled={busy}
          className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-100 disabled:opacity-50"
        >
          {busy ? "…" : "Anchor current chain head"}
        </button>
        <a
          href={`/api/audit/export?customerId=${customerId}`}
          className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
        >
          Download audit export package
        </a>
      </div>
      {status && (
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm flex gap-6">
          <div>
            Chain intact:{" "}
            <span className={status.chainIntact ? "text-emerald-700" : "text-red-700"}>
              {String(status.chainIntact)}
            </span>
          </div>
          <div>
            Anchors match external log:{" "}
            <span className={status.anchorsMatchExternalLog ? "text-emerald-700" : "text-red-700"}>
              {String(status.anchorsMatchExternalLog)}
            </span>
          </div>
          <div>Anchors: {status.anchors.length}</div>
        </div>
      )}
    </div>
  );
}
