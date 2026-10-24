use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use crate::core::error::AppError;

pub const DEFAULT_ROOT: &str = r"C:\Sanatorio";
pub const DATA_DIR_ON_C: &str = r"C:\Sanatorio\datos";
pub const BACKUP_DIR_ON_C: &str = r"C:\Sanatorio\respaldo";
pub const FULL_BACKUP_DIR_ON_C: &str = r"C:\Sanatorio\Backup";
pub const LEGACY_DROPBOX_ROOT: &str = r"C:\Users\LAS\Dropbox";

fn env_trim(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn cached_path(key: &'static str, build: fn() -> PathBuf) -> PathBuf {
    static ROOT: OnceLock<PathBuf> = OnceLock::new();
    static DATA: OnceLock<PathBuf> = OnceLock::new();
    static BACKUP: OnceLock<PathBuf> = OnceLock::new();

    match key {
        "root" => ROOT.get_or_init(build).clone(),
        "data" => DATA.get_or_init(build).clone(),
        "backup" => BACKUP.get_or_init(build).clone(),
        _ => build(),
    }
}

pub fn sanatorio_root() -> PathBuf {
    cached_path("root", || {
        env_trim("SANATORIO_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(DEFAULT_ROOT))
    })
}

pub fn data_dir() -> PathBuf {
    cached_path("data", || {
        env_trim("SANATORIO_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(DATA_DIR_ON_C))
    })
}

pub fn backup_dir() -> PathBuf {
    cached_path("backup", || {
        env_trim("SANATORIO_BACKUP_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(BACKUP_DIR_ON_C))
    })
}

pub fn user_dropbox_root() -> Option<PathBuf> {
    std::env::var("USERPROFILE")
        .ok()
        .map(|p| PathBuf::from(p).join("Dropbox"))
        .filter(|p| p.is_dir())
}

pub fn dropbox_backup_dir_candidates() -> Vec<PathBuf> {
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

pub fn dropbox_installed() -> bool {
    user_dropbox_root().is_some() || Path::new(LEGACY_DROPBOX_ROOT).is_dir()
}

pub fn detect_google_drive_root() -> Option<PathBuf> {
    if let Ok(profile) = std::env::var("USERPROFILE") {
        let p = PathBuf::from(profile);
        for name in ["Google Drive", "GoogleDrive"] {
            let path = p.join(name);
            if path.is_dir() {
                return Some(path);
            }
        }
    }

    #[cfg(windows)]
    for letter in b'D'..=b'Z' {
        let letter = letter as char;
        for name in ["Mi unidad", "My Drive"] {
            let path = PathBuf::from(format!("{letter}:\\{name}"));
            if path.is_dir() {
                return Some(path);
            }
        }
    }
    None
}

pub fn resolve_google_drive_root(custom_root: Option<&str>, disabled: bool) -> Option<PathBuf> {
    if disabled {
        return None;
    }
    if let Some(custom) = custom_root {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            let path = PathBuf::from(trimmed);
            if path.is_dir() {
                return Some(path);
            }
        }
    }
    detect_google_drive_root()
}

pub fn google_drive_root_source(custom_root: Option<&str>, disabled: bool) -> &'static str {
    if disabled {
        return "disabled";
    }
    if let Some(custom) = custom_root {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            let path = PathBuf::from(trimmed);
            if path.is_dir() {
                return "custom";
            }
        }
    }
    if detect_google_drive_root().is_some() {
        "auto"
    } else {
        "none"
    }
}

pub fn user_google_drive_root() -> Option<PathBuf> {
    resolve_google_drive_root(None, false)
}

pub fn google_drive_backup_dir_candidates_from_root(
    root: &Path,
    custom_backup_folder: Option<&str>,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(folder) = custom_backup_folder {
        if !folder.trim().is_empty() {
            candidates.push(root.join(folder.trim()));
        }
    }
    candidates.push(root.join("Backup Agenda"));
    candidates.push(root.join("Sanatorio").join("respaldo"));
    candidates
}

pub fn google_drive_backup_dir_candidates(
    custom_root: Option<&str>,
    disabled: bool,
    custom_backup_folder: Option<&str>,
) -> Vec<PathBuf> {
    resolve_google_drive_root(custom_root, disabled)
        .map(|root| google_drive_backup_dir_candidates_from_root(&root, custom_backup_folder))
        .unwrap_or_default()
}

pub fn google_drive_installed() -> bool {
    detect_google_drive_root().is_some()
}

pub fn google_drive_active(
    custom_root: Option<&str>,
    disabled: bool,
) -> bool {
    resolve_google_drive_root(custom_root, disabled).is_some()
}

pub fn allowed_roots() -> Vec<PathBuf> {
    let mut roots = vec![
        sanatorio_root(),
        data_dir(),
        backup_dir(),
    ];
    for candidate in dropbox_backup_dir_candidates() {
        if !roots.contains(&candidate) {
            roots.push(candidate);
        }
    }
    for candidate in google_drive_backup_dir_candidates(None, false, None) {
        if !roots.contains(&candidate) {
            roots.push(candidate);
        }
    }
    roots
}

fn normalize_path(path: &std::path::Path) -> PathBuf {
    use std::path::Component;
    let mut stack = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(_) | Component::RootDir => stack.push(component),
            Component::Normal(name) if name == ".." => {
                let _ = stack.pop();
            }
            Component::Normal(name) if name == "." => {}
            Component::Normal(name) => stack.push(name),
            Component::CurDir => {}
            _ => {}
        }
    }
    stack
}

fn resolve_path(path: &std::path::Path) -> PathBuf {
    if path.is_absolute() {
        normalize_path(path)
    } else {
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        normalize_path(&cwd.join(path))
    }
}

#[cfg(windows)]
fn path_under_root(child: &std::path::Path, root: &std::path::Path) -> bool {
    child
        .to_string_lossy()
        .to_lowercase()
        .starts_with(&root.to_string_lossy().to_lowercase())
}

#[cfg(not(windows))]
fn path_under_root(child: &std::path::Path, root: &std::path::Path) -> bool {
    child.starts_with(root)
}

pub fn ensure_allowed_path(path_str: &str) -> Result<PathBuf, AppError> {
    let trimmed = path_str.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("Ruta vacía.".to_string()));
    }

    let path = std::path::Path::new(trimmed);
    if path
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(AppError::Validation("Ruta no permitida: no se permiten segmentos '..'.".to_string()));
    }

    let resolved = resolve_path(path);
    for root in allowed_roots() {
        let root_resolved = resolve_path(&root);
        if path_under_root(&resolved, &root_resolved) {
            return Ok(resolved);
        }
    }

    Err(AppError::Validation(format!("Ruta no permitida: {trimmed}")))
}
