"use client";

import { useEffect, useState } from "react";

interface StatusData {
  intraday: { uptime_pct_mtd: number | null; status: string; computed_at: string; source_data_complete: boolean } | null;
  history: {
    month: string;
    status: string;
    uptime_pct: number | null;
    contract_sla_pct: number;
    downtime_minutes: number;
    formula_version: string;
  }[];
  config: {
    logo_url: string | null;
    primary_color: string | null;
    footer_text: string | null;
    hide_slapulse_branding: boolean;
    attestations: { name: string; date: string; url?: string }[];
  } | null;
  customer: { customer_name: string; renewal_date: string | null; contract_sla_pct: number } | null;
}

interface Disclosure {
  incident_started_at: string;
  incident_summary: string;
  detected_at: string;
}

interface Identity {
  vendorId: string;
  customerId: string;
  customerName: string;
  email: string;
}

interface RollupEntry {
  customerId: string;
  customer_name: string;
  status: string;
  uptime_pct_mtd: number | null;
}

export default function PortalDashboardPage() {
  const [identity, setIdentity] = useState<Identity | null | undefined>(undefined);
  const [data, setData] = useState<StatusData | null>(null);
  const [disclosures, setDisclosures] = useState<Disclosure[]>([]);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [rollup, setRollup] = useState<RollupEntry[]>([]);
  const [apiKey, setApiKey] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/portal/session")
      .then((r) => r.json())
      .then((d) => setIdentity(d.identity));
  }, []);

  useEffect(() => {
    if (!identity) return;
    fetch("/api/portal/status")
      .then((r) => r.json())
      .then(setData);
    fetch("/api/portal/disclosures")
      .then((r) => r.json())
      .then((d) => setDisclosures(d.disclosures ?? []));
    fetch("/api/portal/rollup")
      .then((r) => r.json())
      .then((d) => setRollup(d.environments ?? []));
    fetch("/api/portal/api-key")
      .then((r) => r.json())
      .then((d) => setApiKey(d.apiKey ?? null));
  }, [identity]);

  const generateApiKey = async () => {
    const res = await fetch("/api/portal/api-key", { method: "POST" });
    const d = await res.json();
    setApiKey(d.apiKey);
  };

  if (identity === undefined) return null;
  if (identity === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-500">
          Not signed in. <a href="../login" className="text-sky-700 hover:underline">Sign in</a>
        </p>
      </div>
    );
  }

  const accent = data?.config?.primary_color ?? "#0f172a";

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {data?.config?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.config.logo_url} alt="" className="h-8" />
            ) : (
              <div className="font-semibold" style={{ color: accent }}>
                Trust Portal
              </div>
            )}
          </div>
          <div className="text-sm text-slate-500">{identity.customerName}</div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {data?.customer?.renewal_date && <RenewalBanner renewalDate={data.customer.renewal_date} />}

        {rollup.length > 1 && (
          <div className="rounded-lg border border-slate-200 bg-white p-4 mb-6">
            <div className="text-sm font-medium mb-2">All your environments (PF8)</div>
            <ul className="text-sm divide-y divide-slate-100">
              {rollup.map((r) => (
                <li key={r.customerId} className="py-1.5 flex justify-between">
                  <span>{r.customer_name}</span>
                  <span>
                    {r.status} · {r.uptime_pct_mtd !== null ? `${r.uptime_pct_mtd}%` : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">Current status</div>
            <div className="text-xl font-semibold mt-1" style={{ color: accent }}>
              {data?.intraday?.status ?? "—"}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              {data?.intraday ? `as of ${new Date(data.intraday.computed_at).toLocaleString()}` : "no data yet"}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">Uptime (month to date)</div>
            <div className="text-xl font-semibold mt-1">
              {data?.intraday?.uptime_pct_mtd !== null && data?.intraday?.uptime_pct_mtd !== undefined
                ? `${data.intraday.uptime_pct_mtd}%`
                : "—"}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">Contract SLA</div>
            <div className="text-xl font-semibold mt-1">{data?.customer?.contract_sla_pct ?? "—"}%</div>
          </div>
        </div>

        <div className="flex items-center justify-between mb-2">
          <h2 className="font-medium">Compliance history</h2>
          <div className="flex gap-2">
            <a href="/api/portal/export" className="text-xs rounded border border-slate-300 px-2 py-1 hover:bg-slate-100">
              Download export package
            </a>
            <button
              onClick={() => setDisputeOpen((s) => !s)}
              className="text-xs rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
            >
              {disputeOpen ? "Cancel" : "Flag a dispute"}
            </button>
          </div>
        </div>

        {disputeOpen && <DisputeForm onDone={() => setDisputeOpen(false)} />}

        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white mb-8">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Month</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Uptime</th>
                <th className="px-4 py-2 font-medium">Downtime</th>
                <th className="px-4 py-2 font-medium">Formula</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.history ?? []).map((h) => (
                <tr key={h.month}>
                  <td className="px-4 py-2">{h.month}</td>
                  <td className="px-4 py-2">{h.status}</td>
                  <td className="px-4 py-2">{h.uptime_pct !== null ? `${h.uptime_pct}%` : "—"}</td>
                  <td className="px-4 py-2">{h.downtime_minutes} min</td>
                  <td className="px-4 py-2">{h.formula_version}</td>
                </tr>
              ))}
              {(data?.history ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-3 text-slate-500">
                    No published history yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <h2 className="font-medium mb-2">Incident disclosures</h2>
        <ul className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100 mb-8">
          {disclosures.length === 0 && (
            <li className="px-4 py-3 text-sm text-slate-500">No disclosed incidents.</li>
          )}
          {disclosures.map((d, i) => (
            <li key={i} className="px-4 py-2 text-sm">
              <div className="font-medium">{d.incident_summary}</div>
              <div className="text-slate-400 text-xs">{new Date(d.incident_started_at).toLocaleString()}</div>
            </li>
          ))}
        </ul>

        {data?.config?.attestations && data.config.attestations.length > 0 && (
          <div>
            <h2 className="font-medium mb-2">Attestations</h2>
            <ul className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
              {data.config.attestations.map((a, i) => (
                <li key={i} className="px-4 py-2 text-sm flex justify-between">
                  <span>{a.name}</span>
                  <span className="text-slate-400">{a.date}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-8 rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-sm font-medium mb-1">Developer API (PF10)</div>
          <p className="text-xs text-slate-500 mb-2">
            Read-only: <code>GET /api/public/v1/sla?apiKey=...</code>
          </p>
          {apiKey ? (
            <code className="text-xs break-all bg-slate-50 rounded px-2 py-1 block">{apiKey}</code>
          ) : (
            <button onClick={generateApiKey} className="text-xs rounded border border-slate-300 px-2 py-1 hover:bg-slate-100">
              Generate API key
            </button>
          )}
        </div>

        {!data?.config?.hide_slapulse_branding && (
          <p className="text-xs text-slate-400 mt-8">Powered by SLAPulse</p>
        )}
        {data?.config?.footer_text && <p className="text-xs text-slate-400 mt-2">{data.config.footer_text}</p>}
      </main>
    </div>
  );
}

function RenewalBanner({ renewalDate }: { renewalDate: string }) {
  const days = Math.round((new Date(renewalDate).getTime() - Date.now()) / 86_400_000);
  if (days < 0 || days > 90) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-4 py-2 text-sm mb-6">
      Your contract renews in {days} days ({renewalDate}).
    </div>
  );
}

function DisputeForm({ onDone }: { onDone: () => void }) {
  const [month, setMonth] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await fetch("/api/portal/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, description }),
      });
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mb-4 rounded-lg border border-slate-200 bg-white p-3 flex flex-wrap gap-2 items-end text-sm">
      <label className="flex flex-col gap-1">
        Month
        <input
          required
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="border border-slate-300 rounded px-2 py-1"
        />
      </label>
      <label className="flex flex-col gap-1 flex-1 min-w-[240px]">
        What looks wrong?
        <input
          required
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="border border-slate-300 rounded px-2 py-1"
        />
      </label>
      <button type="submit" disabled={busy} className="rounded bg-slate-900 text-white px-3 py-1.5 disabled:opacity-50">
        {busy ? "…" : "Submit"}
      </button>
    </form>
  );
}
