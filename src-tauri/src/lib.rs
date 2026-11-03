mod core;
mod modules;
mod server;
mod client_mode;
mod instance_lock;
mod whatsapp;
mod tls_cert;
mod tls_files;
mod api_client;
mod client_session;
mod client_commands;
mod client_request;
pub mod discovery;
#[cfg(test)]
mod test_support;

#[cfg(test)]
mod service_tests;


use tauri::Manager;
use crate::core::config::settings;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use crate::client_mode::{load_config, StartupPlan};

    let mut config = match load_config() {
        Ok(c) => c,
        Err(e) => {
            rfd::MessageDialog::new()
                .set_title("Sanatorio - Configuración inválida")
                .set_description(&e)
                .set_buttons(rfd::MessageButtons::Ok)
                .show();
            std::process::exit(1);
        }
    };

    // Si aún no se configuró explícitamente, buscar automáticamente si hay un servidor en la red local
    if !crate::client_mode::config_path().exists() {
        if let Ok(servers) = crate::discovery::discover_servers(500) {
            if let Some(srv) = servers.into_iter().find(|s| s.ip != "127.0.0.1" && !s.ip.starts_with("127.")) {
                config.mode = crate::client_mode::AppMode::Client;
                config.server_url = Some(srv.server_url);
                config.server_cert_pem = srv.cert_pem.or_else(|| Some("auto".to_string()));
                let _ = crate::client_mode::save_config(&config);
            }
        }
    }

    let plan = StartupPlan::for_mode(config.mode);
    let prepare_local = plan.prepare_local_storage;
    crate::client_mode::set_runtime_mode(config.mode);

    // Adquirir lock una sola vez (si aplica)
    let lock_result = if plan.check_server_lock {
        let data_dir = settings::data_dir();
        Some(crate::instance_lock::try_lock(&data_dir))
    } else {
        None
    };

    // Verificar resultado antes de continuar
    if let Some(Err(crate::instance_lock::LockError::Busy)) = lock_result {
        rfd::MessageDialog::new()
            .set_title("Sanatorio - Servidor activo")
            .set_description("Ya hay otra instancia (UI o servidor) usando los datos.")
            .set_buttons(rfd::MessageButtons::Ok)
            .show();
        std::process::exit(1);
    }
    if let Some(Err(crate::instance_lock::LockError::Io(e))) = &lock_result {
        rfd::MessageDialog::new()
            .set_title("Sanatorio - Error")
            .set_description(e)
            .set_buttons(rfd::MessageButtons::Ok)
            .show();
        std::process::exit(1);
    }

    let lock_guard = lock_result.map(|r| r.unwrap());

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .manage(client_commands::ClientState::new())
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
            modules::configuracion::commands::get_app_mode,
            
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
            client_commands::client_login,
            client_commands::client_logout,
            client_commands::client_session_info,
            client_request::client_api,
            discovery::discover_sanatorio_servers,
            discovery::auto_connect_sanatorio_server,
            discovery::get_network_connection_status,
            discovery::set_manual_server_url,
        ])
        .setup(move |app| {
            // Traer la ventana principal al frente al iniciar: sin decoración puede
            // quedar detrás de otras aplicaciones y parecer que no abrió.
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                // El "siempre visible" momentáneo fuerza el raise; se quita enseguida.
                let _ = win.set_always_on_top(true);
                let _ = win.set_always_on_top(false);
                let _ = win.set_focus();
            }
            if prepare_local {
                modules::configuracion::service::prepare_storage_on_startup(app.handle());
                if let Some(guard) = lock_guard {
                    app.manage(guard);
                }
                server::start_background_server();
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
