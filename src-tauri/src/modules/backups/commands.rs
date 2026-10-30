use crate::core::config::settings;
use super::service::{self, BackupEntry, DailyBackupEntry, RecoveryChecklistEntry};

#[cfg(target_os = "windows")]
fn stop_legacy_background_services() {
    use std::os::windows::process::CommandExt;
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

#[tauri::command]
pub fn get_backup_dir() -> Result<String, String> {
    crate::client_mode::ensure_local().map_err(|e| e)?;
    service::backup_dir_primary()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_backup_locations() -> Result<Vec<String>, String> {
    crate::client_mode::ensure_local().map_err(|e| e)?;
    let mut out: Vec<String> = service::backup_dirs_local_only()
        .into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    
    #[cfg(windows)]
    {
        for letter in b'D'..=b'Z' {
            let letter = letter as char;
            let root = format!("{letter}:\\");
            if std::path::Path::new(&root).is_dir() {
                let s = format!("{letter}:\\Sanatorio\\respaldo");
                if !out.contains(&s) {
                    out.push(s);
                }
            }
        }
    }

    if settings::dropbox_installed() {
        for p in settings::dropbox_backup_dir_candidates() {
            let s = p.to_string_lossy().into_owned();
            if !out.contains(&s) {
                out.push(s);
            }
        }
    }

    Ok(out)
}

#[tauri::command]
pub fn list_data_backups() -> Result<Vec<BackupEntry>, String> {
    crate::client_mode::ensure_local().map_err(|e| e)?;
    service::list_data_backups().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rotate_data_backups(json: String) -> Result<(), String> {
    crate::client_mode::ensure_local().map_err(|e| e)?;
    service::rotate_backups_all(&json).map_err(|e| e.to_string())?;
    service::save_full_backup_on_exit().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn finalize_exit(json: String) -> Result<(), String> {
    if crate::client_mode::is_client() {
        return Ok(());
    }
    stop_legacy_background_services();
    // Guardar los datos en la base
    crate::modules::configuracion::service::save_app_data(&json).map_err(|e| e.to_string())?;
    // Rotar respaldos
    service::rotate_backups_all(&json).map_err(|e| e.to_string())?;
    // Guardar copia completa y ocultarla en Windows
    service::save_full_backup_on_exit().map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub fn read_data_backup(slot: u8) -> Result<String, String> {
    crate::client_mode::ensure_local().map_err(|e| e)?;
    service::read_data_backup(slot).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_daily_data_backup(date: String) -> Result<String, String> {
    crate::client_mode::ensure_local().map_err(|e| e)?;
    service::read_daily_data_backup(&date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restore_data_backup(slot: u8) -> Result<String, String> {
    crate::client_mode::ensure_local().map_err(|e| e)?;
    // Lee el respaldo y lo restaura en base SQLite
    let raw_json = service::read_data_backup(slot).map_err(|e| e.to_string())?;
    crate::modules::configuracion::service::save_app_data(&raw_json).map_err(|e| e.to_string())?;
    Ok(raw_json)
}

#[tauri::command]
pub fn restore_backup_companion_files(slot: Option<u8>, daily_date: Option<String>) -> Result<(), String> {
    crate::client_mode::ensure_local().map_err(|e| e)?;
    service::restore_backup_companion_files(slot, daily_date.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn apply_data_backup_restore(
    json: String,
    slot: Option<u8>,
    daily_date: Option<String>,
) -> Result<(), String> {
    crate::client_mode::ensure_local().map_err(|e| e)?;
    service::apply_data_backup_restore(&json, slot, daily_date.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_daily_data_backup(json: String, date: String) -> Result<(), String> {
    crate::client_mode::ensure_local().map_err(|e| e)?;
    service::save_daily_backups_all(&json, &date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_daily_data_backups() -> Result<Vec<DailyBackupEntry>, String> {
    crate::client_mode::ensure_local().map_err(|e| e)?;
    let daily_dir = service::backup_dir_primary()
        .map(|p| p.join("diario"))
        .map_err(|e| e.to_string())?;
    service::list_daily_backups_in_dir(&daily_dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_recovery_checklist() -> Result<Vec<RecoveryChecklistEntry>, String> {
    crate::client_mode::ensure_local().map_err(|e| e)?;
    service::get_recovery_checklist().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_local_google_drive_backup_folder(json: String) -> Result<bool, String> {
    use crate::core::config::google_drive::prefs_from_app_json;
    use crate::core::config::settings::google_drive_backup_dir_candidates;

    let prefs = prefs_from_app_json(&json);
    let candidates = google_drive_backup_dir_candidates(
        prefs.custom_root.as_deref(),
        prefs.disabled,
        prefs.backup_folder.as_deref(),
    );
    if let Some(folder) = candidates.first() {
        if folder.exists() {
            // Abrir explorador
            if let Err(e) = std::process::Command::new("explorer")
                .arg(folder)
                .spawn() {
                return Err(format!("No se pudo abrir el explorador: {}", e));
            }
            return Ok(true);
        }
    }
    
    Ok(false)
}
