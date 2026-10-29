// Device diagnostics: run a thorough ADB scan and parse it into a structured
// report. Pure functions + a single orchestrator so the UI stays simple.
//
// Everything here works over plain `adb shell` (no root). Values that can't be
// read on a given phone are returned as null and the UI degrades gracefully.

import { runCapture } from "./api";

export interface BatteryInfo {
  designCapacity: number | null; // µAh
  maxCapacity: number | null; // µAh
  healthPct: number | null; // computed wear %
  level: number | null;
  tempC: number | null;
  voltage: number | null; // mV
  technology: string;
  statusText: string;
  healthRaw: string;
}

export interface ScreenInfo {
  resolution: string;
  density: string;
  refreshHz: string;
  maxNits: string;
  cutout: string;
}

export interface MemInfo {
  totalKb: number | null;
  availKb: number | null;
}

export interface StorageInfo {
  totalKb: number | null;
  usedKb: number | null;
  freeKb: number | null;
}

export interface CpuInfo {
  cores: number | null;
  chipset: string;
  abi: string;
}

export interface SystemInfo {
  props: Map<string, string>;
  kernel: string;
  selinux: string;
  uptime: string;
  securityPatch: string;
  buildDate: string;
  encrypted: string;
  rooted: boolean;
  maxTempC: number | null;
  authenticity: "original" | "modified" | "unknown";
  // granular signals for the split "System & Authenticity" view
  bootloader: "locked" | "unlocked" | "unknown";
  verifiedBoot: string; // green/yellow/orange/red/unknown
  rootManager: string; // "KernelSU" | "Magisk" | "APatch" | "none" | "unknown"
  customRom: { isCustom: boolean; name: string };
  integrityNote: "likely-pass" | "likely-fail" | "spoofed" | "unknown";
  hasIntegrityModule: boolean;
  buildTags: string;
}

export interface CameraInfo {
  count: number | null;
}

export interface RootModule {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
}

/** Canonical sensor keys we care about for a used-phone check. */
export const SENSOR_KEYS = [
  "accelerometer",
  "gyroscope",
  "magnetic",
  "proximity",
  "light",
  "fingerprint",
  "nfc",
  "stepcounter",
  "pressure",
] as const;
export type SensorKey = (typeof SENSOR_KEYS)[number];

/** Sensors that are commonly absent even on healthy phones (don't flag as a defect). */
export const OPTIONAL_SENSORS: SensorKey[] = ["pressure", "nfc", "stepcounter"];

/** The core sensors a healthy modern phone should have — used for scoring. */
export const CORE_SENSORS: SensorKey[] = [
  "accelerometer",
  "gyroscope",
  "magnetic",
  "proximity",
  "light",
  "fingerprint",
];

export interface SensorInfo {
  totalCount: number;
  present: Record<SensorKey, boolean>;
}

export interface DiagnosticReport {
  battery: BatteryInfo;
  screen: ScreenInfo;
  memory: MemInfo;
  storage: StorageInfo;
  cpu: CpuInfo;
  system: SystemInfo;
  sensors: SensorInfo;
  camera: CameraInfo;
  /** Root/Magisk/KSU modules installed (read-only, only when rooted). */
  rootModules: RootModule[];
}

const num = (s: string | undefined): number | null => {
  if (s == null) return null;
  const n = Number(s.trim());
  return Number.isFinite(n) ? n : null;
};

