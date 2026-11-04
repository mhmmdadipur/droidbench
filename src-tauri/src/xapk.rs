// Install app bundles that adb can't take directly: .xapk (APKPure), .apkm
// (APKMirror) and .apks (bundletool). They are all ZIP archives holding a base
// APK, optional split APKs (config.*.apk), and — for XAPK — optional OBB
// expansion files plus a manifest.json describing them.
//
//   • APKs are installed with `adb install` / `adb install-multiple`.
//   • OBB files are pushed to /sdcard/Android/obb/<package>/.
//
// The archive comes from the internet, so extraction is defensive: entries that
// would escape the temp dir (zip-slip) are skipped, and OBB destinations are
// restricted to Android/obb/ with a conservative character set.

use std::fs::File;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::Deserialize;
use tauri::{AppHandle, Emitter};

use crate::runner::{resolve_tool, CommandDone, LogLine};

#[derive(Deserialize, Default)]
struct Manifest {
    #[serde(default)]
    split_apks: Vec<SplitApk>,
    #[serde(default)]
    expansions: Vec<Expansion>,
}

#[derive(Deserialize)]
struct SplitApk {
    file: String,
}

#[derive(Deserialize)]
struct Expansion {
    file: Option<String>,
    install_path: Option<String>,
}

struct Extracted {
    apks: Vec<PathBuf>,
    /// (local temp file, destination relative to /sdcard, e.g. Android/obb/pkg/x.obb)
    obbs: Vec<(PathBuf, String)>,
    skipped: Vec<String>,
}

fn file_name_of(p: &str) -> String {
    p.replace('\\', "/").rsplit('/').next().unwrap_or("").to_string()
}

/// A safe destination under Android/obb/, or None.
fn obb_dest(zip_name: &str, m: &Manifest) -> Option<String> {
    let mut dest = zip_name.replace('\\', "/");
    for e in &m.expansions {
        if e.file.as_deref().map(|f| f.replace('\\', "/")) == Some(dest.clone()) {
            if let Some(p) = &e.install_path {
                dest = p.replace('\\', "/");
            }
        }
    }
    let charset_ok = dest
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '/'));
    let parts_ok = !dest.split('/').any(|s| s.is_empty() || s == "..");
    if dest.starts_with("Android/obb/") && charset_ok && parts_ok {
        Some(dest)
    } else {
        None
    }
}

fn copy_entry(entry: &mut impl Read, out: &Path) -> Result<(), String> {
    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create dir: {e}"))?;
    }
    let mut f = File::create(out).map_err(|e| format!("create {}: {e}", out.display()))?;
    std::io::copy(entry, &mut f).map_err(|e| format!("extract {}: {e}", out.display()))?;
    Ok(())
}

fn extract(zip_path: &Path, dir: &Path) -> Result<Extracted, String> {
    let file = File::open(zip_path).map_err(|e| format!("open file: {e}"))?;
    let mut zip = zip::ZipArchive::new(BufReader::new(file))
        .map_err(|e| format!("not a valid app bundle (zip): {e}"))?;

    // manifest.json is optional (.apkm / .apks usually have none)
    let manifest: Manifest = match zip.by_name("manifest.json") {
        Ok(mut f) => {
            let mut s = String::new();
            let _ = f.read_to_string(&mut s);
            serde_json::from_str(s.trim_start_matches('\u{feff}')).unwrap_or_default()
        }
        Err(_) => Manifest::default(),
    };
    let wanted: Vec<String> = manifest.split_apks.iter().map(|s| file_name_of(&s.file)).collect();

    std::fs::create_dir_all(dir).map_err(|e| format!("create temp dir: {e}"))?;
    let mut out = Extracted { apks: Vec::new(), obbs: Vec::new(), skipped: Vec::new() };

    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("read entry: {e}"))?;
        if entry.is_dir() {
            continue;
        }
        // enclosed_name() is None for absolute paths and `..` traversal.
        let Some(rel) = entry.enclosed_name() else {
            out.skipped.push(entry.name().map(|n| n.into_owned()).unwrap_or_default());
            continue;
        };
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        let lower = rel_str.to_lowercase();
        let fname = rel
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        if lower.ends_with(".apk") {
            if !wanted.is_empty() && !wanted.contains(&fname) {
                continue; // the manifest says this APK isn't part of the install
            }
            let dst = dir.join(&fname);
            copy_entry(&mut entry, &dst)?;
            out.apks.push(dst);
        } else if lower.ends_with(".obb") {
            match obb_dest(&rel_str, &manifest) {
                Some(dest) => {
                    let dst = dir.join("obb").join(format!("{i}.obb"));
                    copy_entry(&mut entry, &dst)?;
                    out.obbs.push((dst, dest));
                }
                None => out.skipped.push(rel_str),
            }
        }
    }
    Ok(out)
}

fn say(app: &AppHandle, id: &str, stream: &str, line: impl Into<String>) {
    let _ = app.emit(
        "log-line",
        LogLine { id: id.to_string(), stream: stream.to_string(), line: line.into() },
    );
}

