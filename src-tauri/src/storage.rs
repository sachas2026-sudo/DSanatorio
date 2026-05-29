use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::Manager;

const DATA_FILE: &str = "sanatorio-datos.json";
const BACKUP_1: &str = "sanatorio-datos.respaldo-1.json";
const BACKUP_2: &str = "sanatorio-datos.respaldo-2.json";
const BACKUP_3: &str = "sanatorio-datos.respaldo-3.json";
const DAILY_BACKUP_SUBDIR: &str = "diario";
const DAILY_BACKUP_RETENTION_DAYS: u32 = 30;
const BACKUP_SLOTS: [u8; 3] = [1, 2, 3];
/// Respaldo local en esta PC.
const BACKUP_DIR_ON_C: &str = r"C:\Sanatorio\respaldo";
/// Dropbox (solo al guardar respaldos, no al iniciar la app).
const BACKUP_DIR_DROPBOX: &str = r"C:\Users\LAS\Dropbox\Sanatorio\respaldo";

/// Ruta junto al .exe (instalaciones anteriores); se migra una sola vez a AppData.
fn legacy_data_file_path() -> Result<Option<PathBuf>, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = match exe.parent() {
        Some(d) => d,
        None => return Ok(None),
    };
    let path = dir.join(DATA_FILE);
    if path.is_file() {
        Ok(Some(path))
    } else {
        Ok(None)
    }
}

fn ensure_app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Migra sanatorio-datos.json desde la carpeta del programa a AppData (persiste al actualizar).
/// Copia bases empaquetadas en el instalador (resources) si AppData y respaldos están vacíos.
fn seed_bundled_bases_if_needed(app: &tauri::AppHandle) -> Result<(), String> {
    let res_dir = match app.path().resource_dir() {
        Ok(d) => d,
        Err(_) => return Ok(()),
    };

    let data_path = {
        let dir = ensure_app_data_dir(app)?;
        dir.join(DATA_FILE)
    };
    if !data_path.is_file() {
        let bundled = res_dir.join(DATA_FILE);
        if bundled.is_file() {
            fs::copy(&bundled, &data_path).map_err(|e| {
                format!("No se pudo copiar la base del instalador: {e}")
            })?;
        }
    }

    let backup_names = [BACKUP_1, BACKUP_2, BACKUP_3];
    let dirs = backup_dirs_local_only(app);
    for name in backup_names {
        let bundled = res_dir.join(name);
        if !bundled.is_file() {
            continue;
        }
        for dir in &dirs {
            let dest = dir.join(name);
            if !dest.is_file() {
                let _ = fs::copy(&bundled, &dest);
            }
        }
    }
    Ok(())
}

pub fn prepare_storage_on_startup(app: &tauri::AppHandle) -> Result<(), String> {
    seed_bundled_bases_if_needed(app)?;
    let _ = data_file_path(app)?;
    Ok(())
}

fn migrate_legacy_data_if_needed(new_path: &Path) -> Result<(), String> {
    if new_path.is_file() {
        return Ok(());
    }
    let Some(legacy) = legacy_data_file_path()? else {
        return Ok(());
    };
    fs::copy(&legacy, new_path).map_err(|e| {
        format!(
            "No se pudo copiar la base de datos a la carpeta permanente: {e}"
        )
    })?;
    let marker = legacy.with_extension("json.ubicacion-anterior");
    if marker.is_file() {
        let _ = fs::remove_file(&marker);
    }
    fs::rename(&legacy, marker).map_err(|e| {
        format!(
            "Datos copiados a AppData, pero no se pudo renombrar el archivo antiguo: {e}"
        )
    })?;
    Ok(())
}

fn data_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = ensure_app_data_dir(app)?;
    let path = dir.join(DATA_FILE);
    migrate_legacy_data_if_needed(&path)?;
    Ok(path)
}

/// Escribe el archivo completo de forma atómica (.tmp + rename).
fn atomic_replace(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    if path.is_file() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}

fn write_data_file(path: &Path, json: &str) -> Result<(), String> {
    atomic_replace(path, json.as_bytes())
}

