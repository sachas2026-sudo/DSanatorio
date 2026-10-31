use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use serde::Serialize;
use crate::core::db;
use crate::core::error::AppError;
use crate::core::config::settings;
use crate::modules::configuracion::dto::AppData;

const BACKUP_1: &str = "sanatorio-datos.respaldo-1.json";
const BACKUP_2: &str = "sanatorio-datos.respaldo-2.json";
const BACKUP_3: &str = "sanatorio-datos.respaldo-3.json";
const DAILY_BACKUP_SUBDIR: &str = "diario";
const DAILY_BACKUP_RETENTION_DAYS: u32 = 60;
const BACKUP_SLOTS: [u8; 3] = [1, 2, 3];
const AUTH_ACCOUNTS_FILE: &str = "auth-accounts.json";
const SMTP_SECRET_FILE: &str = "smtp-secret.txt";
const COMPANION_FILES: [&str; 2] = [AUTH_ACCOUNTS_FILE, SMTP_SECRET_FILE];

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub slot: u8,
    pub exists: bool,
    pub modified_ms: Option<u64>,
    pub size_bytes: Option<u64>,
    pub path: String,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DailyBackupEntry {
    pub date: String,
    pub path: String,
    pub modified_ms: Option<u64>,
    pub size_bytes: Option<u64>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryChecklistEntry {
    pub key: String,
    pub label: String,
    pub path: String,
    pub exists: bool,
    pub required: bool,
    pub optional: bool,
}

fn file_modified_ms(path: &Path) -> Option<u64> {
    let meta = fs::metadata(path).ok()?;
    let modified = meta.modified().ok()?;
    modified
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as u64)
}

