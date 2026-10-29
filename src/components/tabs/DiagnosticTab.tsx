import { useEffect, useState } from "react";
import {
  RefreshCw,
  Copy,
  Check,
  Battery,
  Smartphone,
  MemoryStick,
  HardDrive,
  Cpu,
  ShieldCheck,
  Radar,
  CheckCircle2,
  XCircle,
  Circle,
  Phone,
  Folder,
  FileText,
  ChevronLeft,
} from "lucide-react";
import { Button } from "../ui/Button";
import { Row, Section, TabHelp } from "../ui/Section";
import { runCapture } from "../../lib/api";
import { useLog } from "../../state/log";
import { useDevice } from "../../state/device";
import { useDiagnostic } from "../../state/diagnostic";
import { useI18n, type TKey } from "../../i18n";
import {
  runDiagnosticScan,
  computeScore,
  fmtKb,
  fmtUAh,
  listDir,
  readDeviceFile,
  SENSOR_KEYS,
  OPTIONAL_SENSORS,
  type DiagnosticReport,
  type SensorKey,
  type FsEntry,
} from "../../lib/diagnostics";

type Mode = "simple" | "technical";

// Raw getprop rows shown in technical mode.
const PROPS: { key: string; labelKey: TKey; hintKey: TKey }[] = [
  { key: "ro.product.manufacturer", labelKey: "diag.p.manufacturer", hintKey: "diag.p.manufacturer.h" },
  { key: "ro.product.model", labelKey: "diag.p.model", hintKey: "diag.p.model.h" },
  { key: "ro.product.device", labelKey: "diag.p.device", hintKey: "diag.p.device.h" },
  { key: "ro.build.version.release", labelKey: "diag.p.release", hintKey: "diag.p.release.h" },
  { key: "ro.build.version.sdk", labelKey: "diag.p.sdk", hintKey: "diag.p.sdk.h" },
  { key: "ro.build.flavor", labelKey: "diag.p.flavor", hintKey: "diag.p.flavor.h" },
  { key: "ro.build.tags", labelKey: "diag.p.tags", hintKey: "diag.p.tags.h" },
  { key: "ro.build.type", labelKey: "diag.p.type", hintKey: "diag.p.type.h" },
  { key: "ro.debuggable", labelKey: "diag.p.debuggable", hintKey: "diag.p.debuggable.h" },
  { key: "ro.boot.verifiedbootstate", labelKey: "diag.p.vbstate", hintKey: "diag.p.vbstate.h" },
  { key: "ro.boot.flash.locked", labelKey: "diag.p.locked", hintKey: "diag.p.locked.h" },
  { key: "ro.boot.vbmeta.device_state", labelKey: "diag.p.devstate", hintKey: "diag.p.devstate.h" },
];

const SENSOR_LABEL: Record<SensorKey, TKey> = {
  accelerometer: "diag.s.accelerometer",
  gyroscope: "diag.s.gyroscope",
  magnetic: "diag.s.magnetic",
  proximity: "diag.s.proximity",
  light: "diag.s.light",
  fingerprint: "diag.s.fingerprint",
  nfc: "diag.s.nfc",
  stepcounter: "diag.s.stepcounter",
  pressure: "diag.s.pressure",
};

interface CheckItem {
  id: string;
  labelKey: TKey;
  hintKey: TKey;
  /** optional adb trigger to actually exercise the hardware */
  trigger?: string[];
}
const CHECKS: CheckItem[] = [
  { id: "vibrate", labelKey: "diag.check.vibrate", hintKey: "diag.check.vibrateHint", trigger: ["shell", "cmd", "vibrator_manager", "synced", "oneshot", "800"] },
  { id: "flashlight", labelKey: "diag.check.flashlight", hintKey: "diag.check.flashlightHint" },
  { id: "speaker", labelKey: "diag.check.speaker", hintKey: "diag.check.speakerHint" },
  { id: "screenColors", labelKey: "diag.check.screenColors", hintKey: "diag.check.screenColorsHint" },
  { id: "touch", labelKey: "diag.check.touch", hintKey: "diag.check.touchHint" },
  { id: "fingerprint", labelKey: "diag.check.fingerprint", hintKey: "diag.check.fingerprintHint" },
];

