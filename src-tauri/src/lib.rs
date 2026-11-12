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
mod login_diagnostics;
mod install_profile;
mod auth_defaults;
mod audit_log;
pub mod discovery;
pub mod tray;
#[cfg(test)]
mod test_support;

#[cfg(test)]
mod service_tests;


use tauri::Manager;
use crate::core::config::settings;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    let identifier = context.config().identifier.to_lowercase();
    let product_name = context.config().product_name.as_deref().unwrap_or("").to_lowercase();
    let legacy_client_flavor = identifier.contains("cliente")
        || product_name.contains("cliente")
        || identifier.contains("afiliado")
        || identifier.contains("administrador") 
        || identifier.contains("admi")
        || product_name.contains("afiliado")
        || product_name.contains("administrador")
        || product_name.contains("admi");
    let is_client_flavor = match install_profile::load() {
        Ok(Some(profile)) => profile.is_client(),
        Ok(None) => legacy_client_flavor,
        Err(error) => {
            log::error!("{error}");
            legacy_client_flavor
        }
    };

    use crate::client_mode::{load_config, StartupPlan, AppMode, ClientConfig};

    let (mut config, config_loaded) = match load_config() {
        Ok(c) => (c, true),
        Err(e) => {
            log::warn!("Aviso al cargar configuración ({e}). Se iniciará con valores seguros.");
            (
                ClientConfig {
                    mode: if is_client_flavor { AppMode::Client } else { AppMode::Local },
                    server_url: None,
                    server_cert_pem: None,
                    server_primary_ip: None,
                    device_id: None,
                },
                false,
            )
        }
    };

    if is_client_flavor {
        // En los instaladores cliente siempre opera en modo cliente.
        config.mode = AppMode::Client;
        if config_loaded {
            if let Err(e) = crate::client_mode::save_config(&config) {
                log::error!("No se pudo persistir el modo cliente: {e}");
            }
        }
        // La dirección configurada tiene prioridad. El descubrimiento solo
        // completa una configuración vacía; se deja al comando de estado hacer
        // la búsqueda en segundo plano después de mostrar la interfaz.
        if config.server_url.as_deref().map(str::trim).unwrap_or("").is_empty() {
            if let Err(e) = login_diagnostics::record_startup_no_server() {
                log::error!("No se pudo escribir el diagnóstico de inicio: {e}");
            }
        }
    } else {
        // El sabor Server (Mesa de Entrada) SIEMPRE es el servidor: levanta la
        // base y la comparte en la red sin importar lo que tenga guardada la
        // configuración. Si se quedó guardado "modo cliente" (pruebas, versiones
        // anteriores), antes quedaba "ciego": no compartía datos ni conectaba,
        // y las PCs Afiliados/Administrador no lo encontraban nunca.
        config.mode = AppMode::Local;
        if let Err(e) = crate::client_mode::save_config(&config) {
            log::error!("No se pudo guardar el modo servidor: {e}");
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
            modules::configuracion::commands::registrar_contratante_con_paciente_nuevo,
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
            client_commands::request_client_device_access,
            client_commands::client_logout,
            client_commands::client_session_info,
            client_commands::client_heartbeat,
            install_profile::get_install_profile,
            login_diagnostics::write_login_diagnostic,
            client_request::client_api,
            discovery::discover_sanatorio_servers,
            discovery::auto_connect_sanatorio_server,
            discovery::diagnose_connection,
            discovery::get_network_connection_status,
            discovery::set_manual_server_url,
            discovery::set_mode_local,
            discovery::get_local_network_info,
            discovery::set_server_primary_ip,
            server::get_connected_devices,
            server::approve_client_device,
            server::revoke_client_device,
            server::get_server_pairing_code,
            server::regenerate_server_pairing_code,
            server::hide_server_pairing_code,
            modules::configuracion::commands::minimize_window,
        ])
        .setup(move |app| {
            // Traer la ventana principal al frente al iniciar: sin decoración puede
            // quedar detrás de otras aplicaciones y parecer que no abrió.
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.center();
                let _ = win.maximize();
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

            // Ícono de bandeja del sistema desactivado a pedido
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(context)
        .expect("error while running tauri application");
}

pub fn run_server() {
    server::run_server();
}
