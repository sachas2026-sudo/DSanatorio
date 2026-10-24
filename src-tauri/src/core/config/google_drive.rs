use serde_json::Value;

pub struct GoogleDrivePrefs {
    pub custom_root: Option<String>,
    pub disabled: bool,
    pub backup_folder: Option<String>,
}

pub fn prefs_from_app_json(json: &str) -> GoogleDrivePrefs {
    let mut prefs = GoogleDrivePrefs {
        custom_root: None,
        disabled: false,
        backup_folder: None,
    };
    let Ok(parsed) = serde_json::from_str::<Value>(json) else {
        return prefs;
    };
    let Some(settings) = parsed.get("settings") else {
        return prefs;
    };
    if let Some(v) = settings.get("rutaGoogleDriveCustom").and_then(|x| x.as_str()) {
        let t = v.trim();
        if !t.is_empty() {
            prefs.custom_root = Some(t.to_string());
        }
    }
    if settings
        .get("googleDriveDeshabilitado")
        .and_then(|x| x.as_bool())
        .unwrap_or(false)
    {
        prefs.disabled = true;
    }
    if let Some(v) = settings
        .get("carpetaBackupGoogleDrive")
        .and_then(|x| x.as_str())
    {
        let t = v.trim();
        if !t.is_empty() {
            prefs.backup_folder = Some(t.to_string());
        }
    }
    prefs
}
