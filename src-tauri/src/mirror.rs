// Embedded scrcpy mirroring (Option B).
//
// Droidbench acts as the scrcpy *client*: it pushes scrcpy-server to the device,
// sets up an adb tunnel, starts the server, then connects to the video and
// control sockets. Raw H.264 packets + metadata are forwarded to the frontend
// (which decodes with WebCodecs / WASM and renders to a canvas). Input events
// flow back from the frontend into the control socket.
//
// Protocol reference: scrcpy/doc/develop.md (server >= v3).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::TcpStream;
use tokio::sync::Mutex;

use crate::runner::{resolve_resource, resolve_tool};

/// scrcpy-server version string — MUST match the bundled scrcpy-server exactly.
const SCRCPY_SERVER_VERSION: &str = "5.0.1";

/// Metadata emitted once at stream start.
#[derive(Clone, Serialize)]
pub struct MirrorMeta {
    pub device_name: String,
    pub codec: String, // "h264" | "h265" | "av1"
    pub width: u32,
    pub height: u32,
}

/// Holds the live control socket (write half) so input commands can be written
/// to it. The read half is owned by a reader task that receives device
/// messages (clipboard) — the control socket is bidirectional.
#[derive(Default)]
pub struct MirrorState {
    pub control: Arc<Mutex<Option<OwnedWriteHalf>>>,
    pub running: Arc<Mutex<bool>>,
    pub size: Arc<Mutex<(u32, u32)>>,
    pub socket_name: Arc<Mutex<Option<String>>>,
    pub rec: Arc<Mutex<Option<RecSession>>>,
}

/// An in-progress screen recording (device-side `screenrecord`, in 180 s chunks).
pub struct RecSession {
    stop: Arc<AtomicBool>,
    /// device paths of every chunk started so far
    files: Arc<Mutex<Vec<String>>>,
    dest: String,
    stamp: u64,
    handle: tokio::task::JoinHandle<()>,
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
    max_fps: Option<u32>,
    audio: Option<bool>,
    on_frame: Channel<Response>,
    on_audio: Channel<Response>,
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
    // Audio: raw PCM (16-bit, 48 kHz, stereo) so no audio decoder is needed. On
    // Android 13+ `audio_dup` keeps the sound playing on the phone as well; before
    // that, capturing audio mutes the phone's own speaker.
    let want_audio = audio.unwrap_or(false);
    let audio_args = if want_audio {
        let sdk = tokio::process::Command::new(&adb)
            .args(["shell", "getprop", "ro.build.version.sdk"])
            .output()
            .await
            .ok()
            .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse::<u32>().ok())
            .unwrap_or(0);
        if sdk >= 33 {
            "audio=true audio_codec=raw audio_dup=true"
        } else {
            "audio=true audio_codec=raw"
        }
    } else {
        "audio=false"
    };
    let mut server_cmd = format!(
        "{classpath} app_process / com.genymobile.scrcpy.Server {SCRCPY_SERVER_VERSION} \
         scid={scid} log_level=warn {audio_args} control=true cleanup=true \
         send_frame_meta=false send_device_meta=false"
    );
    if let Some(m) = max_size {
        server_cmd.push_str(&format!(" max_size={m}"));
    }
    if let Some(b) = bitrate {
        server_cmd.push_str(&format!(" video_bit_rate={b}"));
    }
    // cap the frame rate the device encodes — fewer frames = less decode +
    // less IPC, which removes the backlog that makes the mirror feel laggy.
    server_cmd.push_str(&format!(" max_fps={}", max_fps.unwrap_or(30)));
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
    // The server connects in a fixed order: video, then audio (if enabled), then control.
    let mut video = accept_timeout(&listener, 10).await?;
    video.set_nodelay(true).ok();
    let audio_sock = if want_audio {
        Some(accept_timeout(&listener, 10).await?)
    } else {
        None
    };
    let control = accept_timeout(&listener, 10).await?;
    control.set_nodelay(true).ok();

    // Split the control socket: we write input events to one half, and a reader
    // task consumes device->client messages (clipboard) on the other half.
    let (control_rd, control_wr) = control.into_split();
    *state.control.lock().await = Some(control_wr);
    tokio::spawn(read_device_messages(control_rd, app.clone()));
    if let Some(sock) = audio_sock {
        tokio::spawn(stream_audio(sock, on_audio, state.running.clone(), app.clone()));
    }

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

    // With `send_stream_meta` (the server default) the codec id is followed by a
    // 12-byte SESSION header, [flags u32][width u32][height u32] big-endian (see
    // Streamer.writeSessionMeta in scrcpy v5.0.1). It is not video. Left in the
    // stream, a width such as 460 = 0x000001CC contains the bytes 00 00 01, which the
    // Annex-B splitter takes for a NAL start code; OpenH264 then rejects the fake NAL
    // and the UI shows "decode: ... Native:4". Consume it here instead, and use the
    // size it reports so touch mapping works before the first frame arrives.
    let mut session = [0u8; 12];
    video
        .read_exact(&mut session)
        .await
        .map_err(|e| format!("read session header: {e}"))?;
    let sess_w = u32::from_be_bytes([session[4], session[5], session[6], session[7]]);
    let sess_h = u32::from_be_bytes([session[8], session[9], session[10], session[11]]);
    if sess_w > 0 && sess_h > 0 {
        *state.size.lock().await = (sess_w, sess_h);
    }

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
    let frame_chan = on_frame.clone();
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
                // forbidden_zero_bit must be 0 in a real NAL header; a set bit means
                // stray bytes (e.g. a later session header) that look like a start code.
                if sc < unit.len() && unit[sc] & 0x80 != 0 {
                    continue;
                }
                decode_au(&mut decoder, unit, &app2, &frame_chan, &mut frame_count).await;
            }
        }
        *running.lock().await = false;
        let _ = app2.emit("mirror-stopped", ());
    });

    Ok(())
}

