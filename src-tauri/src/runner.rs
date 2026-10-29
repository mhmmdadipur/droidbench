// Core process runner for Droidbench.
// Spawns a CLI tool (adb/fastboot/heimdall/payload-dumper), streams its
// stdout/stderr to the frontend line-by-line via Tauri events, and supports
// cancellation of a running command.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

/// A single log line emitted to the frontend.
#[derive(Clone, Serialize)]
pub struct LogLine {
    pub id: String,
    pub stream: String, // "stdout" | "stderr" | "system"
    pub line: String,
}

/// Emitted when a command finishes.
#[derive(Clone, Serialize)]
pub struct CommandDone {
    pub id: String,
    pub code: Option<i32>,
    pub success: bool,
}

/// Tracks currently running child processes so they can be killed.
#[derive(Default)]
pub struct RunnerState {
    pub running: Arc<Mutex<HashMap<String, Child>>>,
}

/// Resolve the full path to a bundled binary, falling back to PATH.
/// Bundled sidecars live next to the executable in production; during dev we
/// look under `src-tauri/binaries`.
pub fn resolve_tool(app: &AppHandle, tool: &str) -> String {
    use tauri::Manager;
    // platform-specific executable name
    let exe = if cfg!(windows) {
        format!("{tool}.exe")
    } else {
        tool.to_string()
    };

    // 1) bundled resource dir
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("binaries").join(&exe);
        if candidate.exists() {
            return candidate.to_string_lossy().to_string();
        }
    }
    // 2) dev path relative to CWD
    let dev = std::path::Path::new("binaries").join(&exe);
    if dev.exists() {
        if let Ok(abs) = std::fs::canonicalize(&dev) {
            return abs.to_string_lossy().to_string();
        }
    }

    // 3) search common install locations. A bundled macOS .app does NOT inherit
    // the user's shell PATH, so tools installed via Homebrew/MacPorts are
    // invisible unless we look for them explicitly.
    for dir in common_bin_dirs() {
        let candidate = std::path::Path::new(dir).join(&exe);
        if candidate.exists() {
            return candidate.to_string_lossy().to_string();
        }
    }

    // 4) honor an explicit PATH entry if present (dev shells, Windows)
    if let Ok(path) = std::env::var("PATH") {
        let sep = if cfg!(windows) { ';' } else { ':' };
        for dir in path.split(sep) {
            if dir.is_empty() {
                continue;
            }
            let candidate = std::path::Path::new(dir).join(&exe);
            if candidate.exists() {
                return candidate.to_string_lossy().to_string();
            }
        }
    }

    // 5) last resort: bare name (lets the OS resolve it, may fail in GUI apps)
    tool.to_string()
}

/// Resolve a bundled resource file (e.g. "binaries/scrcpy-server"), returning
/// an absolute path if found in the resource dir (prod) or CWD (dev).
pub fn resolve_resource(app: &AppHandle, rel: &str) -> Option<String> {
    use tauri::Manager;
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join(rel);
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    let dev = std::path::Path::new(rel);
    if dev.exists() {
        if let Ok(abs) = std::fs::canonicalize(dev) {
            return Some(abs.to_string_lossy().to_string());
        }
    }
    None
}

/// Availability status of a single CLI tool.
#[derive(Clone, Serialize)]
pub struct ToolStatus {
    pub name: String,
    pub available: bool,
    pub source: String, // "bundled" | "system" | "missing"
    pub path: String,
}

