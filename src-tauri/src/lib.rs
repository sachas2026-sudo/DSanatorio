mod pdf_save;
mod smtp;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            smtp::send_email_gmail,
            smtp::send_agenda_email,
            smtp::open_agenda_email_draft,
            storage::load_app_data,
            storage::save_app_data,
            storage::get_app_data_file_path,
            storage::get_backup_dir,
            storage::get_backup_locations,
            storage::list_data_backups,
            storage::finalize_exit,
            storage::rotate_data_backups,
            storage::restore_data_backup,
            storage::save_daily_data_backup,
            storage::list_daily_data_backups,
            storage::load_smtp_secret,
            storage::save_smtp_secret,
            pdf_save::save_pdf_dialog,
            pdf_save::save_excel_dialog,
        ])
        .setup(|app| {
            storage::prepare_storage_on_startup(app.handle())?;
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
