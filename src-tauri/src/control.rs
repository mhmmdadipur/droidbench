// scrcpy control-message encoding + Tauri commands.
// Message layouts follow scrcpy's ControlMessage (server >= v3).

use tauri::State;

use crate::mirror::{write_control, MirrorState};

// Control message types (subset we use). Verified against scrcpy v5.0.1's
// ControlMessage / ControlMessageReader.
const TYPE_INJECT_KEYCODE: u8 = 0;
const TYPE_INJECT_TEXT: u8 = 1;
const TYPE_INJECT_TOUCH_EVENT: u8 = 2;
const TYPE_INJECT_SCROLL_EVENT: u8 = 3;
const TYPE_BACK_OR_SCREEN_ON: u8 = 4;
const TYPE_EXPAND_NOTIFICATION_PANEL: u8 = 5;
const TYPE_EXPAND_SETTINGS_PANEL: u8 = 6;
const TYPE_COLLAPSE_PANELS: u8 = 7;
const TYPE_GET_CLIPBOARD: u8 = 8;
const TYPE_SET_CLIPBOARD: u8 = 9;
const TYPE_SET_DISPLAY_POWER: u8 = 10;
const TYPE_ROTATE_DEVICE: u8 = 11;
const TYPE_UHID_CREATE: u8 = 12;
const TYPE_UHID_INPUT: u8 = 13;
const TYPE_UHID_DESTROY: u8 = 14;

/// UHID device id of our virtual keyboard (scrcpy uses 1 for its keyboard too).
const UHID_KEYBOARD_ID: u16 = 1;

/// HID report descriptor of a standard 8-byte boot keyboard, taken from scrcpy's
/// app/src/hid/hid_keyboard.c (v5.0.1): [modifiers][reserved][6 key slots] input,
/// plus the 5-bit LED output report. Key usages go up to 101 (0x65).
const KEYBOARD_REPORT_DESC: &[u8] = &[
    0x05, 0x01, // Usage Page (Generic Desktop)
    0x09, 0x06, // Usage (Keyboard)
    0xA1, 0x01, // Collection (Application)
    0x05, 0x07, //   Usage Page (Key Codes)
    0x19, 0xE0, //   Usage Minimum (224)
    0x29, 0xE7, //   Usage Maximum (231)
    0x15, 0x00, //   Logical Minimum (0)
    0x25, 0x01, //   Logical Maximum (1)
    0x75, 0x01, //   Report Size (1)
    0x95, 0x08, //   Report Count (8)
    0x81, 0x02, //   Input (Data, Variable, Absolute): modifier byte
    0x75, 0x08, //   Report Size (8)
    0x95, 0x01, //   Report Count (1)
    0x81, 0x01, //   Input (Constant): reserved byte
    0x05, 0x08, //   Usage Page (LEDs)
    0x19, 0x01, //   Usage Minimum (1)
    0x29, 0x05, //   Usage Maximum (5)
    0x75, 0x01, //   Report Size (1)
    0x95, 0x05, //   Report Count (5)
    0x91, 0x02, //   Output (Data, Variable, Absolute): LED report
    0x75, 0x03, //   Report Size (3)
    0x95, 0x01, //   Report Count (1)
    0x91, 0x01, //   Output (Constant): LED padding
    0x05, 0x07, //   Usage Page (Key Codes)
    0x19, 0x00, //   Usage Minimum (0)
    0x29, 0x65, //   Usage Maximum (101)
    0x15, 0x00, //   Logical Minimum (0)
    0x25, 0x65, //   Logical Maximum (101)
    0x75, 0x08, //   Report Size (8)
    0x95, 0x06, //   Report Count (6)
    0x81, 0x00, //   Input (Data, Array): keys
    0xC0, // End Collection
];

/// Max bytes per INJECT_TEXT message (scrcpy INJECT_TEXT_MAX_LENGTH).
const INJECT_TEXT_MAX: usize = 300;
/// Max clipboard payload (256k message cap minus the 14-byte header).
const CLIPBOARD_MAX: usize = (1 << 18) - 14;

// Android MotionEvent actions.
const ACTION_DOWN: u8 = 0;
const ACTION_UP: u8 = 1;
const ACTION_MOVE: u8 = 2;

// AKEY_EVENT_ACTION
const KEY_ACTION_DOWN: u8 = 0;
const KEY_ACTION_UP: u8 = 1;

const POINTER_ID_MOUSE: u64 = -1i64 as u64; // 0xFFFF_FFFF_FFFF_FFFF
/// Second finger used to simulate a pinch (scrcpy's POINTER_ID_VIRTUAL_FINGER).
/// The server maps every distinct pointer id to its own MotionEvent pointer and
/// turns the 2nd DOWN/UP into ACTION_POINTER_DOWN/UP by itself.
const POINTER_ID_VIRTUAL_FINGER: u64 = -3i64 as u64;

