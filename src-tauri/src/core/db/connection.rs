use std::fs;
use std::path::{Path, PathBuf};
use rusqlite::{params, Connection};
use crate::core::config::settings;
use crate::core::error::AppError;

pub const DB_FILE: &str = "sanatorio-datos.db";
pub const JSON_EXPORT_FILE: &str = "sanatorio-datos.json";

pub fn ensure_data_dir() -> Result<PathBuf, AppError> {
    let dir = settings::data_dir();
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn db_file_path() -> Result<PathBuf, AppError> {
    Ok(ensure_data_dir()?.join(DB_FILE))
}

pub fn json_export_path() -> Result<PathBuf, AppError> {
    Ok(ensure_data_dir()?.join(JSON_EXPORT_FILE))
}

pub fn open_connection() -> Result<Connection, AppError> {
    let path = db_file_path()?;
    let conn = Connection::open(&path)
        .map_err(|e| AppError::Database(format!("No se pudo abrir la base SQLite: {e}")))?;
    
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;")?;
    
    super::migrations::initialize_schema(&conn)?;
    
    Ok(conn)
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes)?;
    if path.is_file() {
        fs::remove_file(path)?;
    }
    fs::rename(&tmp, path)?;
    Ok(())
}

/// Respaldo seguro de SQLite usando VACUUM INTO (evita copiar en caliente).
pub fn backup_db_safe(src: &Path, dst: &Path) -> Result<(), AppError> {
    if dst.exists() {
        fs::remove_file(dst)?;
    }
    let conn = Connection::open(src)
        .map_err(|e| AppError::Database(format!("No se pudo abrir la base para respaldo: {e}")))?;
    conn.execute("VACUUM INTO ?1", params![dst.to_string_lossy().to_string()])
        .map_err(|e| AppError::Database(format!("No se pudo respaldar la base: {e}")))?;
    Ok(())
}
