import { useState } from "react";
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
  FolderOpen,
  Package,
  ExternalLink,
  Download,
  Loader2,
  Scale,
  BadgeCheck,
} from "lucide-react";
import { Button } from "../ui/Button";
import { Section, TabHelp } from "../ui/Section";
import { LicenseModal } from "../LicenseModal";
import { runCapture, installApk } from "../../lib/api";
import { useLog } from "../../state/log";
import { useDevice } from "../../state/device";
import { useDiagnostic } from "../../state/diagnostic";
import { useI18n, type TKey } from "../../i18n";
import {
  runDiagnosticScan,
  computeScore,
  fmtKb,
  fmtUAh,
  SENSOR_KEYS,
  OPTIONAL_SENSORS,
  type DiagnosticReport,
  type SensorKey,
  type IntegrityTier,
} from "../../lib/diagnostics";

type Mode = "simple" | "technical";

/** A plausible µAh battery capacity (Qualcomm charge_full*) is ~1–10 million.
 * MediaTek energy_full* values are a different unit, so we only show the mAh
 * capacity rows when the number is in the µAh range. */
function isUAh(v: number | null): v is number {
  return v != null && v >= 1_000_000 && v <= 20_000_000;
}

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
  /** optional adb trigger to actually exercise the hardware (e.g. buzz motor) */
  trigger?: string[];
  /**
   * optional adb action that makes SOMETHING show up on the phone so the user
   * can run the physical test (open the camera for the flashlight, open the
   * NFC settings screen, launch a tone, …). Shown as an "Open on phone" button.
   */
  open?: { label: TKey; args: string[] };
  /** only offer this check when the sensor/feature is actually present */
  requires?: SensorKey;
  /**
   * an open-source app that performs this test (e.g. InjuredPixels for dead
   * pixels / touch). Shows an "Open app" button; if it isn't installed yet we
   * install the bundled APK first. `pkg` is the Android package to launch.
   */
  app?: { apk: string; pkg: string };
  /** show a small "needs app" hint — this test is best run with a test app. */
  appHint?: boolean;
}
const CHECKS: CheckItem[] = [
  {
    id: "vibrate",
    labelKey: "diag.check.vibrate",
    hintKey: "diag.check.vibrateHint",
    trigger: ["shell", "cmd", "vibrator_manager", "synced", "oneshot", "800"],
  },
  {
    id: "flashlight",
    labelKey: "diag.check.flashlight",
    hintKey: "diag.check.flashlightHint",
    // no universal ADB torch toggle; open the camera so the user can tap torch
    open: { label: "diag.check.openCamera", args: ["shell", "am", "start", "-a", "android.media.action.STILL_IMAGE_CAMERA"] },
  },
  {
    id: "speaker",
    labelKey: "diag.check.speaker",
    hintKey: "diag.check.speakerHint",
    // open the sound settings so the user can play a ringtone/tone
    open: { label: "diag.check.openSound", args: ["shell", "am", "start", "-a", "android.settings.SOUND_SETTINGS"] },
  },
  {
    id: "screenColors",
    labelKey: "diag.check.screenColors",
    hintKey: "diag.check.screenColorsHint",
    // InjuredPixels fills the screen with solid colors — perfect for dead pixels
    app: { apk: "injuredpixels", pkg: "com.aurelitec.injuredpixels" },
    appHint: true,
  },
  {
    id: "touch",
    labelKey: "diag.check.touch",
    hintKey: "diag.check.touchHint",
    // InjuredPixels' full-screen canvas also works for sweeping the touch area
    app: { apk: "injuredpixels", pkg: "com.aurelitec.injuredpixels" },
    appHint: true,
  },
  {
    id: "fingerprint",
    labelKey: "diag.check.fingerprint",
    hintKey: "diag.check.fingerprintHint",
    requires: "fingerprint",
    open: { label: "diag.check.openSecurity", args: ["shell", "am", "start", "-a", "android.settings.SECURITY_SETTINGS"] },
  },
  {
    id: "nfc",
    labelKey: "diag.check.nfc",
    hintKey: "diag.check.nfcHint",
    requires: "nfc",
    open: { label: "diag.check.openNfc", args: ["shell", "am", "start", "-a", "android.settings.NFC_SETTINGS"] },
  },
  {
    id: "sensors",
    labelKey: "diag.check.sensors",
    hintKey: "diag.check.sensorsHint",
    // developer "Sensors Off" tile lives in dev settings; open dev options as a
    // starting point. The recommended path is a sensor-test app (below).
    open: { label: "diag.check.openDev", args: ["shell", "am", "start", "-a", "android.settings.APPLICATION_DEVELOPMENT_SETTINGS"] },
    appHint: true,
  },
];

