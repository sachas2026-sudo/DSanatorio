use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "whatsapp";

#[tauri::command]
pub async fn abrir_whatsapp(app: AppHandle, telefono: String, mensaje: String) -> Result<(), String> {
    eprintln!("[WA] abrir_whatsapp llamado - telefono: {}, mensaje len: {}", telefono, mensaje.len());
    let telefono: String = telefono.chars().filter(|c| c.is_ascii_digit()).collect();
    eprintln!("[WA] telefono normalizado: {}", telefono);
    let url = format!(
        "https://web.whatsapp.com/send?phone={}&text={}",
        telefono,
        urlencoding::encode(&mensaje)
    );
    eprintln!("[WA] URL formateada: {}", url);
    let url = Url::parse(&url).map_err(|e| e.to_string())?;
    eprintln!("[WA] URL parseada: {}", url);

    if let Some(win) = app.get_webview_window(LABEL) {
        eprintln!("[WA] Ventana existente encontrada, navegando...");
        // Tauri v2 no expone `navigate` en WebviewWindow. La navegación se
        // realiza dentro de la webview existente para reutilizar la sesión.
        let js = format!("window.location.replace({:?})", url.as_str());
        win.eval(&js).map_err(|e| e.to_string())?;
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        eprintln!("[WA] Navegación completada en ventana existente");
    } else {
        eprintln!("[WA] Creando nueva ventana Webview...");
        WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(url.clone()))
            .title("WhatsApp")
            .inner_size(1100.0, 750.0)
            .devtools(true)
            .on_navigation(|u| { eprintln!("[WA] navegando a {u}"); true })
            .on_page_load(|_w, p| eprintln!("[WA] {:?} {}", p.event(), p.url()))
            .build()
            .map_err(|e| e.to_string())?;
        eprintln!("[WA] Nueva ventana creada exitosamente");
    }
    Ok(())
}
