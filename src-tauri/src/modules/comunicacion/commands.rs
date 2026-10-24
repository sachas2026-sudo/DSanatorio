use serde::Deserialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use super::service;

#[derive(Deserialize)]
pub struct SendEmailGmailPayload {
    pub from_email: String,
    pub app_password: String,
    pub to: Vec<String>,
    pub subject: String,
    pub body: String,
    pub pdf_base64: Option<String>,
    pub pdf_filename: Option<String>,
    pub attachment_mime: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendEmailPayload {
    pub from: String,
    pub password: String,
    pub to: String,
    pub subject: String,
    pub body: String,
    pub smtp_host: Option<String>,
    pub smtp_port: Option<u16>,
    pub pdf_base64: Option<String>,
    pub pdf_filename: Option<String>,
    pub attachment_mime: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailDraftPayload {
    pub from: String,
    pub to: String,
    pub subject: String,
    pub body: String,
    pub pdf_base64: Option<String>,
    pub pdf_filename: Option<String>,
}

#[tauri::command]
pub async fn send_email_gmail(payload: SendEmailGmailPayload) -> Result<(), String> {
    let s_payload = service::SendEmailGmailPayload {
        from_email: payload.from_email,
        app_password: payload.app_password,
        to: payload.to,
        subject: payload.subject,
        body: payload.body,
        pdf_base64: payload.pdf_base64,
        pdf_filename: payload.pdf_filename,
        attachment_mime: payload.attachment_mime,
    };
    service::send_email_gmail(s_payload).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_agenda_email_draft(
    app: tauri::AppHandle,
    payload: EmailDraftPayload,
) -> Result<(), String> {
    let s_payload = service::EmailDraftPayload {
        from: payload.from,
        to: payload.to,
        subject: payload.subject,
        body: payload.body,
        pdf_base64: payload.pdf_base64,
        pdf_filename: payload.pdf_filename,
    };
    service::open_agenda_email_draft(&app, s_payload).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn send_agenda_email(payload: SendEmailPayload) -> Result<(), String> {
    let s_payload = service::SendEmailPayload {
        from: payload.from,
        password: payload.password,
        to: payload.to,
        subject: payload.subject,
        body: payload.body,
        smtp_host: payload.smtp_host,
        smtp_port: payload.smtp_port,
        pdf_base64: payload.pdf_base64,
        pdf_filename: payload.pdf_filename,
        attachment_mime: payload.attachment_mime,
    };
    service::send_agenda_email(s_payload).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_whatsapp_url(app: AppHandle, url: String) -> Result<(), String> {
    let clean_url = service::validate_whatsapp_url(&url).map_err(|e| e.to_string())?;
    eprintln!("[WA] URL limpia: {}", clean_url);
    let parsed_url = url::Url::parse(&clean_url).map_err(|e| e.to_string())?;
    eprintln!("[WA] URL parseada: {}", parsed_url);

    if let Some(window) = app.get_webview_window("whatsapp") {
        eprintln!("[WA] Ventana existente encontrada, navegando...");
        window.navigate(parsed_url.clone()).map_err(|e| e.to_string())?;
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        eprintln!("[WA] Creando nueva ventana Webview...");
        WebviewWindowBuilder::new(&app, "whatsapp", WebviewUrl::External(parsed_url.clone()))
            .title("WhatsApp")
            .inner_size(1100.0, 750.0)
            .resizable(true)
            .devtools(true)
            .on_navigation(|u| { eprintln!("[WA] navegando a {u}"); true })
            .on_page_load(|_w, p| eprintln!("[WA] {:?} {}", p.event(), p.url()))
            .build()
            .map_err(|e| format!("No se pudo abrir la ventana de WhatsApp: {e}"))?;
    }

    Ok(())
}
