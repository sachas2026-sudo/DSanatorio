use base64::Engine;

/// Diálogo “Guardar como” y escritura del PDF (sin plugin fs en el frontend).
#[tauri::command]
pub fn save_pdf_dialog(default_filename: String, pdf_base64: String) -> Result<bool, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(pdf_base64.trim())
        .map_err(|e| format!("PDF inválido: {e}"))?;

    let name = default_filename.trim();
    let file_name = if name.is_empty() { "documento.pdf" } else { name };

    let path = rfd::FileDialog::new()
        .set_file_name(file_name)
        .add_filter("PDF", &["pdf"])
        .save_file();

    let Some(path) = path else {
        return Ok(false);
    };

    std::fs::write(&path, &bytes).map_err(|e| format!("No se pudo guardar el PDF: {e}"))?;
    Ok(true)
}

/// Diálogo “Guardar como” para exportación Excel (Gerencia en Pagos).
#[tauri::command]
pub fn save_excel_dialog(default_filename: String, file_base64: String) -> Result<bool, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(file_base64.trim())
        .map_err(|e| format!("Archivo inválido: {e}"))?;

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

    std::fs::write(&path, &bytes).map_err(|e| format!("No se pudo guardar el Excel: {e}"))?;
    Ok(true)
}
