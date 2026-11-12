//! Bandeja del sistema (System Tray Icon) al lado del reloj para Sanatorio.
//! Muestra el estado de la conexión de red y opciones rápidas.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime};

pub const TRAY_ID: &str = "sanatorio-tray";
pub const MENU_ID_STATUS: &str = "sanatorio_tray_status";
pub const MENU_ID_RECONNECT: &str = "sanatorio_tray_reconnect";
pub const MENU_ID_SET_LOCAL: &str = "sanatorio_tray_set_local";
pub const MENU_ID_OPEN_APP: &str = "sanatorio_tray_open_app";
pub const MENU_ID_QUIT: &str = "sanatorio_tray_quit";

const EMBEDDED_TRAY_ICON_PNG: &[u8] = include_bytes!("../icons/32x32.png");

fn get_network_status_label() -> String {
    use crate::client_mode::{self, AppMode};

    let cfg = client_mode::load_config().unwrap_or(client_mode::ClientConfig {
        mode: AppMode::Local,
        server_url: None,
        server_cert_pem: None,
        server_primary_ip: None,
        device_id: None,
    });

    if cfg.mode == AppMode::Local {
        "🟢 Modo Servidor Local (Activo)".to_string()
    } else if let Some(url) = cfg.server_url {
        format!("🟢 Servidor: {}", url.replace("https://", "").replace("http://", ""))
    } else {
        "🔴 Sin conexión al Servidor".to_string()
    }
}

pub fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let status_text = get_network_status_label();

    let status_item = MenuItem::with_id(app, MENU_ID_STATUS, &status_text, false, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let reconnect_item = MenuItem::with_id(
        app,
        MENU_ID_RECONNECT,
        "🔄 Buscar Servidor en la red (Cable o Wi-Fi)",
        true,
        None::<&str>,
    )?;
    let local_item = MenuItem::with_id(
        app,
        MENU_ID_SET_LOCAL,
        "💻 Usar Servidor Local (Esta PC)",
        true,
        None::<&str>,
    )?;
    let open_app_item = MenuItem::with_id(
        app,
        MENU_ID_OPEN_APP,
        "🖥️ Abrir Sanatorio",
        true,
        None::<&str>,
    )?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(
        app,
        MENU_ID_QUIT,
        "❌ Cerrar Sanatorio",
        true,
        None::<&str>,
    )?;

    let menu = Menu::with_items(
        app,
        &[
            &status_item,
            &sep1,
            &open_app_item,
            &reconnect_item,
            &local_item,
            &sep2,
            &quit_item,
        ],
    )?;

    let icon = tauri::image::Image::from_bytes(EMBEDDED_TRAY_ICON_PNG)?;

    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .icon(icon)
        .tooltip("Sanatorio — Centro Médico")
        .on_menu_event(move |app_handle, event| {
            match event.id().as_ref() {
                MENU_ID_OPEN_APP => {
                    if let Some(win) = app_handle.get_webview_window("main") {
                        let _ = win.unminimize();
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
                MENU_ID_RECONNECT => {
                    let handle = app_handle.clone();
                    std::thread::spawn(move || {
                        match tauri::async_runtime::block_on(
                            crate::discovery::get_network_connection_status(),
                        ) {
                            Ok(status) => log::info!(
                                "Comprobación de conexión del menú: {} ({})",
                                status.server_name,
                                status.message
                            ),
                            Err(error) => {
                                log::warn!("No se pudo comprobar la conexión desde el menú: {error}")
                            }
                        }
                        if let Some(win) = handle.get_webview_window("main") {
                            let _ = win.eval("window.location.reload()");
                        }
                    });
                }
                MENU_ID_SET_LOCAL => {
                    let _ = crate::discovery::set_mode_local();
                    if let Some(win) = app_handle.get_webview_window("main") {
                        let _ = win.eval("window.location.reload()");
                    }
                }
                MENU_ID_QUIT => {
                    app_handle.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            // Al hacer clic izquierdo en el icono del reloj, traer la ventana de Sanatorio al frente
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.unminimize();
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

