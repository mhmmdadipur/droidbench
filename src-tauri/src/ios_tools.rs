// Extra iOS features via libimobiledevice, all READ-ONLY-friendly and
// jailbreak-free:
//   • Backup / restore            → idevicebackup2
//   • Live syslog + crash reports → idevicesyslog / idevicecrashreport
//   • App install / uninstall     → ideviceinstaller
//
// Streaming commands (backup/restore/syslog) reuse the same log-line /
// command-done event protocol as runner::run_command so the frontend LogPanel
// shows live output and the command stays cancellable. Quick queries (app
// list) use run_capture_internal.

use std::process::Stdio;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::runner::{resolve_tool, run_capture_internal, CommandDone, LogLine, RunnerState};

/// Spawn an iOS (libimobiledevice) tool and stream its stdout/stderr to the
/// frontend exactly like runner::run_command, returning the command id. The
/// child is registered in RunnerState so it stays cancellable (important for
/// long-running `idevicesyslog` / `idevicebackup2`).
async fn spawn_streaming(
    app: &AppHandle,
    state: &State<'_, RunnerState>,
    tool: &str,
    args: Vec<String>,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let program = resolve_tool(app, tool);

    let display = format!("{} {}", tool, args.join(" "));
    let _ = app.emit(
        "log-line",
        LogLine {
            id: id.clone(),
            stream: "system".into(),
            line: format!("$ {}", display.trim()),
        },
    );

    let mut cmd = Command::new(&program);
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let msg = format!("failed to start `{}`: {}", program, e);
            let _ = app.emit(
                "log-line",
                LogLine {
                    id: id.clone(),
                    stream: "stderr".into(),
                    line: msg.clone(),
                },
            );
            let _ = app.emit(
                "log-line",
                LogLine {
                    id: id.clone(),
                    stream: "system".into(),
                    line: install_hint(tool),
                },
            );
            let _ = app.emit(
                "command-done",
                CommandDone {
                    id: id.clone(),
                    code: None,
                    success: false,
                },
            );
            return Err(msg);
        }
    };

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    state.running.lock().await.insert(id.clone(), child);

    if let Some(out) = stdout {
        let app2 = app.clone();
        let id2 = id.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(out).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app2.emit(
                    "log-line",
                    LogLine {
                        id: id2.clone(),
                        stream: "stdout".into(),
                        line,
                    },
                );
            }
        });
    }
    if let Some(err) = stderr {
        let app3 = app.clone();
        let id3 = id.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(err).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app3.emit(
                    "log-line",
                    LogLine {
                        id: id3.clone(),
                        stream: "stderr".into(),
                        line,
                    },
                );
            }
        });
    }

    // poll for completion while leaving the child registered (so cancel works)
    let running = state.running.clone();
    let app4 = app.clone();
    let id4 = id.clone();
    tokio::spawn(async move {
        use std::time::Duration;
        loop {
            let done: Option<CommandDone> = {
                let mut map = running.lock().await;
                match map.get_mut(&id4) {
                    None => break,
                    Some(child) => match child.try_wait() {
                        Ok(Some(status)) => Some(CommandDone {
                            id: id4.clone(),
                            code: status.code(),
                            success: status.success(),
                        }),
                        Ok(None) => None,
                        Err(_) => Some(CommandDone {
                            id: id4.clone(),
                            code: None,
                            success: false,
                        }),
                    },
                }
            };
            if let Some(done) = done {
                running.lock().await.remove(&id4);
                let _ = app4.emit("command-done", done);
                break;
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
    });

    Ok(id)
}

fn install_hint(tool: &str) -> String {
    let mac = cfg!(target_os = "macos");
    match tool {
        "ideviceinstaller" => {
            if mac {
                "→ ideviceinstaller not found. Install it: brew install ideviceinstaller".into()
            } else {
                "→ ideviceinstaller not found. Install it (e.g. apt install ideviceinstaller).".into()
            }
        }
        _ => {
            if mac {
                "→ iOS tool not found. Install libimobiledevice: brew install libimobiledevice".into()
            } else {
                "→ iOS tool not found. Install libimobiledevice (e.g. apt install libimobiledevice-utils).".into()
            }
        }
    }
}

// ───────────────────────── Backup / Restore ────────────────────────────────

/// Start a full device backup into `dest_dir`. idevicebackup2 writes a backup
/// folder named by the device UDID inside `dest_dir`. Encrypted backups (if the
/// user turned on an encryption password in Finder/iTunes) are preserved.
#[tauri::command]
pub async fn ios_backup(
    app: AppHandle,
    state: State<'_, RunnerState>,
    udid: String,
    dest_dir: String,
) -> Result<String, String> {
    if udid.trim().is_empty() {
        return Err("no iOS device UDID".into());
    }
    if dest_dir.trim().is_empty() {
        return Err("no backup destination folder".into());
    }
    let args = vec![
        "-u".into(),
        udid,
        "backup".into(),
        "--full".into(),
        dest_dir,
    ];
    spawn_streaming(&app, &state, "idevicebackup2", args).await
}

/// Restore a previously-made backup from `src_dir` to the device. This REWRITES
/// device data, so the frontend must confirm with the user first. We pass
/// `--system` off by default (settings/data only) to match iTunes behavior.
#[tauri::command]
pub async fn ios_restore(
    app: AppHandle,
    state: State<'_, RunnerState>,
    udid: String,
    src_dir: String,
    reboot: bool,
) -> Result<String, String> {
    if udid.trim().is_empty() {
        return Err("no iOS device UDID".into());
    }
    if src_dir.trim().is_empty() {
        return Err("no backup source folder".into());
    }
    let mut args = vec!["-u".into(), udid, "restore".into(), "--settings".into()];
    if reboot {
        args.push("--reboot".into());
    }
    args.push(src_dir);
    spawn_streaming(&app, &state, "idevicebackup2", args).await
}

// ───────────────────────── Syslog / Crash reports ──────────────────────────

/// Stream the live device console log (idevicesyslog). Long-running; stop via
/// cancel_command with the returned id.
#[tauri::command]
pub async fn ios_syslog(
    app: AppHandle,
    state: State<'_, RunnerState>,
    udid: String,
) -> Result<String, String> {
    if udid.trim().is_empty() {
        return Err("no iOS device UDID".into());
    }
    let args = vec!["-u".into(), udid];
    spawn_streaming(&app, &state, "idevicesyslog", args).await
}

/// Copy crash reports off the device into `dest_dir` (idevicecrashreport -e
/// extracts + keeps them). Streams progress.
#[tauri::command]
pub async fn ios_crash_reports(
    app: AppHandle,
    state: State<'_, RunnerState>,
    udid: String,
    dest_dir: String,
) -> Result<String, String> {
    if udid.trim().is_empty() {
        return Err("no iOS device UDID".into());
    }
    if dest_dir.trim().is_empty() {
        return Err("no destination folder".into());
    }
    // -e keeps the reports on the device (extract/copy, non-destructive)
    let args = vec!["-u".into(), udid, "-e".into(), dest_dir];
    spawn_streaming(&app, &state, "idevicecrashreport", args).await
}

// ───────────────────────── App install / uninstall ─────────────────────────

/// A single installed user app (from `ideviceinstaller -l`).
#[derive(Clone, Serialize)]
pub struct IosApp {
    pub bundle_id: String,
    pub name: String,
    pub version: String,
}

/// List user-installed apps via ideviceinstaller. Output format is CSV-ish:
///   CFBundleIdentifier, CFBundleShortVersionString, CFBundleDisplayName
#[tauri::command]
pub async fn ios_list_apps(app: AppHandle, udid: String) -> Result<Vec<IosApp>, String> {
    if udid.trim().is_empty() {
        return Err("no iOS device UDID".into());
    }
    let out = run_capture_internal(
        &app,
        "ideviceinstaller",
        &["-u".into(), udid, "list".into(), "-o".into(), "list_user".into()],
    )
    .await?;

    let mut apps = Vec::new();
    for line in out.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // skip a header line like "CFBundleIdentifier, CFBundleVersion, ..."
        if line.starts_with("CFBundleIdentifier") {
            continue;
        }
        // Expected: "com.foo.bar", "1.2.3", "Foo Bar"
        let parts: Vec<String> = line
            .split(',')
            .map(|p| p.trim().trim_matches('"').to_string())
            .collect();
        if parts.is_empty() || parts[0].is_empty() {
            continue;
        }
        let bundle_id = parts[0].clone();
        // ideviceinstaller versions vary in column order; be defensive.
        let version = parts.get(1).cloned().unwrap_or_default();
        let name = parts
            .get(2)
            .cloned()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| bundle_id.clone());
        apps.push(IosApp {
            bundle_id,
            name,
            version,
        });
    }
    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(apps)
}

