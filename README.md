# SLAPulse — local dev

A local-dev implementation of the **full SLAPulse spec** — Core Platform
P0/P1/P2 (F1-F12, F-EVID, F-EXEC, F-SYN, F-drift) and the complete Trust
Portal (PF1-PF12) — built on the corrected v3.0 architecture: partitioned
Postgres in place of Timestream, Row-Level Security as a database-enforced
tenant isolation layer, and hash-chained append-only audit logs (both the
internal `sla_audit_log` and the Portal's own `portal_audit_log`).

## What's real vs. substituted for local dev

The **calculation core is real**: the exact downtime-detection boolean
logic from Section 9.2 (extended with F-SYN's independent
infrastructure-OR-application path), the fail-closed `DATA_INCOMPLETE`
completeness check (Section 9.4/11.2), the append-only
`customer_sla_status` + `sla_corrections` two-approver trail (Section
8.3/8.7), the disclosure-delay algorithm (Section 8.8), and both
hash-chained audit logs all run against a real Postgres schema with real
RLS policies.

Four things are substituted because there's no AWS account, real SSO
provider, or real email/paging service to point this at locally —
swapping any one of them for the real thing does not touch the
calculation core:

| Spec calls for | This build uses | Where |
|---|---|---|
| CloudWatch/Route53/ECS APIs (+ synthetic transaction checks) | Deterministic mock signal generator, seeded per customer/minute | `src/lib/mockCollector.ts` |
| EventBridge + SQS + Lambda fan-out, cross-account STS AssumeRole | A single Node process (`node-cron`) calling the same job functions in-process on an accelerated cadence, plus a simulated role-assumption log for Model B customers | `src/worker.ts`, `src/jobs/*` |
| Cognito/Clerk OIDC/SSO (staff) + real Portal SSO/magic-link email (customers) | A cookie-based staff role switcher, and a real magic-link flow whose "email" writes to a local outbox instead of sending | `src/lib/auth.ts`, `src/lib/portalAuth.ts` |
| Slack + PagerDuty, SES | A `notifications` table (`/notifications`) and a local mail outbox (`/reports`, Portal login page) | `src/lib/reportStorage.ts` |
| S3 Object Lock + external transparency log (P2 WORM) | A local append-only anchor file + `audit_chain_anchors` table | `src/lib/auditAnchor.ts` |

## Prerequisites

- Node 20+, Docker Desktop (or compatible).
- Nothing else — no AWS account needed. Puppeteer downloads its own headless Chromium on `npm install`.

## First-time setup

```bash
cp .env.example .env        # already done if you're reading this after setup
npm install
npm run db:up                # starts Postgres in Docker on localhost:5434
npm run migrate               # applies the full schema (RLS, hash chains, portal tables)
npm run seed                  # creates one vendor + 6 monitored customer environments
```

> Postgres runs on **5434**, not 5432 — this machine already has a native
> Postgres 18 install bound to 5432, so the container was moved to avoid
> colliding with it.

## Running it

Two processes, in two terminals:

```bash
npm run dev      # Next.js app on http://localhost:3000
npm run worker   # background jobs: collection/30s, SLA calc/2min, daily ops/3min
```

Open http://localhost:3000, use the role switcher to sign in (try
**Admin** first), and watch the dashboard fill in as the worker's first
tick lands. You can also trigger any tick on demand from the dashboard's
job buttons instead of waiting for the worker.

Seeded customers cover every SLA outcome and every extended feature:

| Customer | Demo profile | Demonstrates |
|---|---|---|
| Beta Inc | stable | COMPLIANT, near-100% uptime |
| Gamma Corp | flaky | AT_RISK / occasional DOWNTIME, F7 credit memo |
| Delta LLC | degrading | F9 Model B (cross-account log), F-drift (starts with simulated drift), no monthly fee on file (F7 skip case) |
| Epsilon Systems | breached | BREACHED, daily outage window, F7 credit memo, short disclosure ceiling |
| Zeta Health | data_gap | DATA_INCOMPLETE — the fail-closed completeness gate (Section 9.4) |
| Theta Retail | app_outage | F-SYN: infra signals stay green, only the synthetic check catches the daily outage — the Section 9.2 documented blind spot, closed |

## Everything that's built

**Core Platform (P0-P2):** F1 registry, F2 detection + fail-closed calc,
F3 breach prediction, F4 HTML reports + mock SES outbox (`/reports`), F5
internal dashboard, F6 incident attribution (Evidence Explorer), F7 SLA
credit automation (`/credits`), F8 self-service maintenance windows
(customer detail page), F9 simulated cross-account deployment (customer
detail page), F10 PDF export (Puppeteer, `/reports`), F11 renewal risk
scoring, F12 formal audit trail — hash chain + external anchor + export
package (`/corrections`), F-EVID evidence explorer, F-EXEC executive
dashboard, F-SYN synthetic monitoring, F-drift drift detection.

**Trust Portal (PF1-PF12):** white-label shell, magic-link auth,
live status + history, disclosure-delayed incident reveal (Section 8.8,
force-hold with second-approver + hard ceiling), vendor admin console
(`/portal-admin`), dispute flagging routed to Ops, multi-environment
rollup, read-only API key (PF10), formal export package, third-party
attestation display. Portal pages live at `/portal/{vendorId}/login` and
share no chrome with the staff app — see `src/app/(staff)/layout.tsx`
vs. the bare root layout.

## Roles (Section 14.5)

- **Admin (founder-admin)** — full access: register customers, trigger jobs, issue credits, configure the Portal.
- **SRE (sre-lead)** — sees everything, can trigger jobs and corrections, cannot register customers or issue credits.
- **CSM (csm-jordan)** — sees only its assigned accounts (Beta Inc, Gamma Corp, Theta Retail), no write access to SLA data.
- **Executive (vp-eng)** — portfolio-only view (F-EXEC), no per-customer evidence.

## Verifying tenant isolation / RLS

```bash
docker exec slapulse-postgres psql -U slapulse -d slapulse -c \
  "select tablename, policyname from pg_policies order by tablename;"
```

Every tenant table (including the Portal tables) should show a
`tenant_isolation` policy. The app connects as `slapulse_app`, not the
Postgres superuser, and is subject to `FORCE ROW LEVEL SECURITY` —
`src/lib/db.ts`'s `withTenant()` sets `app.current_vendor_id` via
`SET LOCAL`/`set_config()` on every transaction (Section 11.5). The two
narrow exceptions (magic-link token lookup, PF10 API key lookup) go
through `SECURITY DEFINER` Postgres functions rather than bypassing RLS
in application code — see `migrations/*_portal-token-lookup.js` and
`*_portal-api-key.js`.

## Resetting local data

```bash
npm run db:down -- -v   # drops the Postgres volume entirely
npm run db:up
npm run migrate
npm run seed
```

## Known local-dev-only rough edges

- ESLint's newer React-Compiler-oriented rules (`react-hooks/set-state-in-effect`,
  `react-hooks/purity`) flag the fetch-on-mount `useEffect` pattern used
  across the dashboard pages, and one `Date.now()` call in a render
  function. Both are functionally correct (verified via browser testing)
  and common in Next.js apps without a data-fetching library — not fixed
  here to avoid a sweeping, low-value refactor across ~10 pages.
- The Portal login page's "which company" picker is a local-dev
  simplification of PF1's real mechanism (a distinct link/subdomain per
  customer).
