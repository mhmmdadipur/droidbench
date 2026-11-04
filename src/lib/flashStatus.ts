import { runCapture } from "./api";

export type LockState = "unlocked" | "locked" | "unknown";

/**
 * Query the bootloader unlock state via `fastboot getvar unlocked`.
 * Only meaningful when the device is in fastboot/bootloader mode. Returns
 * "unknown" if the device isn't in fastboot or the value can't be read.
 */
export async function checkBootloaderUnlocked(): Promise<LockState> {
  try {
    // fastboot prints "unlocked: yes" / "unlocked: no" on stderr
    const out = await runCapture("fastboot", ["getvar", "unlocked"]);
    const m = out.toLowerCase().match(/unlocked:\s*(yes|no)/);
    if (m) return m[1] === "yes" ? "unlocked" : "locked";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Read the bootloader lock state while the phone is booted normally (ADB mode),
 * no root needed. `ro.boot.flash.locked` is 1/0 on most devices; otherwise fall
 * back to Android Verified Boot's `ro.boot.verifiedbootstate`
 * (green = locked, orange = unlocked).
 */
export async function checkBootloaderFromAdb(): Promise<LockState> {
  try {
    const flash = (await runCapture("adb", ["shell", "getprop", "ro.boot.flash.locked"])).trim();
    if (flash === "1") return "locked";
    if (flash === "0") return "unlocked";
    const vb = (await runCapture("adb", ["shell", "getprop", "ro.boot.verifiedbootstate"])).trim().toLowerCase();
    if (vb === "orange") return "unlocked";
    if (vb === "green") return "locked";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/** Read the lock state using whichever method fits the current device mode. */
export async function readLockState(mode: string): Promise<LockState> {
  if (mode === "fastboot") return checkBootloaderUnlocked();
  if (mode === "adb") return checkBootloaderFromAdb();
  return "unknown";
}

/** Read a single fastboot getvar value (e.g. "product", "current-slot"). */
export async function fastbootGetvar(key: string): Promise<string> {
  try {
    const out = await runCapture("fastboot", ["getvar", key]);
    const re = new RegExp(`${key}:\\s*(.+)`, "i");
    const m = out.match(re);
    return m ? m[1].trim() : "";
  } catch {
    return "";
  }
}

/**
 * Read the OEM-unlock (allow bootloader unlocking) toggle state from Android
 * via `adb shell getprop sys.oem_unlock_allowed` (1 = allowed). Only works in
 * adb mode. Returns "unknown" when not readable.
 */
export async function checkOemUnlockAllowed(): Promise<"yes" | "no" | "unknown"> {
  try {
    const out = await runCapture("adb", ["shell", "getprop", "sys.oem_unlock_allowed"]);
    const v = out.trim();
    if (v === "1") return "yes";
    if (v === "0") return "no";
    return "unknown";
  } catch {
    return "unknown";
  }
}
