mod core;
mod modules;
mod server;
mod whatsapp;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            modules::comunicacion::commands::send_email_gmail,
            modules::comunicacion::commands::send_agenda_email,
            modules::comunicacion::commands::open_agenda_email_draft,
            modules::comunicacion::commands::open_whatsapp_url,
            whatsapp::abrir_whatsapp,
            
            modules::configuracion::commands::load_app_data,
            modules::configuracion::commands::save_app_data,
            modules::configuracion::commands::get_app_data_file_path,
            modules::configuracion::commands::get_install_info,
            modules::configuracion::commands::load_smtp_secret,
            modules::configuracion::commands::save_smtp_secret,
            modules::configuracion::commands::load_auth_accounts,
            modules::configuracion::commands::save_auth_accounts,
            modules::configuracion::commands::save_historico_archive,
            modules::configuracion::commands::read_historico_archive,
            modules::configuracion::commands::list_historico_archives,
            modules::configuracion::commands::is_google_drive_installed,
            modules::configuracion::commands::get_google_drive_status,
            modules::configuracion::commands::pick_google_drive_folder,
            
            modules::backups::commands::get_backup_dir,
            modules::backups::commands::get_backup_locations,
            modules::backups::commands::list_data_backups,
            modules::backups::commands::finalize_exit,
            modules::backups::commands::rotate_data_backups,
            modules::backups::commands::read_data_backup,
            modules::backups::commands::read_daily_data_backup,
            modules::backups::commands::restore_data_backup,
            modules::backups::commands::restore_backup_companion_files,
            modules::backups::commands::apply_data_backup_restore,
            modules::backups::commands::save_daily_data_backup,
            modules::backups::commands::list_daily_data_backups,
            modules::backups::commands::get_recovery_checklist,
            modules::backups::commands::open_local_google_drive_backup_folder,
            
            modules::reportes::commands::save_pdf_dialog,
            modules::reportes::commands::save_excel_dialog,
            modules::reportes::commands::save_to_local_google_drive,
            modules::reportes::commands::export_distribucion_pdf,
            modules::reportes::commands::abrir_archivo,
        ])
        .setup(|app| {
            modules::configuracion::service::prepare_storage_on_startup(app.handle());
            match modules::configuracion::service::try_acquire_single_instance_lock(app.handle()) {
                Ok(lock) => {
                    app.manage(lock);
                }
                Err(msg) => {
                    rfd::MessageDialog::new()
                        .set_title("Sanatorio")
                        .set_description(&msg)
                        .set_buttons(rfd::MessageButtons::Ok)
                        .show();
                    std::process::exit(1);
                }
            }
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

pub fn run_server() {
    server::run_server();
}
