use std::fs;
use base64::Engine;
use lettre::message::header::{ContentDisposition, ContentType};
use lettre::message::{Body, Message, MultiPart, SinglePart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{SmtpTransport, Transport};
use tauri_plugin_opener::OpenerExt;
use crate::core::error::AppError;

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

pub struct EmailDraftPayload {
    pub from: String,
    pub to: String,
    pub subject: String,
    pub body: String,
    pub pdf_base64: Option<String>,
    pub pdf_filename: Option<String>,
}

fn clean_app_password(raw: &str) -> String {
    raw.chars().filter(|c| !c.is_whitespace()).collect()
}

fn resolve_smtp(from: &str, host: Option<String>, port: Option<u16>) -> (String, u16) {
    if let Some(h) = host.filter(|s| !s.trim().is_empty()) {
        return (h.trim().to_string(), port.unwrap_or(587));
    }
    let domain = from.split('@').nth(1).unwrap_or("").to_lowercase();
    let host = match domain.as_str() {
        "gmail.com" | "googlemail.com" => "smtp.gmail.com",
        "outlook.com" | "hotmail.com" | "live.com" | "outlook.com.ar" => "smtp.office365.com",
        "yahoo.com" | "yahoo.com.ar" => "smtp.mail.yahoo.com",
        _ => return (format!("mail.{domain}"), port.unwrap_or(587)),
    };
    (host.to_string(), port.unwrap_or(587))
}

fn is_gmail_address(email: &str) -> bool {
    matches!(
        email.split('@').nth(1).map(str::to_lowercase).as_deref(),
        Some("gmail.com") | Some("googlemail.com")
    )
}

fn attachment_mime_type(filename: &str, explicit: Option<&String>) -> String {
    if let Some(m) = explicit.filter(|s| !s.trim().is_empty()) {
        return m.trim().to_string();
    }
    let lower = filename.to_lowercase();
    if lower.ends_with(".json") {
        return "application/json".to_string();
    }
    if lower.ends_with(".zip") {
        return "application/zip".to_string();
    }
    "application/pdf".to_string()
}

fn decode_optional_attachment(
    data_base64: Option<&String>,
    filename: Option<&String>,
    attachment_mime: Option<&String>,
) -> Result<Option<(String, Vec<u8>, String)>, AppError> {
    match (data_base64, filename) {
        (Some(b64), Some(name)) if !b64.trim().is_empty() && !name.trim().is_empty() => {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(b64.trim())
                .map_err(|e| AppError::Validation(format!("Adjunto inválido: {e}")))?;
            let name = name.trim().to_string();
            let mime = attachment_mime_type(&name, attachment_mime);
            Ok(Some((name, bytes, mime)))
        }
        _ => Ok(None),
    }
}

fn wrap_base64_76(data: &str) -> String {
    data.as_bytes()
        .chunks(76)
        .map(|chunk| std::str::from_utf8(chunk).unwrap_or(""))
        .collect::<Vec<_>>()
        .join("\r\n")
}

fn build_eml(from: &str, to: &str, subject: &str, body: &str) -> String {
    let subject_line = subject.replace('\r', "").replace('\n', " ");
    let body_crlf = body.replace("\r\n", "\n").replace('\n', "\r\n");
    format!(
        "From: {from}\r\nTo: {to}\r\nSubject: {subject_line}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n{body_crlf}\r\n"
    )
}

fn build_eml_with_pdf(
    from: &str,
    to: &str,
    subject: &str,
    body: &str,
    pdf_filename: &str,
    pdf_bytes: &[u8],
) -> String {
    let subject_line = subject.replace('\r', "").replace('\n', " ");
    let body_crlf = body.replace("\r\n", "\n").replace('\n', "\r\n");
    let boundary = "sanatorio_mixed_boundary";
    let b64 = base64::engine::general_purpose::STANDARD.encode(pdf_bytes);
    let b64_wrapped = wrap_base64_76(&b64);
    let safe_name = pdf_filename.replace(['\r', '\n'], "_");

    format!(
        "From: {from}\r\nTo: {to}\r\nSubject: {subject_line}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=\"{boundary}\"\r\n\r\n--{boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n{body_crlf}\r\n\r\n--{boundary}\r\nContent-Type: application/pdf; name=\"{safe_name}\"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=\"{safe_name}\"\r\n\r\n{b64_wrapped}\r\n\r\n--{boundary}--\r\n"
    )
}

fn finish_message(
    builder: lettre::message::MessageBuilder,
    body: String,
    attachment: Option<(String, Vec<u8>, String)>,
) -> Result<Message, AppError> {
    match attachment {
        None => builder
            .header(ContentType::TEXT_PLAIN)
            .body(body)
            .map_err(|e| AppError::Email(format!("No se pudo armar el email: {e}"))),
        Some((filename, file_bytes, mime)) => {
            let text_part = SinglePart::builder()
                .header(ContentType::TEXT_PLAIN)
                .body(Body::new(body));

            let file_part = SinglePart::builder()
                .header(
                    ContentType::parse(mime.as_str())
                        .map_err(|e| AppError::Email(format!("Tipo de adjunto inválido ({mime}): {e}")))?,
                )
                .header(ContentDisposition::attachment(filename.as_str()))
                .body(Body::new(file_bytes));

            let multipart = MultiPart::mixed()
                .singlepart(text_part)
                .singlepart(file_part);

            builder
                .multipart(multipart)
                .map_err(|e| AppError::Email(format!("No se pudo armar el email con adjunto: {e}")))
        }
    }
}

pub fn validate_whatsapp_url(url: &str) -> Result<String, AppError> {
    let trimmed = url.trim();
    if !trimmed.starts_with("https://web.whatsapp.com/send")
        && !trimmed.starts_with("https://wa.me/")
        && !trimmed.starts_with("whatsapp://")
    {
        return Err(AppError::WhatsApp("Enlace WhatsApp no válido.".into()));
    }

    if trimmed.starts_with("whatsapp://send?") {
        let query = &trimmed["whatsapp://send?".len()..];
        Ok(format!("https://web.whatsapp.com/send?{}", query))
    } else {
        Ok(trimmed.to_string())
    }
}

pub async fn send_email_gmail(payload: SendEmailGmailPayload) -> Result<(), AppError> {
    let from_email = payload.from_email.trim().to_string();
    let app_password = clean_app_password(&payload.app_password);
    if from_email.is_empty() || app_password.is_empty() {
        return Err(AppError::Email("Falta Gmail o contraseña de aplicación".into()));
    }
    if app_password.len() != 16 {
        return Err(AppError::Email(
            "La contraseña de aplicación de Gmail debe tener 16 caracteres (sin espacios)".into(),
        ));
    }
    let recipients: Vec<String> = payload
        .to
        .iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    if recipients.is_empty() {
        return Err(AppError::Email("No hay destinatarios".into()));
    }

    let attachment = decode_optional_attachment(
        payload.pdf_base64.as_ref(),
        payload.pdf_filename.as_ref(),
        payload.attachment_mime.as_ref(),
    )?;

    let mut builder = Message::builder()
        .from(
            from_email
                .parse()
                .map_err(|_| AppError::Email("Email remitente inválido".to_string()))?,
        )
        .subject(payload.subject);
    for t in &recipients {
        builder = builder.to(
            t.parse()
                .map_err(|_| AppError::Email(format!("Destinatario inválido: {t}")))?,
        );
    }

    let email = finish_message(builder, payload.body, attachment)?;
    let creds = Credentials::new(from_email.clone(), app_password);
    
    tauri::async_runtime::spawn_blocking(move || {
        let mailer = SmtpTransport::relay("smtp.gmail.com")
            .map_err(|e| AppError::Email(format!("SMTP relay error: {e}")))?
            .credentials(creds)
            .build();

        mailer
            .send(&email)
            .map_err(|e| AppError::Email(format!("No se pudo enviar: {e}")))?;
        Ok(())
    })
    .await
    .map_err(|e| AppError::Email(format!("No se pudo iniciar el envío: {e}")))?
}

pub fn open_agenda_email_draft(app: &tauri::AppHandle, payload: EmailDraftPayload) -> Result<(), AppError> {
    let from = payload.from.trim();
    let to = payload.to.trim();
    if from.is_empty() {
        return Err(AppError::Email("Cargá el Email en Configuración (remitente).".into()));
    }
    if to.is_empty() {
        return Err(AppError::Email("Cargá el Email Gerente en Configuración (destino).".into()));
    }

    let path = std::env::temp_dir().join("agenda-sanatorio.eml");
    let eml = match decode_optional_attachment(
        payload.pdf_base64.as_ref(),
        payload.pdf_filename.as_ref(),
        None,
    )? {
        Some((filename, file_bytes, _mime)) => {
            build_eml_with_pdf(from, to, &payload.subject, &payload.body, &filename, &file_bytes)
        }
        None => build_eml(from, to, &payload.subject, &payload.body),
    };
    
    fs::write(&path, eml.as_bytes())?;

    let path_str = path
        .to_str()
        .ok_or_else(|| AppError::Email("Ruta de borrador no válida en este sistema.".into()))?;

    app.opener()
        .open_path(path_str, None::<&str>)
        .map_err(|e| AppError::Email(format!("No se pudo abrir el programa de correo: {e}")))?;

    Ok(())
}

pub fn send_agenda_email(payload: SendEmailPayload) -> Result<(), AppError> {
    let from = payload.from.trim();
    let to = payload.to.trim();
    if from.is_empty() {
        return Err(AppError::Email("Cargá el Email en Configuración (remitente).".into()));
    }
    if to.is_empty() {
        return Err(AppError::Email("Cargá el Email Gerente en Configuración (destino).".into()));
    }
    if is_gmail_address(from) {
        return Err(AppError::Email(
            "Para @gmail.com usá una contraseña de aplicación de 16 caracteres; el envío va por Gmail como en Admi.".into(),
        ));
    }
    let password = clean_app_password(&payload.password);
    if password.is_empty() {
        return Err(AppError::Email("Cargá la Clave del correo en Configuración y pulsá Guardar.".into()));
    }

    let (host, port) = resolve_smtp(from, payload.smtp_host, payload.smtp_port);
    let attachment = decode_optional_attachment(
        payload.pdf_base64.as_ref(),
        payload.pdf_filename.as_ref(),
        payload.attachment_mime.as_ref(),
    )?;

    let email = finish_message(
        Message::builder()
            .from(
                from.parse()
                    .map_err(|_| AppError::Email("El Email de origen no es una dirección válida.".to_string()))?,
            )
            .to(to
                .parse()
                .map_err(|_| AppError::Email("El Email Gerente no es una dirección válida.".to_string()))?)
            .subject(payload.subject),
        payload.body,
        attachment,
    )?;

    let creds = Credentials::new(from.to_string(), password);

    let mailer = SmtpTransport::starttls_relay(&host)
        .map_err(|e| AppError::Email(format!("Servidor SMTP «{host}»: {e}")))?
        .port(port)
        .credentials(creds)
        .build();

    mailer
        .send(&email)
        .map_err(|e| AppError::Email(format!("No se pudo enviar por {host}:{port}. {e}")))?;

    Ok(())
}
