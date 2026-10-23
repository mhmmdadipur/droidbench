// Embedded scrcpy mirroring (Option B).
//
// Droidbench acts as the scrcpy *client*: it pushes scrcpy-server to the device,
// sets up an adb tunnel, starts the server, then connects to the video and
// control sockets. Raw H.264 packets + metadata are forwarded to the frontend
// (which decodes with WebCodecs / WASM and renders to a canvas). Input events
// flow back from the frontend into the control socket.
//
// Protocol reference: scrcpy/doc/develop.md (server >= v3).

use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::Mutex;

use crate::runner::{resolve_resource, resolve_tool};

/// scrcpy-server version string — MUST match the bundled scrcpy-server exactly.
const SCRCPY_SERVER_VERSION: &str = "5.0.1";
const DEVICE_NAME_LEN: usize = 64;

/// Metadata emitted once at stream start.
#[derive(Clone, Serialize)]
pub struct MirrorMeta {
    pub device_name: String,
    pub codec: String, // "h264" | "h265" | "av1"
    pub width: u32,
    pub height: u32,
}

/// A decoded RGBA frame sent to the frontend for direct canvas rendering.
/// This path decodes H.264 in Rust (openh264), so it does not depend on the
/// WebView having working WebCodecs/WASM.
#[derive(Clone, Serialize)]
pub struct MirrorFrame {
    pub width: u32,
    pub height: u32,
    pub rgba_b64: String,
}

/// Holds the live control socket so input commands can be written to it.
#[derive(Default)]
pub struct MirrorState {
    pub control: Arc<Mutex<Option<TcpStream>>>,
    pub running: Arc<Mutex<bool>>,
    pub size: Arc<Mutex<(u32, u32)>>,
    pub socket_name: Arc<Mutex<Option<String>>>,
}

fn b64(data: &[u8]) -> String {
    // small, dependency-free base64 encoder (standard alphabet)
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | (b[2] as u32);
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { T[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[(n & 63) as usize] as char } else { '=' });
    }
    out
}

fn codec_name(id: u32) -> String {
    // scrcpy codec ids are 4 ASCII bytes packed big-endian
    match &id.to_be_bytes() {
        b"h264" => "h264".into(),
        b"h265" => "h265".into(),
        b"av01" => "av1".into(),
        other => String::from_utf8_lossy(other).trim_matches('\0').to_string(),
    }
}

/// Parsed scrcpy frame header (12 bytes).
#[derive(Debug, PartialEq, Eq)]
pub struct FrameHeader {
    pub pts: u64,
    pub config: bool,
    pub keyframe: bool,
    pub size: usize,
}

/// Parse the 12-byte per-packet header: u64 pts+flags, u32 size.
/// Top bit = config (SPS/PPS), next bit = keyframe, remaining 62 bits = PTS.
pub fn parse_frame_header(h: &[u8; 12]) -> FrameHeader {
    const PACKET_FLAG_CONFIG: u64 = 1 << 63;
    const PACKET_FLAG_KEY_FRAME: u64 = 1 << 62;
    const PTS_MASK: u64 = (1 << 62) - 1;
    let pts_flags = u64::from_be_bytes([h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]]);
    let size = u32::from_be_bytes([h[8], h[9], h[10], h[11]]) as usize;
    FrameHeader {
        pts: pts_flags & PTS_MASK,
        config: pts_flags & PACKET_FLAG_CONFIG != 0,
        keyframe: pts_flags & PACKET_FLAG_KEY_FRAME != 0,
        size,
    }
}

/// Find the next Annex-B start code (00 00 01 / 00 00 00 01) at or after `from`.
fn find_start_code(d: &[u8], from: usize) -> Option<usize> {
    let n = d.len();
    let mut i = from;
    while i + 3 <= n {
        if d[i] == 0 && d[i + 1] == 0 && d[i + 2] == 1 {
            return Some(i);
        }
        if i + 4 <= n && d[i] == 0 && d[i + 1] == 0 && d[i + 2] == 0 && d[i + 3] == 1 {
            return Some(i);
        }
        i += 1;
    }
    None
}