fn push_u16(v: &mut Vec<u8>, n: u16) {
    v.extend_from_slice(&n.to_be_bytes());
}
fn push_u32(v: &mut Vec<u8>, n: u32) {
    v.extend_from_slice(&n.to_be_bytes());
}
fn push_u64(v: &mut Vec<u8>, n: u64) {
    v.extend_from_slice(&n.to_be_bytes());
}

/// Build an INJECT_TOUCH_EVENT message.
/// x/y are device pixel coordinates; width/height are the current frame size.
fn touch_msg(action: u8, pointer_id: u64, x: i32, y: i32, width: u16, height: u16, pressure: f32) -> Vec<u8> {
    let mut m = Vec::with_capacity(32);
    m.push(TYPE_INJECT_TOUCH_EVENT);
    m.push(action);
    push_u64(&mut m, pointer_id);
    push_u32(&mut m, x.max(0) as u32);
    push_u32(&mut m, y.max(0) as u32);
    push_u16(&mut m, width);
    push_u16(&mut m, height);
    // pressure is a 16-bit fixed-point fraction (0..=1 -> 0..=0xffff)
    let p = (pressure.clamp(0.0, 1.0) * 65535.0) as u16;
    push_u16(&mut m, p);
    push_u32(&mut m, 1); // action button (primary)
    push_u32(&mut m, 1); // buttons (primary pressed)
    m
}

/// Inject a touch (down/move/up) using normalized coordinates [0,1].
#[tauri::command]
pub async fn mirror_touch(
    state: State<'_, MirrorState>,
    action: String, // "down" | "move" | "up"
    nx: f32,
    ny: f32,
    finger2: Option<bool>, // true = the virtual second finger (pinch)
) -> Result<(), String> {
    let (w, h) = *state.size.lock().await;
    if w == 0 || h == 0 {
        return Err("mirror size unknown".into());
    }
    let x = (nx.clamp(0.0, 1.0) * w as f32) as i32;
    let y = (ny.clamp(0.0, 1.0) * h as f32) as i32;
    let (act, pressure) = match action.as_str() {
        "down" => (ACTION_DOWN, 1.0),
        "move" => (ACTION_MOVE, 1.0),
        "up" => (ACTION_UP, 0.0),
        _ => return Err("invalid touch action".into()),
    };
    let pointer = if finger2.unwrap_or(false) { POINTER_ID_VIRTUAL_FINGER } else { POINTER_ID_MOUSE };
    let msg = touch_msg(act, pointer, x, y, w as u16, h as u16, pressure);
    write_control(&state, &msg).await
}

/// Build an INJECT_KEYCODE message.
fn key_msg(action: u8, keycode: u32, meta: u32) -> Vec<u8> {
    let mut m = Vec::with_capacity(14);
    m.push(TYPE_INJECT_KEYCODE);
    m.push(action);
    push_u32(&mut m, keycode);
    push_u32(&mut m, 0); // repeat
    push_u32(&mut m, meta);
    m
}

/// Inject an Android keycode (down then up). See android.view.KeyEvent.
/// `meta` is an optional KeyEvent.META_* state (e.g. CTRL_ON 0x1000, SHIFT_ON
/// 0x1) so shortcuts like Select-All (Ctrl+A) work in text fields.
#[tauri::command]
pub async fn mirror_keycode(
    state: State<'_, MirrorState>,
    keycode: u32,
    meta: Option<u32>,
) -> Result<(), String> {
    let meta = meta.unwrap_or(0);
    let down = key_msg(KEY_ACTION_DOWN, keycode, meta);
    write_control(&state, &down).await?;
    let up = key_msg(KEY_ACTION_UP, keycode, meta);
    write_control(&state, &up).await
}

/// Largest index <= `max` that lies on a UTF-8 char boundary.
fn utf8_cut(s: &str, max: usize) -> usize {
    if s.len() <= max {
        return s.len();
    }
    let mut n = max;
    while n > 0 && !s.is_char_boundary(n) {
        n -= 1;
    }
    n
}