export function parseGetprop(dump: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /^\[([^\]]+)\]:\s*\[([^\]]*)\]/;
  for (const line of dump.split("\n")) {
    const m = re.exec(line.trim());
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

function parseBattery(dump: string, sysfs: string): BatteryInfo {
  const grab = (key: string): string | undefined => {
    const re = new RegExp(`^\\s*${key}:\\s*(.+)$`, "im");
    return re.exec(dump)?.[1]?.trim();
  };
  let design = num(grab("Design capacity"));
  let max = num(grab("Maximum capacity"));

  // Fallback: some phones expose capacity via sysfs (µAh) even without the
  // newer battery HAL that populates dumpsys. Values are tagged per line.
  if (design == null) {
    design = num(/DF_DESIGN\s+([0-9]+)/.exec(sysfs)?.[1]);
  }
  if (max == null) {
    max = num(/DF_FULL\s+([0-9]+)/.exec(sysfs)?.[1]);
  }

  let healthPct: number | null = null;
  if (design && max && design > 0) {
    healthPct = Math.round((max / design) * 100);
  }
  const temp = num(grab("temperature"));
  const statusCode = num(grab("status"));
  const healthCode = num(grab("health"));
  return {
    designCapacity: design,
    maxCapacity: max,
    healthPct,
    level: num(grab("level")),
    tempC: temp != null ? temp / 10 : null,
    voltage: num(grab("voltage")),
    technology: grab("technology") ?? "—",
    statusText: batteryStatus(statusCode),
    healthRaw: batteryHealth(healthCode),
  };
}

function batteryStatus(code: number | null): string {
  switch (code) {
    case 2:
      return "Charging";
    case 3:
      return "Discharging";
    case 4:
      return "Not charging";
    case 5:
      return "Full";
    default:
      return "Unknown";
  }
}
function batteryHealth(code: number | null): string {
  switch (code) {
    case 2:
      return "Good";
    case 3:
      return "Overheat";
    case 4:
      return "Dead";
    case 5:
      return "Over voltage";
    case 6:
      return "Unspecified failure";
    case 7:
      return "Cold";
    default:
      return "Unknown";
  }
}

function parseScreen(size: string, density: string, refresh: string): ScreenInfo {
  const res = /Physical size:\s*(\S+)/.exec(size)?.[1] ?? "—";
  const dpi = /Physical density:\s*(\S+)/.exec(density)?.[1] ?? "—";
  // collect all supported refresh rates from dumpsys display
  const rates = new Set<number>();
  for (const m of refresh.matchAll(/fps=([0-9.]+)/g)) {
    rates.add(Math.round(Number(m[1])));
  }
  const hz =
    rates.size > 0
      ? `${[...rates].sort((a, b) => a - b).join("/")} Hz`
      : "—";
  const nits = /mMaxLuminance=([0-9.]+)/.exec(refresh)?.[1];
  const hasCutout = /cutout DisplayCutout\{insets=Rect\((?!0, 0 - 0, 0)/.test(refresh) ||
    /boundingRect=\{Bounds=\[(?!Rect\(0, 0 - 0, 0\), Rect\(0, 0 - 0, 0\))/.test(refresh);
  return {
    resolution: res,
    density: dpi,
    refreshHz: hz,
    maxNits: nits ? `${Math.round(Number(nits))} nits` : "—",
    cutout: hasCutout ? "yes" : "no",
  };
}

function parseMem(dump: string): MemInfo {
  return {
    totalKb: num(/MemTotal:\s*([0-9]+)/.exec(dump)?.[1]),
    availKb: num(/MemAvailable:\s*([0-9]+)/.exec(dump)?.[1]),
  };
}

function parseStorage(dump: string): StorageInfo {
  // last non-header line of `df /data`
  const lines = dump.trim().split("\n").filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  const cols = last.split(/\s+/);
  // Filesystem 1K-blocks Used Available Use% Mounted
  if (cols.length >= 4) {
    return {
      totalKb: num(cols[1]),
      usedKb: num(cols[2]),
      freeKb: num(cols[3]),
    };
  }
  return { totalKb: null, usedKb: null, freeKb: null };
}

function parseSensors(sensorDump: string, features: string): SensorInfo {
  const total = num(/Total\s+(\d+)\s+h\/w sensors/.exec(sensorDump)?.[1]) ?? 0;
  // `pm list features` is the authoritative source for hardware presence —
  // the fingerprint reader and NFC do NOT appear in dumpsys sensorservice.
  const feat = (name: string) => features.includes(`android.hardware.${name}`);
  return {
    totalCount: total,
    present: {
      accelerometer: feat("sensor.accelerometer"),
      gyroscope: feat("sensor.gyroscope"),
      magnetic: feat("sensor.compass"),
      proximity: feat("sensor.proximity"),
      light: feat("sensor.light"),
      fingerprint: feat("fingerprint") || feat("biometrics.face"),
      nfc: feat("nfc"),
      stepcounter: feat("sensor.stepcounter") || feat("sensor.stepdetector"),
      pressure: feat("sensor.barometer") || sensorDump.includes("android.sensor.pressure("),
    },
  };
}

/**
 * Parse the delimited dump of `/data/adb/modules/*​/module.prop` (read-only).
 * Each block starts with `===MOD===` and ends with `state=enabled|disabled`.
 */
function parseRootModules(dump: string): RootModule[] {
  if (!dump || /Permission denied|not found|inaccessible/i.test(dump)) return [];
  const out: RootModule[] = [];
  for (const block of dump.split("===MOD===")) {
    const b = block.trim();
    if (!b) continue;
    const get = (k: string) => new RegExp(`^${k}=(.+)$`, "im").exec(b)?.[1]?.trim();
    const id = get("id");
    if (!id) continue;
    out.push({
      id,
      name: get("name") || id,
      version: get("version") || "—",
      enabled: !/state=disabled/i.test(b),
    });
  }
  return out;
}

function authenticityOf(
  props: Map<string, string>,
  rooted: boolean,
): "original" | "modified" | "unknown" {
  const locked = props.get("ro.boot.flash.locked");
  const vbstate = props.get("ro.boot.verifiedbootstate");
  const tags = props.get("ro.build.tags") ?? "";
  const debuggable = props.get("ro.debuggable");
  const devstate = props.get("ro.boot.vbmeta.device_state");

  const signals = [locked, vbstate, tags, debuggable, devstate].filter(
    (x) => x != null && x !== "",
  );
  if (signals.length === 0 && !rooted) return "unknown";

  const modified =
    rooted ||
    locked === "0" ||
    devstate === "unlocked" ||
    (vbstate && vbstate !== "green") ||
    tags.includes("test-keys") ||
    debuggable === "1";
  return modified ? "modified" : "original";
}

function bootloaderOf(props: Map<string, string>): "locked" | "unlocked" | "unknown" {
  const locked = props.get("ro.boot.flash.locked");
  const devstate = props.get("ro.boot.vbmeta.device_state");
  if (locked === "0" || devstate === "unlocked") return "unlocked";
  if (locked === "1" || devstate === "locked") return "locked";
  return "unknown";
}

/** Detect the root manager from markers under /data/adb (via su dump). */
function rootManagerOf(markers: string, rooted: boolean): string {
  if (/\/data\/adb\/ksud?\b/.test(markers) || /KernelSU/i.test(markers)) return "KernelSU";
  if (/\/data\/adb\/ap\b|APatch/i.test(markers)) return "APatch";
  if (/\/data\/adb\/magisk\b|Magisk/i.test(markers)) return "Magisk";
  return rooted ? "unknown" : "none";
}

/** Detect a custom ROM from vendor-specific props + generic heuristics. */
function customRomOf(props: Map<string, string>): { isCustom: boolean; name: string } {
  // vendor-specific marker props used by popular custom ROMs
  const vendorKeys: { prefix: string; label: string }[] = [
    { prefix: "ro.infinity.", label: "Project Infinity-X" },
    { prefix: "ro.lineage.", label: "LineageOS" },
    { prefix: "ro.pixelexperience.", label: "Pixel Experience" },
    { prefix: "ro.crdroid.", label: "crDroid" },
    { prefix: "ro.evolution.", label: "Evolution X" },
    { prefix: "ro.rising.", label: "RisingOS" },
    { prefix: "ro.arrow.", label: "ArrowOS" },
    { prefix: "ro.havoc.", label: "Havoc OS" },
    { prefix: "ro.aospa.", label: "Paranoid Android" },
    { prefix: "ro.du.", label: "Dirty Unicorns" },
    { prefix: "org.pixelexperience.", label: "Pixel Experience" },
    { prefix: "ro.yaap.", label: "YAAP" },
  ];
  for (const { prefix, label } of vendorKeys) {
    for (const k of props.keys()) {
      if (k.startsWith(prefix)) {
        // try to surface a version/build string if present
        const ver =
          props.get(`${prefix}build.version`) ||
          props.get(`${prefix}version`) ||
          "";
        return { isCustom: true, name: ver ? `${label} (${ver})` : label };
      }
    }
  }
  // generic heuristic: official stock builds are release-keys + user + not debuggable
  const tags = props.get("ro.build.tags") ?? "";
  const type = props.get("ro.build.type") ?? "";
  if (tags.includes("test-keys") || (type && type !== "user")) {
    return { isCustom: true, name: "Custom / unofficial build" };
  }
  return { isCustom: false, name: "" };
}

/**
 * Play Integrity can only be *measured* by an on-device checker that calls
 * Google's API — not via ADB. We report an HONEST indicator of likelihood:
 *  - spoofed: a PIF-type module is installed (verdict is being faked)
 *  - likely-fail: unlocked / non-green verified boot / test-keys
 *  - likely-pass: locked + green + release-keys, no spoofing module
 */
function integrityNoteOf(
  props: Map<string, string>,
  hasIntegrityModule: boolean,
): "likely-pass" | "likely-fail" | "spoofed" | "unknown" {
  if (hasIntegrityModule) return "spoofed";
  const locked = props.get("ro.boot.flash.locked");
  const vbstate = props.get("ro.boot.verifiedbootstate");
  const tags = props.get("ro.build.tags") ?? "";
  if (locked == null && vbstate == null && !tags) return "unknown";
  const bad = locked === "0" || (vbstate && vbstate !== "green") || tags.includes("test-keys");
  return bad ? "likely-fail" : "likely-pass";
}

/** Run the full scan. `adb` is the tool name used by runCapture. */
export async function runDiagnosticScan(): Promise<DiagnosticReport> {
  const [
    propDump,
    batteryDump,
    batterySysfs,
    size,
    density,
    display,
    meminfo,
    df,
    cpuinfo,
    sensorsDump,
    features,
    kernel,
    selinux,
    uptimeProc,
    cameraDump,
    thermalDump,
    suCheck,
    rootModulesDump,
    rootMarkers,
  ] = await Promise.all([
    runCapture("adb", ["shell", "getprop"]),
    runCapture("adb", ["shell", "dumpsys", "battery"]),
    // sysfs fallback for capacity: scan every power-supply node for either the
    // Qualcomm (charge_full*) or MediaTek (energy_full*) naming. Tag the first
    // non-empty design/full pair so the parser can read it. Works on many
    // non-rooted phones (e.g. MediaTek mt6xxx-gauge exposes energy_full*).
    runCapture("adb", [
      "shell",
      'for d in /sys/class/power_supply/*; do ' +
        'for a in charge_full_design energy_full_design; do v=$(cat $d/$a 2>/dev/null); ' +
        '[ -n "$v" ] && echo DF_DESIGN $v; done; ' +
        'for a in charge_full energy_full; do v=$(cat $d/$a 2>/dev/null); ' +
        '[ -n "$v" ] && echo DF_FULL $v; done; done',
    ]),
    runCapture("adb", ["shell", "wm", "size"]),
    runCapture("adb", ["shell", "wm", "density"]),
    runCapture("adb", ["shell", "dumpsys", "display"]),
    runCapture("adb", ["shell", "cat", "/proc/meminfo"]),
    runCapture("adb", ["shell", "df", "/data"]),
    runCapture("adb", ["shell", "cat", "/proc/cpuinfo"]),
    runCapture("adb", ["shell", "dumpsys", "sensorservice"]),
    runCapture("adb", ["shell", "pm", "list", "features"]),
    runCapture("adb", ["shell", "uname", "-a"]),
    runCapture("adb", ["shell", "getenforce"]),
    runCapture("adb", ["shell", "cat", "/proc/uptime"]),
    runCapture("adb", ["shell", "dumpsys", "media.camera"]),
    // max temperature across thermal zones (overheating signal for used phones)
    runCapture("adb", [
      "shell",
      "for d in /sys/class/thermal/thermal_zone*; do cat $d/temp 2>/dev/null; done",
    ]),
    // root indicator: does an `su` binary exist on PATH / common locations?
    runCapture("adb", [
      "shell",
      "which su 2>/dev/null; ls /system/bin/su /system/xbin/su /sbin/su 2>/dev/null",
    ]),
    // installed root modules (read-only). Harmlessly empty on non-rooted phones.
    runCapture("adb", [
      "shell",
      'su -c "for d in /data/adb/modules/*/; do echo ===MOD===; cat $d/module.prop 2>/dev/null; ' +
        'if [ -f $d/disable ]; then echo state=disabled; else echo state=enabled; fi; done" 2>/dev/null',
    ]),
    // root-manager markers (which root solution is installed).
    runCapture("adb", [
      "shell",
      'su -c "ls -d /data/adb/ksu /data/adb/ksud /data/adb/magisk /data/adb/ap 2>/dev/null; ksud -V 2>/dev/null; magisk -V 2>/dev/null" 2>/dev/null',
    ]),
  ]);

  const props = parseGetprop(propDump);
  const cores = (cpuinfo.match(/^processor/gim) || []).length || null;
  const chipset =
    props.get("ro.soc.model") ||
    props.get("ro.board.platform") ||
    props.get("ro.hardware") ||
    "—";
  const rooted = /\/su(\s|$)|(^|\n)su(\s|$)/m.test(suCheck) || /bin\/su/.test(suCheck);
  const camCount = num(/Number of camera devices:\s*([0-9]+)/.exec(cameraDump)?.[1]);
  // thermal: pick the max plausible zone temp (values are milli-°C)
  let maxTempC: number | null = null;
  for (const line of thermalDump.split("\n")) {
    const v = Number(line.trim());
    if (Number.isFinite(v) && v > 0) {
      const c = v > 1000 ? v / 1000 : v; // some zones report °C directly
      if (c > 0 && c < 150 && (maxTempC == null || c > maxTempC)) maxTempC = Math.round(c);
    }
  }
  const rootModules = parseRootModules(rootModulesDump);
  // a Play-Integrity-fixing module present → integrity is being spoofed
  const hasIntegrityModule = rootModules.some((m) =>
    /playintegrity|integrityfix|safetynet|teesim|tricky.?store/i.test(`${m.id} ${m.name}`),
  );

  return {
    battery: parseBattery(batteryDump, batterySysfs),
    screen: parseScreen(size, density, display),
    memory: parseMem(meminfo),
    storage: parseStorage(df),
    cpu: {
      cores,
      chipset,
      abi: props.get("ro.product.cpu.abi") || "—",
    },
    system: {
      props,
      kernel: kernel.trim() || "—",
      selinux: selinux.trim() || "—",
      uptime: fmtUptime(uptimeProc),
      securityPatch: props.get("ro.build.version.security_patch") || "—",
      buildDate: props.get("ro.build.date") || "—",
      encrypted: props.get("ro.crypto.state") || "—",
      rooted,
      maxTempC,
      authenticity: authenticityOf(props, rooted),
      bootloader: bootloaderOf(props),
      verifiedBoot: props.get("ro.boot.verifiedbootstate") || "unknown",
      rootManager: rootManagerOf(rootMarkers, rooted),
      customRom: customRomOf(props),
      integrityNote: integrityNoteOf(props, hasIntegrityModule),
      hasIntegrityModule,
      buildTags: props.get("ro.build.tags") || "—",
    },
    sensors: parseSensors(sensorsDump, features),
    camera: { count: camCount },
    rootModules,
  };
}

// ─── scoring ────────────────────────────────────────────────────────────────

export type CheckState = "untested" | "pass" | "fail";

export interface ScoreResult {
  score: number; // 0..100
  band: "excellent" | "good" | "fair" | "poor";
}

/**
 * Compute an overall 0..100 health score, 3uTools-style.
 * Weights: battery 35, authenticity 20, sensors 15, hardware checklist 30.
 * Untested checklist items are treated neutrally (don't penalise).
 */
export function computeScore(
  report: DiagnosticReport,
  checks: Record<string, CheckState>,
): ScoreResult {
  let score = 0;
  let weightUsed = 0;

  // battery (35)
  const bw = 35;
  if (report.battery.healthPct != null) {
    score += (Math.max(0, Math.min(100, report.battery.healthPct)) / 100) * bw;
    weightUsed += bw;
  } else if (report.battery.healthRaw && report.battery.healthRaw !== "Unknown") {
    // No capacity data, but the OS reports a coarse health status. Give partial
    // credit so a phone without the newer HAL isn't scored as if it had no
    // battery at all. "Good" → 0.8, any fault status → 0.3.
    const good = report.battery.healthRaw === "Good";
    score += (good ? 0.8 : 0.3) * bw;
    weightUsed += bw;
  }

  // authenticity (20)
  const aw = 20;
  if (report.system.authenticity !== "unknown") {
    score += (report.system.authenticity === "original" ? 1 : 0.4) * aw;
    weightUsed += aw;
  }

  // sensors (15): fraction of the core sensors present
  const sw = 15;
  const presentCount = CORE_SENSORS.filter((k) => report.sensors.present[k]).length;
  score += (presentCount / CORE_SENSORS.length) * sw;
  weightUsed += sw;

  // hardware checklist (30): average of tested items
  const cw = 30;
  const tested = Object.values(checks).filter((v) => v !== "untested");
  if (tested.length > 0) {
    const passed = tested.filter((v) => v === "pass").length;
    score += (passed / tested.length) * cw;
    weightUsed += cw;
  }

  const normalized = weightUsed > 0 ? (score / weightUsed) * 100 : 0;
  const rounded = Math.round(normalized);
  return { score: rounded, band: band(rounded) };
}

function band(score: number): ScoreResult["band"] {
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 50) return "fair";
  return "poor";
}

export function fmtKb(kb: number | null): string {
  if (kb == null) return "—";
  const gb = kb / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = kb / 1024;
  return `${Math.round(mb)} MB`;
}

export function fmtUAh(uah: number | null): string {
  if (uah == null) return "—";
  return `${Math.round(uah / 1000)} mAh`;
}

// ─── read-only file browser (via su) ─────────────────────────────────────────

export interface FsEntry {
  name: string;
  isDir: boolean;
  size: number | null;
  perms: string;
  /** absolute path (set for search results; derived from cwd otherwise) */
  fullPath?: string;
}

/** List a directory on the device (read-only) via `su -c ls -la`. */
export async function listDir(path: string): Promise<FsEntry[]> {
  // -A: include dotfiles but not . / .. ; -l long; append / dirs handled by type char
  const out = await runCapture("adb", ["shell", `su -c "ls -lA '${path}' 2>&1"`]);
  if (/Permission denied|No such file|not found|inaccessible/i.test(out) && !out.includes("\n")) {
    return [];
  }
  const entries: FsEntry[] = [];
  for (const line of out.split("\n")) {
    const l = line.trim();
    if (!l || l.startsWith("total ")) continue;
    // e.g. "drwxr-xr-x 2 root root 3452 2026-10-28 08:56 name with spaces"
    const m = /^([bcdlsp-][rwxsStT-]{9})\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\S+\s+(.+)$/.exec(l);
    if (!m) continue;
    const perms = m[1];
    const isDir = perms[0] === "d";
    const isLink = perms[0] === "l";
    let name = m[3];
    // strip symlink target "name -> target"
    if (isLink && name.includes(" -> ")) name = name.split(" -> ")[0];
    entries.push({
      name,
      isDir,
      size: isDir ? null : Number(m[2]),
      perms,
    });
  }
  // dirs first, then alpha
  entries.sort((a, b) =>
    a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1,
  );
  return entries;
}

/** Read a text file on the device (read-only). Returns up to ~256 KB. */
export async function readDeviceFile(path: string): Promise<string> {
  // guard against huge/binary files: cap bytes
  return runCapture("adb", ["shell", `su -c "head -c 262144 '${path}' 2>&1"`]);
}

/** Search file names under a directory (recursive) via `find -iname`. */
export async function searchFiles(dir: string, term: string): Promise<FsEntry[]> {
  const safe = term.replace(/["$`\\]/g, "");
  const out = await runCapture("adb", [
    "shell",
    `su -c "find '${dir}' -iname '*${safe}*' 2>/dev/null | head -300"`,
  ]);
  return pathsToEntries(out, dir);
}

/** Search for text inside files under a directory (recursive) via `grep -rl`. */
export async function searchText(dir: string, term: string): Promise<FsEntry[]> {
  const safe = term.replace(/["$`\\]/g, "");
  const out = await runCapture("adb", [
    "shell",
    `su -c "grep -rlI '${safe}' '${dir}' 2>/dev/null | head -300"`,
  ]);
  return pathsToEntries(out, dir);
}

/** Turn a newline list of absolute paths into FsEntry rows (best-effort). */
function pathsToEntries(out: string, _base: string): FsEntry[] {
  const rows: FsEntry[] = [];
  for (const raw of out.split("\n")) {
    const p = raw.trim();
    if (!p || /Permission denied|No such/i.test(p)) continue;
    const name = p.replace(/\/+$/, "").split("/").pop() || p;
    rows.push({ name, isDir: p.endsWith("/"), size: null, perms: "", fullPath: p });
  }
  return rows;
}

/** Get a human size for a file or folder via stat/du. */
export async function deviceSize(path: string, isDir: boolean): Promise<string> {
  const cmd = isDir
    ? `su -c "du -sh '${path}' 2>/dev/null | cut -f1"`
    : `su -c "stat -c %s '${path}' 2>/dev/null"`;
  const out = (await runCapture("adb", ["shell", cmd])).trim();
  if (!out) return "—";
  if (isDir) return out;
  const n = Number(out);
  return Number.isFinite(n) ? humanBytes(n) : out;
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/** Format /proc/uptime (first field = seconds) into "Xh Ym". */
export function fmtUptime(proc: string): string {
  const secs = Number((proc.trim().split(/\s+/)[0] ?? "").trim());
  if (!Number.isFinite(secs) || secs <= 0) return "—";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
