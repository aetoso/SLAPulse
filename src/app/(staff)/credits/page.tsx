"use client";

import { useCallback, useEffect, useState } from "react";
import { useIdentity } from "@/components/IdentityContext";

interface Memo {
  id: string;
  customer_id: string;
  customer_name: string;
  month: string;
  credit_amount_usd: string;
  credit_pct_of_fee: string;
  formula_version: string;
  status: string;
  created_at: string;
}

export default function CreditsPage() {
  const { identity, loading: identityLoading } = useIdentity();
  const [memos, setMemos] = useState<Memo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/credits");
    if (res.ok) setMemos((await res.json()).memos);
  }, []);

  useEffect(() => {
    if (identity) load();
  }, [identity, load]);

  if (identityLoading) return null;
  if (!identity) return <p className="text-slate-500">Sign in to view SLA credit memos.</p>;
  if (identity.role === "CSM" || identity.role === "EXECUTIVE") {
    return <p className="text-slate-500">SLA credit memos are visible to Admin and SRE only.</p>;
  }

  const issue = async (id: string) => {
    setBusy(id);
    try {
      await fetch(`/api/credits/${id}/issue`, { method: "POST" });
      await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">SLA Credit Memos (F7)</h1>
      <p className="text-sm text-slate-500 mb-6">
        Auto-generated for BREACHED months when a customer has a monthly fee on file. Memos start as
        DRAFT — sequenced deliberately as a legal-exposure feature (Section 6, F7): nothing is issued
        to a customer without an explicit Admin action here.
      </p>

      {memos === null ? (
        <p className="text-slate-500">Loading…</p>
      ) : memos.length === 0 ? (
        <p className="text-slate-500">No credit memos yet. These are created automatically once a customer BREACHES with a monthly fee configured.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">Month</th>
                <th className="px-4 py-2 font-medium">Credit</th>
                <th className="px-4 py-2 font-medium">% of fee</th>
                <th className="px-4 py-2 font-medium">Formula</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {memos.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-2 font-medium text-slate-800">{m.customer_name}</td>
                  <td className="px-4 py-2 text-slate-600">{m.month}</td>
                  <td className="px-4 py-2 text-slate-600">${m.credit_amount_usd}</td>
                  <td className="px-4 py-2 text-slate-600">{m.credit_pct_of_fee}%</td>
                  <td className="px-4 py-2 text-slate-600">{m.formula_version}</td>
                  <td className="px-4 py-2 text-slate-600">{m.status}</td>
                  <td className="px-4 py-2">
                    {m.status === "DRAFT" && identity.role === "ADMIN" && (
                      <button
                        onClick={() => issue(m.id)}
                        disabled={busy === m.id}
                        className="rounded bg-slate-900 text-white px-2.5 py-1 text-xs hover:bg-slate-700 disabled:opacity-50"
                      >
                        {busy === m.id ? "…" : "Issue"}
                      </button>
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