/// Start embedded mirroring. Pushes the server, opens the tunnel, connects
/// sockets, and spawns a task that streams video packets to the frontend.
#[tauri::command]
pub async fn mirror_start(
    app: AppHandle,
    state: State<'_, MirrorState>,
    max_size: Option<u32>,
    bitrate: Option<u32>,
) -> Result<(), String> {
    {
        let mut running = state.running.lock().await;
        if *running {
            return Err("mirror already running".into());
        }
        *running = true;
    }

    let adb = resolve_tool(&app, "adb");
    let server = resolve_resource(&app, "binaries/scrcpy-server")
        .ok_or_else(|| "bundled scrcpy-server not found".to_string())?;

    // Safety net: clean up any leftover server/tunnel from a previous session
    // that wasn't shut down cleanly, so a fresh start never needs a manual
    // `adb kill-server`.
    let _ = tokio::process::Command::new(&adb)
        .args(["shell", "pkill", "-f", "com.genymobile.scrcpy.Server"])
        .output()
        .await;
    let _ = tokio::process::Command::new(&adb)
        .args(["reverse", "--remove-all"])
        .output()
        .await;

    // scid must be a positive signed-32-bit value parsed as hex by the server.
    let scid = format!("{:08x}", rand_u32() & 0x7fff_ffff);
    let port: u16 = 27183;
    let socket_name = format!("scrcpy_{scid}");

    // 1) push server fresh (scrcpy's cleanup deletes it on exit)
    run_adb(&adb, &["push", &server, "/data/local/tmp/scrcpy-server.jar"]).await?;

    // 2) reverse tunnel: the server connects back to a local port we listen on.
    //    The abstract socket name MUST be `scrcpy_<scid>` to match the server.
    let _ = run_adb(&adb, &["reverse", "--remove", &format!("localabstract:{socket_name}")]).await;
    run_adb(
        &adb,
        &[
            "reverse",
            &format!("localabstract:{socket_name}"),
            &format!("tcp:{port}"),
        ],
    )
    .await?;
    *state.socket_name.lock().await = Some(socket_name.clone());

    // 3) start listening BEFORE starting the server (avoids race / connection refused)
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| format!("bind listener: {e}"))?;

    // 4) start the server process (detached). Default tunnel mode (reverse),
    //    so NO tunnel_forward. scid is a positive 31-bit hex value.
    let classpath = "CLASSPATH=/data/local/tmp/scrcpy-server.jar";
    let mut server_cmd = format!(
        "{classpath} app_process / com.genymobile.scrcpy.Server {SCRCPY_SERVER_VERSION} \
         scid={scid} log_level=warn audio=false control=true cleanup=true \
         send_frame_meta=false send_device_meta=false"
    );
    if let Some(m) = max_size {
        server_cmd.push_str(&format!(" max_size={m}"));
    }
    if let Some(b) = bitrate {
        server_cmd.push_str(&format!(" video_bit_rate={b}"));
    }
    // NOTE 1: do NOT force a profile. Forcing baseline (profile=1) on some
    // device encoders (e.g. Qualcomm OMX) produces a non-compliant bitstream
    // that OpenH264 rejects. The encoder's native profile decodes cleanly.
    // NOTE 2: send_frame_meta=false is CRITICAL — scrcpy's per-frame 12-byte
    // headers contain byte patterns that look like Annex-B start codes, which
    // corrupt NAL parsing. Disabling it yields a pure Annex-B stream.

    let adb_clone = adb.clone();
    tokio::spawn(async move {
        let _ = tokio::process::Command::new(&adb_clone)
            .args(["shell", &server_cmd])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await;
    });

    // 5) accept sockets from the server: video first, then control.
    let mut video = accept_timeout(&listener, 10).await?;
    video.set_nodelay(true).ok();
    let control = accept_timeout(&listener, 10).await?;
    control.set_nodelay(true).ok();

    *state.control.lock().await = Some(control);

    // 6) With send_device_meta=false there is no 64-byte name. The stream begins
    //    with a 4-byte codec id ("h264") then raw Annex-B video. We skip the
    //    codec id and let the NAL splitter handle the rest.
    let mut codec_buf = [0u8; 4];
    video
        .read_exact(&mut codec_buf)
        .await
        .map_err(|e| format!("read codec id: {e}"))?;
    let codec_id = u32::from_be_bytes(codec_buf);
    let device_name = String::new();

    // width/height unknown until first decoded frame; frontend reports it back.
    let (width, height) = *state.size.lock().await;

    let _ = app.emit(
        "mirror-meta",
        MirrorMeta {
            device_name,
            codec: codec_name(codec_id),
            width,
            height,
        },
    );

    // 7) stream frames: per-packet header is 12 bytes:
    //    u64 pts_and_flags (top 2 bits flags: config, keyframe), u32 size
    let running = state.running.clone();
    let app2 = app.clone();
    tokio::spawn(async move {
        // Decode H.264 in Rust with openh264 and emit RGBA frames.
        //
        // Key lesson: do NOT trust per-packet size framing — scrcpy's framing
        // around the config packet is subtle and easy to misalign. Instead we
        // treat the socket as a continuous Annex-B byte stream: buffer raw
        // bytes, split on NAL start codes, and decode each *complete* NAL unit
        // (openh264 reassembles frames itself). This matches how ffmpeg/scrcpy
        // consume the stream and decodes cleanly.
        use openh264::decoder::Decoder;

        let mut decoder = match Decoder::new() {
            Ok(d) => d,
            Err(e) => {
                let _ = app2.emit("mirror-error", format!("failed to create H.264 decoder: {e}"));
                *running.lock().await = false;
                let _ = app2.emit("mirror-stopped", ());
                return;
            }
        };

        let mut acc: Vec<u8> = Vec::with_capacity(1 << 20);
        let mut chunk = vec![0u8; 65536];
        let mut frame_count: u64 = 0;

        loop {
            if !*running.lock().await {
                break;
            }
            let n = match video.read(&mut chunk).await {
                Ok(0) => break,
                Ok(n) => n,
                Err(_) => break,
            };
            acc.extend_from_slice(&chunk[..n]);

            // Find the LAST start code: everything before it is a run of
            // complete NAL units we can hand to openh264's `nal_units()` (the
            // exact path proven to decode cleanly). Keep the tail (the possibly
            // incomplete final NAL) for the next read.
            let last = {
                let mut found = None;
                let mut from = 0usize;
                while let Some(i) = find_start_code(&acc, from) {
                    found = Some(i);
                    from = i + 3;
                }
                found
            };
            let Some(last) = last else { continue };
            if last == 0 {
                continue; // only one (incomplete) NAL so far
            }

            let complete: Vec<u8> = acc[..last].to_vec();
            acc.drain(0..last);

            for unit in openh264::nal_units(&complete) {
                // skip invalid NAL types (0 / >23) that can arise from stray
                // bytes; only forward real NAL units to the decoder.
                let sc = if unit.len() >= 4 && unit[2] == 0 { 4 } else { 3 };
                let t = if unit.len() > sc { unit[sc] & 0x1f } else { 0 };
                if t == 0 || t > 23 {
                    continue;
                }
                decode_au(&mut decoder, unit, &app2, &mut frame_count).await;
            }
        }
        *running.lock().await = false;
        let _ = app2.emit("mirror-stopped", ());
    });

    Ok(())
}

