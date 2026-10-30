use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AppMode {
    Local,
    Client,
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

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
}