import { useState } from "react";
import { RefreshCw, Copy, Check } from "lucide-react";
import { useDevice } from "../state/device";
import { useLog } from "../state/log";
import { useI18n } from "../i18n";

function Field({
  label,
  value,
  strong,
  onCopy,
  justCopied,
  copyHint,
}: {
  label: string;
  value: string;
  strong?: boolean;
  onCopy?: (value: string) => void;
  justCopied?: boolean;
  copyHint?: string;
}) {
  const canCopy = onCopy && !!value && value !== "—";
  return (
    <div className="group flex items-center justify-between gap-2 text-[13px]">
      <span className="shrink-0 text-[var(--color-ink-faint)]">{label}</span>
      <span className="flex min-w-0 items-center justify-end gap-1">
        {canCopy && (
          <button
            onClick={() => onCopy(value)}
            title={copyHint}
            className="no-drag shrink-0 text-[var(--color-ink-faint)] opacity-0 transition-opacity hover:text-[var(--color-brand)] group-hover:opacity-100"
          >
            {justCopied ? <Check size={12} className="text-emerald-500 opacity-100" /> : <Copy size={12} />}
          </button>
        )}
        <span
          className={`truncate text-right ${
            strong ? "font-semibold text-[var(--color-ink)]" : "text-[var(--color-ink-soft)]"
          }`}
          title={value}
        >
          {value || "—"}
        </span>
      </span>
    </div>
  );
}

const modeLabel: Record<string, string> = {
  adb: "ADB",
  fastboot: "FASTBOOT",
  download: "DOWNLOAD",
  ios: "iOS",
  none: "OFF",
};

export function DeviceStatus() {
  const { device, refreshing, refresh } = useDevice();
  const { push } = useLog();
  const { t } = useI18n();
  const online = device.connected;
  const isIos = device.mode === "ios";
  const [copied, setCopied] = useState(false);
  // track which individual field was just copied (by key) for the check icon
  const [copiedField, setCopiedField] = useState<string | null>(null);

  async function copyField(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(key);
      setTimeout(() => setCopiedField((k) => (k === key ? null : k)), 1500);
      push(t("status.copiedField", { value }), "system");
    } catch {
      push(t("status.copyFail"), "stderr");
    }
  }

  async function copyStatus() {
    if (!online) {
      push(t("status.copyNone"), "stderr");
      return;
    }
    const deviceName = [device.brand, device.model].filter(Boolean).join(" ") || device.serial;
    const lines = [
      `${t("status.device")}: ${deviceName}`,
      isIos
        ? `${t("status.system")}: ${device.rom || device.android}`
        : `${t("status.rom")}: ${device.rom || "—"}\n${t("status.android")}: ${device.android || "—"}`,
      `${isIos ? t("status.udid") : t("status.serial")}: ${device.serial || "—"}`,
      `Mode: ${modeLabel[device.mode] ?? "OFF"}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      push(t("status.copied"), "system");
    } catch {
      push(t("status.copyFail"), "stderr");
    }
  }

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
          {t("status.title")}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={copyStatus}
            disabled={!online}
            title={t("status.copyHint")}
            className="text-[var(--color-ink-faint)] hover:text-[var(--color-brand)] disabled:opacity-40"
          >
            {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
          </button>
          <button
            onClick={refresh}
            title={t("common.refresh")}
            className="text-[var(--color-ink-faint)] hover:text-[var(--color-brand)]"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
          </button>
          <span
            className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
              online
                ? "bg-emerald-50 text-emerald-600"
                : "bg-rose-50 text-rose-500"
            }`}
          >
            {modeLabel[device.mode] ?? "OFF"}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {(() => {
          const deviceName = online
            ? [device.brand, device.model].filter(Boolean).join(" ") || device.serial
            : t("common.noDevice");
          return (
            <Field
              label={t("status.device")}
              value={deviceName}
              strong
              onCopy={online ? (v) => copyField("device", v) : undefined}
              justCopied={copiedField === "device"}
              copyHint={t("status.copyField")}
            />
          );
        })()}
        {/* iOS devices: show "System = iOS x.y"; Android: ROM + Android version */}
        {isIos ? (
          <Field
            label={t("status.system")}
            value={device.rom || device.android}
            onCopy={(v) => copyField("system", v)}
            justCopied={copiedField === "system"}
            copyHint={t("status.copyField")}
          />
        ) : (
          <>
            <Field
              label={t("status.rom")}
              value={device.rom}
              onCopy={(v) => copyField("rom", v)}
              justCopied={copiedField === "rom"}
              copyHint={t("status.copyField")}
            />
            <Field
              label={t("status.android")}
              value={device.android}
              onCopy={(v) => copyField("android", v)}
              justCopied={copiedField === "android"}
              copyHint={t("status.copyField")}
            />
          </>
        )}
        <Field
          label={isIos ? t("status.udid") : t("status.serial")}
          value={device.serial}
          onCopy={(v) => copyField("serial", v)}
          justCopied={copiedField === "serial"}
          copyHint={t("status.copyField")}
        />
      </div>
    </div>
  );
}
