import { useState } from "react";
import { RefreshCw, Info } from "lucide-react";
import { useTools2 } from "../state/tools";
import { cn } from "../lib/utils";
import { useI18n, type TKey } from "../i18n";
import { Modal } from "./ui/Modal";

/** The 7 tools surfaced in the Tools box, in display order. */
const CORE7: { name: string; label: string; descKey: TKey; platform: "android" | "ios" }[] = [
  { name: "adb", label: "adb", descKey: "tools.d.adb", platform: "android" },
  { name: "fastboot", label: "fastboot", descKey: "tools.d.fastboot", platform: "android" },
  { name: "scrcpy", label: "scrcpy", descKey: "tools.d.scrcpy", platform: "android" },
  { name: "idevice_id", label: "idevice_id", descKey: "tools.d.ideviceId", platform: "ios" },
  { name: "ideviceinfo", label: "ideviceinfo", descKey: "tools.d.ideviceinfo", platform: "ios" },
  { name: "idevicediagnostics", label: "idevicediagnostics", descKey: "tools.d.idevicediag", platform: "ios" },
  { name: "idevicescreenshot", label: "idevicescreenshot", descKey: "tools.d.ideviceshot", platform: "ios" },
];

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

export function ToolsBar() {
  const { tools, refresh } = useTools2();
  const { t } = useI18n();
  const [showInfo, setShowInfo] = useState(false);

  // map tool name → status; count how many of the 7 are available
  const byName = new Map(tools.map((x) => [x.name, x]));
  const total = CORE7.length;
  const available = CORE7.filter((c) => {
    const s = byName.get(c.name);
    return s && s.source !== "missing";
  }).length;

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
          {t("tools.title")}
          <button
            onClick={() => setShowInfo(true)}
            title={t("tools.whatAre")}
            className="no-drag flex h-4 w-4 items-center justify-center rounded-full text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-brand-600)]"
          >
            <Info size={12} />
          </button>
        </span>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-md px-1.5 py-0.5 text-[10px] font-bold",
              available === total
                ? "bg-emerald-50 text-emerald-600"
                : available === 0
                  ? "bg-rose-50 text-rose-500"
                  : "bg-amber-50 text-amber-600",
            )}
            title={t("tools.countHint")}
          >
            {available}/{total}
          </span>
          <button
            onClick={refresh}
            title={t("tools.recheck")}
            className="text-[var(--color-ink-faint)] hover:text-[var(--color-brand)]"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {showInfo && (
        <Modal icon={Info} title={t("tools.info.title")} onClose={() => setShowInfo(false)} maxWidth="max-w-md">
          <p className="mb-3 text-[12px] leading-relaxed text-[var(--color-ink-soft)]">
            {t("tools.info.intro")}
          </p>
          <div className="space-y-2">
            {CORE7.map((c) => {
              const source = byName.get(c.name)?.source ?? "missing";
              return (
                <div
                  key={c.name}
                  className="flex items-start gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
                >
                  <span className={cn("mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase", c.platform === "ios" ? "bg-slate-100 text-slate-600" : "bg-[var(--color-brand-50)] text-[var(--color-brand-600)]")}>
                    {c.platform === "ios" ? "iOS" : "Android"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono text-[12px] font-semibold text-[var(--color-ink)]">{c.label}</span>
                      <span className={cn("rounded px-1 py-0.5 text-[8.5px] font-semibold", badgeStyle(source))}>
                        {t(("tools.src." + source) as TKey)}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-[var(--color-ink-soft)]">
                      {t(c.descKey)}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[10.5px] leading-snug text-[var(--color-ink-faint)]">
            {t("tools.info.legend")}
          </p>
        </Modal>
      )}
    </div>
  );
}
