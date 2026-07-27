"use client";

import { useCallback, useEffect, useState } from "react";
import { useIdentity } from "@/components/IdentityContext";

interface Config {
  logo_url: string | null;
  primary_color: string | null;
  footer_text: string | null;
  hide_slapulse_branding: boolean;
  disclosure_delay_hours: number;
  attestations: { name: string; date: string; url?: string }[];
}

interface Disclosure {
  id: string;
  customer_name: string;
  incident_summary: string;
  incident_started_at: string;
  effective_delay_hours: number;
  portal_visible: boolean;
  force_hold: boolean;
  force_hold_approved_by: string | null;
}

interface PortalAuditEvent {
  id: string;
  customer_name: string;
  event_type: string;
  event_timestamp: string;
  actor: string;
  description: string | null;
}

interface Dispute {
  id: string;
  customer_name: string;
  raised_by_email: string;
  month: string;
  description: string;
  status: string;
  created_at: string;
}

export default function PortalAdminPage() {
  const { identity, loading: identityLoading } = useIdentity();
  const [config, setConfig] = useState<Config | null>(null);
  const [disclosures, setDisclosures] = useState<Disclosure[]>([]);
  const [auditEvents, setAuditEvents] = useState<PortalAuditEvent[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [cfgRes, discRes, auditRes, disputeRes] = await Promise.all([
      fetch("/api/portal-admin/config"),
      fetch("/api/portal-admin/disclosures"),
      fetch("/api/portal-admin/audit-log"),
      fetch("/api/portal-admin/disputes"),
    ]);
    if (cfgRes.ok) setConfig((await cfgRes.json()).config);
    if (discRes.ok) setDisclosures((await discRes.json()).disclosures);
    if (auditRes.ok) setAuditEvents((await auditRes.json()).events);
    if (disputeRes.ok) setDisputes((await disputeRes.json()).disputes);
  }, []);

  useEffect(() => {
    if (identity?.role === "ADMIN") load();
  }, [identity, load]);

  if (identityLoading) return null;
  if (!identity) return <p className="text-slate-500">Sign in to view the Trust Portal admin console.</p>;
  if (identity.role !== "ADMIN") return <p className="text-slate-500">Portal admin is Admin-only.</p>;

  const saveConfig = async (patch: Partial<Config>) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/portal-admin/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logoUrl: patch.logo_url,
          primaryColor: patch.primary_color,
          footerText: patch.footer_text,
          hideSlapulseBranding: patch.hide_slapulse_branding,
          disclosureDelayHours: patch.disclosure_delay_hours,
          attestations: patch.attestations,
        }),
      });
      if (res.ok) {
        setConfig((await res.json()).config);
        setMessage("Saved.");
      }
    } finally {
      setBusy(false);
    }
  };

  const forceHold = async (disclosureId: string) => {
    const approvedBy = prompt("Second approver (must differ from you):");
    if (!approvedBy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/portal-admin/disclosures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disclosureId, action: "force-hold", approvedBy }),
      });
      const data = await res.json();
      if (!res.ok) setMessage(data.error);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const release = async (disclosureId: string) => {
    setBusy(true);
    try {
      await fetch("/api/portal-admin/disclosures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disclosureId, action: "release" }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const actOnDispute = async (disputeId: string, action: "route" | "resolve") => {
    setBusy(true);
    try {
      await fetch(`/api/portal-admin/disputes/${disputeId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">Trust Portal Admin Console (PF6)</h1>
      <p className="text-sm text-slate-500 mb-6">
        Branding, disclosure rules, and the disclosure-delay override log — everything the vendor
        controls about what its own customers see in the Portal.
      </p>

      {message && <p className="text-sm text-sky-700 mb-4">{message}</p>}

      <h2 className="font-medium mb-2">Branding &amp; disclosure config</h2>
      <BrandingForm
        config={
          config ?? {
            logo_url: null,
            primary_color: "#0f172a",
            footer_text: null,
            hide_slapulse_branding: false,
            disclosure_delay_hours: 24,
            attestations: [],
          }
        }
        onSave={saveConfig}
        busy={busy}
      />

      <h2 className="font-medium mb-2 mt-8">Disclosure records</h2>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white mb-8">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Customer</th>
              <th className="px-4 py-2 font-medium">Incident</th>
              <th className="px-4 py-2 font-medium">Delay ceiling</th>
              <th className="px-4 py-2 font-medium">Visible</th>
              <th className="px-4 py-2 font-medium">Force hold</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {disclosures.map((d) => (
              <tr key={d.id}>
                <td className="px-4 py-2 font-medium text-slate-800">{d.customer_name}</td>
                <td className="px-4 py-2 text-slate-600">{d.incident_summary}</td>
                <td className="px-4 py-2 text-slate-600">{d.effective_delay_hours}h</td>
                <td className="px-4 py-2 text-slate-600">{String(d.portal_visible)}</td>
                <td className="px-4 py-2 text-slate-600">
                  {d.force_hold ? `held (approved by ${d.force_hold_approved_by})` : "no"}
                </td>
                <td className="px-4 py-2">
                  {!d.portal_visible && !d.force_hold && (
                    <button
                      onClick={() => forceHold(d.id)}
                      disabled={busy}
                      className="text-xs rounded border border-slate-300 px-2 py-1 hover:bg-slate-100 mr-2"
                    >
                      Force hold
                    </button>
                  )}
                  {d.force_hold && (
                    <button
                      onClick={() => release(d.id)}
                      disabled={busy}
                      className="text-xs rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
                    >
                      Release
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {disclosures.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-3 text-slate-500">
                  No disclosure records yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="font-medium mb-2">Customer disputes (PF7)</h2>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white mb-8">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Customer</th>
              <th className="px-4 py-2 font-medium">Raised by</th>
              <th className="px-4 py-2 font-medium">Month</th>
              <th className="px-4 py-2 font-medium">Description</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {disputes.map((d) => (
              <tr key={d.id}>
                <td className="px-4 py-2 font-medium text-slate-800">{d.customer_name}</td>
                <td className="px-4 py-2 text-slate-600">{d.raised_by_email}</td>
                <td className="px-4 py-2 text-slate-600">{d.month}</td>
                <td className="px-4 py-2 text-slate-600">{d.description}</td>
                <td className="px-4 py-2 text-slate-600">{d.status}</td>
                <td className="px-4 py-2 flex gap-2">
                  {d.status === "OPEN" && (
                    <button
                      onClick={() => actOnDispute(d.id, "route")}
                      disabled={busy}
                      className="text-xs rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
                    >
                      Route to CSM
                    </button>
                  )}
                  {d.status !== "RESOLVED" && (
                    <button
                      onClick={() => actOnDispute(d.id, "resolve")}
                      disabled={busy}
                      className="text-xs rounded bg-slate-900 text-white px-2 py-1"
                    >
                      Resolve
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {disputes.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-3 text-slate-500">
                  No disputes raised yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="font-medium mb-2">Portal audit log</h2>
      <ul className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
        {auditEvents.map((e) => (
          <li key={e.id} className="px-4 py-2 text-sm">
            <div className="flex justify-between">
              <span className="font-medium">
                {e.event_type} — {e.customer_name}
              </span>
              <span className="text-slate-400 text-xs">{new Date(e.event_timestamp).toLocaleString()}</span>
            </div>
            <div className="text-slate-600">{e.description}</div>
          </li>
        ))}
        {auditEvents.length === 0 && <li className="px-4 py-3 text-sm text-slate-500">No portal events yet.</li>}
      </ul>
    </div>
  );
}

function BrandingForm({
  config,
  onSave,
  busy,
}: {
  config: Config;
  onSave: (patch: Partial<Config>) => void;
  busy: boolean;
}) {
  const [logoUrl, setLogoUrl] = useState(config.logo_url ?? "");
  const [primaryColor, setPrimaryColor] = useState(config.primary_color ?? "#0f172a");
  const [footerText, setFooterText] = useState(config.footer_text ?? "");
  const [hideBranding, setHideBranding] = useState(config.hide_slapulse_branding);
  const [delayHours, setDelayHours] = useState(String(config.disclosure_delay_hours));
  const [attestations, setAttestations] = useState(config.attestations ?? []);
  const [newAttestation, setNewAttestation] = useState({ name: "", date: "" });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          logo_url: logoUrl || null,
          primary_color: primaryColor,
          footer_text: footerText || null,
          hide_slapulse_branding: hideBranding,
          disclosure_delay_hours: Number(delayHours),
          attestations,
        });
      }}
      className="rounded-lg border border-slate-200 bg-white p-4 grid grid-cols-2 gap-3 text-sm"
    >
      <label className="flex flex-col gap-1">
        Logo URL
        <input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} className="border border-slate-300 rounded px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1">
        Primary color
        <input
          type="color"
          value={primaryColor}
          onChange={(e) => setPrimaryColor(e.target.value)}
          className="border border-slate-300 rounded px-2 py-1 h-9"
        />
      </label>
      <label className="flex flex-col gap-1 col-span-2">
        Footer text
        <input value={footerText} onChange={(e) => setFooterText(e.target.value)} className="border border-slate-300 rounded px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1">
        Disclosure delay ceiling (hours, PF5 / Section 8.8)
        <input
          type="number"
          value={delayHours}
          onChange={(e) => setDelayHours(e.target.value)}
          className="border border-slate-300 rounded px-2 py-1"
        />
      </label>
      <label className="flex items-center gap-2 mt-6">
        <input type="checkbox" checked={hideBranding} onChange={(e) => setHideBranding(e.target.checked)} />
        Hide &quot;Powered by SLAPulse&quot; (Enterprise tier)
      </label>

      <div className="col-span-2">
        <div className="text-sm font-medium mb-1">Attestations (PF12)</div>
        <ul className="mb-2">
          {attestations.map((a, i) => (
            <li key={i} className="flex justify-between items-center py-1 text-slate-600">
              <span>
                {a.name} — {a.date}
              </span>
              <button
                type="button"
                onClick={() => setAttestations(attestations.filter((_, idx) => idx !== i))}
                className="text-xs text-red-700 hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input
            placeholder="SOC 2 Type II"
            value={newAttestation.name}
            onChange={(e) => setNewAttestation({ ...newAttestation, name: e.target.value })}
            className="border border-slate-300 rounded px-2 py-1 flex-1"
          />
          <input
            type="date"
            value={newAttestation.date}
            onChange={(e) => setNewAttestation({ ...newAttestation, date: e.target.value })}
            className="border border-slate-300 rounded px-2 py-1"
          />
          <button
            type="button"
            onClick={() => {
              if (!newAttestation.name || !newAttestation.date) return;
              setAttestations([...attestations, newAttestation]);
              setNewAttestation({ name: "", date: "" });
            }}
            className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-100"
          >
            Add
          </button>
        </div>
      </div>

      <div className="col-span-2">
        <button type="submit" disabled={busy} className="rounded bg-slate-900 text-white px-4 py-2 disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