fn file_size_bytes(path: &Path) -> Option<u64> {
    fs::metadata(path).ok().map(|m| m.len())
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

fn dated_fragment_in_filename(name: &str) -> Option<String> {
    for part in name.split('.') {
        if is_valid_backup_date(part) {
            return Some(part.to_string());
        }
    }
    None
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

pub fn try_backup_dir(path: &str) -> Option<PathBuf> {
    let p = PathBuf::from(path);
    fs::create_dir_all(&p).ok()?;
    Some(p)
}

pub fn backup_dirs_local_only() -> Vec<PathBuf> {
    if let Some(p) = try_backup_dir(settings::BACKUP_DIR_ON_C) {
        return vec![p];
    }
    let p = settings::data_dir().join("respaldo");
    if fs::create_dir_all(&p).is_ok() {
        return vec![p];
    }
    Vec::new()
}

pub fn backup_dirs_for_rotation(json_str: &str) -> Vec<PathBuf> {
    let mut dirs = backup_dirs_local_only();
    let gd_prefs = crate::core::config::google_drive::prefs_from_app_json(json_str);
    // Discos secundarios en Windows (D:, E:, etc)
    #[cfg(windows)]
    {
        for letter in b'D'..=b'Z' {
            let letter = letter as char;
            let root = format!("{letter}:\\");
            if Path::new(&root).is_dir() {
                let p = PathBuf::from(format!("{letter}:\\Sanatorio\\respaldo"));
                if fs::create_dir_all(&p).is_ok() {
                    if !dirs.contains(&p) {
                        dirs.push(p);
                    }
                }
            }
        }
    }

    // Dropbox candidates
    if settings::dropbox_installed() {
        for candidate in settings::dropbox_backup_dir_candidates() {
            if fs::create_dir_all(&candidate).is_ok() {
                if !dirs.contains(&candidate) {
                    dirs.push(candidate);
                }
            }
        }
    }

    // Google Drive desktop candidates
    if !gd_prefs.disabled {
        for candidate in settings::google_drive_backup_dir_candidates(
            gd_prefs.custom_root.as_deref(),
            gd_prefs.disabled,
            gd_prefs.backup_folder.as_deref(),
        ) {
            if fs::create_dir_all(&candidate).is_ok() {
                if !dirs.contains(&candidate) {
                    dirs.push(candidate);
                }
            }
        }
    }

    dirs
}

pub fn backup_dir_primary() -> Result<PathBuf, AppError> {
    if let Some(p) = try_backup_dir(settings::BACKUP_DIR_ON_C) {
        return Ok(p);
    }
    backup_dirs_local_only()
        .into_iter()
        .next()
        .ok_or_else(|| AppError::Io(format!("No se pudo crear la carpeta de respaldo en {}", settings::BACKUP_DIR_ON_C)))
}

fn atomic_replace(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes)?;
    
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        const MOVEFILE_REPLACE_EXISTING: u32 = 0x0000_0001;
        const MOVEFILE_WRITE_THROUGH: u32 = 0x0000_0008;

        extern "system" {
            fn MoveFileExW(
                lp_existing_file_name: *const u16,
                lp_new_file_name: *const u16,
                dw_flags: u32,
            ) -> i32;
        }

        let from_wide: Vec<u16> = tmp.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let to_wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        
        let ok = unsafe {
            MoveFileExW(
                from_wide.as_ptr(),
                to_wide.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        
        if ok == 0 {
            let err = std::io::Error::last_os_error();
            let _ = fs::remove_file(&tmp);
            return Err(AppError::Io(format!("No se pudo reemplazar {}: {err}", path.display())));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        fs::rename(tmp, path)?;
        Ok(())
    }
}

fn companion_slot_backup_name(source_name: &str, slot: u8) -> String {
    let path = Path::new(source_name);
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| source_name.to_string());
    let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    format!("{stem}.respaldo-{slot}{ext}")
}

fn companion_daily_backup_name(source_name: &str, date: &str) -> String {
    let path = Path::new(source_name);
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| source_name.to_string());
    let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    format!("{stem}.{date}{ext}")
}

fn rotate_companion_slot_set(dir: &Path, data_dir: &Path, source_name: &str) -> Result<(), AppError> {
    let p1 = dir.join(companion_slot_backup_name(source_name, 1));
    let p2 = dir.join(companion_slot_backup_name(source_name, 2));
    let p3 = dir.join(companion_slot_backup_name(source_name, 3));
    let source = data_dir.join(source_name);

    if p3.is_file() {
        fs::remove_file(&p3)?;
    }
    if p2.is_file() {
        fs::rename(&p2, &p3)?;
    }
    if p1.is_file() {
        if p2.is_file() {
            fs::remove_file(&p2)?;
        }
        fs::rename(&p1, &p2)?;
    }

    if source.is_file() {
        fs::copy(&source, &p1)?;
    } else if p1.is_file() {
        let _ = fs::remove_file(&p1);
    }
    Ok(())
}

fn snapshot_companion_files_for_rotation(dir: &Path, data_dir: &Path) -> Result<(), AppError> {
    for name in COMPANION_FILES {
        rotate_companion_slot_set(dir, data_dir, name)?;
    }
    Ok(())
}

fn snapshot_companion_files_for_daily(daily_dir: &Path, data_dir: &Path, date: &str) -> Result<(), AppError> {
    for name in COMPANION_FILES {
        let source = data_dir.join(name);
        let dest = daily_dir.join(companion_daily_backup_name(name, date));
        if source.is_file() {
            let bytes = fs::read(&source)?;
            atomic_replace(&dest, &bytes)?;
        } else if dest.is_file() {
            let _ = fs::remove_file(&dest);
        }
    }
    Ok(())
}

fn rotate_backups(dir: &Path, json: &str, data_dir: &Path) -> Result<(), AppError> {
    let p1 = dir.join(BACKUP_1);
    let p2 = dir.join(BACKUP_2);
    let p3 = dir.join(BACKUP_3);

    if p3.is_file() {
        fs::remove_file(&p3)?;
    }
    if p2.is_file() {
        fs::rename(&p2, &p3)?;
    }
    if p1.is_file() {
        if p2.is_file() {
            fs::remove_file(&p2)?;
        }
        fs::rename(&p1, &p2)?;
    }

    atomic_replace(&p1, json.as_bytes())?;
    snapshot_companion_files_for_rotation(dir, data_dir)?;
    Ok(())
}

fn prune_daily_backups(daily_dir: &Path, today: &str) -> Result<(), AppError> {
    if !daily_dir.is_dir() {
        return Ok(());
    }
    let cutoff = match subtract_days_from_date(today, DAILY_BACKUP_RETENTION_DAYS) {
        Some(c) => c,
        None => return Ok(()),
    };
    for entry in fs::read_dir(daily_dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        let date = match parse_daily_backup_date(name).or_else(|| dated_fragment_in_filename(name)) {
            Some(d) => d,
            None => continue,
        };
        if date < cutoff {
            let _ = fs::remove_file(&path);
        }
    }
    Ok(())
}

fn save_daily_backup_in_dir(dir: &Path, json: &str, date: &str, data_dir: &Path) -> Result<(), AppError> {
    let daily_dir = dir.join(DAILY_BACKUP_SUBDIR);
    fs::create_dir_all(&daily_dir)?;
    let path = daily_dir.join(daily_backup_filename(date));
    atomic_replace(&path, json.as_bytes())?;
    snapshot_companion_files_for_daily(&daily_dir, data_dir, date)?;
    prune_daily_backups(&daily_dir, date)
}

pub fn rotate_backups_all(json: &str) -> Result<(), AppError> {
    let data_dir = settings::data_dir();
    let dirs = backup_dirs_for_rotation(json);
    if dirs.is_empty() {
        return Err(AppError::Io("No se pudo crear ninguna carpeta de respaldo.".into()));
    }
    let mut errors: Vec<String> = Vec::new();
    for dir in &dirs {
        if let Err(e) = rotate_backups(dir, json, &data_dir) {
            errors.push(format!("{}: {e}", dir.to_string_lossy()));
        }
    }
    if errors.len() == dirs.len() {
        return Err(AppError::Io(errors.join(" · ")));
    }
    Ok(())
}

fn copy_directory_contents(source: &Path, destination: &Path) -> Result<(), AppError> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        // El bloqueo de instancia permanece abierto mientras se ejecuta el
        // programa y no forma parte de los datos recuperables.
        if entry
            .file_name()
            .to_string_lossy()
            .eq_ignore_ascii_case("sanatorio.lock")
        {
            continue;
        }
        if source_path.is_dir() {
            copy_directory_contents(&source_path, &destination_path)?;
        } else if source_path.is_file() {
            fs::copy(&source_path, &destination_path)?;
        }
    }
    Ok(())
}

