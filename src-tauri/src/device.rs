// Device detection: figures out whether a device is connected via adb,
// fastboot, or heimdall (download mode), and reads brand/model/ROM via getprop.

use serde::Serialize;
use tauri::AppHandle;

use crate::runner::{resolve_tool, run_capture_internal};

#[derive(Clone, Serialize, Default)]
pub struct DeviceInfo {
    pub connected: bool,
    pub mode: String,   // "adb" | "fastboot" | "download" | "none"
    /// Raw adb connection state when a device is seen on USB but not ready:
    /// "" (ready/none) | "unauthorized" | "offline"
    #[serde(rename = "adbState")]
    pub adb_state: String,
    pub serial: String,
    pub brand: String,
    pub model: String,
    pub android: String,
    pub rom: String, // MIUI/HyperOS/OneUI version etc.
}

async fn getprop(app: &AppHandle, prop: &str) -> String {
    let out = run_capture_internal(
        app,
        "adb",
        &["shell".into(), "getprop".into(), prop.into()],
    )
    .await
    .unwrap_or_default();
    out.trim().to_string()
}

#[tauri::command]
pub async fn detect_device(app: AppHandle) -> Result<DeviceInfo, String> {
    let mut info = DeviceInfo::default();
    info.mode = "none".into();

    // 1) adb devices
    let adb_out = run_capture_internal(&app, "adb", &["devices".into()])
        .await
        .unwrap_or_default();
    let adb_serial = adb_out
        .lines()
        .skip(1)
        .find_map(|l| {
            let l = l.trim();
            if l.ends_with("\tdevice") || l.ends_with(" device") {
                Some(l.split_whitespace().next().unwrap_or("").to_string())
            } else {
                None
            }
        });

    if let Some(serial) = adb_serial {
        info.connected = true;
        info.mode = "adb".into();
        info.serial = serial;
        info.brand = {
            let b = getprop(&app, "ro.product.brand").await;
            if b.is_empty() { getprop(&app, "ro.product.manufacturer").await } else { b }
        };
        info.model = getprop(&app, "ro.product.model").await;
        info.android = getprop(&app, "ro.build.version.release").await;
        // ROM flavor: try MIUI/HyperOS then OneUI then build id
        let miui = getprop(&app, "ro.miui.ui.version.name").await;
        let hyperos = getprop(&app, "ro.mi.os.version.name").await;
        let oneui = getprop(&app, "ro.build.version.oneui").await;
        info.rom = if !hyperos.is_empty() {
            format!("HyperOS {hyperos}")
        } else if !miui.is_empty() {
            format!("MIUI {miui}")
        } else if !oneui.is_empty() {
            format!("OneUI {oneui}")
        } else {
            getprop(&app, "ro.build.display.id").await
        };
        return Ok(info);
    }

    // 1b) a device is plugged in but not ready: unauthorized / offline.
    // These are crucial for guiding a first-time user through setup.
    for l in adb_out.lines().skip(1) {
        let l = l.trim();
        if l.is_empty() {
            continue;
        }
        if l.ends_with("unauthorized") {
            info.mode = "none".into();
            info.adb_state = "unauthorized".into();
            info.serial = l.split_whitespace().next().unwrap_or("").to_string();
            return Ok(info);
        }
        if l.ends_with("offline") {
            info.mode = "none".into();
            info.adb_state = "offline".into();
            info.serial = l.split_whitespace().next().unwrap_or("").to_string();
            return Ok(info);
        }
    }

    // 2) fastboot devices
    let fb_out = run_capture_internal(&app, "fastboot", &["devices".into()])
        .await
        .unwrap_or_default();
    if let Some(line) = fb_out.lines().find(|l| l.trim().ends_with("fastboot")) {
        info.connected = true;
        info.mode = "fastboot".into();
        info.serial = line.split_whitespace().next().unwrap_or("").to_string();
        // best-effort product via getvar
        let prod = run_capture_internal(&app, "fastboot", &["getvar".into(), "product".into()])
            .await
            .unwrap_or_default();
        for l in prod.lines() {
            if let Some(rest) = l.strip_prefix("product:") {
                info.model = rest.trim().to_string();
            }
        }
        return Ok(info);
    }

    // 3) heimdall detect (samsung download mode)
    let _ = resolve_tool(&app, "heimdall"); // ensure resolvable; ignore result
    let hd_out = run_capture_internal(&app, "heimdall", &["detect".into()])
        .await
        .unwrap_or_default();
    if hd_out.to_lowercase().contains("device detected") {
        info.connected = true;
        info.mode = "download".into();
        info.brand = "Samsung".into();
        return Ok(info);
    }

    Ok(info)
}