/// Decode one access unit (SPS/PPS/… + VCL slice) and emit an RGBA frame.
async fn decode_au(
    decoder: &mut openh264::decoder::Decoder,
    au: &[u8],
    app: &AppHandle,
    frame_count: &mut u64,
) {
    use openh264::formats::YUVSource;
    match decoder.decode(au) {
        Ok(Some(yuv)) => {
            let (w, h) = yuv.dimensions();
            let mut rgba = vec![0u8; w * h * 4];
            yuv.write_rgba8(&mut rgba);
            *frame_count += 1;
            let _ = app.emit(
                "mirror-frame",
                MirrorFrame {
                    width: w as u32,
                    height: h as u32,
                    rgba_b64: b64(&rgba),
                },
            );
        }
        Ok(None) => {}
        Err(e) => {
            if *frame_count == 0 {
                let _ = app.emit(
                    "mirror-diag",
                    format!("decode: {}", e.to_string().lines().next().unwrap_or("")),
                );
            }
        }
    }
}

/// Stop mirroring: close control socket, mark not running, remove the reverse
/// tunnel, and kill the server process on the device.
#[tauri::command]
pub async fn mirror_stop(app: AppHandle, state: State<'_, MirrorState>) -> Result<(), String> {
    *state.running.lock().await = false;
    *state.control.lock().await = None;
    let adb = resolve_tool(&app, "adb");
    if let Some(name) = state.socket_name.lock().await.take() {
        let _ = run_adb(&adb, &["reverse", "--remove", &format!("localabstract:{name}")]).await;
    }
    // best-effort: stop the server process
    let _ = tokio::process::Command::new(&adb)
        .args(["shell", "pkill", "-f", "com.genymobile.scrcpy.Server"])
        .output()
        .await;
    Ok(())
}

/// The frontend reports the actual decoded video dimensions once known, so
/// touch coordinate mapping is correct.
#[tauri::command]
pub async fn mirror_set_size(
    state: State<'_, MirrorState>,
    width: u32,
    height: u32,
) -> Result<(), String> {
    *state.size.lock().await = (width, height);
    Ok(())
}