#[cfg(windows)]
fn hide_full_backup_directory(path: &Path) -> Result<(), AppError> {
    use std::os::windows::ffi::OsStrExt;

    extern "system" {
        fn SetFileAttributesW(file_name: *const u16, attributes: u32) -> i32;
    }

    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x0000_0002;
    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let ok = unsafe { SetFileAttributesW(wide.as_ptr(), FILE_ATTRIBUTE_HIDDEN) };
    if ok == 0 {
        return Err(AppError::Io(format!(
            "No se pudo ocultar la carpeta {}: {}",
            path.display(),
            std::io::Error::last_os_error()
        )));
    }
    Ok(())
}

#[cfg(not(windows))]
fn hide_full_backup_directory(_path: &Path) -> Result<(), AppError> {
    Ok(())
}

/** Guarda una copia completa de la carpeta de datos en C:\Sanatorio\Backup. */
pub fn save_full_backup_on_exit() -> Result<(), AppError> {
    let source = settings::data_dir();
    let root = PathBuf::from(settings::FULL_BACKUP_DIR_ON_C);
    if source == root || !source.is_dir() {
        return Err(AppError::Io("La carpeta de datos no es válida para el respaldo completo.".into()));
    }
    fs::create_dir_all(&root)?;

    for slot in (1..5).rev() {
        let current = root.join(format!("copia-{slot}"));
        let next = root.join(format!("copia-{}", slot + 1));
        if next.is_dir() {
            fs::remove_dir_all(&next)?;
        }
        if current.is_dir() {
            fs::rename(&current, &next)?;
        }
    }

    let latest = root.join("copia-1");
    if latest.is_dir() {
        fs::remove_dir_all(&latest)?;
    }
    copy_directory_contents(&source, &latest)?;
    hide_full_backup_directory(&root)?;
    Ok(())
}