/// Report which tools Droidbench can find, and whether they are bundled with
/// the app or taken from the system. Drives the UI availability indicators.
#[tauri::command]
pub async fn check_tools(app: AppHandle) -> Result<Vec<ToolStatus>, String> {
    use tauri::Manager;

    let tools = ["adb", "fastboot", "scrcpy", "heimdall", "payload-dumper"];
    let bundled_dir = app.path().resource_dir().ok().map(|d| d.join("binaries"));
    let dev_dir = std::fs::canonicalize("binaries").ok();

    let mut out = Vec::new();
    for t in tools {
        let resolved = resolve_tool(&app, t);
        let available = resolved != t || which_on_path(t).is_some();
        let effective = if resolved != t {
            resolved
        } else {
            which_on_path(t).unwrap_or_else(|| t.to_string())
        };

        let is_bundled = |p: &str| -> bool {
            if let Some(ref d) = bundled_dir {
                if p.starts_with(&d.to_string_lossy().to_string()) {
                    return true;
                }
            }
            if let Some(ref d) = dev_dir {
                if p.starts_with(&d.to_string_lossy().to_string()) {
                    return true;
                }
            }
            false
        };

        let (source, path) = if !available {
            ("missing".to_string(), String::new())
        } else if is_bundled(&effective) {
            ("bundled".to_string(), effective)
        } else {
            ("system".to_string(), effective)
        };

        out.push(ToolStatus {
            name: t.to_string(),
            available,
            source,
            path,
        });
    }
    Ok(out)
}

/// Minimal `which` that honors PATH + common dirs (for system detection).
fn which_on_path(tool: &str) -> Option<String> {
    let exe = if cfg!(windows) {
        format!("{tool}.exe")
    } else {
        tool.to_string()
    };
    for dir in common_bin_dirs() {
        let c = std::path::Path::new(dir).join(&exe);
        if c.exists() {
            return Some(c.to_string_lossy().to_string());
        }
    }
    if let Ok(path) = std::env::var("PATH") {
        let sep = if cfg!(windows) { ';' } else { ':' };
        for dir in path.split(sep) {
            if dir.is_empty() {
                continue;
            }
            let c = std::path::Path::new(dir).join(&exe);
            if c.exists() {
                return Some(c.to_string_lossy().to_string());
            }
        }
    }
    None
}

/// Common directories where CLI tools get installed, per platform.
fn common_bin_dirs() -> &'static [&'static str] {
    #[cfg(target_os = "macos")]
    {
        &[
            "/opt/homebrew/bin",      // Apple Silicon Homebrew
            "/usr/local/bin",         // Intel Homebrew / manual installs
            "/opt/local/bin",         // MacPorts
            "/usr/bin",
            "/bin",
        ]
    }
    #[cfg(target_os = "linux")]
    {
        &["/usr/local/bin", "/usr/bin", "/bin", "/snap/bin"]
    }
    #[cfg(target_os = "windows")]
    {
        &[]
    }
}

/// A friendly install suggestion shown when a tool can't be started.
fn install_hint(tool: &str) -> Option<String> {
    let mac = cfg!(target_os = "macos");
    let hint = match tool {
        "scrcpy" => {
            if mac {
                "→ scrcpy not found. Install it: brew install scrcpy"
            } else {
                "→ scrcpy not found. Install from https://github.com/Genymobile/scrcpy (or your package manager)."
            }
        }
        "heimdall" => {
            if mac {
                "→ heimdall not found. Install it: brew install heimdall — or drop the binary into the app's binaries/ folder."
            } else {
                "→ heimdall not found. Install Heimdall, or drop the binary into the app's binaries/ folder."
            }
        }
        "payload-dumper" | "payload-dumper-go" => {
            "→ payload-dumper not found. Download payload-dumper-go and drop it into the app's binaries/ folder (named 'payload-dumper')."
        }
        "adb" | "fastboot" => {
            "→ Bundled adb/fastboot missing. Run scripts/fetch-binaries.sh, or install Android platform-tools."
        }
        _ => return None,
    };
    Some(hint.to_string())
}

