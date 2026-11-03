// iOS diagnostics via libimobiledevice (usbmux/lockdown). No jailbreak needed.
//
// Everything here is READ-ONLY: we query the device's lockdown + diagnostics
// services the same way tools like 3uTools do. We bundle `ideviceinfo` and
// `idevicediagnostics` as sidecars (see runner::resolve_tool).

use serde::Serialize;
use std::sync::Arc;
use tauri::ipc::{Channel, Response};
use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::runner::{resolve_tool, run_capture_internal};

/// Holds the running go-ios screenshot-stream child so the mirror can be stopped.
#[derive(Default)]
pub struct IosMirrorState {
    pub child: Arc<Mutex<Option<tokio::process::Child>>>,
    pub running: Arc<Mutex<bool>>,
}

/// A flat iOS report for the Diagnostik-style iOS tab.
#[derive(Clone, Serialize, Default)]
pub struct IosReport {
    pub udid: String,
    pub device_name: String,
    pub product_type: String, // e.g. iPhone14,5
    pub marketing_name: String, // e.g. iPhone 13
    pub ios_version: String,
    pub build_version: String,
    pub serial: String,
    pub imei: String,
    pub region: String,
    pub wifi_mac: String,
    pub bluetooth_mac: String,
    pub cpu_arch: String,
    pub activation_state: String, // Activated / Unactivated
    pub disk_total_bytes: Option<u64>,
    pub disk_free_bytes: Option<u64>,
    // battery
    pub battery_percent: Option<i64>,
    pub battery_cycle_count: Option<i64>,
    pub battery_design_capacity: Option<i64>, // mAh
    pub battery_full_capacity: Option<i64>,   // mAh (current full-charge capacity)
    pub battery_health_pct: Option<i64>,      // full/design * 100
}