/// Decode one access unit (SPS/PPS/… + VCL slice) and send an RGBA frame over
/// the channel as raw bytes: [w:u32 BE][h:u32 BE][rgba...]. Sending raw bytes
/// (not base64-in-JSON) removes the biggest per-frame cost and the latency it
/// caused.
async fn decode_au(
    decoder: &mut openh264::decoder::Decoder,
    au: &[u8],
    app: &AppHandle,
    chan: &Channel<Response>,
    frame_count: &mut u64,
) {
    use openh264::formats::YUVSource;
    match decoder.decode(au) {
        Ok(Some(yuv)) => {
            let (w, h) = yuv.dimensions();
            let mut buf = vec![0u8; 8 + w * h * 4];
            buf[0..4].copy_from_slice(&(w as u32).to_be_bytes());
            buf[4..8].copy_from_slice(&(h as u32).to_be_bytes());
            yuv.write_rgba8(&mut buf[8..]);
            *frame_count += 1;
            let _ = chan.send(Response::new(buf));
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
    // don't lose a recording in progress when the mirror window closes
    let _ = finish_recording(&app, &state.rec).await;
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

/// Forward the device audio to the frontend. With `audio_codec=raw` and
/// `send_frame_meta=false` the stream is: [codec id u32] then continuous PCM
/// (signed 16-bit little-endian, 48 kHz, stereo = 4 bytes per frame). A codec id
/// of 0 means the server could not capture audio (e.g. Android < 11); 1 means a
/// configuration error. Either way mirroring video continues.
async fn stream_audio(
    mut sock: TcpStream,
    chan: Channel<Response>,
    running: Arc<Mutex<bool>>,
    app: AppHandle,
) {
    const CODEC_RAW: u32 = 0x0072_6177; // "\0raw"
    sock.set_nodelay(true).ok();
    let mut id = [0u8; 4];
    if sock.read_exact(&mut id).await.is_err() {
        return;
    }
    let codec = u32::from_be_bytes(id);
    if codec != CODEC_RAW {
        let _ = app.emit("mirror-audio", if codec == 0 { "unsupported" } else { "error" });
        return;
    }
    let _ = app.emit("mirror-audio", "on");

    let mut buf = vec![0u8; 16384];
    let mut carry: Vec<u8> = Vec::new(); // socket reads can split a 4-byte stereo frame
    loop {
        if !*running.lock().await {
            break;
        }
        let n = match sock.read(&mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        carry.extend_from_slice(&buf[..n]);
        let usable = carry.len() - carry.len() % 4;
        if usable == 0 {
            continue;
        }
        let out: Vec<u8> = carry.drain(..usable).collect();
        let _ = chan.send(Response::new(out));
    }
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Start recording the screen. Uses the device's `screenrecord` (it records in
/// 180 s chunks, so we start a new one back-to-back until stopped). There is no
/// audio in these recordings. Chunks are pulled to `dest_dir` on stop.
#[tauri::command]
pub async fn mirror_record_start(
    app: AppHandle,
    state: State<'_, MirrorState>,
    dest_dir: String,
) -> Result<(), String> {
    let mut guard = state.rec.lock().await;
    if guard.is_some() {
        return Err("already recording".into());
    }
    if !std::path::Path::new(&dest_dir).is_dir() {
        return Err("choose an existing folder to save the recording".into());
    }
    let adb = resolve_tool(&app, "adb");
    let stop = Arc::new(AtomicBool::new(false));
    let files = Arc::new(Mutex::new(Vec::<String>::new()));
    let stamp = now_secs();

    let (stop2, files2, app2) = (stop.clone(), files.clone(), app.clone());
    let handle = tokio::spawn(async move {
        let mut n = 1u32;
        while !stop2.load(Ordering::SeqCst) {
            let path = format!("/sdcard/droidbench-rec-{stamp}-{n}.mp4");
            files2.lock().await.push(path.clone());
            let out = tokio::process::Command::new(&adb)
                .args(["shell", "screenrecord", "--time-limit", "180", "--bit-rate", "8000000", &path])
                .output()
                .await;
            let failure = match out {
                Ok(o) if o.status.success() => None,
                Ok(o) => Some(String::from_utf8_lossy(&o.stderr).trim().to_string()),
                Err(e) => Some(e.to_string()),
            };
            if let Some(msg) = failure {
                if !stop2.load(Ordering::SeqCst) {
                    let _ = app2.emit("mirror-record-error", msg);
                }
                break;
            }
            n += 1;
        }
    });

    *guard = Some(RecSession { stop, files, dest: dest_dir, stamp, handle });
    Ok(())
}

/// Stop recording and copy the chunks to the chosen folder. Returns saved paths.
#[tauri::command]
pub async fn mirror_record_stop(
    app: AppHandle,
    state: State<'_, MirrorState>,
) -> Result<Vec<String>, String> {
    finish_recording(&app, &state.rec).await
}

async fn finish_recording(
    app: &AppHandle,
    rec: &Arc<Mutex<Option<RecSession>>>,
) -> Result<Vec<String>, String> {
    let Some(sess) = rec.lock().await.take() else {
        return Ok(vec![]);
    };
    let RecSession { stop, files, dest, stamp, handle } = sess;
    stop.store(true, Ordering::SeqCst);
    let adb = resolve_tool(app, "adb");

    // SIGINT makes screenrecord finalize the MP4. Merely killing the host-side adb
    // would leave it running on the device and the file without its index (unplayable).
    let _ = tokio::process::Command::new(&adb)
        .args(["shell", "pkill", "-2", "screenrecord"])
        .output()
        .await;
    let _ = tokio::time::timeout(std::time::Duration::from_secs(20), handle).await;

    let remote_files = files.lock().await.clone();
    let multi = remote_files.len() > 1;
    let mut saved = Vec::new();
    for (i, remote) in remote_files.iter().enumerate() {
        // skip chunks that never got data (e.g. started right as we stopped)
        let size = tokio::process::Command::new(&adb)
            .args(["shell", "stat", "-c", "%s", remote])
            .output()
            .await
            .ok()
            .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse::<u64>().ok())
            .unwrap_or(0);
        if size > 0 {
            let name = if multi {
                format!("droidbench_rec_{stamp}_part{}.mp4", i + 1)
            } else {
                format!("droidbench_rec_{stamp}.mp4")
            };
            let local = std::path::Path::new(&dest).join(name);
            let ok = tokio::process::Command::new(&adb)
                .args(["pull", remote, &local.to_string_lossy()])
                .output()
                .await
                .map(|o| o.status.success())
                .unwrap_or(false);
            if ok {
                saved.push(local.to_string_lossy().to_string());
            }
        }
        let _ = tokio::process::Command::new(&adb)
            .args(["shell", "rm", "-f", remote])
            .output()
            .await;
    }
    Ok(saved)
}

/// Reader for the control socket's device->client direction. Per scrcpy's
/// DeviceMessageWriter: [type u8] then
///   0 CLIPBOARD     [len u32][utf8 text]
///   1 ACK_CLIPBOARD [sequence u64]
///   2 UHID_OUTPUT   [id u16][len u16][data]
/// A device clipboard change (or a GET_CLIPBOARD reply) is written straight into
/// the PC clipboard natively. We emit only the character COUNT to the UI —
/// never the clipboard contents — so nothing sensitive reaches the log panel.
async fn read_device_messages(mut rd: OwnedReadHalf, app: AppHandle) {
    const MAX_MSG: usize = 1 << 18; // matches the server's 256k message cap
    loop {
        let mut t = [0u8; 1];
        if rd.read_exact(&mut t).await.is_err() {
            break; // socket closed (mirror stopped / server exited)
        }
        match t[0] {
            0 => {
                let mut lb = [0u8; 4];
                if rd.read_exact(&mut lb).await.is_err() {
                    break;
                }
                let len = u32::from_be_bytes(lb) as usize;
                if len > MAX_MSG {
                    break; // protocol desync — stop rather than allocate wildly
                }
                let mut buf = vec![0u8; len];
                if rd.read_exact(&mut buf).await.is_err() {
                    break;
                }
                let text = String::from_utf8_lossy(&buf).to_string();
                let chars = text.chars().count();
                if crate::control::set_pc_clipboard(text).await.is_ok() {
                    let _ = app.emit("mirror-clipboard", chars);
                }
            }
            1 => {
                let mut b = [0u8; 8];
                if rd.read_exact(&mut b).await.is_err() {
                    break;
                }
            }
            2 => {
                let mut h = [0u8; 4];
                if rd.read_exact(&mut h).await.is_err() {
                    break;
                }
                let len = u16::from_be_bytes([h[2], h[3]]) as usize;
                let mut data = vec![0u8; len];
                if rd.read_exact(&mut data).await.is_err() {
                    break;
                }
            }
            _ => break, // unknown message type: stream is out of sync
        }
    }
}

/// Reboot the phone (`adb reboot`). The frontend asks for confirmation first.
#[tauri::command]
pub async fn mirror_reboot(app: AppHandle) -> Result<(), String> {
    let adb = resolve_tool(&app, "adb");
    run_adb(&adb, &["reboot"]).await
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