/// Type text into the focused field on the device (INJECT_TEXT). Handles any
/// Unicode (accents, CJK, emoji) and splits into <=300-byte chunks on char
/// boundaries as scrcpy requires.
#[tauri::command]
pub async fn mirror_text(state: State<'_, MirrorState>, text: String) -> Result<(), String> {
    let mut rest = text.as_str();
    while !rest.is_empty() {
        let n = utf8_cut(rest, INJECT_TEXT_MAX);
        if n == 0 {
            break;
        }
        let (head, tail) = rest.split_at(n);
        let mut m = Vec::with_capacity(5 + n);
        m.push(TYPE_INJECT_TEXT);
        push_u32(&mut m, n as u32);
        m.extend_from_slice(head.as_bytes());
        write_control(&state, &m).await?;
        rest = tail;
    }
    Ok(())
}

// ───────────────────────── Clipboard ─────────────────────────

/// Read the PC clipboard as text. An empty / non-text clipboard yields "".
async fn get_pc_clipboard() -> Result<String, String> {
    tokio::task::spawn_blocking(|| {
        let mut cb = arboard::Clipboard::new().map_err(|e| format!("clipboard: {e}"))?;
        match cb.get_text() {
            Ok(t) => Ok(t),
            Err(arboard::Error::ContentNotAvailable) => Ok(String::new()),
            Err(e) => Err(format!("clipboard read: {e}")),
        }
    })
    .await
    .map_err(|e| format!("clipboard task: {e}"))?
}

/// Write text to the PC clipboard (used when the phone's clipboard changes).
pub async fn set_pc_clipboard(text: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let mut cb = arboard::Clipboard::new().map_err(|e| format!("clipboard: {e}"))?;
        cb.set_text(text).map_err(|e| format!("clipboard write: {e}"))
    })
    .await
    .map_err(|e| format!("clipboard task: {e}"))?
}

/// Put arbitrary text on the PC clipboard (used by the "copy" buttons next to
/// diagnostics). The WebView clipboard API is unreliable, so this goes through
/// the same native path as the phone -> PC sync.
#[tauri::command]
pub async fn pc_clipboard_set(text: String) -> Result<(), String> {
    set_pc_clipboard(text).await
}

/// PC -> phone: send the PC clipboard to the device (SET_CLIPBOARD). With
/// `paste = true` the device also pastes it right away (Ctrl/Cmd+V behavior).
/// Returns how many characters were sent (0 if the PC clipboard has no text).
#[tauri::command]
pub async fn mirror_clipboard_to_phone(
    state: State<'_, MirrorState>,
    paste: bool,
) -> Result<usize, String> {
    let text = get_pc_clipboard().await?;
    if text.is_empty() {
        return Ok(0);
    }
    let n = utf8_cut(&text, CLIPBOARD_MAX);
    let mut m = Vec::with_capacity(14 + n);
    m.push(TYPE_SET_CLIPBOARD);
    push_u64(&mut m, 0); // sequence 0 = no ACK requested
    m.push(paste as u8);
    push_u32(&mut m, n as u32);
    m.extend_from_slice(&text.as_bytes()[..n]);
    write_control(&state, &m).await?;
    Ok(text[..n].chars().count())
}

/// Phone -> PC: press COPY (1) or CUT (2) on the device (GET_CLIPBOARD).
///
/// How scrcpy v5.0.1 really behaves (Controller.getClipboard): with
/// `clipboard_autosync` on (the default, which we use) the server does NOT reply to
/// GET_CLIPBOARD. It only injects the COPY/CUT key; if that changes the device
/// clipboard, the autosync listener pushes the new text, which the reader task in
/// mirror.rs writes to the PC clipboard. So `copy_key = 0` never produces anything
/// and is rejected, and COPY with nothing selected on the phone is a silent no-op.
#[tauri::command]
pub async fn mirror_clipboard_from_phone(
    state: State<'_, MirrorState>,
    copy_key: u8,
) -> Result<(), String> {
    if copy_key == 0 || copy_key > 2 {
        return Err("copy_key must be 1 (COPY) or 2 (CUT)".into());
    }
    write_control(&state, &[TYPE_GET_CLIPBOARD, copy_key]).await
}

/// Scroll at normalized position with a vertical/horizontal delta.
#[tauri::command]
pub async fn mirror_scroll(
    state: State<'_, MirrorState>,
    nx: f32,
    ny: f32,
    hscroll: f32,
    vscroll: f32,
) -> Result<(), String> {
    let (w, h) = *state.size.lock().await;
    if w == 0 || h == 0 {
        return Err("mirror size unknown".into());
    }
    let x = (nx.clamp(0.0, 1.0) * w as f32) as i32;
    let y = (ny.clamp(0.0, 1.0) * h as f32) as i32;
    let mut m = Vec::with_capacity(21);
    m.push(TYPE_INJECT_SCROLL_EVENT);
    push_u32(&mut m, x.max(0) as u32);
    push_u32(&mut m, y.max(0) as u32);
    push_u16(&mut m, w as u16);
    push_u16(&mut m, h as u16);
    // scroll values are 16-bit signed fixed-point in [-1,1]
    let hs = (hscroll.clamp(-1.0, 1.0) * 32767.0) as i16;
    let vs = (vscroll.clamp(-1.0, 1.0) * 32767.0) as i16;
    m.extend_from_slice(&hs.to_be_bytes());
    m.extend_from_slice(&vs.to_be_bytes());
    push_u32(&mut m, 0); // buttons
    write_control(&state, &m).await
}

