// Mirror (embedded scrcpy) command + event bindings.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface MirrorMeta {
  device_name: string;
  codec: "h264" | "h265" | "av1" | string;
  width: number;
  height: number;
}

export interface MirrorFrame {
  width: number;
  height: number;
  rgba_b64: string;
}

export function mirrorStart(maxSize = 1024, bitrate = 8_000_000): Promise<void> {
  return invoke("mirror_start", { maxSize, bitrate });
}
export function mirrorStop(): Promise<void> {
  return invoke("mirror_stop");
}

export function mirrorSetSize(width: number, height: number): Promise<void> {
  return invoke("mirror_set_size", { width, height });
}

export function mirrorTouch(action: "down" | "move" | "up", nx: number, ny: number): Promise<void> {
  return invoke("mirror_touch", { action, nx, ny });
}
export function mirrorKeycode(keycode: number): Promise<void> {
  return invoke("mirror_keycode", { keycode });
}
export function mirrorScroll(nx: number, ny: number, hscroll: number, vscroll: number): Promise<void> {
  return invoke("mirror_scroll", { nx, ny, hscroll, vscroll });
}
export function mirrorBack(): Promise<void> {
  return invoke("mirror_back");
}
export function mirrorScreenshot(destDir: string): Promise<string> {
  return invoke<string>("mirror_screenshot", { destDir });
}
export function mirrorPushFile(path: string): Promise<void> {
  return invoke("mirror_push_file", { path });
}
export function mirrorOpen(action: string): Promise<void> {
  return invoke("mirror_open", { action });
}
export function mirrorSetClipboard(text: string): Promise<void> {
  return invoke("mirror_set_clipboard", { text });
}
export function mirrorGetClipboard(): Promise<string> {
  return invoke<string>("mirror_get_clipboard");
}

// Android settings intent actions.
export const INTENT = {
  QUICK_SETTINGS: "android.settings.QUICK_LAUNCH_SETTINGS",
  SETTINGS: "android.settings.SETTINGS",
  DEV_OPTIONS: "android.settings.APPLICATION_DEVELOPMENT_SETTINGS",
  ABOUT: "android.settings.DEVICE_INFO_SETTINGS",
} as const;

export function onMirrorMeta(cb: (m: MirrorMeta) => void): Promise<UnlistenFn> {
  return listen<MirrorMeta>("mirror-meta", (e) => cb(e.payload));
}
export function onMirrorFrame(cb: (f: MirrorFrame) => void): Promise<UnlistenFn> {
  return listen<MirrorFrame>("mirror-frame", (e) => cb(e.payload));
}
export function onMirrorError(cb: (msg: string) => void): Promise<UnlistenFn> {
  return listen<string>("mirror-error", (e) => cb(e.payload));
}
export function onMirrorDiag(cb: (msg: string) => void): Promise<UnlistenFn> {
  return listen<string>("mirror-diag", (e) => cb(e.payload));
}
export function onMirrorStopped(cb: () => void): Promise<UnlistenFn> {
  return listen("mirror-stopped", () => cb());
}

// Common Android keycodes used by the control bar.
export const KEY = {
  HOME: 3,
  BACK: 4,
  APP_SWITCH: 187,
  POWER: 26,
  VOLUME_UP: 24,
  VOLUME_DOWN: 25,
  MENU: 82,
  NOTIFICATION: 83,
} as const;
