use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::core::config::settings;

use serde::{Deserialize, Serialize};
use tauri::Manager;

const DATA_FILE: &str = "sanatorio-datos.json";
const BACKUP_1: &str = "sanatorio-datos.respaldo-1.json";
const BACKUP_2: &str = "sanatorio-datos.respaldo-2.json";
const BACKUP_3: &str = "sanatorio-datos.respaldo-3.json";
const DAILY_BACKUP_SUBDIR: &str = "diario";
const DAILY_BACKUP_RETENTION_DAYS: u32 = 30;
const BACKUP_SLOTS: [u8; 3] = [1, 2, 3];
/// Carpeta raíz de instalación (programa y datos).
const SANATORIO_ROOT: &str = r"C:\Sanatorio";
/// Base de datos y secretos (persiste al actualizar el .exe).
const DATA_DIR_ON_C: &str = r"C:\Sanatorio\datos";
/// Respaldo local en esta PC.
const BACKUP_DIR_ON_C: &str = r"C:\Sanatorio\respaldo";
/// Dropbox (solo al guardar respaldos, no al iniciar la app).
const LEGACY_DROPBOX_ROOT: &str = r"C:\Users\LAS\Dropbox";

const SECRET_FILES: [&str; 1] = ["smtp-secret.txt"];
const AUTH_ACCOUNTS_FILE: &str = "auth-accounts.json";
const INSTALL_META_FILE: &str = "install-meta.json";
/// Archivos de configuración y secretos que acompañan cada respaldo del JSON principal.
const COMPANION_FILES: [&str; 2] = [AUTH_ACCOUNTS_FILE, "smtp-secret.txt"];

/// Ruta junto al .exe (instalaciones muy antiguas).
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