async fn run_adb(adb: &str, args: &[&str]) -> Result<(), String> {
    let out = tokio::process::Command::new(adb)
        .args(args)
        .output()
        .await
        .map_err(|e| format!("adb {:?}: {e}", args))?;
    if !out.status.success() {
        return Err(format!(
            "adb {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(())
}

/// Take a screenshot on the device and pull it to `dest_dir`.
#[tauri::command]
pub async fn mirror_screenshot(app: AppHandle, dest_dir: String) -> Result<String, String> {
    let adb = resolve_tool(&app, "adb");
    let remote = "/sdcard/droidbench_shot.png";
    run_adb(&adb, &["shell", "screencap", "-p", remote]).await?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let local = format!("{dest_dir}/droidbench_shot_{ts}.png");
    run_adb(&adb, &["pull", remote, &local]).await?;
    let _ = run_adb(&adb, &["shell", "rm", remote]).await;
    Ok(local)
}

/// Push a local file to the device's Download folder.
#[tauri::command]
pub async fn mirror_push_file(app: AppHandle, path: String) -> Result<(), String> {
    let adb = resolve_tool(&app, "adb");
    run_adb(&adb, &["push", &path, "/sdcard/Download/"]).await
}

/// Open a settings screen / run an `am` action on the device.
#[tauri::command]
pub async fn mirror_open(app: AppHandle, action: String) -> Result<(), String> {
    let adb = resolve_tool(&app, "adb");
    run_adb(&adb, &["shell", "am", "start", "-a", &action]).await
}

/// Set the device clipboard (PC -> Phone) via adb.
#[tauri::command]
pub async fn mirror_set_clipboard(app: AppHandle, text: String) -> Result<(), String> {
    let adb = resolve_tool(&app, "adb");
    // use the broadcast-free `cmd clipboard` where available; fall back to input
    let escaped = text.replace('\'', "\\'");
    run_adb(&adb, &["shell", "am", "broadcast", "-a", "clipper.set", "-e", "text", &escaped])
        .await
        .or_else(|_| Ok(()))
}

/// Get the device clipboard (Phone -> PC) via adb; returns the text.
#[tauri::command]
pub async fn mirror_get_clipboard(app: AppHandle) -> Result<String, String> {
    let adb = resolve_tool(&app, "adb");
    let out = tokio::process::Command::new(&adb)
        .args(["shell", "cmd", "clipboard", "get"])
        .output()
        .await
        .map_err(|e| format!("clipboard get: {e}"))?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

async fn accept_timeout(
    listener: &tokio::net::TcpListener,
    secs: u64,
) -> Result<TcpStream, String> {
    match tokio::time::timeout(std::time::Duration::from_secs(secs), listener.accept()).await {
        Ok(Ok((stream, _))) => Ok(stream),
        Ok(Err(e)) => Err(format!("accept failed: {e}")),
        Err(_) => Err("timed out waiting for scrcpy server to connect".into()),
    }
}

fn rand_u32() -> u32 {
    // cheap non-crypto random from the clock
    use std::time::{SystemTime, UNIX_EPOCH};
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    n.wrapping_mul(2654435761).wrapping_add(1)
}

/// Write a scrcpy control message (already serialized) to the control socket.
pub async fn write_control(state: &MirrorState, bytes: &[u8]) -> Result<(), String> {
    let mut guard = state.control.lock().await;
    let sock = guard.as_mut().ok_or("control socket not connected")?;
    sock.write_all(bytes)
        .await
        .map_err(|e| format!("control write: {e}"))?;
    Ok(())
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn b64_encodes_correctly() {
        assert_eq!(b64(b""), "");
        assert_eq!(b64(b"f"), "Zg==");
        assert_eq!(b64(b"fo"), "Zm8=");
        assert_eq!(b64(b"foo"), "Zm9v");
        assert_eq!(b64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn codec_names_map() {
        assert_eq!(codec_name(u32::from_be_bytes(*b"h264")), "h264");
        assert_eq!(codec_name(u32::from_be_bytes(*b"h265")), "h265");
        assert_eq!(codec_name(u32::from_be_bytes(*b"av01")), "av1");
    }

    #[test]
    fn frame_header_parses_flags_pts_size() {
        // config + keyframe + pts=0x1234, size=0x100
        let config_bit: u64 = 1 << 63;
        let key_bit: u64 = 1 << 62;
        let pts: u64 = 0x1234;
        let pts_flags = config_bit | key_bit | pts;
        let size: u32 = 0x100;
        let mut h = [0u8; 12];
        h[..8].copy_from_slice(&pts_flags.to_be_bytes());
        h[8..].copy_from_slice(&size.to_be_bytes());

        let fh = parse_frame_header(&h);
        assert!(fh.config);
        assert!(fh.keyframe);
        assert_eq!(fh.pts, 0x1234);
        assert_eq!(fh.size, 0x100);
    }

    #[test]
    fn frame_header_plain_delta() {
        let pts: u64 = 999;
        let size: u32 = 42;
        let mut h = [0u8; 12];
        h[..8].copy_from_slice(&pts.to_be_bytes());
        h[8..].copy_from_slice(&size.to_be_bytes());
        let fh = parse_frame_header(&h);
        assert!(!fh.config);
        assert!(!fh.keyframe);
        assert_eq!(fh.pts, 999);
        assert_eq!(fh.size, 42);
    }
}
