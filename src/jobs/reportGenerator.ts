import puppeteer from "puppeteer";
import { withTenant } from "@/lib/db";
import { appendAuditEvent } from "@/lib/auditLog";
import type { Customer } from "@/lib/customers";
import { renderReportHtml, type DowntimeWindow } from "@/lib/reportTemplate";
import { writeReportFiles, sendMockEmail, readReportHtml, writePdf, readPdf } from "@/lib/reportStorage";

// Section 8.5 Monthly Report Generation (Idempotent) + F10 PDF export.
// LOCAL-DEV SUBSTITUTION: SES send is a local outbox write
// (src/lib/reportStorage.ts); everything else -- idempotency check,
// hash-chained audit record, report archive -- is real.

async function buildDowntimeLog(
  vendorId: string,
  customerId: string,
  monthStart: Date,
  monthEnd: Date
): Promise<DowntimeWindow[]> {
  return withTenant(vendorId, async (client) => {
    const { rows } = await client.query<{ minute_timestamp: string; classification: string }>(
      `SELECT minute_timestamp, classification FROM availability_minutes
       WHERE vendor_id = $1 AND customer_id = $2
         AND minute_timestamp >= $3 AND minute_timestamp < $4
         AND classification = 'DOWNTIME'
       ORDER BY minute_timestamp ASC`,
      [vendorId, customerId, monthStart.toISOString(), monthEnd.toISOString()]
    );

    const windows: DowntimeWindow[] = [];
    let current: { start: Date; end: Date; count: number } | null = null;

    for (const row of rows) {
      const t = new Date(row.minute_timestamp);
      if (current && t.getTime() - current.end.getTime() === 60_000) {
        current.end = t;
        current.count++;
      } else {
        if (current) {
          windows.push({
            start: current.start.toISOString(),
            end: new Date(current.end.getTime() + 60_000).toISOString(),
            minutes: current.count,
            classification: "DOWNTIME",
          });
        }
        current = { start: t, end: t, count: 1 };
      }
    }
    if (current) {
      windows.push({
        start: current.start.toISOString(),
        end: new Date(current.end.getTime() + 60_000).toISOString(),
        minutes: current.count,
        classification: "DOWNTIME",
      });
    }
    return windows;
  });
}

interface StatusRow {
  id: string;
  status: string;
  uptime_pct: number | null;
  contract_sla_pct: number;
  downtime_minutes: number;
  total_minutes: number;
  formula_version: string;
  credits_owed_usd: number | null;
  report_generated_at: string | null;
  report_email_sent_at: string | null;
}