fn copy_file_if_missing(from: &Path, to: &Path) -> Result<(), String> {
    if !from.is_file() || to.is_file() {
        return Ok(());
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(from, to).map_err(|e| e.to_string())?;
    Ok(())
}

fn migrate_secrets_from_dir(from: &Path, to: &Path) -> Result<(), String> {
    for name in SECRET_FILES {
        copy_file_if_missing(&from.join(name), &to.join(name))?;
    }
    Ok(())
}

fn migrate_data_to_sanatorio_dir(app: &tauri::AppHandle, dir: &Path) -> Result<(), String> {
    let new_path = dir.join(DATA_FILE);
    if new_path.is_file() {
        return Ok(());
    }

    if let Ok(old_dir) = app.path().app_data_dir() {
        let old_path = old_dir.join(DATA_FILE);
        if old_path.is_file() {
            copy_file_if_missing(&old_path, &new_path)?;
            migrate_secrets_from_dir(&old_dir, dir)?;
            return Ok(());
        }
    }

    if let Some(legacy) = legacy_data_file_path()? {
        copy_file_if_missing(&legacy, &new_path)?;
        let marker = legacy.with_extension("json.ubicacion-anterior");
        if marker.is_file() {
            let _ = fs::remove_file(&marker);
        }
        if legacy.is_file() {
            let _ = fs::rename(&legacy, marker);
        }
    }
    Ok(())
}

fn ensure_app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = settings::data_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    migrate_data_to_sanatorio_dir(app, &dir)?;
    if let Ok(old_dir) = app.path().app_data_dir() {
        let _ = migrate_secrets_from_dir(&old_dir, &dir);
    }
    Ok(dir)
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallMeta {
    app_version: String,
    updated_at_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    previous_version: Option<String>,
}

/// Migraciones de datos al cambiar de version (extensible en el futuro).
fn apply_version_migrations(_previous: Option<&str>, _data_dir: &Path) -> Result<(), String> {
    Ok(())
}

fn record_install_meta(app: &tauri::AppHandle, data_dir: &Path) -> Result<(), String> {
    let current = app.package_info().version.to_string();
    let path = data_dir.join(INSTALL_META_FILE);
    let previous = if path.is_file() {
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str::<InstallMeta>(&raw)
            .ok()
            .map(|m| m.app_version)
    } else {
        None
    };
    if previous.as_deref() == Some(current.as_str()) {
        return Ok(());
    }
    apply_version_migrations(previous.as_deref(), data_dir)?;
    let meta = InstallMeta {
        app_version: current,
        updated_at_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
        previous_version: previous,
    };
    let json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    atomic_replace(&path, json.as_bytes())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallInfo {
    pub app_version: String,
    pub data_dir: String,
    pub updated_at_ms: Option<u64>,
    pub previous_version: Option<String>,
}

#[tauri::command]
pub fn get_install_info(app: tauri::AppHandle) -> Result<InstallInfo, String> {
    let data_dir = ensure_app_data_dir(&app)?;
    let _ = record_install_meta(&app, &data_dir);
    let path = data_dir.join(INSTALL_META_FILE);
    let (updated_at_ms, previous_version) = if path.is_file() {
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        match serde_json::from_str::<InstallMeta>(&raw) {
            Ok(m) => (Some(m.updated_at_ms), m.previous_version),
            Err(_) => (None, None),
        }
    } else {
        (None, None)
    };
    Ok(InstallInfo {
        app_version: app.package_info().version.to_string(),
        data_dir: data_dir.to_string_lossy().into_owned(),
        updated_at_ms,
        previous_version,
    })
}

fn bundled_resource_roots(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(r) = app.path().resource_dir() {
        roots.push(r);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(dir.join("resources"));
            roots.push(dir.to_path_buf());
        }
    }
    roots
}

fn bundled_resource_file(app: &tauri::AppHandle, name: &str) -> Option<PathBuf> {
    bundled_resource_roots(app)
        .into_iter()
        .map(|root| root.join(name))
        .find(|path| path.is_file())
}

/// Copia bases empaquetadas en el instalador si C:\Sanatorio\datos está vacío.
fn seed_bundled_bases_if_needed(app: &tauri::AppHandle) -> Result<(), String> {
    let data_path = {
        let dir = ensure_app_data_dir(app)?;
        dir.join(DATA_FILE)
    };
    if !data_path.is_file() {
        if let Some(bundled) = bundled_resource_file(app, DATA_FILE) {
            fs::copy(&bundled, &data_path).map_err(|e| {
                format!("No se pudo copiar la base del instalador: {e}")
            })?;
        }
    }

    let backup_names = [BACKUP_1, BACKUP_2, BACKUP_3];
    let dirs = backup_dirs_local_only(app);
    for name in backup_names {
        let Some(bundled) = bundled_resource_file(app, name) else {
            continue;
        };
        for dir in &dirs {
            let dest = dir.join(name);
            if !dest.is_file() {
                let _ = fs::copy(&bundled, &dest);
            }
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn stop_legacy_background_services() {
    use std::os::windows::process::CommandExt;

    // Detiene procesos legacy de instalaciones antiguas en C:\Sanatorio.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const PS: &str = r#"
foreach ($n in @('SanatorioPanel','SanatorioPanelTunnel','CuidarPanel','CuidarPanelTunnel')) {
  Stop-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $n -Confirm:$false -ErrorAction SilentlyContinue
}
Stop-Process -Name cloudflared -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object {
    $cmd = $_.CommandLine
    $cmd -and ($cmd -match 'panel\.cjs' -or $cmd -match '\\Sanatorio\\panel\\')
  } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name = 'cmd.exe'" |
  Where-Object {
    $cmd = $_.CommandLine
    $cmd -and ($cmd -match 'iniciar-panel\.cmd' -or $cmd -match '\\Sanatorio\\panel\\')
  } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
"#;
    let _ = std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-WindowStyle",
            "Hidden",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            PS,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
}

#[cfg(not(target_os = "windows"))]
fn stop_legacy_background_services() {}

pub fn prepare_storage_on_startup(app: &tauri::AppHandle) {
    stop_legacy_background_services();
    if let Ok(dir) = ensure_app_data_dir(app) {
        if let Err(e) = record_install_meta(app, &dir) {
            eprintln!("[Sanatorio] No se pudo registrar version instalada: {e}");
        }
    }
    if let Err(e) = seed_bundled_bases_if_needed(app) {
        eprintln!("[Sanatorio] No se pudieron copiar bases del instalador: {e}");
    }
    if let Err(e) = data_file_path(app) {
        eprintln!("[Sanatorio] No se pudo preparar carpeta de datos: {e}");
    }
}

fn data_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = ensure_app_data_dir(app)?;
    Ok(dir.join(DATA_FILE))
}

/// Escribe el archivo completo de forma atómica (.tmp + rename / reemplazo en Windows).
fn atomic_replace(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    replace_path_atomic(&tmp, path)?;
    Ok(())
}

#[cfg(windows)]
fn replace_path_atomic(from: &Path, to: &Path) -> Result<(), String> {
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

    fn to_wide(path: &Path) -> Result<Vec<u16>, String> {
        Ok(path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect())
    }

    let from_wide = to_wide(from)?;
    let to_wide = to_wide(to)?;
    let ok = unsafe {
        MoveFileExW(
            from_wide.as_ptr(),
            to_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok == 0 {
        let err = std::io::Error::last_os_error();
        let _ = fs::remove_file(from);
        return Err(format!("No se pudo reemplazar {}: {err}", to.display()));
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_path_atomic(from: &Path, to: &Path) -> Result<(), String> {
    fs::rename(from, to).map_err(|e| e.to_string())
}

fn write_data_file(path: &Path, json: &str) -> Result<(), String> {
    atomic_replace(path, json.as_bytes())
}

fn try_backup_dir_path(path: &Path) -> Option<PathBuf> {
    fs::create_dir_all(path).ok()?;
    Some(path.to_path_buf())
}

fn backup_dirs_local_only(app: &tauri::AppHandle) -> Vec<PathBuf> {
    if let Some(p) = try_backup_dir_path(&settings::backup_dir()) {
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

fn user_dropbox_root() -> Option<PathBuf> {
    std::env::var("USERPROFILE")
        .ok()
        .map(|p| PathBuf::from(p).join("Dropbox"))
        .filter(|p| p.is_dir())
}

fn dropbox_backup_dir_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(root) = user_dropbox_root() {
        candidates.push(root.join("Sanatorio").join("respaldo"));
    }
    let legacy = PathBuf::from(LEGACY_DROPBOX_ROOT).join("Sanatorio").join("respaldo");
    if Path::new(LEGACY_DROPBOX_ROOT).is_dir() && !candidates.contains(&legacy) {
        candidates.push(legacy);
    }
    candidates
}

fn dropbox_installed() -> bool {
    user_dropbox_root().is_some() || Path::new(LEGACY_DROPBOX_ROOT).is_dir()
}

fn ensure_dropbox_backup_dirs() -> Vec<PathBuf> {
    dropbox_backup_dir_candidates()
        .into_iter()
        .filter_map(|p| try_backup_dir_path(&p))
        .collect()
}

fn secondary_drive_backup_path(letter: char) -> PathBuf {
    PathBuf::from(format!("{letter}:\\Sanatorio\\respaldo"))
}

/// Otros discos locales (D:, E:, …) distintos de C:.
#[cfg(windows)]
fn secondary_drive_backup_dir_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for letter in b'D'..=b'Z' {
        let letter = letter as char;
        let root = format!("{letter}:\\");
        if Path::new(&root).is_dir() {
            candidates.push(secondary_drive_backup_path(letter));
        }
    }
    candidates
}

#[cfg(not(windows))]
fn secondary_drive_backup_dir_candidates() -> Vec<PathBuf> {
    Vec::new()
}

fn ensure_secondary_drive_backup_dirs() -> Vec<PathBuf> {
    secondary_drive_backup_dir_candidates()
        .into_iter()
        .filter_map(|p| try_backup_dir_path(&p))
        .collect()
}

/// Carpetas para rotar respaldos (PC + otro disco local + Dropbox al guardar).
fn backup_dirs_for_rotation(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut dirs = backup_dirs_local_only(app);
    for p in ensure_secondary_drive_backup_dirs() {
        if !dirs.iter().any(|d| d == &p) {
            dirs.push(p);
        }
    }
    for p in ensure_dropbox_backup_dirs() {
        if !dirs.iter().any(|d| d == &p) {
            dirs.push(p);
        }
    }
    dirs
}

/// Carpeta principal para listar/restaurar (siempre la PC local si existe).
fn backup_dir_primary(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(p) = try_backup_dir_path(&settings::backup_dir()) {
        return Ok(p);
    }
    backup_dirs_local_only(app)
        .into_iter()
        .next()
        .ok_or_else(|| {
            format!(
                "No se pudo crear la carpeta de respaldo en {}.",
                settings::backup_dir().display()
            )
        })
}

fn rotate_backups_all(app: &tauri::AppHandle, json: &str) -> Result<(), String> {
    let data_dir = ensure_app_data_dir(app)?;
    let dirs = backup_dirs_for_rotation(app);
    if dirs.is_empty() {
        return Err("No se pudo crear ninguna carpeta de respaldo.".into());
    }
    let mut errors: Vec<String> = Vec::new();
    for dir in &dirs {
        if let Err(e) = rotate_backups(dir, json, &data_dir) {
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

fn companion_slot_backup_name(source_name: &str, slot: u8) -> String {
    let path = Path::new(source_name);
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| source_name.to_string());
    let ext = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    format!("{stem}.respaldo-{slot}{ext}")
}

fn companion_daily_backup_name(source_name: &str, date: &str) -> String {
    let path = Path::new(source_name);
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| source_name.to_string());
    let ext = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    format!("{stem}.{date}{ext}")
}

fn rotate_companion_slot_set(
    dir: &Path,
    data_dir: &Path,
    source_name: &str,
) -> Result<(), String> {
    let p1 = dir.join(companion_slot_backup_name(source_name, 1));
    let p2 = dir.join(companion_slot_backup_name(source_name, 2));
    let p3 = dir.join(companion_slot_backup_name(source_name, 3));
    let source = data_dir.join(source_name);

    if p3.is_file() {
        fs::remove_file(&p3).map_err(|e| e.to_string())?;
    }
    if p2.is_file() {
        fs::rename(&p2, &p3).map_err(|e| e.to_string())?;
    }
    if p2.is_file() {
        fs::remove_file(&p2).ok();
    }
    if p1.is_file() {
        if p2.is_file() {
            fs::remove_file(&p2).map_err(|e| e.to_string())?;
        }
        fs::rename(&p1, &p2).map_err(|e| e.to_string())?;
    }

    if source.is_file() {
        fs::copy(&source, &p1).map_err(|e| e.to_string())?;
    } else if p1.is_file() {
        let _ = fs::remove_file(&p1);
    }
    Ok(())
}

fn snapshot_companion_files_for_rotation(dir: &Path, data_dir: &Path) -> Result<(), String> {
    for name in COMPANION_FILES {
        rotate_companion_slot_set(dir, data_dir, name)?;
    }
    Ok(())
}

fn snapshot_companion_files_for_daily(
    daily_dir: &Path,
    data_dir: &Path,
    date: &str,
) -> Result<(), String> {
    for name in COMPANION_FILES {
        let source = data_dir.join(name);
        let dest = daily_dir.join(companion_daily_backup_name(name, date));
        if source.is_file() {
            let bytes = fs::read(&source).map_err(|e| e.to_string())?;
            atomic_replace(&dest, &bytes)?;
        } else if dest.is_file() {
            let _ = fs::remove_file(&dest);
        }
    }
    Ok(())
}

fn restore_companion_files_from_slot(
    backup_dir: &Path,
    data_dir: &Path,
    slot: u8,
) -> Result<(), String> {
    for name in COMPANION_FILES {
        let backup = backup_dir.join(companion_slot_backup_name(name, slot));
        let dest = data_dir.join(name);
        if backup.is_file() {
            fs::copy(&backup, &dest).map_err(|e| e.to_string())?;
        } else if dest.is_file() {
            fs::remove_file(&dest).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn restore_companion_files_from_daily(
    daily_dir: &Path,
    data_dir: &Path,
    date: &str,
) -> Result<(), String> {
    for name in COMPANION_FILES {
        let backup = daily_dir.join(companion_daily_backup_name(name, date));
        let dest = data_dir.join(name);
        if backup.is_file() {
            fs::copy(&backup, &dest).map_err(|e| e.to_string())?;
        } else if dest.is_file() {
            fs::remove_file(&dest).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

const RESTORE_ROLLBACK_DIR: &str = ".restore-rollback";

fn clear_restore_rollback_dir(dir: &Path) {
    if dir.is_dir() {
        let _ = fs::remove_dir_all(dir);
    }
}

fn snapshot_live_state_for_rollback(data_dir: &Path, rollback_dir: &Path) -> Result<(), String> {
    clear_restore_rollback_dir(rollback_dir);
    fs::create_dir_all(rollback_dir).map_err(|e| e.to_string())?;

    let main = data_dir.join(DATA_FILE);
    if main.is_file() {
        fs::copy(&main, rollback_dir.join(DATA_FILE)).map_err(|e| e.to_string())?;
    }
    for name in COMPANION_FILES {
        let src = data_dir.join(name);
        if src.is_file() {
            fs::copy(&src, rollback_dir.join(name)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn restore_live_state_from_rollback(data_dir: &Path, rollback_dir: &Path) -> Result<(), String> {
    let main_backup = rollback_dir.join(DATA_FILE);
    if main_backup.is_file() {
        let bytes = fs::read(&main_backup).map_err(|e| e.to_string())?;
        atomic_replace(&data_dir.join(DATA_FILE), &bytes)?;
    }
    for name in COMPANION_FILES {
        let backup = rollback_dir.join(name);
        let dest = data_dir.join(name);
        if backup.is_file() {
            fs::copy(&backup, &dest).map_err(|e| e.to_string())?;
        } else if dest.is_file() {
            fs::remove_file(&dest).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn apply_data_backup_restore_inner(
    app: &tauri::AppHandle,
    json: &str,
    slot: Option<u8>,
    daily_date: Option<&str>,
) -> Result<(), String> {
    if json.trim().is_empty() {
        return Err("Respaldo vacío.".into());
    }
    serde_json::from_str::<serde_json::Value>(json)
        .map_err(|e| format!("JSON de respaldo inválido: {e}"))?;

    let data_dir = ensure_app_data_dir(app)?;
    let rollback_dir = data_dir.join(RESTORE_ROLLBACK_DIR);
    snapshot_live_state_for_rollback(&data_dir, &rollback_dir)?;

    let restore_result = (|| -> Result<(), String> {
        let backup_dir = backup_dir_primary(app)?;
        if let Some(s) = slot {
            if s < 1 || s > 3 {
                return Err("Respaldo inválido (use 1, 2 o 3).".into());
            }
            restore_companion_files_from_slot(&backup_dir, &data_dir, s)?;
        } else if let Some(date) = daily_date {
            if !is_valid_backup_date(date) {
                return Err("Fecha de respaldo inválida (use YYYY-MM-DD).".into());
            }
            let daily_dir = backup_dir.join(DAILY_BACKUP_SUBDIR);
            restore_companion_files_from_daily(&daily_dir, &data_dir, date)?;
        } else {
            return Err("Indique slot o fecha de respaldo diario.".into());
        }
        write_data_file(&data_dir.join(DATA_FILE), json)
    })();

    match restore_result {
        Ok(()) => {
            clear_restore_rollback_dir(&rollback_dir);
            Ok(())
        }
        Err(err) => {
            if let Err(rollback_err) =
                restore_live_state_from_rollback(&data_dir, &rollback_dir)
            {
                eprintln!(
                    "[Sanatorio] Rollback tras restore fallido también falló: {rollback_err}"
                );
            }
            clear_restore_rollback_dir(&rollback_dir);
            Err(err)
        }
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

fn rotate_backups(dir: &Path, json: &str, data_dir: &Path) -> Result<(), String> {
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
    snapshot_companion_files_for_rotation(dir, data_dir)?;
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

fn file_size_bytes(path: &Path) -> Option<u64> {
    fs::metadata(path).ok().map(|m| m.len())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyBackupEntry {
    pub date: String,
    pub path: String,
    pub modified_ms: Option<u64>,
    pub size_bytes: Option<u64>,
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
        let Some(date) = parse_daily_backup_date(name)
            .or_else(|| dated_fragment_in_filename(name))
        else {
            continue;
        };
        if date < cutoff {
            let _ = fs::remove_file(&path);
        }
    }
    Ok(())
}

fn save_daily_backup_in_dir(
    dir: &Path,
    json: &str,
    date: &str,
    data_dir: &Path,
) -> Result<(), String> {
    let daily_dir = dir.join(DAILY_BACKUP_SUBDIR);
    fs::create_dir_all(&daily_dir).map_err(|e| e.to_string())?;
    let path = daily_dir.join(daily_backup_filename(date));
    atomic_replace(&path, json.as_bytes())?;
    snapshot_companion_files_for_daily(&daily_dir, data_dir, date)?;
    prune_daily_backups(&daily_dir, date)
}

fn save_daily_backups_all(app: &tauri::AppHandle, json: &str, date: &str) -> Result<(), String> {
    let data_dir = ensure_app_data_dir(app)?;
    let dirs = backup_dirs_for_rotation(app);
    if dirs.is_empty() {
        return Err("No se pudo crear ninguna carpeta de respaldo.".into());
    }
    let mut errors: Vec<String> = Vec::new();
    for dir in &dirs {
        if let Err(e) = save_daily_backup_in_dir(dir, json, date, &data_dir) {
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
            size_bytes: file_size_bytes(&path),
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
    pub size_bytes: Option<u64>,
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
    for p in secondary_drive_backup_dir_candidates() {
        let s = p.to_string_lossy().into_owned();
        if !out.iter().any(|x| x == &s) {
            out.push(s);
        }
    }
    if dropbox_installed() {
        for p in dropbox_backup_dir_candidates() {
            let s = p.to_string_lossy().into_owned();
            if !out.iter().any(|x| x == &s) {
                out.push(s);
            }
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
        let size_bytes = if exists {
            file_size_bytes(&path)
        } else {
            None
        };
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

/// Rota las 3 copias de resguardo con el JSON indicado (sin tocar el archivo principal).
#[tauri::command]
pub fn rotate_data_backups(app: tauri::AppHandle, json: String) -> Result<(), String> {
    rotate_backups_all(&app, &json)
}

/// Guarda datos actuales y rota las 3 copias de respaldo (al salir).
#[tauri::command]
pub fn finalize_exit(app: tauri::AppHandle, json: String) -> Result<(), String> {
    stop_legacy_background_services();
    let path = data_file_path(&app)?;
    write_data_file(&path, &json)?;
    rotate_data_backups(app, json)?;
    Ok(())
}

#[tauri::command]
pub fn read_data_backup(app: tauri::AppHandle, slot: u8) -> Result<String, String> {
    let dir = backup_dir_primary(&app)?;
    let path = backup_path(&dir, slot)?;
    if !path.is_file() {
        return Err(format!(
            "No existe el respaldo {slot}. Salí del programa al menos una vez para crear copias."
        ));
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_daily_data_backup(app: tauri::AppHandle, date: String) -> Result<String, String> {
    if !is_valid_backup_date(&date) {
        return Err("Fecha de respaldo inválida (use YYYY-MM-DD).".into());
    }
    let dir = backup_dir_primary(&app)?.join(DAILY_BACKUP_SUBDIR);
    let path = dir.join(daily_backup_filename(&date));
    if !path.is_file() {
        return Err(format!("No hay respaldo diario para {date}."));
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restore_data_backup(app: tauri::AppHandle, slot: u8) -> Result<String, String> {
    read_data_backup(app, slot)
}

/// Restaura usuarios, clave SMTP y demás archivos del respaldo (slot 1–3 o fecha diaria).
#[tauri::command]
pub fn restore_backup_companion_files(
    app: tauri::AppHandle,
    slot: Option<u8>,
    daily_date: Option<String>,
) -> Result<(), String> {
    let data_dir = ensure_app_data_dir(&app)?;
    let backup_dir = backup_dir_primary(&app)?;
    if let Some(s) = slot {
        if s < 1 || s > 3 {
            return Err("Respaldo inválido (use 1, 2 o 3).".into());
        }
        restore_companion_files_from_slot(&backup_dir, &data_dir, s)?;
        return Ok(());
    }
    if let Some(date) = daily_date {
        if !is_valid_backup_date(&date) {
            return Err("Fecha de respaldo inválida (use YYYY-MM-DD).".into());
        }
        let daily_dir = backup_dir.join(DAILY_BACKUP_SUBDIR);
        restore_companion_files_from_daily(&daily_dir, &data_dir, &date)?;
        return Ok(());
    }
    Err("Indique slot o fecha de respaldo diario.".into())
}

/// Restaura JSON principal + archivos companion de forma transaccional (rollback si falla).
#[tauri::command]
pub fn apply_data_backup_restore(
    app: tauri::AppHandle,
    json: String,
    slot: Option<u8>,
    daily_date: Option<String>,
) -> Result<(), String> {
    apply_data_backup_restore_inner(&app, &json, slot, daily_date.as_deref())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryChecklistEntry {
    pub key: String,
    pub label: String,
    pub path: String,
    pub exists: bool,
    pub required: bool,
    pub optional: bool,
}

#[tauri::command]
pub fn get_recovery_checklist(app: tauri::AppHandle) -> Result<Vec<RecoveryChecklistEntry>, String> {
    let data_dir = ensure_app_data_dir(&app)?;
    let data_path = data_dir.join(DATA_FILE);

    let mut items = vec![
        RecoveryChecklistEntry {
            key: "datos".into(),
            label: "Base principal (JSON)".into(),
            path: data_path.to_string_lossy().into_owned(),
            exists: data_path.is_file(),
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

    if let Ok(backup_dir) = backup_dir_primary(&app) {
        for slot in BACKUP_SLOTS {
            let path = backup_path(&backup_dir, slot)?;
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

    let dropbox_path = user_dropbox_root()
        .map(|r| r.join("Sanatorio").join("respaldo"))
        .unwrap_or_else(|| {
            std::env::var("USERPROFILE")
                .map(|p| PathBuf::from(p).join("Dropbox").join("Sanatorio").join("respaldo"))
                .unwrap_or_else(|_| PathBuf::from("Dropbox/Sanatorio/respaldo"))
        });
    items.push(RecoveryChecklistEntry {
        key: "dropbox".into(),
        label: if dropbox_installed() {
            "Respaldo en Dropbox".into()
        } else {
            "Dropbox (no instalado)".into()
        },
        path: dropbox_path.to_string_lossy().into_owned(),
        exists: dropbox_path.is_dir(),
        required: false,
        optional: true,
    });

    Ok(items)
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

#[tauri::command]
pub fn load_auth_accounts(app: tauri::AppHandle) -> Result<String, String> {
    let path = ensure_app_data_dir(&app)?.join(AUTH_ACCOUNTS_FILE);
    if !path.is_file() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_auth_accounts(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let path = ensure_app_data_dir(&app)?.join(AUTH_ACCOUNTS_FILE);
    if json.trim().is_empty() {
        if path.is_file() {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    atomic_replace(path.as_path(), json.as_bytes())
}

const HISTORICO_SUBDIR: &str = "historico";

fn historico_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = ensure_app_data_dir(app)?.join(HISTORICO_SUBDIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn is_valid_historico_filename(name: &str) -> bool {
    name.starts_with("sanatorio-historico-") && name.ends_with(".json")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoricoArchiveEntry {
    pub filename: String,
    pub path: String,
    pub cutoff_date: Option<String>,
    pub archived_at: Option<String>,
    pub size_bytes: Option<u64>,
    pub modified_ms: Option<u64>,
}

#[tauri::command]
pub fn save_historico_archive(
    app: tauri::AppHandle,
    filename: String,
    json: String,
) -> Result<String, String> {
    if !is_valid_historico_filename(&filename) {
        return Err("Nombre de archivo histórico inválido.".into());
    }
    let path = historico_dir(&app)?.join(&filename);
    atomic_replace(&path, json.as_bytes())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn read_historico_archive(
    app: tauri::AppHandle,
    filename: String,
) -> Result<String, String> {
    if !is_valid_historico_filename(&filename) {
        return Err("Nombre de archivo histórico inválido.".into());
    }
    let path = historico_dir(&app)?.join(&filename);
    if !path.is_file() {
        return Err(format!("No existe el archivo histórico {filename}."));
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_historico_archives(app: tauri::AppHandle) -> Result<Vec<HistoricoArchiveEntry>, String> {
    let dir = historico_dir(&app)?;
    let mut out: Vec<HistoricoArchiveEntry> = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|s| s.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if !is_valid_historico_filename(&name) {
            continue;
        }
        let cutoff_date = name
            .strip_prefix("sanatorio-historico-antes-de-")
            .and_then(|s| s.strip_suffix(".json"))
            .map(|s| s.to_string());
        let archived_at = fs::read_to_string(&path)
            .ok()
            .and_then(|raw| {
                serde_json::from_str::<serde_json::Value>(&raw)
                    .ok()
                    .and_then(|v| {
                        v.get("archivedAt")
                            .and_then(|x| x.as_str())
                            .map(|s| s.to_string())
                    })
            });
        out.push(HistoricoArchiveEntry {
            filename: name.clone(),
            path: path.to_string_lossy().into_owned(),
            cutoff_date,
            archived_at,
            size_bytes: file_size_bytes(&path),
            modified_ms: file_modified_ms(&path),
        });
    }
    out.sort_by(|a, b| a.filename.cmp(&b.filename));
    Ok(out)
}

#[cfg(test)]
mod backup_tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn is_valid_backup_date_accepts_iso() {
        assert!(is_valid_backup_date("2026-05-29"));
        assert!(!is_valid_backup_date("29-05-2026"));
        assert!(!is_valid_backup_date("2026-5-29"));
    }

    #[test]
    fn companion_slot_backup_name_formats() {
        assert_eq!(
            companion_slot_backup_name("auth-accounts.json", 2),
            "auth-accounts.respaldo-2.json"
        );
        assert_eq!(
            companion_slot_backup_name("smtp-secret.txt", 1),
            "smtp-secret.respaldo-1.txt"
        );
    }

    #[test]
    fn companion_daily_backup_name_formats() {
        assert_eq!(
            companion_daily_backup_name("auth-accounts.json", "2026-05-29"),
            "auth-accounts.2026-05-29.json"
        );
    }

    #[test]
    fn parse_daily_backup_date_only_main_json() {
        assert_eq!(
            parse_daily_backup_date("sanatorio-datos.2026-05-29.json").as_deref(),
            Some("2026-05-29")
        );
        assert!(parse_daily_backup_date("auth-accounts.2026-05-29.json").is_none());
    }

    #[test]
    fn dated_fragment_in_filename_finds_companion() {
        assert_eq!(
            dated_fragment_in_filename("auth-accounts.2026-01-15.json").as_deref(),
            Some("2026-01-15")
        );
    }

    #[test]
    fn secondary_drive_backup_path_formats() {
        assert_eq!(
            secondary_drive_backup_path('D'),
            PathBuf::from(r"D:\Sanatorio\respaldo")
        );
    }

    #[test]
    fn rotate_backups_shifts_json_slots() {
        let backup_dir = TempDir::new().unwrap();
        let data_dir = TempDir::new().unwrap();
        let dir = backup_dir.path();

        fs::write(dir.join(BACKUP_1), b"{\"v\":1}").unwrap();
        rotate_backups(dir, "{\"v\":2}", data_dir.path()).unwrap();

        assert_eq!(fs::read_to_string(dir.join(BACKUP_1)).unwrap(), "{\"v\":2}");
        assert_eq!(fs::read_to_string(dir.join(BACKUP_2)).unwrap(), "{\"v\":1}");
        assert!(!dir.join(BACKUP_3).exists());
    }

    #[test]
    fn rotate_companion_copies_to_slot_one() {
        let backup_dir = TempDir::new().unwrap();
        let data_dir = TempDir::new().unwrap();
        let secret = data_dir.path().join("smtp-secret.txt");
        fs::write(&secret, b"clave-smtp").unwrap();

        rotate_companion_slot_set(backup_dir.path(), data_dir.path(), "smtp-secret.txt").unwrap();

        let backup = backup_dir
            .path()
            .join(companion_slot_backup_name("smtp-secret.txt", 1));
        assert_eq!(fs::read_to_string(&backup).unwrap(), "clave-smtp");
    }

    #[test]
    fn restore_companion_from_slot_overwrites_dest() {
        let backup_dir = TempDir::new().unwrap();
        let data_dir = TempDir::new().unwrap();
        let name = AUTH_ACCOUNTS_FILE;
        let backup = backup_dir
            .path()
            .join(companion_slot_backup_name(name, 1));
        fs::write(&backup, b"{\"users\":[]}").unwrap();
        fs::write(data_dir.path().join(name), b"old").unwrap();

        restore_companion_files_from_slot(backup_dir.path(), data_dir.path(), 1).unwrap();
        assert_eq!(
            fs::read_to_string(data_dir.path().join(name)).unwrap(),
            "{\"users\":[]}"
        );
    }

    #[test]
    fn daily_companion_snapshot_and_restore() {
        let backup_root = TempDir::new().unwrap();
        let data_dir = TempDir::new().unwrap();
        let daily_dir = backup_root.path().join("diario");
        fs::create_dir_all(&daily_dir).unwrap();
        fs::write(data_dir.path().join("smtp-secret.txt"), b"smtp-abc").unwrap();

        snapshot_companion_files_for_daily(&daily_dir, data_dir.path(), "2026-05-29")
            .unwrap();
        fs::write(data_dir.path().join("smtp-secret.txt"), b"changed").unwrap();

        restore_companion_files_from_daily(&daily_dir, data_dir.path(), "2026-05-29")
            .unwrap();
        assert_eq!(
            fs::read_to_string(data_dir.path().join("smtp-secret.txt")).unwrap(),
            "smtp-abc"
        );
    }

    #[test]
    fn prune_daily_removes_old_companion_files() {
        let backup_root = TempDir::new().unwrap();
        let daily_dir = backup_root.path().join("diario");
        fs::create_dir_all(&daily_dir).unwrap();
        let old = daily_dir.join("auth-accounts.2026-01-01.json");
        let recent = daily_dir.join("sanatorio-datos.2026-05-29.json");
        fs::write(&old, b"{}").unwrap();
        fs::write(&recent, b"{}").unwrap();

        prune_daily_backups(&daily_dir, "2026-05-29").unwrap();

        assert!(!old.exists());
        assert!(recent.exists());
    }

    #[test]
    fn rollback_snapshot_restores_main_and_companions() {
        let data_dir = TempDir::new().unwrap();
        let rollback_dir = data_dir.path().join(RESTORE_ROLLBACK_DIR);

        fs::write(data_dir.path().join(DATA_FILE), b"{\"v\":1}").unwrap();
        fs::write(
            data_dir.path().join(AUTH_ACCOUNTS_FILE),
            b"cuentas-viejas",
        )
        .unwrap();

        snapshot_live_state_for_rollback(data_dir.path(), &rollback_dir).unwrap();

        fs::write(data_dir.path().join(DATA_FILE), b"{\"v\":2}").unwrap();
        fs::write(
            data_dir.path().join(AUTH_ACCOUNTS_FILE),
            b"cuentas-nuevas",
        )
        .unwrap();

        restore_live_state_from_rollback(data_dir.path(), &rollback_dir).unwrap();

        assert_eq!(
            fs::read_to_string(data_dir.path().join(DATA_FILE)).unwrap(),
            "{\"v\":1}"
        );
        assert_eq!(
            fs::read_to_string(data_dir.path().join(AUTH_ACCOUNTS_FILE)).unwrap(),
            "cuentas-viejas"
        );
    }

    #[test]
    fn atomic_replace_overwrites_existing_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("datos.json");
        fs::write(&path, b"v1").unwrap();
        atomic_replace(&path, b"v2").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "v2");
    }
}
