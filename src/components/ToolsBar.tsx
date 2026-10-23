import { CheckCircle2, AlertTriangle, XCircle, RefreshCw } from "lucide-react";
import { useTools2 } from "../state/tools";
import { cn } from "../lib/utils";

const LABEL: Record<string, string> = {
  adb: "adb",
  fastboot: "fastboot",
  scrcpy: "scrcpy",
  heimdall: "heimdall",
  "payload-dumper": "dumper",
};

function badgeStyle(source: string) {
  switch (source) {
    case "bundled":
      return "bg-emerald-50 text-emerald-600";
    case "system":
      return "bg-sky-50 text-sky-600";
    default:
      return "bg-rose-50 text-rose-500";
  }
}

function Icon({ source }: { source: string }) {
  if (source === "bundled") return <CheckCircle2 size={11} />;
  if (source === "system") return <AlertTriangle size={11} />;
  return <XCircle size={11} />;
}

export function ToolsBar() {
  const { tools, refresh } = useTools2();
  // only surface the core + any missing optional tools
  const shown = tools.filter(
    (t) => ["adb", "fastboot", "scrcpy"].includes(t.name) || t.source !== "missing",
  );
  const missingCore = tools.filter(
    (t) => ["adb", "fastboot"].includes(t.name) && t.source === "missing",
  );

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
          Tools
        </span>
        <button
          onClick={refresh}
          title="Re-check tools"
          className="text-[var(--color-ink-faint)] hover:text-[var(--color-brand)]"
        >
          <RefreshCw size={12} />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((t) => (
          <span
            key={t.name}
            title={t.source === "missing" ? `${t.name}: not found` : `${t.name} (${t.source})\n${t.path}`}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
              badgeStyle(t.source),
            )}
          >
            <Icon source={t.source} />
            {LABEL[t.name] ?? t.name}
          </span>
        ))}
      </div>
      {missingCore.length > 0 && (
        <div className="mt-2 rounded-md bg-rose-50 px-2 py-1.5 text-[11px] leading-snug text-rose-600">
          {missingCore.map((t) => t.name).join(" & ")} tidak ditemukan. Jalankan{" "}
          <code className="font-mono">scripts/fetch-binaries.sh</code> untuk
          bundle, atau pasang Android platform-tools.
        </div>
      )}
    </div>
  );
}
