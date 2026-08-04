"use client";

import { useCallback, useEffect, useState } from "react";
import { Cloud, Check, X, Copy } from "lucide-react";
import { useIdentity } from "@/components/IdentityContext";

interface Connection {
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

const STATUS_STYLES: Record<Connection["status"], string> = {
  NOT_CONFIGURED: "bg-slate-100 text-slate-600",
  CONNECTED: "bg-emerald-50 text-emerald-700",
  ERROR: "bg-red-50 text-red-700",
};

export default function AwsIntegrationPage() {
  const { identity, loading: identityLoading } = useIdentity();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [platformAccountId, setPlatformAccountId] = useState<string | null>(null);
  const [form, setForm] = useState({ roleArn: "", region: "us-east-1" });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/aws/connection");
    if (!res.ok) return;
    const data = await res.json();
    setConnection(data.connection);
    setPlatformAccountId(data.platformAccountId);
    setForm({ roleArn: data.connection.roleArn ?? "", region: data.connection.region ?? "us-east-1" });
  }, []);

  useEffect(() => {
    if (identity) load();
  }, [identity, load]);

  if (identityLoading) return null;
  if (!identity) return null;
  if (!connection) return <p className="text-slate-500">Loading…</p>;

  const canManage = identity.role === "ADMIN" || identity.role === "SRE";

  const trustPolicy = JSON.stringify(
    {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { AWS: platformAccountId ? `arn:aws:iam::${platformAccountId}:root` : "arn:aws:iam::<YOUR-OWN-AWS-ACCOUNT-ID>:root" },
          Action: "sts:AssumeRole",
          Condition: { StringEquals: { "sts:ExternalId": connection.externalId } },
        },
      ],
    },
    null,
    2
  );

  const permissionsPolicy = JSON.stringify(
    {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: ["elasticloadbalancing:DescribeTargetHealth", "ecs:DescribeServices", "ecs:ListServices", "route53:GetHealthCheckStatus"],
          Resource: "*",
        },
      ],
    },
    null,
    2
  );

  const save = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/aws/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) setConnection((await res.json()).connection);
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/aws/connection/test", { method: "POST" });
      const data = await res.json();
      setConnection(data.connection);
      setTestResult({ ok: data.ok, error: data.error });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 mb-1">
        <Cloud className="h-5 w-5 text-indigo-600" />
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">AWS Integration</h1>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        Connect your own AWS account so monitors can pull a real root-cause snapshot (ALB target health, ECS task state,
        Route&nbsp;53 health checks) when something goes down. Uses a real cross-account IAM role — no AWS keys are ever
        pasted into this app.
      </p>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm mb-6 flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-500 mb-1">Connection status</p>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[connection.status]}`}>
            {connection.status.replace("_", " ")}
          </span>
          {connection.status === "CONNECTED" && connection.connectedAccountId && (
            <span className="text-xs text-slate-500 ml-2">AWS account {connection.connectedAccountId}</span>
          )}
          {connection.lastTestedAt && (
            <p className="text-xs text-slate-400 mt-1">Last tested {new Date(connection.lastTestedAt).toLocaleString()}</p>
          )}
        </div>
        {connection.status === "ERROR" && connection.lastError && (
          <p className="text-xs text-red-600 max-w-sm text-right">{connection.lastError}</p>
        )}
      </div>

      <Step n={1} title="Create the IAM role">
        <p className="text-sm text-slate-600 mb-2">
          In the AWS account you want to connect, create an IAM role with this trust policy. The <code>Principal</code>{" "}
          is {platformAccountId ? "SLAPulse's own AWS account (resolved automatically)" : "a placeholder — for local testing, use your own account ID so the role trusts itself"}.
        </p>
        <CodeBlock code={trustPolicy} />
        {!platformAccountId && (
          <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mt-2">
            SLAPulse has no AWS credentials configured on this server yet, so there&apos;s no fixed platform account to show
            here. For local testing, replace the placeholder with your own AWS account ID — the same account both
            creates the role and (once you set AWS_ACCESS_KEY_ID/SECRET in .env) assumes it.
          </p>
        )}
      </Step>

      <Step n={2} title="Attach a permissions policy">
        <p className="text-sm text-slate-600 mb-2">Minimal read-only access — just enough to answer &quot;why is this down&quot;:</p>
        <CodeBlock code={permissionsPolicy} />
      </Step>

      <Step n={3} title="Connect the role">
        {!canManage ? (
          <p className="text-sm text-slate-500">Only Admin/SRE can configure the AWS connection.</p>
        ) : (
          <div className="space-y-3">
            <label className="flex flex-col gap-1 text-sm">
              Role ARN
              <input
                value={form.roleArn}
                onChange={(e) => setForm({ ...form, roleArn: e.target.value })}
                placeholder="arn:aws:iam::123456789012:role/slapulse-readonly-role"
                className="border border-slate-200 rounded-lg px-2.5 py-1.5 font-mono text-xs"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Region
              <input
                value={form.region}
                onChange={(e) => setForm({ ...form, region: e.target.value })}
                placeholder="us-east-1"
                className="border border-slate-200 rounded-lg px-2.5 py-1.5 w-40"
              />
            </label>
            <div className="flex gap-2">
              <button
                onClick={save}
                disabled={saving || !form.roleArn}
                className="rounded-lg bg-slate-900 text-white px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                onClick={test}
                disabled={testing || !connection.roleArn}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 text-white px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {testing ? "Testing…" : "Test connection"}
              </button>
            </div>
            {testResult && (
              <p className={`text-sm flex items-center gap-1.5 ${testResult.ok ? "text-emerald-700" : "text-red-700"}`}>
                {testResult.ok ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                {testResult.ok ? "Connected — AssumeRole succeeded." : testResult.error}
              </p>
            )}
          </div>
        )}
      </Step>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm mb-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="flex items-center justify-center h-6 w-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-semibold shrink-0">
          {n}
        </span>
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="text-xs bg-slate-900 text-slate-100 rounded-lg p-3 overflow-x-auto">{code}</pre>
      <button
        onClick={() => {
          navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="absolute top-2 right-2 flex items-center gap-1 text-xs bg-slate-700 text-slate-200 rounded px-2 py-1 hover:bg-slate-600"
      >
        <Copy className="h-3 w-3" />
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
