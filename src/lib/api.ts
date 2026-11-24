// Thin typed wrapper over Tauri commands + events.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type LogStream = "stdout" | "stderr" | "system";

export interface LogLine {
  id: string;
  stream: LogStream;
  line: string;
}

export interface CommandDone {
  id: string;
  code: number | null;
  success: boolean;
}

export interface DeviceInfo {
  connected: boolean;
  mode: "adb" | "fastboot" | "download" | "ios" | "none";
  adbState?: string; // "" | "unauthorized" | "offline" | "ios-untrusted"
  serial: string;
  brand: string;
  model: string;
  android: string;
  rom: string;
  /** every adb device that is ready right now; `serial` above is the selected one */
  adbDevices?: AdbDeviceEntry[];
}

export interface DebloatEntry {
  package: string;
  label: string;
  description: string;
  safe: boolean;
}
export interface DebloatCategory {
  name: string;
  entries: DebloatEntry[];
}
export interface DebloatDatabase {
  id: string;
  name: string;
  source: string;
  categories: DebloatCategory[];
}

export interface ToolStatus {
  name: string;
  available: boolean;
  source: "bundled" | "system" | "missing";
  path: string;
}

/** Run a streaming command. Output arrives via onLog/onDone listeners. */
export function runCommand(tool: string, args: string[], usePath = false): Promise<string> {
  return invoke<string>("run_command", { tool, args, usePath });
}

/** Run a command and get its full combined output. */
export function runCapture(tool: string, args: string[], usePath = false): Promise<string> {
  return invoke<string>("run_capture", { tool, args, usePath });
}

export function cancelCommand(id?: string): Promise<void> {
  return invoke("cancel_command", { id: id ?? null });
}

export function detectDevice(): Promise<DeviceInfo> {
  return invoke<DeviceInfo>("detect_device");
}

export interface IosReport {
  udid: string;
  device_name: string;
  product_type: string;
  marketing_name: string;
  ios_version: string;
  build_version: string;
  serial: string;
  imei: string;
  region: string;
  wifi_mac: string;
  bluetooth_mac: string;
  cpu_arch: string;
  activation_state: string;
  disk_total_bytes: number | null;
  disk_free_bytes: number | null;
  battery_percent: number | null;
  battery_cycle_count: number | null;
  battery_design_capacity: number | null;
  battery_full_capacity: number | null;
  battery_health_pct: number | null;
}

/** Full iOS device report (info + storage + battery) via libimobiledevice. */
export function iosInfo(udid: string): Promise<IosReport> {
  return invoke<IosReport>("ios_info", { udid });
}

/** Capture a screenshot from the iOS device into destDir; returns saved path. */
export function iosScreenshot(udid: string, destDir: string): Promise<string> {
  return invoke<string>("ios_screenshot", { udid, destDir });
}

export interface IosApp {
  bundle_id: string;
  name: string;
  version: string;
}

/** Start a full device backup into destDir (streaming; returns command id). */
export function iosBackup(udid: string, destDir: string): Promise<string> {
  return invoke<string>("ios_backup", { udid, destDir });
}
/** Restore a backup from srcDir to the device (streaming; returns command id). */
export function iosRestore(udid: string, srcDir: string, reboot: boolean): Promise<string> {
  return invoke<string>("ios_restore", { udid, srcDir, reboot });
}
/** Stream the live device console log (returns command id; stop via cancelCommand). */
export function iosSyslog(udid: string): Promise<string> {
  return invoke<string>("ios_syslog", { udid });
}
/** Copy crash reports off the device into destDir (streaming; returns command id). */
export function iosCrashReports(udid: string, destDir: string): Promise<string> {
  return invoke<string>("ios_crash_reports", { udid, destDir });
}
/** List user-installed apps via ideviceinstaller. */
export function iosListApps(udid: string): Promise<IosApp[]> {
  return invoke<IosApp[]>("ios_list_apps", { udid });
}
/** Install a signed .ipa (streaming; returns command id). */
export function iosInstallIpa(udid: string, ipaPath: string): Promise<string> {
  return invoke<string>("ios_install_ipa", { udid, ipaPath });
}
/** Uninstall an app by bundle id (streaming; returns command id). */
export function iosUninstallApp(udid: string, bundleId: string): Promise<string> {
  return invoke<string>("ios_uninstall_app", { udid, bundleId });
}

export interface AdbDeviceEntry {
  serial: string;
  state: string; // "device" | "unauthorized" | "offline" | other
  model: string;
}
export function listDevices(): Promise<AdbDeviceEntry[]> {
  return invoke<AdbDeviceEntry[]>("list_devices");
}

/** Choose which phone adb / fastboot / scrcpy talk to (null = automatic). */
export function selectDevice(serial: string | null): Promise<void> {
  return invoke("select_device", { serial });
}

/** `adb shell <command>` with a time limit (default 30 s); returns stdout + stderr. */
export function adbShell(command: string, timeoutSecs?: number): Promise<string> {
  return invoke<string>("adb_shell", { command, timeoutSecs: timeoutSecs ?? null });
}

export function checkTools(): Promise<ToolStatus[]> {
  return invoke<ToolStatus[]>("check_tools");
}

/** Install a bundled FOSS hardware-test APK by short id ("injuredpixels" | "hardware-test"). */
export function installApk(which: string): Promise<string> {
  return invoke<string>("install_apk", { which });
}
/** Install an .xapk / .apkm / .apks bundle (streams progress to the log; returns the command id). */
export function installXapk(path: string, grant: boolean, reinstall: boolean): Promise<string> {
  return invoke<string>("install_xapk", { path, grant, reinstall });
}

export function loadDebloatDb(id: string): Promise<DebloatDatabase> {
  return invoke<DebloatDatabase>("load_debloat_db", { id });
}
/** Store a downloaded debloat list so it replaces the bundled one. Returns the package count. */
export function saveDebloatDb(id: string, json: string): Promise<number> {
  return invoke<number>("save_debloat_db", { id, json });
}
export function listInstalledPackages(): Promise<string[]> {
  return invoke<string[]>("list_installed_packages");
}
export function listDisabledPackages(): Promise<string[]> {
  return invoke<string[]>("list_disabled_packages");
}

export function onLog(cb: (l: LogLine) => void): Promise<UnlistenFn> {
  return listen<LogLine>("log-line", (e) => cb(e.payload));
}
export function onDone(cb: (d: CommandDone) => void): Promise<UnlistenFn> {
  return listen<CommandDone>("command-done", (e) => cb(e.payload));
}
