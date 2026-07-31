"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface MonitorStatus {
  monitorId: string;
  name: string;
  checkType: string;
  currentlyUp: boolean | null;
  classification: string;
  uptimePctMtd: number | null;
}

export default function PublicStatusPage() {
  const params = useParams<{ vendorId: string }>();
  const [data, setData] = useState<{ title: string; monitors: MonitorStatus[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/public/status/${params.vendorId}`)
      .then(async (r) => {
        if (!r.ok) {
          setError((await r.json()).error ?? "Not found");
          return;
        }
        setData(await r.json());
      })
      .catch(() => setError("Failed to load status page"));
  }, [params.vendorId]);

  const allUp = data?.monitors.every((m) => m.currentlyUp !== false) ?? true;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-2xl mx-auto px-6 py-12">
        {error && <p className="text-red-600 text-sm">{error}</p>}
        {data && (
          <>
            <h1 className="text-2xl font-semibold text-slate-900 mb-1">{data.title}</h1>
            <div
              className={`rounded-xl px-4 py-3 text-sm font-medium mb-8 ${
                allUp ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
              }`}
            >
              {allUp ? "All systems operational" : "Some systems are experiencing issues"}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
              {data.monitors.map((m) => (
                <div key={m.monitorId} className="flex items-center justify-between px-5 py-4">
                  <div>
                    <div className="font-medium text-slate-800">{m.name}</div>
                    <div className="text-xs text-slate-400">{m.checkType}</div>
                  </div>
                  <div className="text-right">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                        m.currentlyUp === false ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${m.currentlyUp === false ? "bg-red-500" : "bg-emerald-500"}`} />
                      {m.currentlyUp === false ? "Down" : "Operational"}
                    </span>
                    <div className="text-xs text-slate-400 mt-1">
                      {m.uptimePctMtd !== null ? `${m.uptimePctMtd}% this month` : "no data yet"}
                    </div>
                  </div>
                </div>
              ))}
              {data.monitors.length === 0 && <div className="px-5 py-6 text-sm text-slate-500">No public monitors yet.</div>}
            </div>

            <p className="text-xs text-slate-400 mt-8 text-center">Powered by SLAPulse</p>
          </>
        )}
      </div>
    </div>
  );
}
