mod control;
mod debloat;
mod device;
mod mirror;
mod runner;

use mirror::MirrorState;
use runner::RunnerState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .manage(RunnerState::default())
        .manage(MirrorState::default())
        .invoke_handler(tauri::generate_handler![
            runner::run_command,
            runner::run_capture,
            runner::cancel_command,
            runner::check_tools,
            device::detect_device,
            debloat::load_debloat_db,
            debloat::list_installed_packages,
            debloat::list_disabled_packages,
            mirror::mirror_start,
            mirror::mirror_stop,
            mirror::mirror_set_size,
            mirror::mirror_screenshot,
            mirror::mirror_push_file,
            mirror::mirror_open,
            mirror::mirror_set_clipboard,
            mirror::mirror_get_clipboard,
            control::mirror_touch,
            control::mirror_keycode,
            control::mirror_scroll,
            control::mirror_back,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
