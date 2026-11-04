mod control;
mod debloat;
mod device;
mod ios;
mod ios_tools;
mod mirror;
mod runner;
mod xapk;

use mirror::MirrorState;
use runner::RunnerState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(RunnerState::default())
        .manage(MirrorState::default())
        .invoke_handler(tauri::generate_handler![
            runner::run_command,
            runner::run_capture,
            runner::cancel_command,
            runner::check_tools,
            runner::install_apk,
            xapk::install_xapk,
            device::detect_device,
            device::list_devices,
            ios::ios_info,
            ios::ios_screenshot,
            ios_tools::ios_backup,
            ios_tools::ios_restore,
            ios_tools::ios_syslog,
            ios_tools::ios_crash_reports,
            ios_tools::ios_list_apps,
            ios_tools::ios_install_ipa,
            ios_tools::ios_uninstall_app,
            debloat::load_debloat_db,
            debloat::list_installed_packages,
            debloat::list_disabled_packages,
            mirror::mirror_start,
            mirror::mirror_stop,
            mirror::mirror_set_size,
            mirror::mirror_screenshot,
            mirror::mirror_push_file,
            mirror::mirror_open,
            mirror::mirror_reboot,
            mirror::mirror_record_start,
            mirror::mirror_record_stop,
            control::mirror_rotate,
            control::mirror_display_power,
            control::mirror_uhid_create,
            control::mirror_uhid_input,
            control::mirror_uhid_destroy,
            control::mirror_panel,
            control::mirror_text,
            control::mirror_clipboard_to_phone,
            control::mirror_clipboard_from_phone,
            control::pc_clipboard_set,
            control::mirror_touch,
            control::mirror_keycode,
            control::mirror_scroll,
            control::mirror_back,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