pub fn save_daily_backups_all(json: &str, date: &str) -> Result<(), AppError> {
    let data_dir = settings::data_dir();
    let dirs = backup_dirs_for_rotation(json);
    if dirs.is_empty() {
        return Err(AppError::Io("No se pudo crear ninguna carpeta de respaldo.".into()));
    }
    let mut errors: Vec<String> = Vec::new();
    for dir in &dirs {
        if let Err(e) = save_daily_backup_in_dir(dir, json, date, &data_dir) {
            errors.push(format!("{}: {e}", dir.to_string_lossy()));
        }
    }
    if errors.len() == dirs.len() {
        return Err(AppError::Io(errors.join(" · ")));
    }
    Ok(())
}

pub fn list_data_backups() -> Result<Vec<BackupEntry>, AppError> {
    let dir = backup_dir_primary()?;
    let mut out = Vec::with_capacity(3);
    for slot in BACKUP_SLOTS {
        let path = dir.join(match slot {
            1 => BACKUP_1,
            2 => BACKUP_2,
            3 => BACKUP_3,
            _ => unreachable!(),
        });
        let exists = path.is_file();
        let modified_ms = if exists { file_modified_ms(&path) } else { None };
        let size_bytes = if exists { file_size_bytes(&path) } else { None };
        out.push(BackupEntry {
            slot,
            exists,
            modified_ms,
            size_bytes,
            path: path.to_string_lossy().into_owned(),
        });
    }
    Ok(out)
}

pub fn list_daily_backups_in_dir(daily_dir: &Path) -> Result<Vec<DailyBackupEntry>, AppError> {
    if !daily_dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(daily_dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        let date = match parse_daily_backup_date(name) {
            Some(d) => d,
            None => continue,
        };
        out.push(DailyBackupEntry {
            date,
            path: path.to_string_lossy().into_owned(),
            modified_ms: file_modified_ms(&path),
            size_bytes: file_size_bytes(&path),
        });
    }
    out.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(out)
}

pub fn read_data_backup(slot: u8) -> Result<String, AppError> {
    let dir = backup_dir_primary()?;
    let name = match slot {
        1 => BACKUP_1,
        2 => BACKUP_2,
        3 => BACKUP_3,
        _ => return Err(AppError::Validation("Slot de respaldo inválido.".into())),
    };
    let path = dir.join(name);
    if !path.is_file() {
        return Err(AppError::NotFound(format!("No existe el respaldo {slot}.")));
    }
    Ok(fs::read_to_string(&path)?)
}

pub fn read_daily_data_backup(date: &str) -> Result<String, AppError> {
    if !is_valid_backup_date(date) {
        return Err(AppError::Validation("Fecha de respaldo inválida (use YYYY-MM-DD).".into()));
    }
    let dir = backup_dir_primary()?.join(DAILY_BACKUP_SUBDIR);
    let path = dir.join(daily_backup_filename(date));
    if !path.is_file() {
        return Err(AppError::NotFound(format!("No hay respaldo diario para {date}.")));
    }
    Ok(fs::read_to_string(&path)?)
}

