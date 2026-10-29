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
  mode: "adb" | "fastboot" | "download" | "none";
  adbState?: string; // "" | "unauthorized" | "offline"
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

export function checkTools(): Promise<ToolStatus[]> {
  return invoke<ToolStatus[]>("check_tools");
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
