"use client";

import { useEffect, useState } from "react";
import { useIdentity } from "@/components/IdentityContext";

interface Notification {
  id: string;
  channel: string;
  severity: string;
  message: string;
  created_at: string;
}

const SEVERITY_STYLES: Record<string, string> = {
  LOW: "bg-slate-100 text-slate-700",
  MEDIUM: "bg-amber-100 text-amber-800",
  HIGH: "bg-orange-100 text-orange-800",
  CRITICAL: "bg-red-100 text-red-800",
};

export default function NotificationsPage() {
  const { identity, loading: identityLoading } = useIdentity();
  const [notifications, setNotifications] = useState<Notification[] | null>(null);

  useEffect(() => {
    if (!identity) return;
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((d) => setNotifications(d.notifications));
  }, [identity]);

  if (identityLoading) return null;
  if (!identity) return <p className="text-slate-500">Sign in to view notifications.</p>;

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">Notifications</h1>
      <p className="text-sm text-slate-500 mb-6">
        Local-dev stand-in for Slack + PagerDuty — monitor downtime and recovery alerts land here
        instead of a real channel.
      </p>

      {notifications === null ? (
        <p className="text-slate-500">Loading…</p>
      ) : notifications.length === 0 ? (
        <p className="text-slate-500">Nothing yet.</p>
      ) : (
        <ul className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
          {notifications.map((n) => (
            <li key={n.id} className="px-4 py-3 text-sm flex items-start gap-3">
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium shrink-0 ${SEVERITY_STYLES[n.severity] ?? "bg-slate-100 text-slate-700"}`}
              >
                {n.severity}
              </span>
              <div className="flex-1">
                <div className="text-slate-800">{n.message}</div>
                <div className="text-slate-400 text-xs mt-0.5">
                  {n.channel} · {new Date(n.created_at).toLocaleString()}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