fn restore_companion_files_from_slot(backup_dir: &Path, data_dir: &Path, slot: u8) -> Result<(), AppError> {
    for name in COMPANION_FILES {
        let backup = backup_dir.join(companion_slot_backup_name(name, slot));
        let dest = data_dir.join(name);
        if backup.is_file() {
            fs::copy(&backup, &dest)?;
        } else if dest.is_file() {
            fs::remove_file(&dest)?;
        }
    }
    Ok(())
}

fn restore_companion_files_from_daily(daily_dir: &Path, data_dir: &Path, date: &str) -> Result<(), AppError> {
    for name in COMPANION_FILES {
        let backup = daily_dir.join(companion_daily_backup_name(name, date));
        let dest = data_dir.join(name);
        if backup.is_file() {
            fs::copy(&backup, &dest)?;
        } else if dest.is_file() {
            fs::remove_file(&dest)?;
        }
    }
    Ok(())
}

pub fn restore_backup_companion_files(slot: Option<u8>, daily_date: Option<&str>) -> Result<(), AppError> {
    let data_dir = settings::data_dir();
    let backup_dir = backup_dir_primary()?;
    if let Some(s) = slot {
        if s < 1 || s > 3 {
            return Err(AppError::Validation("Respaldo inválido (use 1, 2 o 3).".into()));
        }
        restore_companion_files_from_slot(&backup_dir, &data_dir, s)?;
        return Ok(());
    }
    if let Some(date) = daily_date {
        if !is_valid_backup_date(date) {
            return Err(AppError::Validation("Fecha de respaldo inválida (use YYYY-MM-DD).".into()));
        }
        let daily_dir = backup_dir.join(DAILY_BACKUP_SUBDIR);
        restore_companion_files_from_daily(&daily_dir, &data_dir, date)?;
        return Ok(());
    }
    Err(AppError::Validation("Indique slot o fecha de respaldo diario.".into()))
}

pub fn apply_data_backup_restore(json: &str, slot: Option<u8>, daily_date: Option<&str>) -> Result<(), AppError> {
    if json.trim().is_empty() {
        return Err(AppError::Validation("Respaldo vacío.".into()));
    }
    
    // Validar JSON de respaldo
    let data: AppData = serde_json::from_str(json)?;

    let data_dir = settings::data_dir();
    let rollback_dir = data_dir.join(".restore-rollback");
    
    // Crear snapshot de estado actual para rollback
    if rollback_dir.is_dir() {
        fs::remove_dir_all(&rollback_dir)?;
    }
    fs::create_dir_all(&rollback_dir)?;

    let db_file = data_dir.join(db::DB_FILE);
    if db_file.is_file() {
        db::backup_db_safe(&db_file, &rollback_dir.join(db::DB_FILE))?;
    }
    for name in COMPANION_FILES {
        let src = data_dir.join(name);
        if src.is_file() {
            fs::copy(&src, rollback_dir.join(name))?;
        }
    }

    let restore_result = (|| -> Result<(), AppError> {
        let backup_dir = backup_dir_primary()?;
        if let Some(s) = slot {
            restore_companion_files_from_slot(&backup_dir, &data_dir, s)?;
        } else if let Some(date) = daily_date {
            let daily_dir = backup_dir.join(DAILY_BACKUP_SUBDIR);
            restore_companion_files_from_daily(&daily_dir, &data_dir, date)?;
        }
        
        // Guardar directamente en SQLite
        crate::modules::configuracion::service::replace_app_data_direct(&data)?;
        Ok(())
    })();

    match restore_result {
        Ok(()) => {
            let _ = fs::remove_dir_all(&rollback_dir);
            Ok(())
        }
        Err(err) => {
            // Rollback en caso de error
            let db_backup = rollback_dir.join(db::DB_FILE);
            if db_backup.is_file() {
                fs::copy(&db_backup, &db_file)?;
            }
            for name in COMPANION_FILES {
                let backup = rollback_dir.join(name);
                let dest = data_dir.join(name);
                if backup.is_file() {
                    fs::copy(&backup, &dest)?;
                } else if dest.is_file() {
                    fs::remove_file(&dest)?;
                }
            }
            let _ = fs::remove_dir_all(&rollback_dir);
            Err(err)
        }
    }
}

