use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};
use crate::core::db;
use crate::core::config::settings;
use super::service;

const SMTP_SECRET_FILE: &str = "smtp-secret.txt";
const AUTH_ACCOUNTS_FILE: &str = "auth-accounts.json";
const INSTALL_META_FILE: &str = "install-meta.json";
const HISTORICO_SUBDIR: &str = "historico";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallMeta {
    app_version: String,
    updated_at_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    previous_version: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallInfo {
    pub app_version: String,
    pub data_dir: String,
    pub updated_at_ms: Option<u64>,
    pub previous_version: Option<String>,
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

fn file_modified_ms(path: &std::path::Path) -> Option<u64> {
    let meta = fs::metadata(path).ok()?;
    let modified = meta.modified().ok()?;
    modified
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as u64)
}

fn file_size_bytes(path: &std::path::Path) -> Option<u64> {
    fs::metadata(path).ok().map(|m| m.len())
}

fn is_valid_historico_filename(name: &str) -> bool {
    name.starts_with("sanatorio-historico-") && name.ends_with(".json")
}

fn record_install_meta(app: &tauri::AppHandle, data_dir: &std::path::Path) -> Result<(), String> {
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
    let meta = InstallMeta {
        app_version: current,
        updated_at_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
        previous_version: previous,
    };
    let json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, json.as_bytes()).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

fn historico_dir() -> Result<PathBuf, String> {
    let dir = settings::data_dir().join(HISTORICO_SUBDIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub fn load_app_data() -> Result<Option<String>, String> {
    crate::client_mode::ensure_local().map_err(|e| e)?;
    match service::load_app_data() {
        Ok(data) => {
            let json = serde_json::to_string(&data).map_err(|e| e.to_string())?;
            Ok(Some(json))
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn save_app_data(json: String) -> Result<(), String> {
    crate::client_mode::ensure_local().map_err(|e| e)?;
    service::save_app_data(&json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_app_data_file_path() -> Result<String, String> {
    crate::client_mode::ensure_local().map_err(|e| e)?;
    Ok(settings::data_dir().join(db::DB_FILE).to_string_lossy().into_owned())
}

#[tauri::command]
pub fn get_install_info(app: tauri::AppHandle) -> Result<InstallInfo, String> {
    let data_dir = settings::data_dir();
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
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

#[tauri::command]
pub fn load_smtp_secret() -> Result<String, String> {
    crate::client_mode::ensure_local().map_err(|e| e)?;
    let path = settings::data_dir().join(SMTP_SECRET_FILE);
    if !path.is_file() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_smtp_secret(secret: String) -> Result<(), String> {
    crate::client_mode::ensure_local().map_err(|e| e)?;
    let path = settings::data_dir().join(SMTP_SECRET_FILE);
    if secret.trim().is_empty() {
        if path.is_file() {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, secret.as_bytes()).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn load_auth_accounts() -> Result<String, String> {
    crate::client_mode::ensure_local().map_err(|e| e)?;
    let path = settings::data_dir().join(AUTH_ACCOUNTS_FILE);
    if !path.is_file() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_auth_accounts(json: String) -> Result<(), String> {
    crate::client_mode::ensure_local().map_err(|e| e)?;
    let path = settings::data_dir().join(AUTH_ACCOUNTS_FILE);
    if json.trim().is_empty() {
        if path.is_file() {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, json.as_bytes()).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn save_historico_archive(filename: String, json: String) -> Result<String, String> {
    crate::client_mode::ensure_local().map_err(|e| e)?;
    if !is_valid_historico_filename(&filename) {
        return Err("Nombre de archivo histórico inválido.".into());
    }
    let path = historico_dir()?.join(&filename);
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, json.as_bytes()).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn read_historico_archive(filename: String) -> Result<String, String> {
    crate::client_mode::ensure_local().map_err(|e| e)?;
    if !is_valid_historico_filename(&filename) {
        return Err("Nombre de archivo histórico inválido.".into());
    }
    let path = historico_dir()?.join(&filename);
    if !path.is_file() {
        return Err(format!("No existe el archivo histórico {filename}."));
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_historico_archives() -> Result<Vec<HistoricoArchiveEntry>, String> {
    crate::client_mode::ensure_local().map_err(|e| e)?;
    let dir = historico_dir()?;
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

#[tauri::command]
pub fn is_google_drive_installed(
    custom_root: Option<String>,
    disabled: Option<bool>,
) -> bool {
    settings::google_drive_active(
        custom_root.as_deref(),
        disabled.unwrap_or(false),
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleDriveStatus {
    pub detected_path: Option<String>,
    pub active_path: Option<String>,
    pub source: String,
    pub available: bool,
}

#[tauri::command]
pub fn get_google_drive_status(
    custom_root: Option<String>,
    disabled: Option<bool>,
) -> GoogleDriveStatus {
    let disabled = disabled.unwrap_or(false);
    let detected = settings::detect_google_drive_root()
        .map(|p| p.to_string_lossy().into_owned());
    let active = settings::resolve_google_drive_root(custom_root.as_deref(), disabled)
        .map(|p| p.to_string_lossy().into_owned());
    let source = settings::google_drive_root_source(custom_root.as_deref(), disabled).to_string();

    GoogleDriveStatus {
        detected_path: detected,
        active_path: active.clone(),
        source,
        available: active.is_some(),
    }
}

#[tauri::command]
pub fn pick_google_drive_folder() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Elegir carpeta de Google Drive")
        .pick_folder()
        .map(|p| p.to_string_lossy().into_owned())
}


#[tauri::command]
pub fn get_app_mode() -> serde_json::Value {
    use crate::client_mode;
    match client_mode::load_config() {
        Ok(cfg) => serde_json::json!({
            "mode": match cfg.mode {
                client_mode::AppMode::Local => "local",
                client_mode::AppMode::Client => "client",
            },
            "serverUrl": cfg.server_url,
        }),
        Err(_) => serde_json::json!({
            "mode": "local",
            "serverUrl": null,
        }),
    }
}
