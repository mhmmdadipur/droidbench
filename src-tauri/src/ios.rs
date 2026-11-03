// iOS diagnostics via libimobiledevice (usbmux/lockdown). No jailbreak needed.
//
// Everything here is READ-ONLY: we query the device's lockdown + diagnostics
// services the same way tools like 3uTools do. We bundle `ideviceinfo` and
// `idevicediagnostics` as sidecars (see runner::resolve_tool).

use serde::Serialize;
use tauri::AppHandle;

use crate::runner::run_capture_internal;

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
    // Health %: iOS is inconsistent about FullChargeCapacity. On many devices it
    // is reported in mAh (e.g. 2300) → health = full/design*100. On others it is
    // already a 0–100 percentage (e.g. 100) → use it directly. We disambiguate
    // by magnitude: a value <= 100 is a percentage, a larger value is mAh.
    match (r.battery_design_capacity, r.battery_full_capacity) {
        (_, Some(full)) if full > 0 && full <= 100 => {
            // already a health percentage
            r.battery_health_pct = Some(full);
            // the "100" isn't a real mAh capacity — don't show it as one
            r.battery_full_capacity = None;
        }
        (Some(d), Some(full)) if d > 0 && full > 100 => {
            r.battery_health_pct = Some(((full as f64 / d as f64) * 100.0).round() as i64);
        }
        _ => {}
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
