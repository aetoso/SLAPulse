import type { LucideIcon } from "lucide-react";

const TONE_STYLES: Record<string, { icon: string; ring: string }> = {
  slate: { icon: "bg-slate-100 text-slate-600", ring: "" },
  emerald: { icon: "bg-emerald-100 text-emerald-600", ring: "" },
  amber: { icon: "bg-amber-100 text-amber-600", ring: "" },
  red: { icon: "bg-red-100 text-red-600", ring: "" },
  indigo: { icon: "bg-indigo-100 text-indigo-600", ring: "" },
};

export function StatCard({
  label,
  value,
  sublabel,
  icon: Icon,
  tone = "slate",
}: {
  label: string;
  value: string | number;
  sublabel?: string;
  icon: LucideIcon;
  tone?: keyof typeof TONE_STYLES;
}) {
  const styles = TONE_STYLES[tone];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="text-2xl font-semibold text-slate-900 mt-1 tabular-nums">{value}</p>
          {sublabel && <p className="text-xs text-slate-400 mt-1">{sublabel}</p>}
        </div>
        <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${styles.icon}`}>
          <Icon className="h-4.5 w-4.5" />
        </div>
      </div>
    </div>
  );
}