async function getActiveStatus(vendorId: string, customerId: string, month: string): Promise<StatusRow | null> {
  return withTenant(vendorId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM customer_sla_status
       WHERE vendor_id = $1 AND customer_id = $2 AND month = $3 AND is_active_for_display = true`,
      [vendorId, customerId, month]
    );
    return rows[0] ?? null;
  });
}

async function getBranding(vendorId: string): Promise<{ logoUrl: string | null; primaryColor: string | null; footerText: string | null; vendorName: string }> {
  return withTenant(vendorId, async (client) => {
    const [{ rows: cfgRows }, { rows: vendorRows }] = await Promise.all([
      client.query(`SELECT logo_url, primary_color, footer_text FROM portal_vendor_config WHERE vendor_id = $1`, [vendorId]),
      client.query(`SELECT vendor_name FROM vendor_accounts WHERE vendor_id = $1`, [vendorId]),
    ]);
    return {
      logoUrl: cfgRows[0]?.logo_url ?? null,
      primaryColor: cfgRows[0]?.primary_color ?? null,
      footerText: cfgRows[0]?.footer_text ?? null,
      vendorName: vendorRows[0]?.vendor_name ?? vendorId,
    };
  });
}

export interface GenerateReportResult {
  alreadySent: boolean;
  htmlGenerated: boolean;
  emailSent: boolean;
  messageId: string | null;
}

export async function generateMonthlyReport(
  vendorId: string,
  customer: Customer,
  month: string,
  actor: string,
  opts: { send: boolean }
): Promise<GenerateReportResult | null> {
  const statusRow = await getActiveStatus(vendorId, customer.customerId, month);
  if (!statusRow) return null;

  // Idempotency (Section 8.5): a report already emailed this month is
  // never re-sent, even if the job (or the "Send now" button) runs again.
  if (opts.send && statusRow.report_email_sent_at) {
    return { alreadySent: true, htmlGenerated: false, emailSent: false, messageId: null };
  }

  const [year, monthNum] = month.split("-").map(Number);
  const monthStart = new Date(Date.UTC(year, monthNum - 1, 1));
  const monthEnd = new Date(Date.UTC(year, monthNum, 1));

  const [downtimeWindows, branding] = await Promise.all([
    buildDowntimeLog(vendorId, customer.customerId, monthStart, monthEnd),
    getBranding(vendorId),
  ]);

  const html = renderReportHtml({
    vendorName: branding.vendorName,
    customerName: customer.customerName,
    month,
    status: statusRow.status,
    uptimePct: statusRow.uptime_pct !== null ? Number(statusRow.uptime_pct) : null,
    contractSlaPct: Number(statusRow.contract_sla_pct),
    downtimeMinutes: statusRow.downtime_minutes,
    totalMinutes: statusRow.total_minutes,
    formulaVersion: statusRow.formula_version,
    downtimeWindows,
    creditAmountUsd: statusRow.credits_owed_usd !== null ? Number(statusRow.credits_owed_usd) : null,
    generatedAt: new Date().toISOString(),
    logoUrl: branding.logoUrl,
    primaryColor: branding.primaryColor,
    footerText: branding.footerText,
  });

  await writeReportFiles(vendorId, customer.customerId, month, html, {
    customerId: customer.customerId,
    month,
    status: statusRow.status,
    uptimePct: statusRow.uptime_pct,
    downtimeWindows,
  });

  let messageId: string | null = null;
  if (opts.send) {
    const recipient = customer.customerId + "@vendor-customer.example"; // no real contact_emails UI yet
    const sent = await sendMockEmail(vendorId, [recipient], `Your ${month} SLA report — ${customer.customerName}`, html);
    messageId = sent.messageId;
  }

  await withTenant(vendorId, async (client) => {
    await client.query(
      `UPDATE customer_sla_status
       SET report_generated_at = COALESCE(report_generated_at, NOW()),
           report_email_sent_at = CASE WHEN $1 THEN NOW() ELSE report_email_sent_at END,
           ses_message_id = COALESCE($2, ses_message_id)
       WHERE id = $3`,
      [opts.send, messageId, statusRow.id]
    );
    await appendAuditEvent(client, {
      vendorId,
      customerId: customer.customerId,
      eventType: "REPORT_GENERATED",
      actor,
      description: opts.send
        ? `SLA report for ${month} generated and emailed (mock SES message ${messageId})`
        : `SLA report for ${month} generated (not sent)`,
      metadata: { month, sent: opts.send, messageId },
    });
  });

  return { alreadySent: false, htmlGenerated: true, emailSent: opts.send, messageId };
}

export async function getOrRenderHtml(
  vendorId: string,
  customer: Customer,
  month: string,
  actor: string
): Promise<string | null> {
  const existing = await readReportHtml(vendorId, customer.customerId, month);
  if (existing) return existing;
  const result = await generateMonthlyReport(vendorId, customer, month, actor, { send: false });
  if (!result) return null;
  return readReportHtml(vendorId, customer.customerId, month);
}

export async function getOrRenderPdf(
  vendorId: string,
  customer: Customer,
  month: string,
  actor: string
): Promise<Buffer | null> {
  const cached = await readPdf(vendorId, customer.customerId, month);
  if (cached) return cached;

  const html = await getOrRenderHtml(vendorId, customer, month, actor);
  if (!html) return null;

  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdf = Buffer.from(await page.pdf({ format: "A4", printBackground: true, margin: { top: "20px", bottom: "20px" } }));
    await writePdf(vendorId, customer.customerId, month, pdf);
    return pdf;
  } finally {
    await browser.close();
  }
}