/// Run adb, log its output, and return the combined text (Err on non-zero exit).
async fn adb(app: &AppHandle, id: &str, adb_path: &str, args: &[String]) -> Result<String, String> {
    let mut cmd = tokio::process::Command::new(adb_path);
    cmd.args(args).stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let out = cmd.output().await.map_err(|e| format!("failed to run adb: {e}"))?;
    let mut text = String::from_utf8_lossy(&out.stdout).to_string();
    text.push_str(&String::from_utf8_lossy(&out.stderr));
    let stream = if out.status.success() { "stdout" } else { "stderr" };
    for l in text.lines().filter(|l| !l.trim().is_empty()) {
        say(app, id, stream, l.trim());
    }
    if out.status.success() {
        Ok(text)
    } else {
        Err(text)
    }
}

async fn run_install(app: &AppHandle, id: &str, path: &str, grant: bool, reinstall: bool) -> bool {
    let tmp = std::env::temp_dir().join(format!("droidbench-xapk-{}", &id[..8]));
    say(app, id, "system", format!("Reading bundle: {path}"));

    let (zp, td) = (PathBuf::from(path), tmp.clone());
    let extracted = match tokio::task::spawn_blocking(move || extract(&zp, &td)).await {
        Ok(Ok(e)) => e,
        Ok(Err(e)) => {
            say(app, id, "stderr", e);
            let _ = std::fs::remove_dir_all(&tmp);
            return false;
        }
        Err(e) => {
            say(app, id, "stderr", format!("extract task failed: {e}"));
            let _ = std::fs::remove_dir_all(&tmp);
            return false;
        }
    };

    for s in &extracted.skipped {
        say(app, id, "stderr", format!("Skipped unsafe or unsupported entry: {s}"));
    }
    if extracted.apks.is_empty() {
        say(app, id, "stderr", "No .apk found inside the bundle.");
        let _ = std::fs::remove_dir_all(&tmp);
        return false;
    }
    say(
        app,
        id,
        "system",
        format!("Found {} APK(s) and {} OBB file(s).", extracted.apks.len(), extracted.obbs.len()),
    );

    let adb_path = resolve_tool(app, "adb");
    let mut args: Vec<String> = vec![if extracted.apks.len() > 1 { "install-multiple" } else { "install" }.into()];
    if reinstall {
        args.push("-r".into());
    }
    if grant {
        args.push("-g".into());
    }
    for a in &extracted.apks {
        args.push(a.to_string_lossy().to_string());
    }
    say(app, id, "system", "Installing APK(s)…");
    let ok = match adb(app, id, &adb_path, &args).await {
        Ok(t) => t.contains("Success"),
        Err(_) => false,
    };
    if !ok {
        say(app, id, "stderr", "APK install failed — OBB files were not copied.");
        let _ = std::fs::remove_dir_all(&tmp);
        return false;
    }

    // OBB expansion files go to /sdcard/Android/obb/<package>/
    let mut all_ok = true;
    for (local, dest) in &extracted.obbs {
        let remote = format!("/sdcard/{dest}");
        let parent = remote.rsplit_once('/').map(|(p, _)| p.to_string()).unwrap_or_default();
        say(app, id, "system", format!("Copying OBB to {remote}"));
        let mk = ["shell".to_string(), "mkdir".into(), "-p".into(), parent];
        if adb(app, id, &adb_path, &mk).await.is_err() {
            all_ok = false;
            continue;
        }
        let push = ["push".to_string(), local.to_string_lossy().to_string(), remote];
        if adb(app, id, &adb_path, &push).await.is_err() {
            all_ok = false;
        }
    }

    let _ = std::fs::remove_dir_all(&tmp);
    if all_ok {
        say(app, id, "system", "Bundle installed.");
    } else {
        say(app, id, "stderr", "App installed, but copying an OBB file failed.");
    }
    all_ok
}

/// Install an .xapk / .apkm / .apks bundle. Progress streams to the log panel
/// via the same log-line / command-done events as other commands; the returned
/// id lets the frontend track it.
#[tauri::command]
pub async fn install_xapk(
    app: AppHandle,
    path: String,
    grant: bool,
    reinstall: bool,
) -> Result<String, String> {
    let ext = Path::new(&path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !matches!(ext.as_str(), "xapk" | "apkm" | "apks" | "zip") {
        return Err(format!("unsupported file type: .{ext}"));
    }
    if !Path::new(&path).is_file() {
        return Err("file not found".into());
    }

    let id = uuid::Uuid::new_v4().to_string();
    let (app2, id2) = (app.clone(), id.clone());
    tokio::spawn(async move {
        let ok = run_install(&app2, &id2, &path, grant, reinstall).await;
        let _ = app2.emit(
            "command-done",
            CommandDone { id: id2, code: Some(if ok { 0 } else { 1 }), success: ok },
        );
    });
    Ok(id)
}
