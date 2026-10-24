use base64::Engine;
use crate::core::error::AppError;

pub fn save_pdf_dialog(
    default_filename: &str,
    pdf_base64: &str,
    google_drive_folder: Option<&str>,
    custom_root: Option<&str>,
    disabled: bool,
) -> Result<bool, AppError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(pdf_base64.trim())
        .map_err(|e| AppError::Validation(format!("PDF inválido: {e}")))?;

    let name = default_filename.trim();
    let file_name = if name.is_empty() { "documento.pdf" } else { name };

    let path = rfd::FileDialog::new()
        .set_file_name(file_name)
        .add_filter("PDF", &["pdf"])
        .save_file();

    let Some(path) = path else {
        return Ok(false);
    };

    std::fs::write(&path, &bytes)?;

    // Guardar en Google Drive si se indicó una carpeta (silencioso)
    if let Some(folder) = google_drive_folder {
        let folder_trim = folder.trim();
        if !folder_trim.is_empty() {
            let _ = save_to_local_google_drive(
                pdf_base64,
                folder_trim,
                file_name,
                custom_root,
                disabled,
            );
        }
    }

    Ok(true)
}

pub fn save_excel_dialog(default_filename: &str, file_base64: &str) -> Result<bool, AppError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(file_base64.trim())
        .map_err(|e| AppError::Validation(format!("Archivo inválido: {e}")))?;

    let name = default_filename.trim();
    let file_name = if name.is_empty() {
        "pagos-gerencia.xlsx"
    } else {
        name
    };

    let path = rfd::FileDialog::new()
        .set_file_name(file_name)
        .add_filter("Excel", &["xlsx"])
        .save_file();

    let Some(path) = path else {
        return Ok(false);
    };

    std::fs::write(&path, &bytes)?;
    Ok(true)
}

pub fn save_to_local_google_drive(
    file_base64: &str,
    folder_name: &str,
    filename: &str,
    custom_root: Option<&str>,
    disabled: bool,
) -> Result<bool, AppError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(file_base64.trim())
        .map_err(|e| AppError::Validation(format!("Archivo inválido: {e}")))?;

    if let Some(drive_root) =
        crate::core::config::settings::resolve_google_drive_root(custom_root, disabled)
    {
        let target_dir = drive_root.join(folder_name);
        if !target_dir.is_dir() {
            std::fs::create_dir_all(&target_dir)?;
        }
        let target_file = target_dir.join(filename);
        std::fs::write(&target_file, &bytes)?;
        return Ok(true);
    }

    Ok(false)
}
