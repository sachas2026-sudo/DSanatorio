use super::distribucion;
use super::service;

#[tauri::command]
pub fn save_pdf_dialog(
    default_filename: String,
    pdf_base64: String,
    google_drive_folder: Option<String>,
    custom_root: Option<String>,
    disabled: Option<bool>,
) -> Result<bool, String> {
    service::save_pdf_dialog(
        &default_filename,
        &pdf_base64,
        google_drive_folder.as_deref(),
        custom_root.as_deref(),
        disabled.unwrap_or(false),
    )
    .map_err(|e| e.to_string())
}

/// Guarda el PDF de "Distribución por médico · Obras sociales" y devuelve la
/// ruta en la que quedó.
///
/// A diferencia de `save_pdf_dialog`, que devuelve un booleano porque sus
/// llamadores sólo necesitan saber si se guardó, éste devuelve la ruta: la
/// pantalla la muestra junto a un "Abrir" para que el usuario llegue al archivo
/// sin buscarlo a mano.
///
/// `Ok(None)` = el usuario canceló el diálogo.
#[tauri::command]
pub fn export_distribucion_pdf(
    default_filename: String,
    pdf_base64: String,
) -> Result<Option<String>, String> {
    distribucion::export_distribucion_pdf(&default_filename, &pdf_base64)
        .map_err(|e| e.to_string())
}

/// Abre un archivo con la aplicación que el sistema tenga asociada.
#[tauri::command]
pub fn abrir_archivo(path: String) -> Result<(), String> {
    distribucion::abrir_archivo(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_excel_dialog(default_filename: String, file_base64: String) -> Result<bool, String> {
    service::save_excel_dialog(&default_filename, &file_base64).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_to_local_google_drive(
    file_base64: String,
    folder_name: String,
    filename: String,
    custom_root: Option<String>,
    disabled: Option<bool>,
) -> Result<bool, String> {
    service::save_to_local_google_drive(
        &file_base64,
        &folder_name,
        &filename,
        custom_root.as_deref(),
        disabled.unwrap_or(false),
    )
    .map_err(|e| e.to_string())
}