fn try_backup_dir(path: &str) -> Option<PathBuf> {
    let p = PathBuf::from(path);
    fs::create_dir_all(&p).ok()?;
    Some(p)
}

fn backup_dirs_local_only(app: &tauri::AppHandle) -> Vec<PathBuf> {
    if let Some(p) = try_backup_dir(BACKUP_DIR_ON_C) {
        return vec![p];
    }
    if let Ok(app_data) = ensure_app_data_dir(app) {
        let p = app_data.join("respaldo");
        if fs::create_dir_all(&p).is_ok() {
            return vec![p];
        }
    }
    Vec::new()
}

const DROPBOX_ROOT: &str = r"C:\Users\LAS\Dropbox";

fn dropbox_installed() -> bool {
    Path::new(DROPBOX_ROOT).is_dir()
}

/// Ruta de respaldo en Dropbox (sin crear carpeta; evita bloqueos al listar).
fn dropbox_backup_path() -> PathBuf {
    PathBuf::from(BACKUP_DIR_DROPBOX)
}

/// Solo al rotar respaldos: crea la carpeta si hace falta.
fn ensure_dropbox_backup_dir() -> Option<PathBuf> {
    if !dropbox_installed() {
        return None;
    }
    try_backup_dir(BACKUP_DIR_DROPBOX)
}

/// Carpetas para rotar respaldos (PC + Dropbox al guardar, no en el arranque).
fn backup_dirs_for_rotation(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut dirs = backup_dirs_local_only(app);
    if let Some(p) = ensure_dropbox_backup_dir() {
        if !dirs.iter().any(|d| d == &p) {
            dirs.push(p);
        }
    }
    dirs
}

/// Carpeta principal para listar/restaurar (siempre la PC local si existe).
fn backup_dir_primary(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(p) = try_backup_dir(BACKUP_DIR_ON_C) {
        return Ok(p);
    }
    backup_dirs_local_only(app)
        .into_iter()
        .next()
        .ok_or_else(|| {
            format!(
                "No se pudo crear la carpeta de respaldo en {BACKUP_DIR_ON_C}.",
                BACKUP_DIR_ON_C = BACKUP_DIR_ON_C,
            )
        })
}

fn rotate_backups_all(app: &tauri::AppHandle, json: &str) -> Result<(), String> {
    let dirs = backup_dirs_for_rotation(app);
    if dirs.is_empty() {
        return Err("No se pudo crear ninguna carpeta de respaldo.".into());
    }
    let mut errors: Vec<String> = Vec::new();
    for dir in &dirs {
        if let Err(e) = rotate_backups(dir, json) {
            errors.push(format!("{}: {e}", dir.to_string_lossy()));
        }
    }
    if errors.len() == dirs.len() {
        return Err(errors.join(" · "));
    }
    Ok(())
}

fn backup_path(dir: &Path, slot: u8) -> Result<PathBuf, String> {
    let name = match slot {
        1 => BACKUP_1,
        2 => BACKUP_2,
        3 => BACKUP_3,
        _ => return Err("Respaldo inválido (use 1, 2 o 3).".to_string()),
    };
    Ok(dir.join(name))
}

fn rotate_backups(dir: &Path, json: &str) -> Result<(), String> {
    let p1 = dir.join(BACKUP_1);
    let p2 = dir.join(BACKUP_2);
    let p3 = dir.join(BACKUP_3);

    // Rotación por rename para preservar fecha/hora (modified) de cada archivo.
    // Así los 3 respaldos quedan con distintas fechas reales.
    if p3.is_file() {
        fs::remove_file(&p3).map_err(|e| e.to_string())?;
    }
    if p2.is_file() {
        fs::rename(&p2, &p3).map_err(|e| e.to_string())?;
    }
    if p2.is_file() {
        // Si no se pudo mover (por permisos/bloqueo), evitamos quedar en estado inconsistente.
        fs::remove_file(&p2).ok();
    }
    if p1.is_file() {
        if p2.is_file() {
            fs::remove_file(&p2).map_err(|e| e.to_string())?;
        }
        fs::rename(&p1, &p2).map_err(|e| e.to_string())?;
    }

    atomic_replace(&p1, json.as_bytes())?;
    Ok(())
}

