import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "../ui/Button";
import { Section, TabHelp } from "../ui/Section";
import { runCapture } from "../../lib/api";
import { useLog } from "../../state/log";
import { useDevice } from "../../state/device";
import { useConnectivity } from "../../state/connectivity";
import { useI18n, type TKey } from "../../i18n";

interface DnsPreset {
  id: string;
  labelKey: TKey;
  hintKey: TKey;
  mode: "off" | "opportunistic" | "hostname";
  host?: string;
}

const DNS_PRESETS: DnsPreset[] = [
  { id: "auto", labelKey: "net.p.auto", hintKey: "net.p.auto.h", mode: "opportunistic" },
  { id: "off", labelKey: "net.p.off", hintKey: "net.p.off.h", mode: "off" },
  { id: "google", labelKey: "net.p.google", hintKey: "net.p.google.h", mode: "hostname", host: "dns.google" },
  { id: "cloudflare", labelKey: "net.p.cloudflare", hintKey: "net.p.cloudflare.h", mode: "hostname", host: "one.one.one.one" },
  { id: "adguard", labelKey: "net.p.adguard", hintKey: "net.p.adguard.h", mode: "hostname", host: "dns.adguard.com" },
];

export function ConnectivityTab() {
  const { push } = useLog();
  const { device } = useDevice();
  const { t } = useI18n();
  const { current, setCurrent } = useConnectivity();
  const [loading, setLoading] = useState(false);

  function guard(): boolean {
    if (!device.connected || device.mode !== "adb") {
      push("No device connected in ADB mode.", "stderr");
      return false;
    }
    return true;
  }

  async function readCurrent() {
    if (!guard()) return;
    setLoading(true);
    try {
      const [mode, host] = await Promise.all([
        runCapture("adb", ["shell", "settings", "get", "global", "private_dns_mode"]),
        runCapture("adb", ["shell", "settings", "get", "global", "private_dns_specifier"]),
      ]);
      const m = mode.trim();
      const h = host.trim();
      setCurrent({ mode: m, host: h });
      push(`Private DNS: mode=${m || "—"}${h && h !== "null" ? `, server=${h}` : ""}`, "system");
    } catch (e) {
      push(String(e), "stderr");
    } finally {
      setLoading(false);
    }
  }

  async function applyPreset(p: DnsPreset) {
    if (!guard()) return;
    push(`Setting Private DNS → ${t(p.labelKey)}…`, "system");
    try {
      await runCapture("adb", ["shell", "settings", "put", "global", "private_dns_mode", p.mode]);
      if (p.mode === "hostname" && p.host) {
        await runCapture("adb", [
          "shell",
          "settings",
          "put",
          "global",
          "private_dns_specifier",
          p.host,
        ]);
      }
      push(`✓ Private DNS changed to "${t(p.labelKey)}".`, "system");
      await readCurrent();
    } catch (e) {
      push(String(e), "stderr");
    }
  }

  function label(): string {
    if (!current) return t("net.notRead");
    if (current.mode === "off") return t("net.p.off");
    if (current.mode === "opportunistic") return t("net.p.auto");
    if (current.mode === "hostname") {
      const match = DNS_PRESETS.find((p) => p.host === current.host);
      return match ? t(match.labelKey) : `${current.host}`;
    }
    return current.mode || "—";
  }

  return (
    <>
      <TabHelp>{t("net.help")}</TabHelp>

      <Section title={t("net.current")}>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[12px]">
          <span className="text-[var(--color-ink-faint)]">{t("net.privateDns")} </span>
          <span className="font-semibold text-[var(--color-ink)]">{label()}</span>
        </div>
        <Button
          size="block"
          disabled={loading}
          title={t("net.checkHint")}
          onClick={readCurrent}
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          {t("net.check")}
        </Button>
      </Section>

      <Section title={t("net.change")}>
        {DNS_PRESETS.map((p) => {
          const active =
            current != null &&
            ((p.mode === "hostname" && current.mode === "hostname" && current.host === p.host) ||
              (p.mode !== "hostname" && current.mode === p.mode));
          return (
            <Button
              key={p.id}
              size="block"
              variant={active ? "primary" : "default"}
              title={t(p.hintKey)}
              onClick={() => applyPreset(p)}
            >
              {t(p.labelKey)}
              {active && " ✓"}
            </Button>
          );
        })}
      </Section>

      <div className="text-[11px] leading-snug text-[var(--color-ink-faint)]">
        {t("net.note")}
      </div>
    </>
  );
}
