"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Cloud, Activity, Radar } from "lucide-react";
import { useIdentity, type Role } from "./IdentityContext";

const SEEDED_IDENTITIES: { actor: string; role: Role; label: string }[] = [
  { actor: "founder-admin", role: "ADMIN", label: "Admin (founder)" },
  { actor: "sre-lead", role: "SRE", label: "SRE" },
  { actor: "csm-jordan", role: "CSM", label: "CSM (Jordan)" },
  { actor: "vp-eng", role: "EXECUTIVE", label: "Executive (VP Eng)" },
];

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  roles?: Role[];
}

// Single product: Uptime Monitoring. AWS Integration is an optional
// enrichment (real cross-account root-cause lookups for a monitor's
// downtime), not a separate customer-facing product anymore.
const UPTIME_NAV: NavItem[] = [{ href: "/monitors", label: "Monitors", icon: Radar }];

const OTHER_NAV: NavItem[] = [
  { href: "/aws-integration", label: "AWS Integration", icon: Cloud, roles: ["ADMIN", "SRE"] },
  { href: "/notifications", label: "Notifications", icon: Bell, roles: ["ADMIN", "SRE", "CSM"] },
];

const ROLE_COLORS: Record<Role, string> = {
  ADMIN: "bg-violet-100 text-violet-700",
  SRE: "bg-sky-100 text-sky-700",
  CSM: "bg-teal-100 text-teal-700",
  EXECUTIVE: "bg-amber-100 text-amber-700",
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const { identity, signIn, signOut, loading } = useIdentity();
  const pathname = usePathname();

  if (loading) return null;

  if (!identity) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-indigo-50">
        <div className="max-w-sm w-full">
          <div className="flex items-center gap-2 justify-center mb-8">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center">
              <Activity className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-semibold tracking-tight text-slate-900">SLAPulse</span>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
            <p className="text-sm font-medium text-slate-700 mb-1">Sign in as…</p>
            <p className="text-xs text-slate-500 mb-4">
              Local-dev role switcher, standing in for SSO (Section 14.1).
            </p>
            <div className="flex flex-col gap-2">
              {SEEDED_IDENTITIES.map((id) => (
                <button
                  key={id.actor}
                  onClick={() => signIn(id.actor, id.role)}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 hover:bg-white hover:border-indigo-300 hover:shadow-sm px-4 py-2.5 text-sm font-medium text-slate-700 transition-all"
                >
                  {id.label}
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${ROLE_COLORS[id.role]}`}>
                    {id.role}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const visible = (items: NavItem[]) => items.filter((item) => !item.roles || item.roles.includes(identity.role));
  const isActive = (href: string) => pathname === href || pathname?.startsWith(href + "/");

  const renderGroup = (label: string, items: NavItem[]) => {
    const shown = visible(items);
    if (shown.length === 0) return null;
    return (
      <div className="mb-4">
        <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
        <div className="space-y-0.5">
          {shown.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${active ? "text-indigo-600" : "text-slate-400"}`} />
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex bg-slate-50">
      <aside className="w-64 shrink-0 border-r border-slate-200 bg-white flex flex-col">
        <div className="h-16 flex items-center gap-2 px-5 border-b border-slate-100">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center">
            <Activity className="h-4 w-4 text-white" />
          </div>
          <span className="text-base font-semibold tracking-tight text-slate-900">SLAPulse</span>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3">
          {renderGroup("Uptime Monitoring", UPTIME_NAV)}
          {renderGroup("More", OTHER_NAV)}
        </nav>

        <div className="border-t border-slate-100 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800 truncate">{identity.actor}</p>
              <span className={`inline-block mt-0.5 text-[10px] font-semibold px-2 py-0.5 rounded-full ${ROLE_COLORS[identity.role]}`}>
                {identity.role}
              </span>
            </div>
          </div>
          <button
            onClick={() => signOut()}
            className="w-full text-xs rounded-lg border border-slate-200 text-slate-600 px-3 py-1.5 hover:bg-slate-100 transition-colors"
          >
            Switch role
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