fn file_modified_ms(path: &Path) -> Option<u64> {
    let meta = fs::metadata(path).ok()?;
    let modified = meta.modified().ok()?;
    modified
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as u64)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyBackupEntry {
    pub date: String,
    pub path: String,
    pub modified_ms: Option<u64>,
}

fn is_valid_backup_date(date: &str) -> bool {
    let bytes = date.as_bytes();
    if bytes.len() != 10 {
        return false;
    }
    if bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    date.chars().all(|c| c.is_ascii_digit() || c == '-')
}

fn daily_backup_filename(date: &str) -> String {
    format!("sanatorio-datos.{date}.json")
}

fn parse_daily_backup_date(filename: &str) -> Option<String> {
    let prefix = "sanatorio-datos.";
    let suffix = ".json";
    if !filename.starts_with(prefix) || !filename.ends_with(suffix) {
        return None;
    }
    let date = &filename[prefix.len()..filename.len() - suffix.len()];
    if is_valid_backup_date(date) {
        Some(date.to_string())
    } else {
        None
    }
}

fn subtract_days_from_date(date: &str, days: u32) -> Option<String> {
    let parts: Vec<&str> = date.split('-').collect();
    if parts.len() != 3 {
        return None;
    }
    let y: i32 = parts[0].parse().ok()?;
    let m: u32 = parts[1].parse().ok()?;
    let d: u32 = parts[2].parse().ok()?;
    if m < 1 || m > 12 || d < 1 || d > 31 {
        return None;
    }

    let mut year = y;
    let mut month = m as i32;
    let mut day = d as i32;
    let mut remaining = days as i32;

    while remaining > 0 {
        day -= 1;
        if day < 1 {
            month -= 1;
            if month < 1 {
                month = 12;
                year -= 1;
            }
            day = days_in_month(year, month as u32);
        }
        remaining -= 1;
    }

    Some(format!("{year:04}-{month:02}-{day:02}"))
}

fn days_in_month(year: i32, month: u32) -> i32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            let leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
            if leap {
                29
            } else {
                28
            }
        }
        _ => 30,
    }
}

fn prune_daily_backups(daily_dir: &Path, today: &str) -> Result<(), String> {
    if !daily_dir.is_dir() {
        return Ok(());
    }
    let Some(cutoff) = subtract_days_from_date(today, DAILY_BACKUP_RETENTION_DAYS) else {
        return Ok(());
    };
    for entry in fs::read_dir(daily_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Some(date) = parse_daily_backup_date(name) else {
            continue;
        };
        if date < cutoff {
            let _ = fs::remove_file(&path);
        }
    }
    Ok(())
}

fn save_daily_backup_in_dir(dir: &Path, json: &str, date: &str) -> Result<(), String> {
    let daily_dir = dir.join(DAILY_BACKUP_SUBDIR);
    fs::create_dir_all(&daily_dir).map_err(|e| e.to_string())?;
    let path = daily_dir.join(daily_backup_filename(date));
    atomic_replace(&path, json.as_bytes())?;
    prune_daily_backups(&daily_dir, date)
}

fn save_daily_backups_all(app: &tauri::AppHandle, json: &str, date: &str) -> Result<(), String> {
    let dirs = backup_dirs_for_rotation(app);
    if dirs.is_empty() {
        return Err("No se pudo crear ninguna carpeta de respaldo.".into());
    }
    let mut errors: Vec<String> = Vec::new();
    for dir in &dirs {
        if let Err(e) = save_daily_backup_in_dir(dir, json, date) {
            errors.push(format!("{}: {e}", dir.to_string_lossy()));
        }
    }
    if errors.len() == dirs.len() {
        return Err(errors.join(" · "));
    }
    Ok(())
}

fn list_daily_backups_in_dir(daily_dir: &Path) -> Result<Vec<DailyBackupEntry>, String> {
    if !daily_dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut out: Vec<DailyBackupEntry> = Vec::new();
    for entry in fs::read_dir(daily_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Some(date) = parse_daily_backup_date(name) else {
            continue;
        };
        out.push(DailyBackupEntry {
            date,
            path: path.to_string_lossy().into_owned(),
            modified_ms: file_modified_ms(&path),
        });
    }
    out.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(out)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub slot: u8,
    pub exists: bool,
    pub modified_ms: Option<u64>,
    pub path: String,
}

