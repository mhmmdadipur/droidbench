import { RefreshCw } from "lucide-react";
import { useDevice } from "../state/device";

function Field({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[13px]">
      <span className="text-[var(--color-ink-faint)]">{label}</span>
      <span
        className={`truncate text-right ${
          strong ? "font-semibold text-[var(--color-ink)]" : "text-[var(--color-ink-soft)]"
        }`}
        title={value}
      >
        {value || "—"}
      </span>
    </div>
  );
}

const modeLabel: Record<string, string> = {
  adb: "ADB",
  fastboot: "FASTBOOT",
  download: "DOWNLOAD",
  none: "OFF",
};

export function DeviceStatus() {
  const { device, refreshing, refresh } = useDevice();
  const online = device.connected;

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
          Device Status
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            title="Refresh"
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
        <Field
          label="Device"
          value={online ? [device.brand, device.model].filter(Boolean).join(" ") || device.serial : "No device"}
          strong
        />
        <Field label="ROM" value={device.rom} />
        <Field label="Android" value={device.android} />
        <Field label="Serial" value={device.serial} />
      </div>
    </div>
  );
}
