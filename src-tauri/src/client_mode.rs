use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU8, Ordering};

static RUNTIME_MODE: AtomicU8 = AtomicU8::new(0); // 0 = Local, 1 = Client

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AppMode {
    Local,
    Client,
}

impl AppMode {
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => AppMode::Client,
            _ => AppMode::Local,
        }
    }
    pub fn to_u8(self) -> u8 {
        match self {
            AppMode::Local => 0,
            AppMode::Client => 1,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientConfig {
    pub mode: AppMode,
    pub server_url: Option<String>,
    pub server_cert_pem: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StartupPlan {
    pub check_server_lock: bool,
    pub prepare_local_storage: bool,
    pub acquire_instance_lock: bool,
}

impl StartupPlan {
    pub fn for_mode(mode: AppMode) -> Self {
        match mode {
            AppMode::Local => StartupPlan {
                check_server_lock: true,
                prepare_local_storage: true,
                acquire_instance_lock: true,
            },
            AppMode::Client => StartupPlan {
                check_server_lock: false,
                prepare_local_storage: false,
                acquire_instance_lock: false,
            },
        }
    }
}

pub fn config_path() -> PathBuf {
    let appdata = std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."));
    appdata.join("Sanatorio").join("client-config.json")
}

pub fn load_config_from(path: &std::path::Path) -> Result<ClientConfig, String> {
    if !path.exists() {
        return Ok(ClientConfig {
            mode: AppMode::Local,
            server_url: None,
            server_cert_pem: None,
        });
    }
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("No se pudo leer client-config: {e}"))?;
    let cfg: ClientConfig = serde_json::from_str(&content)
        .map_err(|e| format!("client-config inválido: {e}"))?;

    if cfg.mode == AppMode::Client {
        let url = cfg.server_url.as_deref().unwrap_or("");
        if !url.starts_with("https://") {
            return Err("Modo Client requiere server_url con https://".into());
        }
        let cert = cfg.server_cert_pem.as_deref().unwrap_or("");
        if cert.trim().is_empty() {
            return Err("Modo Client requiere server_cert_pem no vacío".into());
        }
    }
    Ok(cfg)
}

pub fn save_config_to(path: &std::path::Path, cfg: &ClientConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("No se pudo crear dir: {e}"))?;
    }
    let json = serde_json::to_string_pretty(cfg).map_err(|e| format!("Serialización: {e}"))?;
    std::fs::write(path, json).map_err(|e| format!("No se pudo escribir config: {e}"))
}

pub fn load_config() -> Result<ClientConfig, String> {
    load_config_from(&config_path())
}

// --- Runtime mode (global, set once at startup) ---

pub fn set_runtime_mode(mode: AppMode) {
    RUNTIME_MODE.store(mode.to_u8(), Ordering::SeqCst);
}

pub fn is_client() -> bool {
    AppMode::from_u8(RUNTIME_MODE.load(Ordering::SeqCst)) == AppMode::Client
}

pub fn current_mode() -> AppMode {
    AppMode::from_u8(RUNTIME_MODE.load(Ordering::SeqCst))
}

pub fn ensure_local() -> Result<(), String> {
    ensure_local_for(current_mode())
}

