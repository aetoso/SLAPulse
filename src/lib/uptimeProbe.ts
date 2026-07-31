import net from "net";
import tls from "tls";

// Product 1: real, live network checks -- unlike the AWS-side of this
// app (necessarily mocked locally, no AWS account), an HTTPS/TCP check
// against a public URL needs nothing but outbound network access, so
// this module makes actual requests. No simulation here.
//
// PING SUBSTITUTION: true ICMP ping needs a raw socket, which requires
// root/native modules unavailable in a sandboxed Node process. "PING"
// checks are implemented as a bare TCP handshake against the target port
// (default 443) and timed the same way traceroute/mtr tools approximate
// reachability without raw sockets -- this is disclosed here and in the
// UI, not silently faked as ICMP.
//
// HEARTBEAT has no probe function here -- it's a passive check (the
// monitored system pings SLAPulse, not the other way around), handled
// entirely in src/jobs/uptimeChecker.ts by checking staleness of
// last_heartbeat_at.

export type CheckType = "HTTPS" | "TCP" | "PING" | "KEYWORD" | "HEARTBEAT";

export interface ProbeResult {
  isUp: boolean;
  responseTimeMs: number | null;
  statusCode: number | null;
  errorMessage: string | null;
}

const DEFAULT_TIMEOUT_MS = 8000;

export async function probeHttps(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ProbeResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", signal: controller.signal, redirect: "follow" });
    const responseTimeMs = Date.now() - start;
    // 2xx/3xx = up, matching the convention most uptime monitors use by
    // default (UptimeRobot, Pingdom) -- 4xx/5xx counts as down.
    const isUp = res.status >= 200 && res.status < 400;
    return { isUp, responseTimeMs, statusCode: res.status, errorMessage: isUp ? null : `HTTP ${res.status}` };
  } catch (err) {
    return {
      isUp: false,
      responseTimeMs: Date.now() - start,
      statusCode: null,
      errorMessage: err instanceof Error ? err.message : "request failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

// Keyword monitoring: same GET as an HTTPS check, but the pass/fail
// condition is "does the body contain (or not contain) this text" --
// catches the "200 OK but showing an error page" class of outage that a
// bare status-code check misses (Section 9.2's documented blind spot,
// now closeable from the outside too, not just via F-SYN inside a
// customer's AWS account).
export async function probeKeyword(
  url: string,
  keyword: string,
  mode: "PRESENT" | "ABSENT",
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<ProbeResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", signal: controller.signal, redirect: "follow" });
    const body = await res.text();
    const responseTimeMs = Date.now() - start;
    const found = body.includes(keyword);
    const keywordOk = mode === "PRESENT" ? found : !found;
    const httpOk = res.status >= 200 && res.status < 400;
    const isUp = httpOk && keywordOk;
    let errorMessage: string | null = null;
    if (!httpOk) errorMessage = `HTTP ${res.status}`;
    else if (!keywordOk) errorMessage = mode === "PRESENT" ? `keyword "${keyword}" not found` : `keyword "${keyword}" found (expected absent)`;
    return { isUp, responseTimeMs, statusCode: res.status, errorMessage };
  } catch (err) {
    return {
      isUp: false,
      responseTimeMs: Date.now() - start,
      statusCode: null,
      errorMessage: err instanceof Error ? err.message : "request failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeTcp(host: string, port: number, timeoutMs = 5000): Promise<ProbeResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      finish({ isUp: true, responseTimeMs: Date.now() - start, statusCode: null, errorMessage: null });
    });
    socket.once("timeout", () => {
      finish({ isUp: false, responseTimeMs: Date.now() - start, statusCode: null, errorMessage: "connection timed out" });
    });
    socket.once("error", (err) => {
      finish({ isUp: false, responseTimeMs: Date.now() - start, statusCode: null, errorMessage: err.message });
    });
    socket.connect(port, host);
  });
}

export interface SslCheckResult {
  isValid: boolean;
  validFrom: Date | null;
  validTo: Date | null;
  issuer: string | null;
  daysUntilExpiry: number | null;
  errorMessage: string | null;
}

function firstString(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

// Real TLS handshake + peer certificate inspection -- not a mock. Same
// mechanism `openssl s_client` or your browser's padlock uses.
export async function checkSslCertificate(host: string, port = 443, timeoutMs = 8000): Promise<SslCheckResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: SslCheckResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    const socket = tls.connect(
      { host, port, servername: host, timeout: timeoutMs, rejectUnauthorized: false },
      () => {
        const cert = socket.getPeerCertificate();
        if (!cert || Object.keys(cert).length === 0) {
          finish({ isValid: false, validFrom: null, validTo: null, issuer: null, daysUntilExpiry: null, errorMessage: "no certificate presented" });
          return;
        }
        const validTo = new Date(cert.valid_to);
        const validFrom = new Date(cert.valid_from);
        const daysUntilExpiry = Math.round((validTo.getTime() - Date.now()) / 86_400_000);
        finish({
          isValid: socket.authorized || daysUntilExpiry > 0,
          validFrom,
          validTo,
          issuer: firstString(cert.issuer?.O) ?? firstString(cert.issuer?.CN) ?? null,
          daysUntilExpiry,
          errorMessage: socket.authorized ? null : socket.authorizationError?.toString() ?? null,
        });
      }
    );
    socket.once("timeout", () => {
      finish({ isValid: false, validFrom: null, validTo: null, issuer: null, daysUntilExpiry: null, errorMessage: "TLS handshake timed out" });
    });
    socket.once("error", (err) => {
      finish({ isValid: false, validFrom: null, validTo: null, issuer: null, daysUntilExpiry: null, errorMessage: err.message });
    });
  });
}

export function parseHost(targetUrl: string): { host: string; port: number } {
  try {
    const u = new URL(targetUrl.includes("://") ? targetUrl : `https://${targetUrl}`);
    return { host: u.hostname, port: u.port ? Number(u.port) : 443 };
  } catch {
    return { host: targetUrl, port: 443 };
  }
}

export async function runProbe(
  checkType: CheckType,
  targetUrl: string,
  port: number | null,
  keyword?: string | null,
  keywordMode?: "PRESENT" | "ABSENT" | null
): Promise<ProbeResult> {
  if (checkType === "HTTPS") {
    const url = targetUrl.includes("://") ? targetUrl : `https://${targetUrl}`;
    return probeHttps(url);
  }
  if (checkType === "KEYWORD") {
    const url = targetUrl.includes("://") ? targetUrl : `https://${targetUrl}`;
    return probeKeyword(url, keyword ?? "", keywordMode ?? "PRESENT");
  }
  const { host, port: parsedPort } = parseHost(targetUrl);
  return probeTcp(host, port ?? parsedPort);
}