const DIAG_CODES: { labelKey: TKey; code: string }[] = [
  { labelKey: "diag.builtin.samsung", code: "*#0*#" },
  { labelKey: "diag.builtin.samsungFull", code: "*#*#6484#*#*" },
  { labelKey: "diag.builtin.samsungExtra", code: "*#*#64663#*#*" },
];

export function DiagnosticTab() {
  const { push } = useLog();
  const { device } = useDevice();
  const { t } = useI18n();
  const { report, setReport, checks, setCheck } = useDiagnostic();
  const [mode, setMode] = useState<Mode>("simple");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  function guard(): boolean {
    if (!device.connected || device.mode !== "adb") {
      push("No device connected in ADB mode.", "stderr");
      return false;
    }
    return true;
  }

  async function scan() {
    if (!guard()) return;
    setLoading(true);
    push("Scanning device (full diagnostics)…", "system");
    try {
      const r = await runDiagnosticScan();
      setReport(r);
      push(
        `Scan done. Battery health: ${r.battery.healthPct ?? "n/a"}%, ` +
          `sensors: ${r.sensors.totalCount}, authenticity: ${r.system.authenticity}.`,
        "system",
      );
    } catch (e) {
      push(String(e), "stderr");
    } finally {
      setLoading(false);
    }
  }

  async function runCheck(item: CheckItem) {
    if (!guard()) return;
    if (item.trigger) {
      push(`Testing ${item.id}…`, "system");
      try {
        await runCapture("adb", item.trigger);
      } catch (e) {
        push(String(e), "stderr");
      }
    } else {
      // no reliable stock trigger — guide the user
      push(`Manually test ${item.id} on the phone.`, "system");
    }
  }

  const score = report ? computeScore(report, checks) : null;

  async function copyAll() {
    if (!report) return;
    const b = report.battery;
    const lines = [
      `Battery health: ${b.healthPct ?? "n/a"}% (${fmtUAh(b.maxCapacity)} / ${fmtUAh(b.designCapacity)})`,
      `Battery level: ${b.level ?? "—"}%  temp: ${b.tempC ?? "—"}°C  voltage: ${b.voltage ?? "—"}mV`,
      `RAM: ${fmtKb(report.memory.availKb)} free / ${fmtKb(report.memory.totalKb)}`,
      `Storage: ${fmtKb(report.storage.freeKb)} free / ${fmtKb(report.storage.totalKb)}`,
      `CPU: ${report.cpu.cores} cores, ${report.cpu.chipset} (${report.cpu.abi})`,
      `Cameras: ${report.camera.count ?? "—"}`,
      `Screen: ${report.screen.resolution} ${report.screen.refreshHz} ${report.screen.maxNits}`,
      `Sensors: ${report.sensors.totalCount}`,
      `Authenticity: ${report.system.authenticity}${report.system.rooted ? " (rooted)" : ""}`,
      `Security patch: ${report.system.securityPatch}`,
      `Kernel: ${report.system.kernel}`,
      score ? `Score: ${score.score}/100 (${score.band})` : "",
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      push("Report copied to clipboard.", "system");
    } catch {
      push("Failed to copy to clipboard.", "stderr");
    }
  }

  return (
    <>
      <TabHelp>{t("diag.help")}</TabHelp>

      {/* mode toggle */}
      <div className="mb-3 flex gap-1 rounded-lg bg-[var(--color-surface-2)] p-1">
        {(["simple", "technical"] as Mode[]).map((m) => (
          <button
            key={m}
            title={t(m === "simple" ? "diag.mode.simpleHint" : "diag.mode.technicalHint")}
            onClick={() => setMode(m)}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
              mode === m
                ? "bg-[var(--color-surface)] text-[var(--color-brand-600)] shadow-sm"
                : "text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
            }`}
          >
            {t(m === "simple" ? "diag.mode.simple" : "diag.mode.technical")}
          </button>
        ))}
      </div>

      <Button
        size="block"
        variant="primary"
        disabled={loading}
        title={t("diag.scanAllHint")}
        onClick={scan}
      >
        <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        {loading ? t("diag.scanning") : t("diag.scanAll")}
      </Button>

      {report && (
        <div className="mt-3">
          {/* SCORE */}
          {score && <ScoreGauge score={score.score} band={score.band} />}

          {mode === "simple" ? (
            <SimpleView report={report} />
          ) : (
            <TechnicalView report={report} />
          )}

          {/* hardware checklist (both modes) */}
          <Section title={t("diag.check.title")}>
            <p className="mb-1 text-[11px] leading-snug text-[var(--color-ink-faint)]">
              {t("diag.check.intro")}
            </p>
            {CHECKS.map((item) => {
              const st = checks[item.id] ?? "untested";
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5"
                >
                  <span className="min-w-0 flex-1" title={t(item.hintKey)}>
                    <span className="block text-[12px] font-medium text-[var(--color-ink)]">
                      {t(item.labelKey)}
                    </span>
                  </span>
                  <Button size="sm" title={t(item.hintKey)} onClick={() => runCheck(item)}>
                    {t("diag.check.run")}
                  </Button>
                  <button
                    title={t("diag.check.pass")}
                    onClick={() => setCheck(item.id, "pass")}
                    className={`no-drag rounded-md p-1 ${st === "pass" ? "text-emerald-500" : "text-[var(--color-ink-faint)] hover:text-emerald-500"}`}
                  >
                    <CheckCircle2 size={16} />
                  </button>
                  <button
                    title={t("diag.check.fail")}
                    onClick={() => setCheck(item.id, "fail")}
                    className={`no-drag rounded-md p-1 ${st === "fail" ? "text-[var(--color-danger)]" : "text-[var(--color-ink-faint)] hover:text-[var(--color-danger)]"}`}
                  >
                    <XCircle size={16} />
                  </button>
                </div>
              );
            })}
          </Section>

          {/* built-in diagnostics launcher */}
          <Section title={t("diag.builtin.title")}>
            <p className="mb-1 text-[11px] leading-snug text-[var(--color-ink-faint)]">
              {t("diag.builtin.intro")}
            </p>
            {DIAG_CODES.map((d) => (
              <div
                key={d.code}
                className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5"
              >
                <Phone size={14} className="shrink-0 text-[var(--color-brand-600)]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-medium text-[var(--color-ink)]">
                    {t(d.labelKey)}
                  </span>
                  <span className="block font-mono text-[11px] text-[var(--color-ink-faint)]">
                    {d.code}
                  </span>
                </span>
                <Button
                  size="sm"
                  title={t("diag.builtin.tryHint")}
                  onClick={() => {
                    if (!guard()) return;
                    push(t("diag.builtin.dialCode", { code: d.code }), "system");
                    runCapture("adb", [
                      "shell",
                      "am",
                      "start",
                      "-a",
                      "android.intent.action.DIAL",
                      "-d",
                      `tel:${encodeURIComponent(d.code)}`,
                    ]).catch((e) => push(String(e), "stderr"));
                  }}
                >
                  {t("diag.builtin.try")}
                </Button>
              </div>
            ))}
            <p className="text-[10.5px] leading-snug text-[var(--color-ink-faint)]">
              {t("diag.builtin.manual")}
            </p>
            <p className="text-[10.5px] leading-snug text-[var(--color-ink-faint)]">
              {t("diag.builtin.note")}
            </p>
          </Section>

          <Button size="block" title={t("diag.copyHint")} onClick={copyAll}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? t("common.copied") : t("diag.copyAll")}
          </Button>

          {/* how the score is calculated — transparency */}
          <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-brand-600)]">
              {t("diag.formula.title")}
            </div>
            <p className="mb-2 text-[10.5px] leading-snug text-[var(--color-ink-soft)]">
              {t("diag.formula.intro")}
            </p>
            <ul className="flex flex-col gap-1 text-[10.5px] leading-snug text-[var(--color-ink-soft)]">
              {(
                [
                  "diag.formula.battery",
                  "diag.formula.auth",
                  "diag.formula.sensors",
                  "diag.formula.checklist",
                ] as TKey[]
              ).map((k) => (
                <li key={k} className="flex gap-1.5">
                  <span className="mt-[2px] shrink-0 text-[var(--color-brand-600)]">•</span>
                  <span>{t(k)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10.5px] font-medium leading-snug text-[var(--color-ink-faint)]">
              {t("diag.formula.bands")}
            </p>
          </div>
        </div>
      )}
    </>
  );
}

// ─── score gauge ──────────────────────────────────────────────────────────

function ScoreGauge({ score, band }: { score: number; band: string }) {
  const { t } = useI18n();
  const color =
    band === "excellent"
      ? "#10b981"
      : band === "good"
        ? "#22c55e"
        : band === "fair"
          ? "#f59e0b"
          : "#ef4444";
  const bandKey = `diag.score.${band}` as TKey;
  return (
    <div className="mb-3 flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-sm">
      <div
        className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full"
        style={{ background: `conic-gradient(${color} ${score * 3.6}deg, var(--color-surface-2) 0deg)` }}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-surface)]">
          <span className="text-[15px] font-bold" style={{ color }}>
            {score}
          </span>
        </div>
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
          {t("diag.score.title")}
        </div>
        <div className="text-[15px] font-bold" style={{ color }}>
          {t(bandKey)}
        </div>
        <p className="mt-0.5 text-[10px] leading-snug text-[var(--color-ink-faint)]">
          {t("diag.score.hint")}
        </p>
      </div>
    </div>
  );
}

// ─── simple view ────────────────────────────────────────────────────────────

function Card({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Battery;
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
    <div className="flex items-center justify-between gap-2">
      <span className="text-[var(--color-ink-faint)]">{k}</span>
      <span className={`text-right ${strong ? "font-semibold text-[var(--color-ink)]" : "text-[var(--color-ink-soft)]"}`}>
        {v}
      </span>
    </div>
  );
}

type Tone = "ok" | "warn" | "bad" | "neutral";
function AuthRow({ k, v, tone }: { k: string; v: string; tone: Tone }) {
  const color =
    tone === "ok"
      ? "text-emerald-600"
      : tone === "warn"
        ? "text-amber-600"
        : tone === "bad"
          ? "text-[var(--color-danger-600)]"
          : "text-[var(--color-ink-soft)]";
  const dot =
    tone === "ok"
      ? "bg-emerald-500"
      : tone === "warn"
        ? "bg-amber-500"
        : tone === "bad"
          ? "bg-[var(--color-danger)]"
          : "bg-slate-300";
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[var(--color-ink-faint)]">{k}</span>
      <span className={`flex items-center gap-1.5 text-right font-medium ${color}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {v}
      </span>
    </div>
  );
}

/** The split "System & Authenticity" rows — bootloader, root, ROM, integrity… */
function AuthRows({ report }: { report: DiagnosticReport }) {
  const { t } = useI18n();
  const s = report.system;

  const bl =
    s.bootloader === "locked"
      ? { v: t("diag.auth.bl.locked"), tone: "ok" as Tone }
      : s.bootloader === "unlocked"
        ? { v: t("diag.auth.bl.unlocked"), tone: "bad" as Tone }
        : { v: t("diag.auth.bl.unknown"), tone: "neutral" as Tone };

  const vb = {
    v: s.verifiedBoot,
    tone: (s.verifiedBoot === "green"
      ? "ok"
      : s.verifiedBoot === "unknown"
        ? "neutral"
        : "bad") as Tone,
  };

  const root = s.rooted
    ? { v: s.rootManager === "unknown" ? t("diag.yes") : s.rootManager, tone: "bad" as Tone }
    : { v: t("diag.auth.root.none"), tone: "ok" as Tone };

  const rom = s.customRom.isCustom
    ? { v: s.customRom.name, tone: "warn" as Tone }
    : { v: t("diag.auth.rom.stock"), tone: "ok" as Tone };

  const intMap: Record<string, { v: string; tone: Tone }> = {
    "likely-pass": { v: t("diag.auth.int.pass"), tone: "ok" },
    "likely-fail": { v: t("diag.auth.int.fail"), tone: "bad" },
    spoofed: { v: t("diag.auth.int.spoofed"), tone: "warn" },
    unknown: { v: t("diag.auth.int.unknown"), tone: "neutral" },
  };
  const integ = intMap[s.integrityNote];

  return (
    <>
      <AuthRow k={t("diag.auth.bootloader")} v={bl.v} tone={bl.tone} />
      <AuthRow k={t("diag.auth.verifiedBoot")} v={vb.v} tone={vb.tone} />
      <AuthRow k={t("diag.auth.root")} v={root.v} tone={root.tone} />
      <AuthRow k={t("diag.auth.rom")} v={rom.v} tone={rom.tone} />
      <AuthRow k={t("diag.auth.integrity")} v={integ.v} tone={integ.tone} />
      <AuthRow
        k={t("diag.auth.selinux")}
        v={report.system.selinux}
        tone={/enforcing/i.test(report.system.selinux) ? "ok" : "warn"}
      />
      <AuthRow k={t("diag.sys.securityPatch")} v={report.system.securityPatch} tone="neutral" />
      <p className="mt-1 text-[10px] leading-snug text-[var(--color-ink-faint)]">
        {t("diag.auth.int.note")}
      </p>
      {s.hasIntegrityModule && (
        <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-[10px] leading-snug text-amber-700">
          {t("diag.auth.spoofWarn")}
        </p>
      )}
    </>
  );
}

function SimpleView({ report }: { report: DiagnosticReport }) {
  const { t } = useI18n();
  const b = report.battery;
  const bandText =
    b.healthPct == null
      ? null
      : b.healthPct >= 85
        ? t("diag.bat.h.good")
        : b.healthPct >= 70
          ? t("diag.bat.h.fair")
          : t("diag.bat.h.poor");

  return (
    <>
      <Card icon={Battery} title={t("diag.card.battery")}>
        {b.healthPct != null ? (
          <KV k={t("diag.bat.health")} v={t("diag.bat.healthFromCap", { pct: b.healthPct })} strong />
        ) : (
          <>
            <KV k={t("diag.bat.healthRaw")} v={b.healthRaw} strong />
            <p className="text-[10px] leading-snug text-[var(--color-ink-faint)]">
              {t("diag.bat.noCap")}
            </p>
          </>
        )}
        {b.designCapacity != null && <KV k={t("diag.bat.design")} v={fmtUAh(b.designCapacity)} />}
        {b.maxCapacity != null && <KV k={t("diag.bat.current")} v={fmtUAh(b.maxCapacity)} />}
        <KV k={t("diag.bat.level")} v={b.level != null ? `${b.level}%` : "—"} />
        <KV k={t("diag.bat.temp")} v={b.tempC != null ? `${b.tempC}°C` : "—"} />
        {bandText && (
          <p className="mt-1 text-[10.5px] leading-snug text-[var(--color-ink-faint)]">{bandText}</p>
        )}
      </Card>

      <Card icon={ShieldCheck} title={t("diag.card.system")}>
        <AuthRows report={report} />
        <p className="mt-1 text-[10.5px] leading-snug text-[var(--color-ink-faint)]">{t("diag.auth.h")}</p>
      </Card>

      <Row>
        <Card icon={Smartphone} title={t("diag.card.screen")}>
          <KV k={t("diag.scr.resolution")} v={report.screen.resolution} />
          <KV k={t("diag.scr.refresh")} v={report.screen.refreshHz} />
          <KV k={t("diag.scr.nits")} v={report.screen.maxNits} />
        </Card>
        <Card icon={Cpu} title={t("diag.card.cpu")}>
          <KV k={t("diag.cpu.cores")} v={report.cpu.cores != null ? String(report.cpu.cores) : "—"} />
          <KV k={t("diag.cpu.chipset")} v={report.cpu.chipset} />
          <KV
            k={t("diag.card.camera")}
            v={report.camera.count != null ? String(report.camera.count) : "—"}
          />
        </Card>
      </Row>

      <Row>
        <Card icon={MemoryStick} title={t("diag.card.memory")}>
          <KV k={t("diag.mem.total")} v={fmtKb(report.memory.totalKb)} strong />
          <KV k={t("diag.mem.available")} v={fmtKb(report.memory.availKb)} />
        </Card>
        <Card icon={HardDrive} title={t("diag.card.storage")}>
          <KV k={t("diag.sto.total")} v={fmtKb(report.storage.totalKb)} strong />
          <KV k={t("diag.sto.free")} v={fmtKb(report.storage.freeKb)} />
        </Card>
      </Row>

      <Card icon={Radar} title={t("diag.card.sensors")}>
        <p className="mb-1 text-[10.5px] text-[var(--color-ink-faint)]">
          {t("diag.sensors.detected", { n: report.sensors.totalCount })}
        </p>
        <div className="flex flex-wrap gap-1">
          {SENSOR_KEYS.map((k) => {
            const ok = report.sensors.present[k];
            const optional = OPTIONAL_SENSORS.includes(k);
            // present → green; missing core → red; missing optional → neutral gray
            const cls = ok
              ? "bg-emerald-50 text-emerald-600"
              : optional
                ? "bg-[var(--color-surface-2)] text-[var(--color-ink-faint)]"
                : "bg-rose-50 text-rose-500";
            return (
              <span
                key={k}
                className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
              >
                {ok ? <CheckCircle2 size={10} /> : optional ? <Circle size={10} /> : <XCircle size={10} />}
                {t(SENSOR_LABEL[k])}
              </span>
            );
          })}
        </div>
        <p className="mt-1 text-[10px] leading-snug text-[var(--color-ink-faint)]">
          {t("diag.sensors.optionalNote")}
        </p>
      </Card>
    </>
  );
}

// ─── technical view ─────────────────────────────────────────────────────────

function TechnicalView({ report }: { report: DiagnosticReport }) {
  const { t } = useI18n();
  const b = report.battery;
  return (
    <>
      <Section title={t("diag.section.identity")}>
        <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
          {PROPS.map((p, i) => (
            <div
              key={p.key}
              title={t(p.hintKey)}
              className={`flex items-start gap-2 px-3 py-1.5 text-[12px] ${i % 2 ? "bg-[var(--color-bg)]" : "bg-[var(--color-surface)]"}`}
            >
              <span className="w-[120px] shrink-0 text-[var(--color-ink-faint)]">{t(p.labelKey)}</span>
              <span className="min-w-0 flex-1 break-words font-medium text-[var(--color-ink)]">
                {report.system.props.get(p.key) || "—"}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t("diag.card.battery")}>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-[11.5px]">
          <KV k={t("diag.bat.design")} v={fmtUAh(b.designCapacity)} />
          <KV k={t("diag.bat.current")} v={fmtUAh(b.maxCapacity)} />
          <KV k={t("diag.bat.health")} v={b.healthPct != null ? `${b.healthPct}%` : "—"} strong />
          <KV k={t("diag.bat.level")} v={b.level != null ? `${b.level}%` : "—"} />
          <KV k={t("diag.bat.temp")} v={b.tempC != null ? `${b.tempC}°C` : "—"} />
          <KV k={t("diag.bat.voltage")} v={b.voltage != null ? `${b.voltage} mV` : "—"} />
          <KV k={t("diag.bat.tech")} v={b.technology} />
          <KV k={t("diag.bat.status")} v={b.statusText} />
          <KV k={t("diag.bat.healthRaw")} v={b.healthRaw} />
        </div>
      </Section>

      <Section title={t("diag.card.cpu")}>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-[11.5px]">
          <KV k={t("diag.cpu.cores")} v={report.cpu.cores != null ? String(report.cpu.cores) : "—"} />
          <KV k={t("diag.cpu.chipset")} v={report.cpu.chipset} />
          <KV k={t("diag.cpu.abi")} v={report.cpu.abi} />
          <KV k={t("diag.card.camera")} v={report.camera.count != null ? String(report.camera.count) : "—"} />
          <KV k={t("diag.scr.resolution")} v={report.screen.resolution} />
          <KV k={t("diag.scr.density")} v={report.screen.density} />
          <KV k={t("diag.scr.refresh")} v={report.screen.refreshHz} />
          <KV k={t("diag.scr.nits")} v={report.screen.maxNits} />
          <KV k={t("diag.scr.cutout")} v={report.screen.cutout === "yes" ? t("diag.yes") : t("diag.no")} />
          <KV k={t("diag.mem.total")} v={fmtKb(report.memory.totalKb)} />
          <KV k={t("diag.sto.total")} v={fmtKb(report.storage.totalKb)} />
          <KV k={t("diag.sto.free")} v={fmtKb(report.storage.freeKb)} />
          <KV k={t("diag.sys.uptime")} v={report.system.uptime} />
          <KV k={t("diag.sys.securityPatch")} v={report.system.securityPatch} />
          <KV k={t("diag.sys.buildDate")} v={report.system.buildDate} />
          <KV k={t("diag.sys.encrypted")} v={report.system.encrypted} />
          <KV k={t("diag.sys.rooted")} v={report.system.rooted ? t("diag.yes") : t("diag.no")} />
        </div>
      </Section>

      <Section title={t("diag.section.kernel")}>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-[11px] leading-relaxed">
          <div className="mb-2">
            <span className="text-[var(--color-ink-faint)]">{t("diag.kernel")}:</span>
            <div className="mt-0.5 break-words font-mono text-[10.5px] text-[var(--color-ink)]">
              {report.system.kernel}
            </div>
          </div>
          <div>
            <span className="text-[var(--color-ink-faint)]">{t("diag.selinux")}:</span>{" "}
            <span className="font-medium text-[var(--color-ink)]">{report.system.selinux}</span>
            <span className="ml-1 text-[var(--color-ink-faint)]">{t("diag.selinuxNote")}</span>
          </div>
        </div>
      </Section>

      {report.rootModules.length > 0 && (
        <Section title={t("diag.modules.title")}>
          <p className="mb-1 text-[10.5px] leading-snug text-[var(--color-ink-faint)]">
            {t("diag.modules.intro")}
          </p>
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            {report.rootModules.map((m, i) => (
              <div
                key={m.id}
                className={`flex items-center gap-2 px-3 py-1.5 text-[11.5px] ${i % 2 ? "bg-[var(--color-bg)]" : "bg-[var(--color-surface)]"}`}
                title={m.id}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-[var(--color-ink)]">{m.name}</span>
                  <span className="block truncate font-mono text-[10px] text-[var(--color-ink-faint)]">
                    {m.id} · {m.version}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                    m.enabled ? "bg-emerald-50 text-emerald-600" : "bg-[var(--color-surface-2)] text-[var(--color-ink-faint)]"
                  }`}
                >
                  {m.enabled ? t("common.on") : t("common.off")}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {report.system.rooted && <FileBrowser />}
    </>
  );
}

// ─── read-only file browser ─────────────────────────────────────────────────

function FileBrowser() {
  const { t } = useI18n();
  const [path, setPath] = useState("/data/adb/modules");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileBody, setFileBody] = useState("");

  async function load(p: string) {
    setLoading(true);
    setFileName(null);
    try {
      setEntries(await listDir(p));
      setPath(p);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function joinPath(base: string, name: string) {
    return base.endsWith("/") ? base + name : `${base}/${name}`;
  }
  function parentOf(p: string) {
    const trimmed = p.replace(/\/+$/, "");
    const idx = trimmed.lastIndexOf("/");
    return idx <= 0 ? "/" : trimmed.slice(0, idx);
  }

  async function openEntry(e: FsEntry) {
    if (e.isDir) {
      load(joinPath(path, e.name));
    } else {
      setLoading(true);
      try {
        const body = await readDeviceFile(joinPath(path, e.name));
        setFileName(e.name);
        // crude binary guard: lots of non-printable chars
        const nonPrintable = (body.match(/[^\x09\x0a\x0d\x20-\x7e]/g) || []).length;
        setFileBody(nonPrintable > body.length * 0.3 ? "" : body);
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <Section title={t("diag.fs.title")}>
      <p className="mb-1 text-[10.5px] leading-snug text-[var(--color-ink-faint)]">
        {t("diag.fs.intro")}
      </p>

      {/* path bar */}
      <div className="mb-1 flex items-center gap-1">
        <button
          onClick={() => load(parentOf(path))}
          title={t("diag.fs.up")}
          className="no-drag flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-2)]"
        >
          <ChevronLeft size={12} /> {t("diag.fs.up")}
        </button>
        <span className="min-w-0 flex-1 truncate rounded-md bg-[var(--color-surface-2)] px-2 py-1 font-mono text-[10.5px] text-[var(--color-ink-soft)]">
          {path}
        </span>
      </div>

      {fileName ? (
        <div className="rounded-lg border border-[var(--color-border)]">
          <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5">
            <FileText size={13} className="text-[var(--color-brand-600)]" />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--color-ink)]">
              {fileName}
            </span>
            <button
              onClick={() => setFileName(null)}
              className="no-drag rounded px-1.5 py-0.5 text-[10px] text-[var(--color-ink-soft)] hover:bg-[var(--color-bg)]"
            >
              {t("diag.fs.close")}
            </button>
          </div>
          <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-[10.5px] leading-snug text-[var(--color-ink)]">
            {fileBody || t("diag.fs.binary")}
          </pre>
        </div>
      ) : (
        <div className="max-h-[260px] overflow-auto rounded-lg border border-[var(--color-border)]">
          {loading ? (
            <div className="px-3 py-3 text-[11px] text-[var(--color-ink-faint)]">
              {t("common.loading")}
            </div>
          ) : entries.length === 0 ? (
            <div className="px-3 py-3 text-[11px] text-[var(--color-ink-faint)]">
              {t("diag.fs.empty")}
            </div>
          ) : (
            entries.map((e) => (
              <button
                key={e.name}
                onClick={() => openEntry(e)}
                className="flex w-full items-center gap-2 border-b border-[var(--color-border)] px-3 py-1.5 text-left text-[11.5px] last:border-0 hover:bg-[var(--color-bg)]"
              >
                {e.isDir ? (
                  <Folder size={13} className="shrink-0 text-amber-500" />
                ) : (
                  <FileText size={13} className="shrink-0 text-[var(--color-ink-faint)]" />
                )}
                <span className="min-w-0 flex-1 truncate font-mono text-[var(--color-ink)]">
                  {e.name}
                </span>
                {!e.isDir && e.size != null && (
                  <span className="shrink-0 text-[9.5px] text-[var(--color-ink-faint)]">
                    {e.size} B
                  </span>
                )}
                <span className="shrink-0 font-mono text-[9px] text-[var(--color-ink-faint)]">
                  {e.perms}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </Section>
  );
}