pub fn get_recovery_checklist() -> Result<Vec<RecoveryChecklistEntry>, AppError> {
    let data_dir = settings::data_dir();
    let db_path = data_dir.join(db::DB_FILE);

    let mut items = vec![
        RecoveryChecklistEntry {
            key: "datos".into(),
            label: "Base principal (SQLite)".into(),
            path: db_path.to_string_lossy().into_owned(),
            exists: db_path.is_file(),
            required: true,
            optional: false,
        },
        RecoveryChecklistEntry {
            key: "auth".into(),
            label: "Cuentas de ingreso".into(),
            path: data_dir.join(AUTH_ACCOUNTS_FILE).to_string_lossy().into_owned(),
            exists: data_dir.join(AUTH_ACCOUNTS_FILE).is_file(),
            required: true,
            optional: false,
        },
        RecoveryChecklistEntry {
            key: "smtp".into(),
            label: "Clave SMTP (correo)".into(),
            path: data_dir.join(SMTP_SECRET_FILE).to_string_lossy().into_owned(),
            exists: data_dir.join(SMTP_SECRET_FILE).is_file(),
            required: false,
            optional: false,
        },
    ];

    if let Ok(backup_dir) = backup_dir_primary() {
        for slot in BACKUP_SLOTS {
            let path = backup_dir.join(match slot {
                1 => BACKUP_1,
                2 => BACKUP_2,
                3 => BACKUP_3,
                _ => unreachable!(),
            });
            items.push(RecoveryChecklistEntry {
                key: format!("respaldo-{slot}"),
                label: format!("Respaldo rotativo {slot}"),
                path: path.to_string_lossy().into_owned(),
                exists: path.is_file(),
                required: false,
                optional: false,
            });
        }
        let daily_dir = backup_dir.join(DAILY_BACKUP_SUBDIR);
        items.push(RecoveryChecklistEntry {
            key: "respaldo-diario".into(),
            label: "Carpeta respaldo diario".into(),
            path: daily_dir.to_string_lossy().into_owned(),
            exists: daily_dir.is_dir(),
            required: false,
            optional: false,
        });
    }

    let dropbox_path = settings::user_dropbox_root()
        .map(|r| r.join("Sanatorio").join("respaldo"))
        .unwrap_or_else(|| {
            std::env::var("USERPROFILE")
                .map(|p| PathBuf::from(p).join("Dropbox").join("Sanatorio").join("respaldo"))
                .unwrap_or_else(|_| PathBuf::from("Dropbox/Sanatorio/respaldo"))
        });
    
    items.push(RecoveryChecklistEntry {
        key: "dropbox".into(),
        label: if settings::dropbox_installed() {
            "Respaldo en Dropbox".into()
        } else {
            "Dropbox (no instalado)".into()
        },
        path: dropbox_path.to_string_lossy().into_owned(),
        exists: dropbox_path.is_dir(),
        required: false,
        optional: true,
    });

    let google_drive_path = settings::user_google_drive_root()
        .map(|r| r.join("Sanatorio").join("respaldo"))
        .unwrap_or_else(|| {
            std::env::var("USERPROFILE")
                .map(|p| PathBuf::from(p).join("Google Drive").join("Sanatorio").join("respaldo"))
                .unwrap_or_else(|_| PathBuf::from("Google Drive/Sanatorio/respaldo"))
        });

    items.push(RecoveryChecklistEntry {
        key: "google_drive".into(),
        label: if settings::google_drive_installed() {
            "Respaldo en Google Drive".into()
        } else {
            "Google Drive (no instalado)".into()
        },
        path: google_drive_path.to_string_lossy().into_owned(),
        exists: google_drive_path.is_dir(),
        required: false,
        optional: true,
    });

    Ok(items)
}
