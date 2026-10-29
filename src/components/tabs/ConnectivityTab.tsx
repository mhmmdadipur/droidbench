import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "../ui/Button";
import { Row, Section, TabHelp } from "../ui/Section";
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
  const [netInfo, setNetInfo] = useState<Record<string, string> | null>(null);

  function guard(): boolean {
    if (!device.connected || device.mode !== "adb") {
      push("No device connected in ADB mode.", "stderr");
      return false;
    }
    return true;
  }

  async function readNetInfo() {
    if (!guard()) return;
    setLoading(true);
    try {
      const [wifi, ipOut, op, netType, dnsMode, dnsHost] = await Promise.all([
        runCapture("adb", ["shell", "cmd", "wifi", "status"]),
        runCapture("adb", ["shell", "ip", "-f", "inet", "addr", "show", "wlan0"]),
        runCapture("adb", ["shell", "getprop", "gsm.operator.alpha"]),
        runCapture("adb", ["shell", "getprop", "gsm.network.type"]),
        runCapture("adb", ["shell", "settings", "get", "global", "private_dns_mode"]),
        runCapture("adb", ["shell", "settings", "get", "global", "private_dns_specifier"]),
      ]);
      const g = (re: RegExp, s: string) => re.exec(s)?.[1]?.trim() ?? "—";
      const info: Record<string, string> = {
        ssid: g(/SSID:\s*"?([^",]+)"?/, wifi),
        signal: g(/RSSI:\s*(-?\d+)/, wifi) + " dBm",
        speed: g(/Link speed:\s*([^,]+)/, wifi),
        freq: g(/Frequency:\s*([^,]+)/, wifi),
        ip: g(/inet\s+([0-9.]+)/, ipOut),
        operator: op.trim().split(",")[0] || "—",
        network: netType.trim().split(",")[0] || "—",
      };
      setNetInfo(info);
      // read DNS at the same time so "Change DNS" unlocks after one scan
      const m = dnsMode.trim();
      const h = dnsHost.trim();
      setCurrent({ mode: m, host: h });
      push(
        `Network read. Private DNS: mode=${m || "—"}${h && h !== "null" ? `, server=${h}` : ""}`,
        "system",
      );
    } catch (e) {
      push(String(e), "stderr");
    } finally {
      setLoading(false);
    }
  }

  function toggleSetting(ns: string, key: string, broadcast?: string) {
    if (!guard()) return;
    // read → flip → write, then broadcast where needed
    runCapture("adb", ["shell", "settings", "get", ns, key]).then((cur) => {
      const on = cur.trim() === "1";
      const next = on ? "0" : "1";
      runCapture("adb", ["shell", "settings", "put", ns, key, next]).then(() => {
        if (broadcast) {
          runCapture("adb", ["shell", "am", "broadcast", "-a", broadcast, "--ez", "state", on ? "false" : "true"]).catch(() => {});
        }
        push(`${key} → ${next === "1" ? "ON" : "OFF"}`, "system");
      });
    });
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

      <Section title={t("net.toggles")}>
        <Row>
          <Button title={t("net.wifiHint")} onClick={() => toggleSetting("global", "wifi_on")}>
            {t("net.wifi")}
          </Button>
          <Button title={t("net.dataHint")} onClick={() => toggleSetting("global", "mobile_data")}>
            {t("net.data")}
          </Button>
        </Row>
        <Button
          size="block"
          title={t("net.airplaneHint")}
          onClick={() => toggleSetting("global", "airplane_mode_on", "android.intent.action.AIRPLANE_MODE")}
        >
          {t("net.airplane")}
        </Button>
      </Section>

      <Section title={t("net.info")}>
        <Button size="block" variant="primary" disabled={loading} title={t("net.infoScanHint")} onClick={readNetInfo}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> {t("net.infoScan")}
        </Button>
        {netInfo && (
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            {([
              ["net.i.ssid", netInfo.ssid],
              ["net.i.signal", netInfo.signal],
              ["net.i.speed", netInfo.speed],
              ["net.i.freq", netInfo.freq],
              ["net.i.ip", netInfo.ip],
              ["net.i.operator", netInfo.operator],
              ["net.i.network", netInfo.network],
            ] as [TKey, string][]).map(([k, v], i) => (
              <div key={k} className={`flex items-center justify-between gap-2 px-3 py-1.5 text-[12px] ${i % 2 ? "bg-[var(--color-bg)]" : "bg-[var(--color-surface)]"}`}>
                <span className="text-[var(--color-ink-faint)]">{t(k)}</span>
                <span className="truncate text-right font-medium text-[var(--color-ink)]">{v}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title={t("net.current")}>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[12px]">
          <span className="text-[var(--color-ink-faint)]">{t("net.privateDns")} </span>
          <span className="font-semibold text-[var(--color-ink)]">{label()}</span>
        </div>
      </Section>

      <Section title={t("net.change")}>
        {!current && (
          <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-700">
            {t("net.changeLocked")}
          </div>
        )}
        {DNS_PRESETS.map((p) => {
          const active =
            current != null &&
            ((p.mode === "hostname" && current.mode === "hostname" && current.host === p.host) ||
              (p.mode !== "hostname" && current.mode === p.mode));
          return (
            <Button
              key={p.id}
              size="block"
              disabled={!current}
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
