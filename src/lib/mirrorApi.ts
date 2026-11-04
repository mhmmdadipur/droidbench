// Mirror (embedded scrcpy) command + event bindings.
import { invoke, Channel } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface MirrorMeta {
  device_name: string;
  codec: "h264" | "h265" | "av1" | string;
  width: number;
  height: number;
}

/** Start mirroring. Frames arrive as raw bytes over `onFrame`: each message is
 * [w:u32 BE][h:u32 BE][rgba...]. When `audio` is true, PCM (s16le, 48 kHz,
 * stereo) arrives on `onAudio`. The audio channel is always required by the
 * backend and simply stays silent when audio is off. */
export function mirrorStart(
  onFrame: Channel<ArrayBuffer>,
  maxSize = 1024,
  bitrate = 8_000_000,
  maxFps = 30,
  audio = false,
  onAudio: Channel<ArrayBuffer> = new Channel<ArrayBuffer>(),
): Promise<void> {
  return invoke("mirror_start", { maxSize, bitrate, maxFps, audio, onFrame, onAudio });
}
export function mirrorStop(): Promise<void> {
  return invoke("mirror_stop");
}

export function mirrorSetSize(width: number, height: number): Promise<void> {
  return invoke("mirror_set_size", { width, height });
}

/** `finger2` drives the virtual second finger (used to simulate pinch-zoom). */
export function mirrorTouch(
  action: "down" | "move" | "up",
  nx: number,
  ny: number,
  finger2 = false,
): Promise<void> {
  return invoke("mirror_touch", { action, nx, ny, finger2 });
}
export function mirrorKeycode(keycode: number, meta?: number): Promise<void> {
  return invoke("mirror_keycode", { keycode, meta });
}
/** Type text into the focused field on the device (any Unicode). */
export function mirrorText(text: string): Promise<void> {
  return invoke("mirror_text", { text });
}
/** PC -> phone: send the PC clipboard to the device; paste=true also pastes it. */
export function mirrorClipboardToPhone(paste: boolean): Promise<number> {
  return invoke<number>("mirror_clipboard_to_phone", { paste });
}
/** Phone -> PC: press COPY (1) or CUT (2) on the phone. The text arrives through the
 * autosync event (onMirrorClipboard) only if the phone clipboard actually changed. */
export function mirrorClipboardFromPhone(copyKey: 1 | 2): Promise<void> {
  return invoke("mirror_clipboard_from_phone", { copyKey });
}
/** Put text on the PC clipboard natively (the WebView clipboard API is unreliable). */
export function pcClipboardSet(text: string): Promise<void> {
  return invoke("pc_clipboard_set", { text });
}
export function onMirrorClipboard(cb: (chars: number) => void): Promise<UnlistenFn> {
  return listen<number>("mirror-clipboard", (e) => cb(e.payload));
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
/** Notification shade / quick-settings shade / collapse both (scrcpy control messages). */
export function mirrorPanel(kind: "notifications" | "settings" | "collapse"): Promise<void> {
  return invoke("mirror_panel", { kind });
}
/** Reboot the phone (adb reboot). */
export function mirrorReboot(): Promise<void> {
  return invoke("mirror_reboot");
}

/** Create / feed / remove the virtual physical keyboard (scrcpy -K, UHID). */
export function mirrorUhidCreate(): Promise<void> {
  return invoke("mirror_uhid_create");
}
export function mirrorUhidInput(data: number[]): Promise<void> {
  return invoke("mirror_uhid_input", { data });
}
export function mirrorUhidDestroy(): Promise<void> {
  return invoke("mirror_uhid_destroy");
}
/** Rotate the device screen. */
export function mirrorRotate(): Promise<void> {
  return invoke("mirror_rotate");
}
/** Turn the phone's physical display on/off while mirroring keeps running. */
export function mirrorDisplayPower(on: boolean): Promise<void> {
  return invoke("mirror_display_power", { on });
}
/** Start recording the screen (device-side, no audio); chunks are saved on stop. */
export function mirrorRecordStart(destDir: string): Promise<void> {
  return invoke("mirror_record_start", { destDir });
}
/** Stop recording; resolves to the saved file paths. */
export function mirrorRecordStop(): Promise<string[]> {
  return invoke<string[]>("mirror_record_stop");
}
export function onMirrorAudio(cb: (state: "on" | "unsupported" | "error") => void): Promise<UnlistenFn> {
  return listen<"on" | "unsupported" | "error">("mirror-audio", (e) => cb(e.payload));
}
export function onMirrorRecordError(cb: (msg: string) => void): Promise<UnlistenFn> {
  return listen<string>("mirror-record-error", (e) => cb(e.payload));
}

// Android settings intent actions.
export const INTENT = {
  SETTINGS: "android.settings.SETTINGS",
  DEV_OPTIONS: "android.settings.APPLICATION_DEVELOPMENT_SETTINGS",
  ABOUT: "android.settings.DEVICE_INFO_SETTINGS",
} as const;

export function onMirrorMeta(cb: (m: MirrorMeta) => void): Promise<UnlistenFn> {
  return listen<MirrorMeta>("mirror-meta", (e) => cb(e.payload));
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