/**
 * Recommended FOSS, ad-free hardware-test apps (open-source on GitHub / F-Droid).
 * We never bundle or auto-download an APK silently — each row opens the app's
 * page so the user installs it themselves from a source they trust.
 */
interface TestApp {
  name: string;
  descKey: TKey;
  /** page to open in the desktop browser */
  url: string;
  /** bundled APK short id → enables the one-tap "Install via USB" button */
  apk?: string;
}
const TEST_APPS: TestApp[] = [
  {
    name: "Hardware Testing (FOSS)",
    descKey: "diag.apps.hwtest",
    url: "https://github.com/rohanagarwal94/Hardware-testing",
    apk: "hardware-test",
  },
  {
    name: "InjuredPixels",
    descKey: "diag.apps.injured",
    url: "https://github.com/aurelitec/injuredpixels-android",
    apk: "injuredpixels",
  },
  {
    name: "Open Sensor Test",
    descKey: "diag.apps.sensor",
    url: "https://github.com/JFMG/Open-Sensor-Test",
  },
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
  const [showLicenses, setShowLicenses] = useState(false);

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
      push(t("diag.check.manualHint", { name: t(item.labelKey) }), "system");
    }
  }

  // Launch an activity/settings screen on the phone so the user can run the
  // physical test (camera for torch, NFC settings, sound settings, …).
  async function openOnPhone(args: string[], label: string) {
    if (!guard()) return;
    push(t("diag.check.opening", { what: label }), "system");
    try {
      await runCapture("adb", args);
    } catch (e) {
      push(String(e), "stderr");
    }
  }

  // Open a test-app page in the desktop browser.
  async function openTestAppPage(url: string) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } catch (e) {
      push(String(e), "stderr");
    }
  }

  // Install a bundled FOSS test APK over USB via adb.
  const [installing, setInstalling] = useState<string | null>(null);

  // Open an app on the phone for a hardware test; install the bundled APK
  // first if it isn't present yet. Used by screen/touch checks (InjuredPixels).
  async function openCheckApp(apk: string, pkg: string) {
    if (!guard()) return;
    setInstalling(apk);
    try {
      const pkgs = await runCapture("adb", ["shell", "pm", "list", "packages", pkg]);
      if (!pkgs.includes(pkg)) {
        push(t("diag.apps.installing", { name: pkg }), "system");
        await installApk(apk);
      }
      // launch the app's launcher activity
      await runCapture("adb", ["shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"]);
      push(t("diag.check.appOpened", { pkg }), "system");
    } catch (e) {
      push(String(e), "stderr");
    } finally {
      setInstalling(null);
    }
  }
  async function installTestApp(apk: string, name: string) {
    if (!guard()) return;
    setInstalling(apk);
    push(t("diag.apps.installing", { name }), "system");
    try {
      const out = await installApk(apk);
      push(t("diag.apps.installed", { name }) + (out ? ` (${out})` : ""), "system");
    } catch (e) {
      push(t("diag.apps.installFail", { name }) + `: ${String(e)}`, "stderr");
    } finally {
      setInstalling(null);
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
      {showLicenses && <LicenseModal mode="info" onClose={() => setShowLicenses(false)} />}

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
          <Section>
            {(() => {
              const visible = CHECKS.filter(
                (item) => !(item.requires && report && !report.sensors.present[item.requires]),
              );
              const withAction = visible.filter((i) => i.trigger || i.open || i.app);
              const manualOnly = visible.filter((i) => !i.trigger && !i.open && !i.app);

              // progress summary across all visible checks
              const total = visible.length;
              const nPass = visible.filter((i) => (checks[i.id] ?? "untested") === "pass").length;
              const nFail = visible.filter((i) => (checks[i.id] ?? "untested") === "fail").length;
              const nTodo = total - nPass - nFail;

              const StatusButtons = ({ id }: { id: string }) => {
                const st = checks[id] ?? "untested";
                return (
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      title={t("diag.check.pass")}
                      onClick={() => setCheck(id, "pass")}
                      className={`no-drag rounded-md p-1 ${st === "pass" ? "text-emerald-500" : "text-[var(--color-ink-faint)] hover:text-emerald-500"}`}
                    >
                      <CheckCircle2 size={16} />
                    </button>
                    <button
                      title={t("diag.check.fail")}
                      onClick={() => setCheck(id, "fail")}
                      className={`no-drag rounded-md p-1 ${st === "fail" ? "text-[var(--color-danger)]" : "text-[var(--color-ink-faint)] hover:text-[var(--color-danger)]"}`}
                    >
                      <XCircle size={16} />
                    </button>
                  </div>
                );
              };

              return (
                <div className="space-y-3">
                  {/* header: title, then a live progress summary on its own row
                      (stacked so the 330px column never wraps the title) */}
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-brand-600)]">
                      {t("diag.check.title")}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] font-medium">
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-600">
                        {t("diag.check.sumOk", { n: nPass, total })}
                      </span>
                      <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[var(--color-danger-600)]">
                        {t("diag.check.sumFail", { n: nFail })}
                      </span>
                      <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[var(--color-ink-faint)]">
                        {t("diag.check.sumTodo", { n: nTodo })}
                      </span>
                    </div>
                  </div>
                  <p className="text-[11px] leading-snug text-[var(--color-ink-faint)]">
                    {t("diag.check.intro")}
                  </p>

                  {withAction.length > 0 && (
                    <div>
                      <div className="mb-1 px-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
                        {t("diag.check.groupAuto")}
                      </div>
                      <div className="space-y-1.5">
                        {withAction.map((item) => (
                          <div
                            key={item.id}
                            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2"
                          >
                            <div className="flex items-center gap-2">
                              <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] font-medium text-[var(--color-ink)]" title={t(item.hintKey)}>
                                <span className="truncate">{t(item.labelKey)}</span>
                                {item.appHint && (
                                  <span className="shrink-0 rounded bg-[var(--color-brand-50)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--color-brand-600)]">
                                    {t("diag.check.needsApp")}
                                  </span>
                                )}
                              </span>
                              <StatusButtons id={item.id} />
                            </div>
                            <div className="mt-1.5 flex gap-1.5">
                              {item.trigger && (
                                <Button size="sm" className="flex-1" title={t(item.hintKey)} onClick={() => runCheck(item)}>
                                  {t("diag.check.run")}
                                </Button>
                              )}
                              {item.open && (
                                <Button
                                  size="sm"
                                  className="flex-1"
                                  title={t("diag.check.openHint")}
                                  onClick={() => openOnPhone(item.open!.args, t(item.open!.label))}
                                >
                                  <Smartphone size={13} />
                                  {t(item.open.label)}
                                </Button>
                              )}
                              {item.app && (
                                <Button
                                  size="sm"
                                  className="flex-1"
                                  title={t("diag.check.openAppHint")}
                                  disabled={installing === item.app.apk}
                                  onClick={() => openCheckApp(item.app!.apk, item.app!.pkg)}
                                >
                                  {installing === item.app.apk ? (
                                    <Loader2 size={13} className="animate-spin" />
                                  ) : (
                                    <Package size={13} />
                                  )}
                                  {t("diag.check.openApp")}
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* group 2: purely manual checks (no button — test on the phone) */}
                  {manualOnly.length > 0 && (
                    <div>
                      <div className="mb-1 px-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
                        {t("diag.check.groupManual")}
                      </div>
                      <div className="space-y-1.5">
                        {manualOnly.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2"
                            title={t(item.hintKey)}
                          >
                            <span className="min-w-0 flex-1 text-[12px] font-medium text-[var(--color-ink)]">
                              {t(item.labelKey)}
                            </span>
                            <StatusButtons id={item.id} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </Section>

          {/* recommended FOSS hardware-test apps (open-source, no ads) */}
          <Section title={t("diag.apps.title")}>
            <p className="mb-1 text-[11px] leading-snug text-[var(--color-ink-faint)]">
              {t("diag.apps.intro")}
            </p>
            {TEST_APPS.map((app) => (
              <div
                key={app.name}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2"
              >
                {/* name + description stacked, full width */}
                <div className="flex items-start gap-2">
                  <Package size={14} className="mt-0.5 shrink-0 text-[var(--color-brand-600)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-medium text-[var(--color-ink)]">{app.name}</span>
                    <span className="block text-[10.5px] leading-snug text-[var(--color-ink-faint)]">
                      {t(app.descKey)}
                    </span>
                  </span>
                </div>
                {/* buttons: 50:50 when both exist, full width when only "open page" */}
                <div className="mt-1.5 flex gap-1.5">
                  {app.apk && (
                    <Button
                      size="sm"
                      variant="primary"
                      className="flex-1"
                      title={t("diag.apps.installHint")}
                      disabled={installing === app.apk}
                      onClick={() => installTestApp(app.apk!, app.name)}
                    >
                      {installing === app.apk ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Download size={13} />
                      )}
                      {t("diag.apps.install")}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="flex-1"
                    title={t("diag.apps.openHint")}
                    onClick={() => openTestAppPage(app.url)}
                  >
                    <ExternalLink size={13} />
                    {t("diag.apps.open")}
                  </Button>
                </div>
              </div>
            ))}
            <p className="text-[10.5px] leading-snug text-[var(--color-ink-faint)]">
              {t("diag.apps.note")}
            </p>
            <Button size="sm" variant="ghost" className="mt-1" onClick={() => setShowLicenses(true)}>
              <Scale size={13} />
              {t("terms.openInfo")}
            </Button>
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
    <div className="flex items-start justify-between gap-2">
      <span className="shrink-0 pt-px text-[var(--color-ink-faint)]">{k}</span>
      <span className={`flex items-start gap-1.5 text-right font-medium ${color}`}>
        <span className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        <span className="break-words">{v}</span>
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

  const tierMap: Record<IntegrityTier, { v: string; tone: Tone }> = {
    pass: { v: t("diag.auth.int.pass"), tone: "ok" },
    fail: { v: t("diag.auth.int.fail"), tone: "bad" },
    spoofed: { v: t("diag.auth.int.spoofed"), tone: "warn" },
    unknown: { v: t("diag.auth.int.unknown"), tone: "neutral" },
  };
  const ig = s.integrity;

  // root-hiding: active (named module OR inferred from a too-clean boot state)
  const hiding = s.rootHiding;
  const hidingVal =
    hiding.state === "active"
      ? hiding.names.length > 0
        ? t("diag.auth.hiding.active", { list: hiding.names.join(", ") })
        : t("diag.auth.hiding.inferred")
      : t("diag.auth.hiding.none");

  return (
    <>
      <AuthRow k={t("diag.auth.bootloader")} v={bl.v} tone={bl.tone} />
      <AuthRow k={t("diag.auth.verifiedBoot")} v={vb.v} tone={vb.tone} />
      <AuthRow k={t("diag.auth.root")} v={root.v} tone={root.tone} />
      <AuthRow k={t("diag.auth.rom")} v={rom.v} tone={rom.tone} />
      <AuthRow k={t("diag.auth.int.basic")} v={tierMap[ig.basic].v} tone={tierMap[ig.basic].tone} />
      <AuthRow k={t("diag.auth.int.device")} v={tierMap[ig.device].v} tone={tierMap[ig.device].tone} />
      <AuthRow k={t("diag.auth.int.strong")} v={tierMap[ig.strong].v} tone={tierMap[ig.strong].tone} />
      {report.system.rooted && (
        <AuthRow
          k={t("diag.auth.hiding")}
          v={hidingVal}
          tone={hiding.state === "active" ? "warn" : "neutral"}
        />
      )}
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

/** Identity, firmware age, IMEI & warranty — practical info for used-phone checks. */
function IdentityCard({ report }: { report: DiagnosticReport }) {
  const { t } = useI18n();
  const { push } = useLog();
  const { device } = useDevice();
  const s = report.system;

  function guard(): boolean {
    if (!device.connected || device.mode !== "adb") {
      push(t("common.connectFirst"), "stderr");
      return false;
    }
    return true;
  }
  async function openExternal(url: string) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } catch (e) {
      push(String(e), "stderr");
    }
  }
  // show IMEI on the phone screen via the universal dial code *#06#
  function showImeiOnPhone() {
    if (!guard()) return;
    push(t("diag.id.imeiDialing"), "system");
    runCapture("adb", [
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.DIAL",
      "-d",
      "tel:" + encodeURIComponent("*#06#"),
    ]).catch((e) => push(String(e), "stderr"));
  }

  // firmware age estimate from the build epoch
  let ageText = "—";
  if (s.buildEpoch != null) {
    const months = Math.max(0, Math.round((Date.now() / 1000 - s.buildEpoch) / (30.44 * 86400)));
    const years = Math.floor(months / 12);
    const rem = months % 12;
    ageText =
      years > 0
        ? t("diag.id.ageYM", { y: years, m: rem })
        : t("diag.id.ageM", { m: months });
  }

  // brand-specific warranty / IMEI check pages
  const brand = (report.system.props.get("ro.product.brand") || report.system.props.get("ro.product.manufacturer") || "").toLowerCase();
  const warranty: { label: string; url: string } =
    brand.includes("samsung")
      ? { label: "Samsung", url: "https://www.samsung.com/us/support/warranty/" }
      : brand.includes("xiaomi") || brand.includes("redmi") || brand.includes("poco")
        ? { label: "Xiaomi", url: "https://www.mi.com/global/verify/" }
        : brand.includes("oppo")
          ? { label: "OPPO", url: "https://support.oppo.com/en/warranty-check/" }
          : brand.includes("vivo")
            ? { label: "vivo", url: "https://www.vivo.com/en/support/warranty" }
            : brand.includes("realme")
              ? { label: "realme", url: "https://www.realme.com/support/phonecheck" }
              : brand.includes("oneplus")
                ? { label: "OnePlus", url: "https://www.oneplus.com/support/warranty-check" }
                : { label: "", url: "" };

  return (
    <Card icon={BadgeCheck} title={t("diag.card.identity")}>
      <KV k={t("diag.id.serial")} v={s.serialNo} />
      <KV k={t("diag.id.imei")} v={s.imei || t("diag.id.imeiUnknown")} />
      <KV k={t("diag.id.buildDate")} v={s.buildDate} />
      <KV k={t("diag.id.fwAge")} v={ageText} />

      <div className="mt-2 flex flex-col gap-1.5">
        <Button size="sm" className="w-full" title={t("diag.id.showImeiHint")} onClick={showImeiOnPhone}>
          <Smartphone size={13} />
          {t("diag.id.showImei")}
        </Button>
        <Button
          size="sm"
          className="w-full"
          title={t("diag.id.checkImeiHint")}
          onClick={() => openExternal(s.imei ? `https://www.imei.info/?imei=${s.imei}` : "https://www.imei.info/")}
        >
          <ExternalLink size={13} />
          {t("diag.id.checkImei")}
        </Button>
        {warranty.url && (
          <Button
            size="sm"
            className="w-full"
            title={t("diag.id.checkWarrantyHint")}
            onClick={() => openExternal(warranty.url)}
          >
            <ExternalLink size={13} />
            {t("diag.id.checkWarranty", { brand: warranty.label })}
          </Button>
        )}
      </div>
      <p className="mt-1.5 text-[10px] leading-snug text-[var(--color-ink-faint)]">
        {t("diag.id.note")}
      </p>
    </Card>
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
          <KV k={t("diag.bat.healthRaw")} v={b.healthRaw} strong />
        )}
        {isUAh(b.designCapacity) && <KV k={t("diag.bat.design")} v={fmtUAh(b.designCapacity)} />}
        {isUAh(b.maxCapacity) && <KV k={t("diag.bat.current")} v={fmtUAh(b.maxCapacity)} />}
        <KV k={t("diag.bat.level")} v={b.level != null ? `${b.level}%` : "—"} />
        <KV k={t("diag.bat.temp")} v={b.tempC != null ? `${b.tempC}°C` : "—"} />
        <KV k={t("diag.bat.voltage")} v={b.voltage != null ? `${(b.voltage / 1000).toFixed(3)} V` : "—"} />
        <KV k={t("diag.bat.tech")} v={b.technology} />
        <KV k={t("diag.bat.status")} v={b.statusText} />
        {bandText && (
          <p className="mt-1 text-[10.5px] leading-snug text-[var(--color-ink-faint)]">{bandText}</p>
        )}
        {b.healthPct == null && (
          <p className="mt-1 text-[10px] leading-snug text-[var(--color-ink-faint)]">
            {t("diag.bat.noCap")}
          </p>
        )}
      </Card>

      <Card icon={ShieldCheck} title={t("diag.card.system")}>
        <AuthRows report={report} />
        <p className="mt-1 text-[10.5px] leading-snug text-[var(--color-ink-faint)]">{t("diag.auth.h")}</p>
      </Card>

      <IdentityCard report={report} />

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

      <Card icon={MemoryStick} title={t("diag.card.memory")}>
        <KV k={t("diag.mem.total")} v={fmtKb(report.memory.totalKb)} strong />
        <KV k={t("diag.mem.available")} v={fmtKb(report.memory.availKb)} />
      </Card>
      <Card icon={HardDrive} title={t("diag.card.storage")}>
        <KV k={t("diag.sto.total")} v={fmtKb(report.storage.totalKb)} strong />
        <KV k={t("diag.sto.free")} v={fmtKb(report.storage.freeKb)} />
      </Card>

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
          {isUAh(b.designCapacity) && <KV k={t("diag.bat.design")} v={fmtUAh(b.designCapacity)} />}
          {isUAh(b.maxCapacity) && <KV k={t("diag.bat.current")} v={fmtUAh(b.maxCapacity)} />}
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
          <KV k={t("diag.sys.temp")} v={report.system.maxTempC != null ? `${report.system.maxTempC}°C` : "—"} />
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

      {report.system.rooted && <FileBrowserLauncher />}
    </>
  );
}

// ─── read-only file browser ─────────────────────────────────────────────────

// ─── read-only file browser launcher (opens a separate window) ──────────────

function FileBrowserLauncher() {
  const { t } = useI18n();
  const { push } = useLog();

  async function openExplorer() {
    push("Opening File Explorer…", "system");
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const win = new WebviewWindow("explorer", {
      url: "index.html?view=explorer",
      title: "Droidbench File Explorer",
      width: 1000,
      height: 680,
      minWidth: 720,
      minHeight: 480,
      resizable: true,
      decorations: false,
      shadow: true,
      transparent: true,
    });
    win.once("tauri://error", (e) => {
      push(`Explorer window error: ${JSON.stringify(e.payload)}`, "stderr");
    });
  }

  return (
    <Section title={t("diag.fs.title")}>
      <p className="mb-1 text-[10.5px] leading-snug text-[var(--color-ink-faint)]">
        {t("diag.fs.intro")}
      </p>
      <Button size="block" variant="primary" title={t("explorer.openHint")} onClick={openExplorer}>
        <FolderOpen size={14} />
        {t("explorer.open")}
      </Button>
    </Section>
  );
}
