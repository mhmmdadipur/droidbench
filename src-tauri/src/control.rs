// scrcpy control-message encoding + Tauri commands.
// Message layouts follow scrcpy's ControlMessage (server >= v3).

use tauri::State;

use crate::mirror::{write_control, MirrorState};

// Control message types (subset we use).
const TYPE_INJECT_KEYCODE: u8 = 0;
const TYPE_INJECT_TOUCH_EVENT: u8 = 2;
const TYPE_INJECT_SCROLL_EVENT: u8 = 3;
const TYPE_BACK_OR_SCREEN_ON: u8 = 4;

// Android MotionEvent actions.
const ACTION_DOWN: u8 = 0;
const ACTION_UP: u8 = 1;
const ACTION_MOVE: u8 = 2;

// AKEY_EVENT_ACTION
const KEY_ACTION_DOWN: u8 = 0;
const KEY_ACTION_UP: u8 = 1;

const POINTER_ID_MOUSE: u64 = -1i64 as u64; // 0xFFFF_FFFF_FFFF_FFFF

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
fn touch_msg(action: u8, x: i32, y: i32, width: u16, height: u16, pressure: f32) -> Vec<u8> {
    let mut m = Vec::with_capacity(32);
    m.push(TYPE_INJECT_TOUCH_EVENT);
    m.push(action);
    push_u64(&mut m, POINTER_ID_MOUSE);
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
    let msg = touch_msg(act, x, y, w as u16, h as u16, pressure);
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
#[tauri::command]
pub async fn mirror_keycode(state: State<'_, MirrorState>, keycode: u32) -> Result<(), String> {
    let down = key_msg(KEY_ACTION_DOWN, keycode, 0);
    write_control(&state, &down).await?;
    let up = key_msg(KEY_ACTION_UP, keycode, 0);
    write_control(&state, &up).await
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

/// Press BACK (or turn screen on). type + action.
#[tauri::command]
pub async fn mirror_back(state: State<'_, MirrorState>) -> Result<(), String> {
    let msg = vec![TYPE_BACK_OR_SCREEN_ON, KEY_ACTION_DOWN];
    write_control(&state, &msg).await?;
    let up = vec![TYPE_BACK_OR_SCREEN_ON, KEY_ACTION_UP];
    write_control(&state, &up).await
}
