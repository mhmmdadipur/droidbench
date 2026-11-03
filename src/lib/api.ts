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

/** Start iOS screen mirror (read-only MJPEG over USB). Frames arrive as raw
 * JPEG bytes over the Channel. */
export function iosMirrorStart(udid: string, onFrame: import("@tauri-apps/api/core").Channel<ArrayBuffer>): Promise<void> {
  return invoke("ios_mirror_start", { udid, onFrame });
}
export function iosMirrorStop(): Promise<void> {
  return invoke("ios_mirror_stop");
}

export interface AdbDeviceEntry {
  serial: string;
  state: string; // "device" | "unauthorized" | "offline" | other
  model: string;
}
export function listDevices(): Promise<AdbDeviceEntry[]> {
  return invoke<AdbDeviceEntry[]>("list_devices");
}

export function checkTools(): Promise<ToolStatus[]> {
  return invoke<ToolStatus[]>("check_tools");
}

/** Install a bundled FOSS hardware-test APK by short id ("injuredpixels" | "hardware-test"). */
export function installApk(which: string): Promise<string> {
  return invoke<string>("install_apk", { which });
}

export function loadDebloatDb(id: string): Promise<DebloatDatabase> {
  return invoke<DebloatDatabase>("load_debloat_db", { id });
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
