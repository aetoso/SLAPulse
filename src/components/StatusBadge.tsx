const STYLES: Record<string, { pill: string; dot: string }> = {
  COMPLIANT: { pill: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  AT_RISK: { pill: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  BREACHED: { pill: "bg-red-50 text-red-700", dot: "bg-red-500" },
  DATA_INCOMPLETE: { pill: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
  UP: { pill: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  DEGRADED: { pill: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  DOWNTIME: { pill: "bg-red-50 text-red-700", dot: "bg-red-500" },
  MAINTENANCE: { pill: "bg-sky-50 text-sky-700", dot: "bg-sky-500" },
  UNKNOWN: { pill: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
};

export function StatusBadge({ status }: { status: string }) {
  const styles = STYLES[status] ?? STYLES.UNKNOWN;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${styles.pill}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
      {status.replace("_", " ")}
    </span>
  );
}