#[tauri::command]
pub fn get_app_data_file_path(app: tauri::AppHandle) -> Result<String, String> {
    Ok(data_file_path(&app)?.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn load_app_data(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = data_file_path(&app)?;
    if !path.is_file() {
        return Ok(None);
    }
    fs::read_to_string(&path).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_app_data(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let path = data_file_path(&app)?;
    write_data_file(&path, &json)
}

#[tauri::command]
pub fn get_backup_dir(app: tauri::AppHandle) -> Result<String, String> {
    Ok(backup_dir_primary(&app)?.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn get_backup_locations(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let mut out: Vec<String> = backup_dirs_local_only(&app)
        .into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    if dropbox_installed() {
        let dropbox = dropbox_backup_path().to_string_lossy().into_owned();
        if !out.iter().any(|p| p == &dropbox) {
            out.push(dropbox);
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn list_data_backups(app: tauri::AppHandle) -> Result<Vec<BackupEntry>, String> {
    let dir = backup_dir_primary(&app)?;
    let mut out = Vec::with_capacity(BACKUP_SLOTS.len());
    for slot in BACKUP_SLOTS {
        let path = backup_path(&dir, slot)?;
        let exists = path.is_file();
        let modified_ms = if exists {
            file_modified_ms(&path)
        } else {
            None
        };
        out.push(BackupEntry {
            slot,
            exists,
            modified_ms,
            path: path.to_string_lossy().into_owned(),
        });
    }
    Ok(out)
}

/// Rota las 3 copias de resguardo con el JSON indicado (sin tocar el archivo principal).
#[tauri::command]
pub fn rotate_data_backups(app: tauri::AppHandle, json: String) -> Result<(), String> {
    rotate_backups_all(&app, &json)
}

/// Guarda datos actuales y rota las 3 copias de respaldo (al salir).
#[tauri::command]
pub fn finalize_exit(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let path = data_file_path(&app)?;
    write_data_file(&path, &json)?;
    rotate_data_backups(app, json)?;
    Ok(())
}

#[tauri::command]
pub fn restore_data_backup(app: tauri::AppHandle, slot: u8) -> Result<String, String> {
    let dir = backup_dir_primary(&app)?;
    let path = backup_path(&dir, slot)?;
    if !path.is_file() {
        return Err(format!(
            "No existe el respaldo {slot}. Salí del programa al menos una vez para crear copias."
        ));
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let data_path = data_file_path(&app)?;
    write_data_file(&data_path, &content)?;
    Ok(content)
}

/// Copia fechada del día (YYYY-MM-DD) en carpeta diario/; conserva 30 días.
#[tauri::command]
pub fn save_daily_data_backup(
    app: tauri::AppHandle,
    json: String,
    date: String,
) -> Result<(), String> {
    if !is_valid_backup_date(&date) {
        return Err("Fecha de respaldo inválida (use YYYY-MM-DD).".into());
    }
    save_daily_backups_all(&app, &json, &date)
}

#[tauri::command]
pub fn list_daily_data_backups(app: tauri::AppHandle) -> Result<Vec<DailyBackupEntry>, String> {
    let dir = backup_dir_primary(&app)?.join(DAILY_BACKUP_SUBDIR);
    list_daily_backups_in_dir(&dir)
}

const SMTP_SECRET_FILE: &str = "smtp-secret.txt";

#[tauri::command]
pub fn load_smtp_secret(app: tauri::AppHandle) -> Result<String, String> {
    let path = ensure_app_data_dir(&app)?.join(SMTP_SECRET_FILE);
    if !path.is_file() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_smtp_secret(app: tauri::AppHandle, secret: String) -> Result<(), String> {
    let path = ensure_app_data_dir(&app)?.join(SMTP_SECRET_FILE);
    if secret.trim().is_empty() {
        if path.is_file() {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    atomic_replace(&path, secret.as_bytes())
}