/// Install a signed .ipa onto the device (ideviceinstaller install <path>).
/// Only works for apps the user is entitled to install (App Store resigned /
/// developer-signed / enterprise); this doesn't bypass Apple code-signing.
#[tauri::command]
pub async fn ios_install_ipa(
    app: AppHandle,
    state: State<'_, RunnerState>,
    udid: String,
    ipa_path: String,
) -> Result<String, String> {
    if udid.trim().is_empty() {
        return Err("no iOS device UDID".into());
    }
    if ipa_path.trim().is_empty() {
        return Err("no .ipa file selected".into());
    }
    let args = vec!["-u".into(), udid, "install".into(), ipa_path];
    spawn_streaming(&app, &state, "ideviceinstaller", args).await
}

/// Uninstall an app by bundle id (ideviceinstaller uninstall <bundle>).
#[tauri::command]
pub async fn ios_uninstall_app(
    app: AppHandle,
    state: State<'_, RunnerState>,
    udid: String,
    bundle_id: String,
) -> Result<String, String> {
    if udid.trim().is_empty() {
        return Err("no iOS device UDID".into());
    }
    if bundle_id.trim().is_empty() {
        return Err("no bundle id".into());
    }
    let args = vec!["-u".into(), udid, "uninstall".into(), bundle_id];
    spawn_streaming(&app, &state, "ideviceinstaller", args).await
}
