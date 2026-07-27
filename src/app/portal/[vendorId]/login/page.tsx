"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface CustomerOption {
  customer_id: string;
  customer_name: string;
}

export default function PortalLoginPage() {
  const params = useParams<{ vendorId: string }>();
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/portal/customers?vendorId=${params.vendorId}`)
      .then((r) => r.json())
      .then((d) => {
        setCustomers(d.customers ?? []);
        if (d.customers?.[0]) setCustomerId(d.customers[0].customer_id);
      });
  }, [params.vendorId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setLink(null);
    try {
      const res = await fetch("/api/portal/auth/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId: params.vendorId, customerId, email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(JSON.stringify(data.error));
        return;
      }
      setLink(data.link);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="max-w-sm w-full bg-white border border-slate-200 rounded-lg p-6">
        <h1 className="text-lg font-semibold mb-1">Trust Portal sign-in</h1>
        <p className="text-sm text-slate-500 mb-4">
          Enter your company and email — we&apos;ll send a one-time sign-in link.
        </p>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Your company
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="border border-slate-300 rounded px-2 py-1.5"
            >
              {customers.map((c) => (
                <option key={c.customer_id} value={c.customer_id}>
                  {c.customer_name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Email
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border border-slate-300 rounded px-2 py-1.5"
              placeholder="you@your-company.com"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !customerId}
            className="rounded bg-slate-900 text-white px-3 py-2 text-sm hover:bg-slate-700 disabled:opacity-50"
          >
            {busy ? "Sending…" : "Send sign-in link"}
          </button>
        </form>

        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

        {link && (
          <div className="mt-4 rounded border border-sky-200 bg-sky-50 p-3 text-sm">
            <p className="text-slate-600 mb-1">
              Local dev: no real email was sent. Here&apos;s the link that would have gone out:
            </p>
            <a href={link} className="text-sky-700 break-all hover:underline">
              {link}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