/// Run a command, streaming output. Returns the command id immediately-ish;
/// the actual completion is signaled via the `command-done` event.
#[tauri::command]
pub async fn run_command(
    app: AppHandle,
    state: State<'_, RunnerState>,
    tool: String,
    args: Vec<String>,
    use_path: Option<bool>,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();

    // Resolve the program path. `tool` may be a bundled name or a raw command.
    let program = if use_path.unwrap_or(false) {
        tool.clone()
    } else {
        resolve_tool(&app, &tool)
    };

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

    // Point child tools at our resolved adb and make sure common bin dirs are on
    // PATH. A bundled macOS .app starts with a minimal PATH, so tools like
    // scrcpy otherwise can't find adb (or each other).
    let adb_path = resolve_tool(&app, "adb");
    let mut path_dirs: Vec<String> = Vec::new();
    if adb_path != "adb" {
        cmd.env("ADB", &adb_path);
        if let Some(parent) = std::path::Path::new(&adb_path).parent() {
            path_dirs.push(parent.to_string_lossy().to_string());
        }
    }
    // scrcpy needs its matching server pushed to the device; point it at the
    // bundled scrcpy-server so a system scrcpy isn't required.
    if let Some(server) = resolve_resource(&app, "binaries/scrcpy-server") {
        cmd.env("SCRCPY_SERVER_PATH", server);
    }
    for dir in common_bin_dirs() {
        if std::path::Path::new(dir).exists() {
            path_dirs.push((*dir).to_string());
        }
    }
    if let Ok(existing) = std::env::var("PATH") {
        path_dirs.push(existing);
    }
    if !path_dirs.is_empty() {
        let sep = if cfg!(windows) { ";" } else { ":" };
        cmd.env("PATH", path_dirs.join(sep));
    }

    #[cfg(windows)]
    {
        // avoid flashing console windows on Windows
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
            if let Some(hint) = install_hint(&tool) {
                let _ = app.emit(
                    "log-line",
                    LogLine {
                        id: id.clone(),
                        stream: "system".into(),
                        line: hint,
                    },
                );
            }
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

    // register the child for cancellation
    state.running.lock().await.insert(id.clone(), child);

    // stream stdout
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

    // stream stderr
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

    // Wait for completion in a background task WITHOUT removing the child from
    // the map — otherwise `cancel_command` would have nothing to kill for
    // long-running commands (e.g. `adb logcat`). We poll with try_wait and keep
    // the child registered so it stays killable until it actually exits.
    let running = state.running.clone();
    let app4 = app.clone();
    let id4 = id.clone();
    tokio::spawn(async move {
        use std::time::Duration;
        loop {
            let done: Option<CommandDone> = {
                let mut map = running.lock().await;
                match map.get_mut(&id4) {
                    None => {
                        // cancel_command removed (and killed) it → stop; the
                        // canceller already handled cleanup.
                        break;
                    }
                    Some(child) => match child.try_wait() {
                        Ok(Some(status)) => Some(CommandDone {
                            id: id4.clone(),
                            code: status.code(),
                            success: status.success(),
                        }),
                        Ok(None) => None, // still running
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

/// Run a command and collect all output into a string (blocking until done).
/// Used for quick queries like device detection where we need the result.
#[tauri::command]
pub async fn run_capture(
    app: AppHandle,
    tool: String,
    args: Vec<String>,
    _use_path: Option<bool>,
) -> Result<String, String> {
    run_capture_internal(
        &app,
        &tool,
        &args,
    )
    .await
}

/// Internal variant callable from other Rust modules.
pub async fn run_capture_internal(
    app: &AppHandle,
    tool: &str,
    args: &[String],
) -> Result<String, String> {
    let program = resolve_tool(app, tool);

    let mut cmd = Command::new(&program);
    cmd.args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("failed to run `{}`: {}", program, e))?;

    let mut combined = String::new();
    combined.push_str(&String::from_utf8_lossy(&output.stdout));
    let err = String::from_utf8_lossy(&output.stderr);
    if !err.trim().is_empty() {
        combined.push_str(&err);
    }
    Ok(combined)
}

/// Cancel a running command by id, or all if id is None.
#[tauri::command]
pub async fn cancel_command(
    state: State<'_, RunnerState>,
    id: Option<String>,
) -> Result<(), String> {
    let mut map = state.running.lock().await;
    match id {
        Some(id) => {
            if let Some(mut child) = map.remove(&id) {
                let _ = child.kill().await;
            }
        }
        None => {
            for (_, mut child) in map.drain() {
                let _ = child.kill().await;
            }
        }
    }
    Ok(())
}