async fn info_key(app: &AppHandle, udid: &str, domain: Option<&str>, key: &str) -> String {
    let mut args: Vec<String> = vec!["-u".into(), udid.into()];
    if let Some(d) = domain {
        args.push("-q".into());
        args.push(d.into());
    }
    args.push("-k".into());
    args.push(key.into());
    run_capture_internal(app, "ideviceinfo", &args)
        .await
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn parse_i64(s: &str) -> Option<i64> {
    let t = s.trim();
    if t.is_empty() {
        return None;
    }
    t.parse::<i64>().ok()
}

/// Collect the full iOS device report (info + storage + battery).
#[tauri::command]
pub async fn ios_info(app: AppHandle, udid: String) -> Result<IosReport, String> {
    if udid.trim().is_empty() {
        return Err("no iOS device UDID".into());
    }
    let mut r = IosReport {
        udid: udid.clone(),
        ..Default::default()
    };

    r.device_name = info_key(&app, &udid, None, "DeviceName").await;
    r.product_type = info_key(&app, &udid, None, "ProductType").await;
    r.ios_version = info_key(&app, &udid, None, "ProductVersion").await;
    r.build_version = info_key(&app, &udid, None, "BuildVersion").await;
    r.serial = info_key(&app, &udid, None, "SerialNumber").await;
    r.imei = info_key(&app, &udid, None, "InternationalMobileEquipmentIdentity").await;
    r.region = info_key(&app, &udid, None, "RegionInfo").await;
    r.wifi_mac = info_key(&app, &udid, None, "WiFiAddress").await;
    r.bluetooth_mac = info_key(&app, &udid, None, "BluetoothAddress").await;
    r.cpu_arch = info_key(&app, &udid, None, "CPUArchitecture").await;
    r.activation_state = info_key(&app, &udid, None, "ActivationState").await;
    r.marketing_name = marketing_name(&r.product_type);

    // storage via the disk usage domain
    let total = info_key(&app, &udid, Some("com.apple.disk_usage"), "TotalDiskCapacity").await;
    let free = info_key(&app, &udid, Some("com.apple.disk_usage"), "AmountDataAvailable").await;
    r.disk_total_bytes = total.trim().parse::<u64>().ok();
    r.disk_free_bytes = free.trim().parse::<u64>().ok();

    // battery via the battery domain (lockdown) — works on most non-jailbroken
    // devices and is how battery apps read iPhone health.
    let bd = Some("com.apple.mobile.battery");
    r.battery_percent = parse_i64(&info_key(&app, &udid, bd, "BatteryCurrentCapacity").await);

    // deeper gauge data via idevicediagnostics GasGauge (cycle count, mAh)
    let gauge = run_capture_internal(
        &app,
        "idevicediagnostics",
        &["-u".into(), udid.clone(), "diagnostics".into(), "GasGauge".into()],
    )
    .await
    .unwrap_or_default();
    r.battery_cycle_count = extract_int(&gauge, "CycleCount");
    r.battery_design_capacity = extract_int(&gauge, "DesignCapacity");
    r.battery_full_capacity = extract_int(&gauge, "FullChargeCapacity");
    // Battery HEALTH %: only trustworthy when GasGauge exposes a real mAh pair
    // (design > 0 AND full-charge in mAh, i.e. clearly > 100). On iOS 17+ the
    // diagnostics relay returns FullChargeCapacity=100 with NO DesignCapacity —
    // a placeholder, NOT a real 100% health — so we must NOT report a number
    // there (it would wrongly show 100% when the phone is e.g. 88%). We leave
    // health unknown and only keep the reliable CycleCount + current level.
    match (r.battery_design_capacity, r.battery_full_capacity) {
        (Some(d), Some(full)) if d > 100 && full > 100 => {
            r.battery_health_pct = Some(((full as f64 / d as f64) * 100.0).round() as i64);
        }
        _ => {
            // not reliably exposed (common on modern iOS) — report unknown
            r.battery_health_pct = None;
            r.battery_full_capacity = None;
            r.battery_design_capacity = None;
        }
    }

    Ok(r)
}

/// Pull the first integer value following a `<key>Name</key>` or `Name = n`
/// pattern out of a plist/ioreg-ish text dump (idevicediagnostics output).
fn extract_int(dump: &str, key: &str) -> Option<i64> {
    // plist style: <key>CycleCount</key><integer>123</integer>
    if let Some(pos) = dump.find(key) {
        let tail = &dump[pos + key.len()..];
        // find the first run of digits (optionally after <integer> or =)
        let mut digits = String::new();
        let mut started = false;
        for ch in tail.chars() {
            if ch.is_ascii_digit() {
                digits.push(ch);
                started = true;
            } else if started {
                break;
            } else if digits.len() > 24 {
                break;
            }
        }
        if !digits.is_empty() {
            return digits.parse::<i64>().ok();
        }
    }
    None
}

/// Map a ProductType (iPhone14,5) to a human marketing name where known.
/// Falls back to the raw product type for unknown/newer models.
fn marketing_name(product: &str) -> String {
    let name = match product {
        "iPhone10,1" | "iPhone10,4" => "iPhone 8",
        "iPhone10,2" | "iPhone10,5" => "iPhone 8 Plus",
        "iPhone10,3" | "iPhone10,6" => "iPhone X",
        "iPhone11,2" => "iPhone XS",
        "iPhone11,4" | "iPhone11,6" => "iPhone XS Max",
        "iPhone11,8" => "iPhone XR",
        "iPhone12,1" => "iPhone 11",
        "iPhone12,3" => "iPhone 11 Pro",
        "iPhone12,5" => "iPhone 11 Pro Max",
        "iPhone12,8" => "iPhone SE (2nd gen)",
        "iPhone13,1" => "iPhone 12 mini",
        "iPhone13,2" => "iPhone 12",
        "iPhone13,3" => "iPhone 12 Pro",
        "iPhone13,4" => "iPhone 12 Pro Max",
        "iPhone14,2" => "iPhone 13 Pro",
        "iPhone14,3" => "iPhone 13 Pro Max",
        "iPhone14,4" => "iPhone 13 mini",
        "iPhone14,5" => "iPhone 13",
        "iPhone14,6" => "iPhone SE (3rd gen)",
        "iPhone14,7" => "iPhone 14",
        "iPhone14,8" => "iPhone 14 Plus",
        "iPhone15,2" => "iPhone 14 Pro",
        "iPhone15,3" => "iPhone 14 Pro Max",
        "iPhone15,4" => "iPhone 15",
        "iPhone15,5" => "iPhone 15 Plus",
        "iPhone16,1" => "iPhone 15 Pro",
        "iPhone16,2" => "iPhone 15 Pro Max",
        "iPhone17,3" => "iPhone 16",
        "iPhone17,4" => "iPhone 16 Plus",
        "iPhone17,1" => "iPhone 16 Pro",
        "iPhone17,2" => "iPhone 16 Pro Max",
        _ => "",
    };
    if name.is_empty() {
        product.to_string()
    } else {
        name.to_string()
    }
}

/// Capture a screenshot from the connected iOS device into `dest_dir` and
/// return the saved file path. Uses libimobiledevice's `idevicescreenshot`
/// (PNG on iOS 9+). Requires a mounted developer disk image / Developer Mode.
#[tauri::command]
pub async fn ios_screenshot(app: AppHandle, udid: String, dest_dir: String) -> Result<String, String> {
    if udid.trim().is_empty() {
        return Err("no iOS device UDID".into());
    }
    // build a timestamped destination filename
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let sep = if cfg!(windows) { "\\" } else { "/" };
    let dir = dest_dir.trim_end_matches(['/', '\\']);
    let out_path = format!("{dir}{sep}ios_screenshot_{ts}.png");

    let out = run_capture_internal(
        &app,
        "idevicescreenshot",
        &["-u".into(), udid, out_path.clone()],
    )
    .await?;

    // idevicescreenshot prints "Screenshot saved to <file>" on success; verify
    // the file actually exists before reporting success.
    if std::path::Path::new(&out_path).exists() {
        Ok(out_path)
    } else {
        Err(if out.trim().is_empty() {
            "screenshot failed — is Developer Mode / developer disk image enabled on the device?".into()
        } else {
            out.trim().to_string()
        })
    }
}

// ─── iOS screen mirror (read-only, via go-ios MJPEG stream over USB) ─────────
//
// go-ios (`ios-mirror screenshot --stream --port=<p>`) serves a standard MJPEG
// multipart stream at http://127.0.0.1:<p>/ . We read that stream, split it on
// the multipart boundary into individual JPEG frames, and forward each raw JPEG
// to the frontend over a Tauri Channel (the frontend renders it to an <img>).
//
// Read-only: iOS gives no touch-control path without a jailbreak. iOS 17+ also
// needs `ios tunnel start` (a privileged daemon); iOS <= 16 works directly.

// go-ios v1.3.2 ignores --port and always serves the MJPEG stream on 3333.
const IOS_MIRROR_PORT: u16 = 3333;

#[tauri::command]
pub async fn ios_mirror_start(
    app: AppHandle,
    state: tauri::State<'_, IosMirrorState>,
    udid: String,
    on_frame: Channel<Response>,
) -> Result<(), String> {
    // Always tear down any previous session first (don't reject) — a stale
    // `running` flag or a leftover child from a closed window must not block a
    // fresh start. This makes the mirror re-openable after any abnormal exit.
    {
        *state.running.lock().await = false;
        if let Some(mut old) = state.child.lock().await.take() {
            let _ = old.kill().await;
        }
    }
    // give the old go-ios process a moment to release port 3333
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    // Safety net: kill any stray ios-mirror (go-ios) process left from a crash
    // or a pre-fix run that is still holding port 3333.
    #[cfg(not(windows))]
    {
        let _ = tokio::process::Command::new("pkill")
            .args(["-f", "ios-mirror"])
            .output()
            .await;
    }
    #[cfg(windows)]
    {
        let _ = tokio::process::Command::new("taskkill")
            .args(["/F", "/IM", "ios-mirror.exe"])
            .output()
            .await;
    }
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    *state.running.lock().await = true;

    let tool = resolve_tool(&app, "ios-mirror");

    // start the go-ios MJPEG stream server (it always listens on 3333)
    let mut cmd = tokio::process::Command::new(&tool);
    cmd.args(["screenshot", "--stream"]);
    if !udid.trim().is_empty() {
        cmd.arg(format!("--udid={udid}"));
    }
    cmd.stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .stdin(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("failed to start ios-mirror: {e}"))?;
    *state.child.lock().await = Some(child);

    let running = state.running.clone();
    let child_handle = state.child.clone();
    tokio::spawn(async move {
        // give the stream server a moment to come up, then connect + read frames
        let url = format!("http://127.0.0.1:{IOS_MIRROR_PORT}/");
        let mut attempts = 0;
        let stream = loop {
            if !*running.lock().await {
                return;
            }
            match tokio::net::TcpStream::connect(("127.0.0.1", IOS_MIRROR_PORT)).await {
                Ok(s) => break s,
                Err(_) => {
                    attempts += 1;
                    if attempts > 50 {
                        use tauri::Emitter;
                        let _ = app.emit("ios-mirror-error", "ios mirror: stream server never came up".to_string());
                        *running.lock().await = false;
                        return;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                }
            }
        };
        let _ = url; // (kept for clarity; we speak HTTP manually below)

        if let Err(e) = read_mjpeg(stream, &on_frame, &running).await {
            use tauri::Emitter;
            let _ = app.emit("ios-mirror-error", format!("ios mirror: {e}"));
        }
        *running.lock().await = false;
        // ensure the child is reaped
        if let Some(mut c) = child_handle.lock().await.take() {
            let _ = c.kill().await;
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn ios_mirror_stop(state: tauri::State<'_, IosMirrorState>) -> Result<(), String> {
    *state.running.lock().await = false;
    if let Some(mut child) = state.child.lock().await.take() {
        let _ = child.kill().await;
    }
    Ok(())
}

/// Minimal HTTP + multipart/x-mixed-replace reader: sends the GET request, skips
/// response headers, then scans the body for JPEG frames (SOI 0xFFD8 … EOI
/// 0xFFD9) and forwards each complete frame as raw bytes over the channel.
async fn read_mjpeg(
    mut stream: tokio::net::TcpStream,
    chan: &Channel<Response>,
    running: &Arc<Mutex<bool>>,
) -> Result<(), String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    stream
        .write_all(b"GET / HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n")
        .await
        .map_err(|e| e.to_string())?;
    stream.set_nodelay(true).ok();

    let mut acc: Vec<u8> = Vec::with_capacity(1 << 20);
    let mut buf = vec![0u8; 65536];

    loop {
        if !*running.lock().await {
            return Ok(());
        }
        let n = match stream.read(&mut buf).await {
            Ok(0) => return Ok(()),
            Ok(n) => n,
            Err(e) => return Err(e.to_string()),
        };
        acc.extend_from_slice(&buf[..n]);

        // extract every complete JPEG (FFD8 … FFD9) currently buffered
        loop {
            let start = match find_marker(&acc, 0, 0xD8) {
                Some(i) => i,
                None => {
                    // no SOI yet — keep only a small tail to avoid unbounded growth
                    if acc.len() > 1 << 20 {
                        acc.drain(0..acc.len() - 4);
                    }
                    break;
                }
            };
            let end = match find_marker(&acc, start + 2, 0xD9) {
                Some(i) => i + 2, // include the EOI marker
                None => {
                    // incomplete frame — drop anything before SOI and wait for more
                    if start > 0 {
                        acc.drain(0..start);
                    }
                    break;
                }
            };
            let frame: Vec<u8> = acc[start..end].to_vec();
            acc.drain(0..end);
            let _ = chan.send(Response::new(frame));
        }
    }
}

/// Find a JPEG marker `0xFF <code>` at or after `from`. Returns the index of FF.
fn find_marker(d: &[u8], from: usize, code: u8) -> Option<usize> {
    let mut i = from;
    while i + 1 < d.len() {
        if d[i] == 0xFF && d[i + 1] == code {
            return Some(i);
        }
        i += 1;
    }
    None
}