pub fn ensure_local_for(mode: AppMode) -> Result<(), String> {
    match mode {
        AppMode::Local => Ok(()),
        AppMode::Client => Err("Modo cliente: operación no disponible".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    struct ModeGuard {
        original: AppMode,
    }
    impl Drop for ModeGuard {
        fn drop(&mut self) {
            set_runtime_mode(self.original);
        }
    }

    #[test]
    fn inexistente_retorna_local() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("no-existe.json");
        let cfg = load_config_from(&path).unwrap();
        assert_eq!(cfg.mode, AppMode::Local);
        assert!(cfg.server_url.is_none());
        assert!(cfg.server_cert_pem.is_none());
    }

    #[test]
    fn ida_y_vuelta_cliente_valido() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("config.json");
        let cfg = ClientConfig {
            mode: AppMode::Client,
            server_url: Some("https://192.168.1.10:8787".into()),
            server_cert_pem: Some("-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----".into()),
        };
        save_config_to(&path, &cfg).unwrap();
        let loaded = load_config_from(&path).unwrap();
        assert_eq!(loaded.mode, AppMode::Client);
        assert_eq!(loaded.server_url.as_deref(), Some("https://192.168.1.10:8787"));
        assert!(loaded.server_cert_pem.as_deref().unwrap().contains("CERTIFICATE"));
    }

    #[test]
    fn client_sin_https_retorna_err() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("config.json");
        let cfg = ClientConfig {
            mode: AppMode::Client,
            server_url: Some("http://192.168.1.10:8787".into()),
            server_cert_pem: Some("cert".into()),
        };
        save_config_to(&path, &cfg).unwrap();
        let result = load_config_from(&path);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("https://"));
    }

    #[test]
    fn client_sin_certificado_retorna_err() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("config.json");
        let cfg = ClientConfig {
            mode: AppMode::Client,
            server_url: Some("https://192.168.1.10:8787".into()),
            server_cert_pem: None,
        };
        save_config_to(&path, &cfg).unwrap();
        let result = load_config_from(&path);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("server_cert_pem"));
    }

    #[test]
    fn archivo_con_basura_retorna_err() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("config.json");
        std::fs::write(&path, "esto no es json {{{").unwrap();
        let result = load_config_from(&path);
        assert!(result.is_err());
    }

    #[test]
    fn startup_plan_local() {
        let plan = StartupPlan::for_mode(AppMode::Local);
        assert!(plan.check_server_lock);
        assert!(plan.prepare_local_storage);
        assert!(plan.acquire_instance_lock);
    }

    #[test]
    fn startup_plan_client() {
        let plan = StartupPlan::for_mode(AppMode::Client);
        assert!(!plan.check_server_lock);
        assert!(!plan.prepare_local_storage);
        assert!(!plan.acquire_instance_lock);
    }

    #[test]
    fn ensure_local_for_local_ok() {
        assert!(ensure_local_for(AppMode::Local).is_ok());
    }

    #[test]
    fn ensure_local_for_client_err() {
        let result = ensure_local_for(AppMode::Client);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Modo cliente: operación no disponible");
    }

    #[test]
    fn runtime_mode_global() {
        let _guard = crate::core::db::TEST_MUTEX.lock().unwrap_or_else(|e| e.into_inner());
        let _mode_guard = ModeGuard { original: current_mode() };
        set_runtime_mode(AppMode::Client);
        assert!(is_client());
        assert_eq!(current_mode(), AppMode::Client);
        assert!(ensure_local().is_err());
        set_runtime_mode(AppMode::Local);
        assert!(!is_client());
        assert!(ensure_local().is_ok());
    }

    #[test]
    fn client_mode_save_app_data_err_sin_archivos() {
        let _guard = crate::core::db::TEST_MUTEX.lock().unwrap_or_else(|e| e.into_inner());
        let _mode_guard = ModeGuard { original: current_mode() };
        set_runtime_mode(AppMode::Client);
        let tmp = TempDir::new().unwrap();
        std::env::set_var("SANATORIO_DATA_DIR", tmp.path().to_str().unwrap());
        let result = crate::modules::configuracion::commands::save_app_data("{}".into());
        assert!(result.is_err());
        let entries: Vec<_> = std::fs::read_dir(tmp.path()).unwrap().collect();
        assert!(entries.is_empty(), "No debe crear archivos en modo Client");
    }

    #[test]
    fn client_mode_load_app_data_err() {
        let _guard = crate::core::db::TEST_MUTEX.lock().unwrap_or_else(|e| e.into_inner());
        let _mode_guard = ModeGuard { original: current_mode() };
        set_runtime_mode(AppMode::Client);
        let tmp = TempDir::new().unwrap();
        std::env::set_var("SANATORIO_DATA_DIR", tmp.path().to_str().unwrap());
        let result = crate::modules::configuracion::commands::load_app_data();
        assert!(result.is_err());
    }

    #[test]
    fn client_mode_finalize_exit_ok_sin_escribir() {
        let _guard = crate::core::db::TEST_MUTEX.lock().unwrap_or_else(|e| e.into_inner());
        let _mode_guard = ModeGuard { original: current_mode() };
        set_runtime_mode(AppMode::Client);
        let tmp = TempDir::new().unwrap();
        std::env::set_var("SANATORIO_DATA_DIR", tmp.path().to_str().unwrap());
        let result = crate::modules::backups::commands::finalize_exit("{}".into());
        assert!(result.is_ok(), "finalize_exit debe retornar Ok en modo Client");
        let entries: Vec<_> = std::fs::read_dir(tmp.path()).unwrap().collect();
        assert!(entries.is_empty(), "finalize_exit no debe escribir nada en modo Client");
    }

    #[test]
    fn local_mode_comando_funciona() {
        let _guard = crate::core::db::TEST_MUTEX.lock().unwrap_or_else(|e| e.into_inner());
        let _mode_guard = ModeGuard { original: current_mode() };
        set_runtime_mode(AppMode::Local);
        let tmp = TempDir::new().unwrap();
        std::env::set_var("SANATORIO_DATA_DIR", tmp.path().to_str().unwrap());
        let result = crate::modules::configuracion::commands::get_app_data_file_path();
        assert!(result.is_ok(), "get_app_data_file_path debe funcionar en modo Local");
    }
}