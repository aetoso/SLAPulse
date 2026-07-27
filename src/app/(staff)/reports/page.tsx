"use client";

import { useCallback, useEffect, useState } from "react";
import { useIdentity } from "@/components/IdentityContext";

interface CustomerOption {
  customerId: string;
  customerName: string;
}

interface OutboxEmail {
  id: string;
  to: string[];
  subject: string;
  sentAt: string;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function ReportsPage() {
  const { identity, loading: identityLoading } = useIdentity();
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [month, setMonth] = useState(currentMonth());
  const [outbox, setOutbox] = useState<OutboxEmail[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [custRes, outboxRes] = await Promise.all([fetch("/api/customers"), fetch("/api/mail-outbox")]);
    if (custRes.ok) setCustomers((await custRes.json()).customers);
    if (outboxRes.ok) setOutbox((await outboxRes.json()).emails);
  }, []);

  useEffect(() => {
    if (identity) load();
  }, [identity, load]);

  if (identityLoading) return null;
  if (!identity) return <p className="text-slate-500">Sign in to view reports.</p>;
  if (identity.role === "EXECUTIVE") {
    return <p className="text-slate-500">Report generation is not available to the Executive role.</p>;
  }

  const generate = async (customerId: string, send: boolean, format: "html" | "pdf") => {
    const key = `${customerId}-${send}-${format}`;
    setBusy(key);
    setMessage(null);
    try {
      if (format === "pdf" && !send) {
        window.open(`/api/reports/download?customerId=${customerId}&month=${month}&format=pdf`, "_blank");
        return;
      }
      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, month, send }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Failed");
        return;
      }
      setMessage(
        data.alreadySent
          ? "Already sent this month (idempotent -- Section 8.5)."
          : send
            ? `Report generated and emailed (mock message ${data.messageId}).`
            : "Report generated."
      );
      await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">SLA Reports (F4 + F10)</h1>
      <p className="text-sm text-slate-500 mb-6">
        Monthly report generation is idempotent per customer per month (Section 8.5) — sending twice
        does nothing the second time. PDF export (F10) renders the same template via a headless
        browser instead of plain HTML email.
      </p>

      <div className="flex items-center gap-3 mb-4">
        <label className="text-sm text-slate-600">
          Month{" "}
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border border-slate-300 rounded px-2 py-1 ml-1"
          />
        </label>
      </div>

      {message && <p className="text-sm text-sky-700 mb-4">{message}</p>}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white mb-8">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Customer</th>
              <th className="px-4 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {customers.map((c) => (
              <tr key={c.customerId}>
                <td className="px-4 py-2 font-medium text-slate-800">{c.customerName}</td>
                <td className="px-4 py-2 flex gap-2 flex-wrap">
                  <ActionButton
                    label="Download HTML"
                    busy={busy === `${c.customerId}-false-html`}
                    onClick={() =>
                      window.open(`/api/reports/download?customerId=${c.customerId}&month=${month}&format=html`, "_blank")
                    }
                  />
                  <ActionButton
                    label="Download PDF"
                    busy={busy === `${c.customerId}-false-pdf`}
                    onClick={() => generate(c.customerId, false, "pdf")}
                  />
                  <ActionButton
                    label="Generate & send"
                    primary
                    busy={busy === `${c.customerId}-true-html`}
                    onClick={() => generate(c.customerId, true, "html")}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="font-medium mb-2">Mock SES outbox</h2>
      <p className="text-xs text-slate-500 mb-3">
        No real email is sent locally — this is what would have gone out via SES.
      </p>
      <ul className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
        {outbox.length === 0 && <li className="px-4 py-3 text-sm text-slate-500">Nothing sent yet.</li>}
        {outbox.map((e) => (
          <li key={e.id} className="px-4 py-2 text-sm flex justify-between items-center">
            <div>
              <div className="font-medium">{e.subject}</div>
              <div className="text-slate-500 text-xs">
                to: {e.to.join(", ")} · {new Date(e.sentAt).toLocaleString()}
              </div>
            </div>
            <a href={`/api/mail-outbox/${e.id}`} target="_blank" className="text-sky-700 hover:underline text-xs">
              View →
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  busy,
  primary,
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`rounded px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
        primary ? "bg-slate-900 text-white hover:bg-slate-700" : "border border-slate-300 hover:bg-slate-100"
      }`}
    >
      {busy ? "…" : label}
    </button>
  );
}
