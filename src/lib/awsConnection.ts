import crypto from "crypto";
import { STSClient, AssumeRoleCommand, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { withTenant } from "./db";

// Real cross-account AWS integration, one connection per vendor
// (single-tenant: one company, one AWS account). Uses platform-side
// credentials (the Node process's own AWS identity -- env vars,
// `aws configure`, or SSO login, picked up by the SDK's default
// credential provider chain) to AssumeRole into the role the vendor
// creates and pastes in, exactly like real cross-account SaaS
// integrations (Datadog, Snyk, etc.) -- never a customer's raw AWS keys
// pasted into this app.

export interface AwsConnection {
  vendorId: string;
  roleArn: string | null;
  externalId: string;
  region: string | null;
  status: "NOT_CONFIGURED" | "CONNECTED" | "ERROR";
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastError: string | null;
  connectedAccountId: string | null;
}

function mapRow(r: Record<string, unknown>): AwsConnection {
  return {
    vendorId: r.vendor_id as string,
    roleArn: (r.role_arn as string) ?? null,
    externalId: r.external_id as string,
    region: (r.region as string) ?? null,
    status: r.status as AwsConnection["status"],
    lastTestedAt: (r.last_tested_at as string) ?? null,
    lastTestOk: (r.last_test_ok as boolean) ?? null,
    lastError: (r.last_error as string) ?? null,
    connectedAccountId: (r.connected_account_id as string) ?? null,
  };
}

/**
 * Returns the vendor's AWS connection, creating a NOT_CONFIGURED row
 * with a freshly generated external_id on first read -- so the wizard
 * shows a stable external_id (needed for the trust-policy JSON) even
 * before the vendor has entered a role ARN.
 */
export async function getAwsConnection(vendorId: string): Promise<AwsConnection> {
  return withTenant(vendorId, async (client) => {
    const { rows } = await client.query(`SELECT * FROM vendor_aws_connections WHERE vendor_id = $1`, [vendorId]);
    if (rows[0]) return mapRow(rows[0]);

    const externalId = generateExternalId();
    const { rows: inserted } = await client.query(
      `INSERT INTO vendor_aws_connections (vendor_id, external_id) VALUES ($1, $2)
       ON CONFLICT (vendor_id) DO UPDATE SET vendor_id = EXCLUDED.vendor_id
       RETURNING *`,
      [vendorId, externalId]
    );
    return mapRow(inserted[0]);
  });
}

export async function saveAwsConnectionConfig(
  vendorId: string,
  input: { roleArn: string; region: string }
): Promise<AwsConnection> {
  return withTenant(vendorId, async (client) => {
    const { rows } = await client.query(
      `UPDATE vendor_aws_connections
         SET role_arn = $2, region = $3, status = 'NOT_CONFIGURED',
             last_tested_at = NULL, last_test_ok = NULL, last_error = NULL,
             connected_account_id = NULL, updated_at = NOW()
       WHERE vendor_id = $1
       RETURNING *`,
      [vendorId, input.roleArn, input.region]
    );
    return mapRow(rows[0]);
  });
}

export async function recordTestResult(
  vendorId: string,
  result: { ok: boolean; accountId?: string; error?: string }
): Promise<AwsConnection> {
  return withTenant(vendorId, async (client) => {
    const { rows } = await client.query(
      `UPDATE vendor_aws_connections
         SET status = $2, last_tested_at = NOW(), last_test_ok = $3,
             last_error = $4, connected_account_id = $5, updated_at = NOW()
       WHERE vendor_id = $1
       RETURNING *`,
      [vendorId, result.ok ? "CONNECTED" : "ERROR", result.ok, result.error ?? null, result.accountId ?? null]
    );
    return mapRow(rows[0]);
  });
}

/**
 * Resolves the AWS account ID for the platform's own (default-chain)
 * credentials, if any are configured -- shown in the wizard as the
 * trust-policy `Principal`. Returns null (never throws) if no
 * credentials are configured, so the wizard can fall back to a
 * self-trust placeholder for local testing.
 */
export async function getPlatformAccountId(): Promise<string | null> {
  const sts = new STSClient({ region: process.env.AWS_REGION || "us-east-1" });
  try {
    const result = await sts.send(new GetCallerIdentityCommand({}));
    return result.Account ?? null;
  } catch {
    return null;
  } finally {
    sts.destroy();
  }
}

export function generateExternalId(): string {
  return crypto.randomBytes(16).toString("hex");
}

export interface AssumeRoleResult {
  ok: boolean;
  accountId?: string;
  error?: string;
}

/**
 * Performs a real `sts:AssumeRole` call using this Node process's own
 * AWS credentials (default credential provider chain: env vars,
 * `~/.aws/credentials`, SSO, etc.) into the vendor-supplied role ARN,
 * with the vendor's external_id as the confused-deputy mitigation. Never
 * throws a raw SDK error to the caller -- always returns a classified,
 * readable result.
 */
export async function testAwsConnection(roleArn: string, externalId: string, region: string): Promise<AssumeRoleResult> {
  if (!roleArn || !roleArn.startsWith("arn:aws:iam::")) {
    return { ok: false, error: "Role ARN looks malformed (expected arn:aws:iam::<account-id>:role/<name>)." };
  }

  const sts = new STSClient({ region: region || "us-east-1" });

  try {
    const result = await sts.send(
      new AssumeRoleCommand({
        RoleArn: roleArn,
        RoleSessionName: "slapulse-test",
        ExternalId: externalId,
        DurationSeconds: 900,
      })
    );

    const assumedArn = result.AssumedRoleUser?.Arn ?? "";
    const accountId = assumedArn.match(/^arn:aws:sts::(\d+):/)?.[1] ?? roleArn.match(/^arn:aws:iam::(\d+):/)?.[1];

    if (!result.Credentials) {
      return { ok: false, error: "AssumeRole succeeded but returned no credentials -- unexpected AWS response." };
    }

    return { ok: true, accountId };
  } catch (err) {
    return { ok: false, error: classifyAwsError(err) };
  } finally {
    sts.destroy();
  }
}

function classifyAwsError(err: unknown): string {
  const name = (err as { name?: string })?.name ?? "";
  const message = (err as Error)?.message ?? String(err);

  if (!process.env.AWS_ACCESS_KEY_ID && !process.env.AWS_PROFILE) {
    // Heuristic: the SDK's own "could not find credentials" errors are
    // verbose and technical; give the user something actionable instead.
    if (name === "CredentialsProviderError" || /credential/i.test(message)) {
      return "AWS not configured on this server -- set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY (or run `aws configure`/SSO login) for the process running SLAPulse, then try again.";
    }
  }

  if (name === "AccessDenied") {
    return "AccessDenied -- the role's trust policy doesn't allow this caller to assume it, or the external ID doesn't match.";
  }
  if (name === "ExpiredTokenException" || name === "TokenRefreshRequired") {
    return "The platform's AWS credentials have expired -- refresh them (aws sso login / re-export keys) and try again.";
  }
  if (/does not exist|NoSuchEntity/i.test(message)) {
    return "That role ARN doesn't exist in the target account.";
  }

  return message;
}
