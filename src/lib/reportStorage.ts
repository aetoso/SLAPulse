import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

// LOCAL-DEV SUBSTITUTION for the S3 bucket structure in Section 11.4:
//   s3://slapulse-audit-{account}/reports/{vendor}/{customer}/{year}/{month}/
// and for SES (report emails land in a local "outbox" folder instead of
// actually sending). Swapping this module for S3 PutObject + SES SendEmail
// calls is the only change needed to point at real AWS.

const DATA_ROOT = path.join(process.cwd(), "data");

export function reportDir(vendorId: string, customerId: string, month: string): string {
  const [year] = month.split("-");
  return path.join(DATA_ROOT, "reports", vendorId, customerId, year, month);
}

export function mailOutboxDir(vendorId: string): string {
  return path.join(DATA_ROOT, "mail-outbox", vendorId);
}

export async function writeReportFiles(
  vendorId: string,
  customerId: string,
  month: string,
  html: string,
  jsonPayload: unknown
): Promise<{ htmlPath: string; jsonPath: string; sha256Path: string; sha256: string }> {
  const dir = reportDir(vendorId, customerId, month);
  await fs.mkdir(dir, { recursive: true });

  const htmlPath = path.join(dir, "report.html");
  const jsonPath = path.join(dir, "report.json");
  const sha256Path = path.join(dir, "report.sha256");

  const jsonStr = JSON.stringify(jsonPayload, null, 2);
  const sha256 = crypto.createHash("sha256").update(html + jsonStr).digest("hex");

  await fs.writeFile(htmlPath, html, "utf8");
  await fs.writeFile(jsonPath, jsonStr, "utf8");
  await fs.writeFile(sha256Path, sha256, "utf8");

  return { htmlPath, jsonPath, sha256Path, sha256 };
}

export async function readReportHtml(vendorId: string, customerId: string, month: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(reportDir(vendorId, customerId, month), "report.html"), "utf8");
  } catch {
    return null;
  }
}

export async function writePdf(vendorId: string, customerId: string, month: string, pdf: Buffer): Promise<string> {
  const dir = reportDir(vendorId, customerId, month);
  await fs.mkdir(dir, { recursive: true });
  const pdfPath = path.join(dir, "report.pdf");
  await fs.writeFile(pdfPath, pdf);
  return pdfPath;
}

export async function readPdf(vendorId: string, customerId: string, month: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(path.join(reportDir(vendorId, customerId, month), "report.pdf"));
  } catch {
    return null;
  }
}

export interface OutboxEmail {
  id: string;
  to: string[];
  subject: string;
  sentAt: string;
  htmlPath: string;
}

// Simulated SES send: writes the email metadata + a copy of the HTML body
// into a per-vendor outbox folder instead of calling ses:SendEmail.
export async function sendMockEmail(
  vendorId: string,
  to: string[],
  subject: string,
  html: string
): Promise<{ messageId: string }> {
  const dir = mailOutboxDir(vendorId);
  await fs.mkdir(dir, { recursive: true });

  const messageId = `mock-ses-${crypto.randomUUID()}`;
  const record: OutboxEmail = {
    id: messageId,
    to,
    subject,
    sentAt: new Date().toISOString(),
    htmlPath: `${messageId}.html`,
  };

  await fs.writeFile(path.join(dir, `${messageId}.json`), JSON.stringify(record, null, 2), "utf8");
  await fs.writeFile(path.join(dir, `${messageId}.html`), html, "utf8");

  return { messageId };
}

export async function listOutbox(vendorId: string): Promise<OutboxEmail[]> {
  const dir = mailOutboxDir(vendorId);
  try {
    const files = await fs.readdir(dir);
    const records = await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map(async (f) => JSON.parse(await fs.readFile(path.join(dir, f), "utf8")) as OutboxEmail)
    );
    return records.sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1));
  } catch {
    return [];
  }
}

export async function readOutboxEmailHtml(vendorId: string, messageId: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(mailOutboxDir(vendorId), `${messageId}.html`), "utf8");
  } catch {
    return null;
  }
}
