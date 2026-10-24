//! Guardado del PDF de "Distribución por médico · Obras sociales".
//!
//! El PDF en sí lo arma el frontend con jsPDF (misma pila que el resto de los
//! reportes del proyecto). Rust sólo pone el diálogo de guardado del sistema y
//! la escritura en disco, que es lo que ya hacía `service::save_pdf_dialog`.
//! La diferencia es que este comando devuelve la ruta en la que quedó el
//! archivo, para poder mostrarla y ofrecer "Abrir".

use base64::Engine;
use crate::core::error::AppError;

/// Guarda el PDF con el diálogo del sistema y devuelve la ruta final.
///
/// `Ok(None)` es el caso normal de "el usuario canceló": no es un error, y el
/// frontend no debe mostrar ningún aviso.
///
/// El nombre sugerido se sanea antes porque va directo al `set_file_name` del
/// diálogo: si trae `/` o `\` Windows lo interpreta como subcarpeta y el
/// diálogo arranca en un lugar que el usuario no pidió.
pub fn export_distribucion_pdf(
    default_filename: &str,
    pdf_base64: &str,
) -> Result<Option<String>, AppError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(pdf_base64.trim())
        .map_err(|e| AppError::Validation(format!("El PDF generado no es válido: {e}")))?;

    let file_name = nombre_sugerido(default_filename);

    let Some(path) = rfd::FileDialog::new()
        .set_file_name(&file_name)
        .add_filter("PDF", &["pdf"])
        .save_file()
    else {
        return Ok(None);
    };

    std::fs::write(&path, &bytes).map_err(|e| {
        AppError::Io(format!(
            "No se pudo escribir {}: {e}",
            path.to_string_lossy()
        ))
    })?;

    Ok(Some(path.to_string_lossy().to_string()))
}

/// Nombre de archivo sugerido, sin separadores de ruta ni caracteres inválidos.
fn nombre_sugerido(default_filename: &str) -> String {
    let limpio: String = default_filename
        .trim()
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            otro => otro,
        })
        .collect();

    let limpio = limpio.trim().to_string();
    if limpio.is_empty() {
        "Distribucion_medico.pdf".to_string()
    } else if limpio.to_lowercase().ends_with(".pdf") {
        limpio
    } else {
        format!("{limpio}.pdf")
    }
}

/// Abre un archivo con la aplicación que el sistema tenga asociada.
///
/// Se usa para el "Abrir" del aviso de generación: el PDF se acaba de guardar
/// y el usuario casi siempre quiere verlo, no volver a navegar hasta él.
pub fn abrir_archivo(path: &str) -> Result<(), AppError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation(
            "No se indicó qué archivo abrir.".to_string(),
        ));
    }

    open::that(trimmed).map_err(|e| {
        AppError::Io(format!(
            "No se pudo abrir {trimmed}: {e}. Verificá que el archivo exista."
        ))
    })
}
