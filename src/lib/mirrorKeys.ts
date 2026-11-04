// Maps laptop keyboard events to Android input for the mirror window.
//
// Printable characters are NOT handled here: they flow through a hidden
// <textarea>'s `input` event and are sent as text (INJECT_TEXT), which handles
// every keyboard layout, accents and IME composition correctly. This module
// only covers the keys that have no text representation (Enter, Backspace,
// arrows, …) and the Ctrl/Cmd shortcuts.

/** android.view.KeyEvent.KEYCODE_* values we use. */
export const AKEY = {
  ENTER: 66,
  DEL: 67, // backspace
  FORWARD_DEL: 112,
  TAB: 61,
  DPAD_UP: 19,
  DPAD_DOWN: 20,
  DPAD_LEFT: 21,
  DPAD_RIGHT: 22,
  PAGE_UP: 92,
  PAGE_DOWN: 93,
  MOVE_HOME: 122,
  MOVE_END: 123,
  A: 29,
  Z: 54,
  Y: 53,
} as const;

/** android.view.KeyEvent.META_* flags. */
export const META = {
  SHIFT_ON: 0x1,
  ALT_ON: 0x2,
  CTRL_ON: 0x1000,
} as const;

/** DOM `KeyboardEvent.key` -> Android keycode for non-text keys. */
const SPECIAL: Record<string, number> = {
  Enter: AKEY.ENTER,
  Backspace: AKEY.DEL,
  Delete: AKEY.FORWARD_DEL,
  Tab: AKEY.TAB,
  ArrowUp: AKEY.DPAD_UP,
  ArrowDown: AKEY.DPAD_DOWN,
  ArrowLeft: AKEY.DPAD_LEFT,
  ArrowRight: AKEY.DPAD_RIGHT,
  PageUp: AKEY.PAGE_UP,
  PageDown: AKEY.PAGE_DOWN,
  Home: AKEY.MOVE_HOME,
  End: AKEY.MOVE_END,
};

export type KeyAction =
  | { kind: "keycode"; keycode: number; meta?: number }
  | { kind: "back" }
  | { kind: "copy"; cut: boolean }
  | { kind: "paste" }
  | { kind: "none" }; // not ours: let it become text input / default behavior

/**
 * Decide what a keydown means for the phone. `mod` is Ctrl on Windows/Linux and
 * Cmd on macOS (we accept either so it feels native on every OS).
 */
export function classifyKey(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): KeyAction {
  const mod = e.ctrlKey || e.metaKey;

  if (mod) {
    switch (e.key.toLowerCase()) {
      case "c":
        return { kind: "copy", cut: false };
      case "x":
        return { kind: "copy", cut: true };
      case "v":
        return { kind: "paste" };
      case "a":
        return { kind: "keycode", keycode: AKEY.A, meta: META.CTRL_ON };
      case "z":
        // Ctrl+Z = undo, Ctrl+Shift+Z = redo (Android text fields honor both)
        return { kind: "keycode", keycode: AKEY.Z, meta: META.CTRL_ON | (e.shiftKey ? META.SHIFT_ON : 0) };
      case "y":
        return { kind: "keycode", keycode: AKEY.Y, meta: META.CTRL_ON };
      default:
        return { kind: "none" };
    }
  }

  if (e.key === "Escape") return { kind: "back" };

  const code = SPECIAL[e.key];
  if (code !== undefined) {
    let meta = 0;
    if (e.shiftKey) meta |= META.SHIFT_ON; // Shift+Arrow selects text
    if (e.altKey) meta |= META.ALT_ON;
    return { kind: "keycode", keycode: code, meta: meta || undefined };
  }

  return { kind: "none" };
}

// ───────────────────────── Physical keyboard (scrcpy -K / UHID) ─────────────────────────
//
// In this mode the laptop keyboard is presented to the phone as a real USB keyboard,
// so the phone's on-screen keyboard stays hidden. We send SCANCODES, not characters:
// the phone's own physical-keyboard layout decides which character each key types.
// `KeyboardEvent.code` is the physical key, which is exactly what HID usages describe.

/** KeyboardEvent.code -> USB HID usage (keyboard page 0x07), all within 0..101. */
export const HID_USAGE: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").forEach((c, i) => (m[`Key${c}`] = 0x04 + i));
  for (let i = 1; i <= 9; i++) m[`Digit${i}`] = 0x1e + (i - 1);
  m.Digit0 = 0x27;
  Object.assign(m, {
    Enter: 0x28, Escape: 0x29, Backspace: 0x2a, Tab: 0x2b, Space: 0x2c,
    Minus: 0x2d, Equal: 0x2e, BracketLeft: 0x2f, BracketRight: 0x30, Backslash: 0x31,
    Semicolon: 0x33, Quote: 0x34, Backquote: 0x35, Comma: 0x36, Period: 0x37, Slash: 0x38,
    CapsLock: 0x39,
    PrintScreen: 0x46, ScrollLock: 0x47, Pause: 0x48,
    Insert: 0x49, Home: 0x4a, PageUp: 0x4b, Delete: 0x4c, End: 0x4d, PageDown: 0x4e,
    ArrowRight: 0x4f, ArrowLeft: 0x50, ArrowDown: 0x51, ArrowUp: 0x52,
    NumLock: 0x53, NumpadDivide: 0x54, NumpadMultiply: 0x55, NumpadSubtract: 0x56,
    NumpadAdd: 0x57, NumpadEnter: 0x58, Numpad0: 0x62, NumpadDecimal: 0x63,
    IntlBackslash: 0x64, ContextMenu: 0x65,
  });
  for (let i = 1; i <= 12; i++) m[`F${i}`] = 0x3a + (i - 1);
  for (let i = 1; i <= 9; i++) m[`Numpad${i}`] = 0x59 + (i - 1);
  return m;
})();

/** Modifier keys -> bit in byte 0 of the HID report. */
export const HID_MOD_BIT: Record<string, number> = {
  ControlLeft: 1 << 0, ShiftLeft: 1 << 1, AltLeft: 1 << 2, MetaLeft: 1 << 3,
  ControlRight: 1 << 4, ShiftRight: 1 << 5, AltRight: 1 << 6, MetaRight: 1 << 7,
};

export const isMac = (): boolean => typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
export const isHidKey = (code: string): boolean => code in HID_USAGE || code in HID_MOD_BIT;
export const isHidModifier = (code: string): boolean => code in HID_MOD_BIT;

/**
 * Build the 8-byte boot-keyboard input report from the physical keys currently held:
 * [modifiers][0][key1 .. key6] (extra slots 0; more than 6 keys = rollover error 0x01).
 * On macOS the Command keys are sent as Ctrl, because Android shortcuts (copy, paste,
 * select all, undo) use Ctrl, not Cmd.
 */
export function hidReport(held: Iterable<string>, cmdAsCtrl: boolean): number[] {
  let mods = 0;
  const keys: number[] = [];
  for (const code of held) {
    if (code in HID_MOD_BIT) {
      let bit = HID_MOD_BIT[code];
      if (cmdAsCtrl && code === "MetaLeft") bit = HID_MOD_BIT.ControlLeft;
      if (cmdAsCtrl && code === "MetaRight") bit = HID_MOD_BIT.ControlRight;
      mods |= bit;
    } else if (code in HID_USAGE) {
      keys.push(HID_USAGE[code]);
    }
  }
  const slots = keys.length > 6 ? Array(6).fill(0x01) : [...keys, ...Array(6 - keys.length).fill(0)];
  return [mods, 0, ...slots];
}