/// Notification shade / quick-settings shade / collapse-all, via scrcpy's
/// dedicated empty control messages (types 5, 6, 7 in v5.0.1's ControlMessage).
/// These work regardless of OEM, unlike keycode 83 or settings intents.
#[tauri::command]
pub async fn mirror_panel(state: State<'_, MirrorState>, kind: String) -> Result<(), String> {
    let t = match kind.as_str() {
        "notifications" => TYPE_EXPAND_NOTIFICATION_PANEL,
        "settings" => TYPE_EXPAND_SETTINGS_PANEL,
        "collapse" => TYPE_COLLAPSE_PANELS,
        _ => return Err("invalid panel".into()),
    };
    write_control(&state, &[t]).await
}

/// Rotate the device screen (scrcpy ROTATE_DEVICE).
#[tauri::command]
pub async fn mirror_rotate(state: State<'_, MirrorState>) -> Result<(), String> {
    write_control(&state, &[TYPE_ROTATE_DEVICE]).await
}

/// Turn the phone's physical display on/off while mirroring keeps running
/// (scrcpy SET_DISPLAY_POWER). Saves battery and hides the screen from view.
#[tauri::command]
pub async fn mirror_display_power(state: State<'_, MirrorState>, on: bool) -> Result<(), String> {
    write_control(&state, &[TYPE_SET_DISPLAY_POWER, on as u8]).await
}

/// Create a virtual USB-style keyboard on the phone (UHID_CREATE) — what scrcpy's
/// `-K` / `--keyboard=uhid` does. Android then sees the laptop keyboard as a real
/// hardware keyboard, so it hides the on-screen keyboard while typing.
#[tauri::command]
pub async fn mirror_uhid_create(state: State<'_, MirrorState>) -> Result<(), String> {
    let name = b"Droidbench Keyboard";
    let mut m = Vec::with_capacity(12 + name.len() + KEYBOARD_REPORT_DESC.len());
    m.push(TYPE_UHID_CREATE);
    push_u16(&mut m, UHID_KEYBOARD_ID);
    push_u16(&mut m, 0); // vendor id
    push_u16(&mut m, 0); // product id
    m.push(name.len() as u8); // name: 1-byte length prefix
    m.extend_from_slice(name);
    push_u16(&mut m, KEYBOARD_REPORT_DESC.len() as u16); // descriptor: 2-byte length prefix
    m.extend_from_slice(KEYBOARD_REPORT_DESC);
    write_control(&state, &m).await
}

/// Send one 8-byte keyboard input report to the virtual keyboard (UHID_INPUT):
/// [modifiers][0][key1..key6]. The frontend builds it from the held keys.
#[tauri::command]
pub async fn mirror_uhid_input(state: State<'_, MirrorState>, data: Vec<u8>) -> Result<(), String> {
    if data.len() != 8 {
        return Err("a keyboard report must be exactly 8 bytes".into());
    }
    let mut m = Vec::with_capacity(5 + data.len());
    m.push(TYPE_UHID_INPUT);
    push_u16(&mut m, UHID_KEYBOARD_ID);
    push_u16(&mut m, data.len() as u16);
    m.extend_from_slice(&data);
    write_control(&state, &m).await
}

/// Remove the virtual keyboard (UHID_DESTROY); the phone's own keyboard returns.
#[tauri::command]
pub async fn mirror_uhid_destroy(state: State<'_, MirrorState>) -> Result<(), String> {
    let mut m = Vec::with_capacity(3);
    m.push(TYPE_UHID_DESTROY);
    push_u16(&mut m, UHID_KEYBOARD_ID);
    write_control(&state, &m).await
}

/// Press BACK (or turn screen on). type + action.
#[tauri::command]
pub async fn mirror_back(state: State<'_, MirrorState>) -> Result<(), String> {
    let msg = vec![TYPE_BACK_OR_SCREEN_ON, KEY_ACTION_DOWN];
    write_control(&state, &msg).await?;
    let up = vec![TYPE_BACK_OR_SCREEN_ON, KEY_ACTION_UP];
    write_control(&state, &up).await
}
