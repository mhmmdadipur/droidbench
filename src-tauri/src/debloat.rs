// Debloat support: loads bundled package databases (Xiaomi / Universal / TV)
// and queries which packages are currently installed/enabled on the device.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::runner::run_capture_internal;

#[derive(Clone, Serialize, Deserialize)]
pub struct DebloatEntry {
    pub package: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub safe: bool,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct DebloatCategory {
    pub name: String,
    pub entries: Vec<DebloatEntry>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct DebloatDatabase {
    pub id: String,
    pub name: String,
    pub source: String,
    pub categories: Vec<DebloatCategory>,
}

/// Load a bundled debloat database JSON by id (xiaomi/universal/tv).
#[tauri::command]
pub async fn load_debloat_db(app: AppHandle, id: String) -> Result<DebloatDatabase, String> {
    // production: resource_dir/databases/<id>.json ; dev: ./databases/<id>.json
    let file_name = format!("{id}.json");

    let mut content: Option<String> = None;
    // a copy refreshed from the internet (see save_debloat_db) wins over the bundled one
    if let Ok(data_dir) = app.path().app_data_dir() {
        let updated = data_dir.join("databases").join(&file_name);
        if updated.exists() {
            content = std::fs::read_to_string(&updated).ok();
        }
    }
    if content.is_none() {
        if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("databases").join(&file_name);
        if candidate.exists() {
            content = std::fs::read_to_string(&candidate).ok();
        }
    }
    }
    if content.is_none() {
        let dev = std::path::Path::new("databases").join(&file_name);
        if dev.exists() {
            content = std::fs::read_to_string(&dev).ok();
        }
    }
    let content = content.ok_or_else(|| format!("database `{id}` not found"))?;
    serde_json::from_str::<DebloatDatabase>(&content).map_err(|e| e.to_string())
}

/// Store a debloat database downloaded by the frontend, so it replaces the bundled copy.
/// The JSON must parse as a `DebloatDatabase` with the same id and at least one package;
/// anything else is rejected instead of being saved over a working list.
#[tauri::command]
pub async fn save_debloat_db(app: AppHandle, id: String, json: String) -> Result<usize, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("invalid database id".into());
    }
    let db: DebloatDatabase = serde_json::from_str(&json).map_err(|e| format!("invalid database: {e}"))?;
    if db.id != id {
        return Err(format!("database id mismatch: {} != {}", db.id, id));
    }
    let total: usize = db.categories.iter().map(|c| c.entries.len()).sum();
    if total == 0 {
        return Err("the downloaded list is empty".into());
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("databases");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // write to a temp file first so a crash never leaves a half-written list
    let tmp = dir.join(format!("{id}.json.tmp"));
    std::fs::write(&tmp, &json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(format!("{id}.json"))).map_err(|e| e.to_string())?;
    Ok(total)
}

/// Return the set of package names currently present on the device
/// (via `adb shell pm list packages`), so the UI can mark status.
#[tauri::command]
pub async fn list_installed_packages(app: AppHandle) -> Result<Vec<String>, String> {
    let out = run_capture_internal(
        &app,
        "adb",
        &["shell".into(), "pm".into(), "list".into(), "packages".into()],
    )
    .await?;
    let set: HashSet<String> = out
        .lines()
        .filter_map(|l| l.trim().strip_prefix("package:").map(|s| s.trim().to_string()))
        .collect();
    Ok(set.into_iter().collect())
}

/// Return disabled packages so UI can show OFF status.
#[tauri::command]
pub async fn list_disabled_packages(app: AppHandle) -> Result<Vec<String>, String> {
    let out = run_capture_internal(
        &app,
        "adb",
        &[
            "shell".into(),
            "pm".into(),
            "list".into(),
            "packages".into(),
            "-d".into(),
        ],
    )
    .await?;
    let v: Vec<String> = out
        .lines()
        .filter_map(|l| l.trim().strip_prefix("package:").map(|s| s.trim().to_string()))
        .collect();
    Ok(v)
}
