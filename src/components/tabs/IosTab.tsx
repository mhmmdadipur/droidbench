import { useState } from "react";
import {
  RefreshCw,
  BatteryCharging,
  BadgeCheck,
  HardDrive,
  Copy,
  Check,
  ExternalLink,
  Smartphone,
} from "lucide-react";
import { Button } from "../ui/Button";
import { TabHelp } from "../ui/Section";
import { iosInfo, type IosReport } from "../../lib/api";
import { useLog } from "../../state/log";
import { useDevice } from "../../state/device";
import { useIosDiagnostic } from "../../state/iosDiagnostic";
import { useI18n } from "../../i18n";

function Card({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--color-ink)]">
        <Icon size={14} className="text-[var(--color-brand-600)]" />
        {title}
      </div>
      <div className="flex flex-col gap-0.5 text-[11.5px]">{children}</div>
    </div>
  );
}

function KV({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="shrink-0 text-[var(--color-ink-faint)]">{k}</span>
      <span className={`text-right ${strong ? "font-semibold text-[var(--color-ink)]" : "font-medium text-[var(--color-ink-soft)]"}`}>
        {v}
      </span>
    </div>
  );
}

const fmtGB = (b: number | null): string =>
  b == null ? "—" : `${(b / 1024 ** 3).toFixed(1)} GB`;

export function IosTab() {
  const { t } = useI18n();
  const { push } = useLog();
  const { device } = useDevice();
  const { report, setReport } = useIosDiagnostic();
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function scan() {
    if (!device.connected || device.mode !== "ios") {
      push(t("ios.connectFirst"), "stderr");
      return;
    }
    setLoading(true);
    push(t("ios.scanning"), "system");
    try {
      const r = await iosInfo(device.serial);
      setReport(r);
      push(
        t("ios.scanDone", {
          model: r.marketing_name || r.product_type,
          health: r.battery_health_pct ?? "n/a",
        }),
        "system",
      );
    } catch (e) {
      push(String(e), "stderr");
    } finally {
      setLoading(false);
    }
  }

  async function openExternal(url: string) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } catch (e) {
      push(String(e), "stderr");
    }
  }

  async function copyAll(r: IosReport) {
    const lines = [
      `Model: ${r.marketing_name} (${r.product_type})`,
      `iOS: ${r.ios_version} (${r.build_version})`,
      `Serial: ${r.serial}  IMEI: ${r.imei}`,
      `Battery: ${r.battery_health_pct ?? "n/a"}% health, ${r.battery_cycle_count ?? "n/a"} cycles`,
      `Storage: ${fmtGB(r.disk_free_bytes)} free / ${fmtGB(r.disk_total_bytes)}`,
      `Activation: ${r.activation_state}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      push(t("ios.copied"), "system");
    } catch {
      push("Failed to copy.", "stderr");
    }
  }

  const bandText =
    report == null || report.battery_health_pct == null
      ? null
      : report.battery_health_pct >= 90
        ? t("ios.bat.good")
        : report.battery_health_pct >= 80
          ? t("ios.bat.fair")
          : t("ios.bat.poor");

  return (
    <>
      <TabHelp>{t("ios.help")}</TabHelp>

      <Button size="block" variant="primary" disabled={loading} title={t("ios.scanHint")} onClick={scan}>
        <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        {loading ? t("ios.scanningShort") : t("ios.scan")}
      </Button>

      {report && (
        <div className="mt-3">
          <Card icon={BatteryCharging} title={t("ios.card.battery")}>
            <KV
              k={t("ios.bat.health")}
              v={report.battery_health_pct != null ? `${report.battery_health_pct}%` : t("ios.bat.naHealth")}
              strong={report.battery_health_pct != null}
            />
            <KV
              k={t("ios.bat.cycles")}
              v={report.battery_cycle_count != null ? String(report.battery_cycle_count) : "—"}
              strong={report.battery_health_pct == null && report.battery_cycle_count != null}
            />
            <KV
              k={t("ios.bat.capacity")}
              v={
                report.battery_full_capacity != null && report.battery_design_capacity != null
                  ? `${report.battery_full_capacity} / ${report.battery_design_capacity} mAh`
                  : "—"
              }
            />
            <KV k={t("ios.bat.level")} v={report.battery_percent != null ? `${report.battery_percent}%` : "—"} />
            {bandText && (
              <p className="mt-1 text-[10.5px] leading-snug text-[var(--color-ink-faint)]">{bandText}</p>
            )}
            {report.battery_health_pct == null && (
              <p className="mt-1 text-[10px] leading-snug text-[var(--color-ink-faint)]">{t("ios.bat.note")}</p>
            )}
          </Card>

          <Card icon={BadgeCheck} title={t("ios.card.identity")}>
            <KV k={t("ios.id.model")} v={report.marketing_name || "—"} strong />
            <KV k={t("ios.id.productType")} v={report.product_type || "—"} />
            <KV k={t("ios.id.ios")} v={report.ios_version ? `${report.ios_version} (${report.build_version})` : "—"} />
            <KV k={t("ios.id.serial")} v={report.serial || "—"} />
            <KV k={t("ios.id.imei")} v={report.imei || t("ios.id.na")} />
            <KV k={t("ios.id.region")} v={report.region || "—"} />
            <KV k={t("ios.id.activation")} v={report.activation_state || "—"} />
            <KV k={t("ios.id.cpu")} v={report.cpu_arch || "—"} />
            <div className="mt-2 flex flex-col gap-1.5">
              <Button
                size="sm"
                className="w-full"
                title={t("ios.id.checkImeiHint")}
                onClick={() => openExternal(report.imei ? `https://www.imei.info/?imei=${report.imei}` : "https://www.imei.info/")}
              >
                <ExternalLink size={13} />
                {t("ios.id.checkImei")}
              </Button>
              <Button
                size="sm"
                className="w-full"
                title={t("ios.id.checkCoverageHint")}
                onClick={() => openExternal("https://checkcoverage.apple.com/")}
              >
                <ExternalLink size={13} />
                {t("ios.id.checkCoverage")}
              </Button>
            </div>
          </Card>

          <Card icon={HardDrive} title={t("ios.card.storage")}>
            <KV k={t("ios.sto.total")} v={fmtGB(report.disk_total_bytes)} />
            <KV k={t("ios.sto.free")} v={fmtGB(report.disk_free_bytes)} />
            <KV
              k={t("ios.sto.used")}
              v={
                report.disk_total_bytes != null && report.disk_free_bytes != null
                  ? fmtGB(report.disk_total_bytes - report.disk_free_bytes)
                  : "—"
              }
            />
          </Card>

          <Button size="block" title={t("ios.copyHint")} onClick={() => copyAll(report)}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? t("common.copied") : t("ios.copyAll")}
          </Button>

          <p className="mt-2 text-[10px] leading-snug text-[var(--color-ink-faint)]">{t("ios.note")}</p>
        </div>
      )}

      {!report && device.mode !== "ios" && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[11.5px] leading-snug text-[var(--color-ink-soft)]">
          <Smartphone size={15} className="mt-0.5 shrink-0 text-[var(--color-brand-600)]" />
          <span>{t("ios.noDevice")}</span>
        </div>
      )}
    </>
  );
}
