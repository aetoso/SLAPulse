export interface DowntimeWindow {
  start: string;
  end: string;
  minutes: number;
  classification: string;
}

export interface ReportData {
  vendorName: string;
  customerName: string;
  month: string;
  status: string;
  uptimePct: number | null;
  contractSlaPct: number;
  downtimeMinutes: number;
  totalMinutes: number;
  formulaVersion: string;
  downtimeWindows: DowntimeWindow[];
  creditAmountUsd: number | null;
  generatedAt: string;
  // F10 white-label fields (Section 6, F10 + PF1) -- null means SLAPulse default.
  logoUrl: string | null;
  primaryColor: string | null;
  footerText: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  COMPLIANT: "#047857",
  AT_RISK: "#b45309",
  BREACHED: "#b91c1c",
  DATA_INCOMPLETE: "#475569",
};

// F4 (HTML email report) + F10 (same template rendered to PDF via
// Puppeteer, src/jobs/reportGenerator.ts). Section 9.2's disclosed
// limitation is included verbatim so every report carries it, not just
// the dashboard.
export function renderReportHtml(data: ReportData): string {
  const accent = data.primaryColor ?? "#0f172a";
  const statusColor = STATUS_COLORS[data.status] ?? "#475569";

  const rows = data.downtimeWindows
    .map(
      (w) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${new Date(w.start).toLocaleString("en-US", { timeZone: "UTC" })} UTC</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${new Date(w.end).toLocaleString("en-US", { timeZone: "UTC" })} UTC</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${w.minutes} min</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${w.classification}</td>
      </tr>`
    )
    .join("");

  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>SLA Report - ${data.customerName} - ${data.month}</title></head>
<body style="font-family:-apple-system,Helvetica,Arial,sans-serif;color:#0f172a;max-width:720px;margin:0 auto;padding:32px;">
  <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid ${accent};padding-bottom:16px;margin-bottom:24px;">
    <div>
      ${data.logoUrl ? `<img src="${data.logoUrl}" style="height:32px;" />` : `<div style="font-weight:700;font-size:20px;">${data.vendorName}</div>`}
    </div>
    <div style="text-align:right;font-size:13px;color:#64748b;">
      Monthly SLA Report<br/>${data.month}
    </div>
  </div>

  <h1 style="font-size:22px;margin:0 0 4px;">${data.customerName}</h1>
  <p style="color:#64748b;margin:0 0 24px;">Contract SLA: ${data.contractSlaPct}% &middot; Formula version: ${data.formulaVersion}</p>

  <div style="display:flex;gap:16px;margin-bottom:24px;">
    <div style="flex:1;border:1px solid #e2e8f0;border-radius:8px;padding:16px;">
      <div style="font-size:12px;color:#64748b;">Status</div>
      <div style="font-size:20px;font-weight:700;color:${statusColor};">${data.status.replace("_", " ")}</div>
    </div>
    <div style="flex:1;border:1px solid #e2e8f0;border-radius:8px;padding:16px;">
      <div style="font-size:12px;color:#64748b;">Uptime</div>
      <div style="font-size:20px;font-weight:700;">${data.uptimePct !== null ? `${data.uptimePct}%` : "—"}</div>
    </div>
    <div style="flex:1;border:1px solid #e2e8f0;border-radius:8px;padding:16px;">
      <div style="font-size:12px;color:#64748b;">Downtime</div>
      <div style="font-size:20px;font-weight:700;">${data.downtimeMinutes} min</div>
    </div>
    ${
      data.creditAmountUsd !== null
        ? `<div style="flex:1;border:1px solid #e2e8f0;border-radius:8px;padding:16px;">
      <div style="font-size:12px;color:#64748b;">SLA credit</div>
      <div style="font-size:20px;font-weight:700;">$${data.creditAmountUsd.toFixed(2)}</div>
    </div>`
        : ""
    }
  </div>

  <h2 style="font-size:16px;margin-bottom:8px;">Downtime log</h2>
  ${
    data.downtimeWindows.length === 0
      ? `<p style="color:#64748b;">No downtime windows recorded this month.</p>`
      : `<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px;">
      <thead>
        <tr style="text-align:left;background:#f8fafc;">
          <th style="padding:6px 10px;">Start</th>
          <th style="padding:6px 10px;">End</th>
          <th style="padding:6px 10px;">Duration</th>
          <th style="padding:6px 10px;">Classification</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`
  }

  <div style="background:#f8fafc;border-radius:8px;padding:16px;font-size:12px;color:#64748b;margin-bottom:24px;">
    This report reflects infrastructure-layer availability signals (Route53 Health Checks, ALB 5xx
    error rates, ECS task health)${data.formulaVersion ? "" : ""}. Application-level synthetic
    transaction monitoring, where enabled, is included as an independent detection path. Outages
    where all signals remain green but application functionality is impaired will not be detected
    unless synthetic monitoring is enabled for this customer. Disputes are handled via the SLA
    Disagreement Resolution Process.
  </div>

  <p style="font-size:11px;color:#94a3b8;">Generated ${new Date(data.generatedAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC</p>
  ${data.footerText ? `<p style="font-size:11px;color:#94a3b8;">${data.footerText}</p>` : ""}
  <p style="font-size:11px;color:#cbd5e1;">Powered by SLAPulse</p>
</body>
</html>`;
}
