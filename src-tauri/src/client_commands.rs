//! Comandos de Tauri del modo cliente: login, logout y estado de sesión.
//!
//! El token y el cliente HTTPS viven solo en memoria de Rust (`ClientState`).
//! La interfaz recibe únicamente `SessionInfo`, nunca el token.
//!
//! Paso 4.4-B2. Los pedidos genéricos a la API llegan en 4.4-C.
use crate::api_client::build_http_client;
use crate::client_mode::{self, AppMode, ClientConfig};
use crate::client_session::{ClientSession, SessionInfo};
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, MutexGuard};

/// Cliente HTTPS ya configurado + URL base del servidor.
#[derive(Clone)]
pub struct Conn {
    pub client: reqwest::Client,
    pub base_url: String,
}

pub struct ClientState {
    pub session: ClientSession,
    conn: Mutex<Option<Conn>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientDeviceAccessInfo {
    pub status: String,
    pub server_name: String,
    pub message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceAccessReply {
    status: String,
    server_name: String,
}

impl ClientState {
    pub fn new() -> Self {
        ClientState {
            session: ClientSession::new(),
            conn: Mutex::new(None),
        }
    }

    fn conn_lock(&self) -> MutexGuard<'_, Option<Conn>> {
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn conn(&self) -> Option<Conn> {
        self.conn_lock().clone()
    }

    pub fn logout(&self) {
        self.session.logout();
        *self.conn_lock() = None;
    }

    /// Login a partir de una config ya cargada. Separado del comando para poder
    /// probarlo sin Tauri ni archivos reales.
    pub async fn login_with_config(
        &self,
        cfg: &ClientConfig,
        username: &str,
        password: &str,
    ) -> Result<SessionInfo, String> {
        self.logout();
        if cfg.mode != AppMode::Client {
            return Err("La aplicación no está en modo cliente".into());
        }
        let base_url = cfg
            .server_url
            .as_deref()
            .map(str::trim)
            .filter(|url| !url.is_empty())
            .ok_or_else(|| {
                "No hay un servidor configurado. Usá «Configurar conexión» antes de iniciar sesión."
                    .to_string()
            })?
            .trim_end_matches('/')
            .to_string();
        let pem = cfg.server_cert_pem.as_deref().unwrap_or("auto").to_string();

        crate::discovery::check_server_health(&base_url, &pem)
            .await
            .map_err(|(_, message)| message)?;
        let client = build_http_client(&pem)?;
        let device_id = cfg.device_id.as_deref().unwrap_or("legacy-client");
        let device_name = std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| "Equipo cliente".to_string());
        let info = self
            .session
            .login_with_device(
                &client,
                &base_url,
                username,
                password,
                device_id,
                &device_name,
            )
            .await?;
        *self.conn_lock() = Some(Conn { client, base_url });
        Ok(info)
    }
}

#[tauri::command]
pub async fn client_login(
    state: tauri::State<'_, ClientState>,
    username: String,
    password: String,
) -> Result<SessionInfo, String> {
    let mut cfg = client_mode::load_config()?;
    if cfg.mode == AppMode::Client {
        if let Some(server_url) = cfg.server_url.as_deref() {
            crate::discovery::set_manual_server_url(server_url.to_string(), None).await?;
            cfg = client_mode::load_config()?;
        }
    }
    if cfg
        .device_id
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
    {
        cfg.device_id = Some(uuid::Uuid::new_v4().to_string());
        client_mode::save_config(&cfg)?;
    }
    state.login_with_config(&cfg, &username, &password).await
}

#[tauri::command]
pub async fn request_client_device_access(
    pairing_code: String,
) -> Result<ClientDeviceAccessInfo, String> {
    let mut cfg = client_mode::load_config()?;
    if cfg.mode != AppMode::Client {
        return Err("La solicitud de acceso solo está disponible en modo cliente.".into());
    }
    let base_url = cfg
        .server_url
        .as_deref()
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .ok_or_else(|| "Primero configure la dirección del servidor.".to_string())?
        .trim_end_matches('/')
        .to_string();
    if cfg
        .device_id
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
    {
        cfg.device_id = Some(uuid::Uuid::new_v4().to_string());
        client_mode::save_config(&cfg)?;
    }

    crate::discovery::set_manual_server_url(base_url.clone(), None).await?;
    cfg = client_mode::load_config()?;
    let pem = cfg.server_cert_pem.as_deref().unwrap_or("auto");
    let client = build_http_client(pem)?;
    let device_name = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "Equipo cliente".to_string());
    let response = client
        .post(format!("{base_url}/api/device-access"))
        .json(&serde_json::json!({
            "device_id": cfg.device_id.as_deref().unwrap_or_default(),
            "device_name": device_name,
            "pairing_code": pairing_code,
        }))
        .send()
        .await
        .map_err(|error| format!("No se pudo enviar la solicitud al servidor: {error}"))?;

    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            404 | 405 => {
                "El servidor no admite solicitudes de dispositivos; actualice el servidor."
                    .to_string()
            }
            status => format!("El servidor rechazó la solicitud de acceso (HTTP {status})."),
        });
    }
    let reply: DeviceAccessReply = response.json().await.map_err(|error| {
        format!("El servidor devolvió una respuesta de acceso inválida: {error}")
    })?;
    let message = match reply.status.as_str() {
        "pending" => "Solicitud enviada; espere la aprobación del servidor.",
        "approved" => "Este dispositivo está aprobado para conectarse.",
        "revoked" => "El acceso de este dispositivo fue revocado por el servidor.",
        "invalid_code" => "Clave incorrecta, vencida o no visible en el servidor. Ingrese la clave actual de seis caracteres.",
        _ => "El servidor devolvió un estado de acceso desconocido.",
    };
    Ok(ClientDeviceAccessInfo {
        status: reply.status,
        server_name: reply.server_name,
        message: message.to_string(),
    })
}

#[tauri::command]
pub fn client_logout(state: tauri::State<'_, ClientState>) {
    state.logout();
}

#[tauri::command]
pub fn client_session_info(state: tauri::State<'_, ClientState>) -> Option<SessionInfo> {
    state.session.info()
}

#[tauri::command]
pub async fn client_heartbeat(state: tauri::State<'_, ClientState>) -> Result<(), String> {
    let reply = state
        .api_call("GET", "/api/session/heartbeat", None)
        .await?;
    if (200..300).contains(&reply.status) {
        Ok(())
    } else {
        Err(format!(
            "El servidor rechazó el heartbeat de conexión (HTTP {}).",
            reply.status
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tls_cert::desired_names;
    use crate::tls_files::ensure_server_cert;
    use axum::{
        http::StatusCode,
        routing::{get, post},
        Json, Router,
    };
    use axum_server::tls_rustls::RustlsConfig;
    use tempfile::TempDir;

    fn ensure_crypto() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }

    struct Fixture {
        _tmp: TempDir,
        handle: axum_server::Handle,
        base_url: String,
        pem: String,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            self.handle.shutdown();
        }
    }

    async fn fixture() -> Fixture {
        ensure_crypto();
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().join("tls");
        ensure_server_cert(&dir, &desired_names(&[])).unwrap();
        let cfg =
            RustlsConfig::from_pem_file(dir.join("server-cert.pem"), dir.join("server-key.pem"))
                .await
                .unwrap();
        let handle = axum_server::Handle::new();
        let h = handle.clone();
        let app = Router::new()
            .route("/api/health", get(fake_health))
            .route("/api/login", post(fake_login));
        tokio::spawn(async move {
            axum_server::bind_rustls("127.0.0.1:0".parse().unwrap(), cfg)
                .handle(h)
                .serve(app.into_make_service())
                .await
                .unwrap();
        });
        let addr = handle
            .listening()
            .await
            .expect("el servidor de prueba no arrancó");
        let pem = std::fs::read_to_string(dir.join("server-cert.pem")).unwrap();
        Fixture {
            _tmp: tmp,
            handle,
            base_url: format!("https://127.0.0.1:{}", addr.port()),
            pem,
        }
    }

    async fn fake_login(
        Json(body): Json<serde_json::Value>,
    ) -> (StatusCode, Json<serde_json::Value>) {
        if body["username"] == "ana" && body["password"] == "secreto" {
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "token": "tok-123",
                    "role": "admin",
                    "display_name": "Ana",
                    "must_change_password": false
                })),
            )
        } else {
            (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "credenciales inválidas" })),
            )
        }
    }

    async fn fake_health() -> Json<serde_json::Value> {
        Json(serde_json::json!({
            "status": "ok",
            "app": "sanatorio",
            "server_name": "Servidor de prueba"
        }))
    }

    fn cfg_cliente(fx: &Fixture) -> ClientConfig {
        ClientConfig {
            mode: AppMode::Client,
            server_url: Some(fx.base_url.clone()),
            server_cert_pem: Some(fx.pem.clone()),
            server_primary_ip: None,
            device_id: None,
        }
    }

    #[tokio::test]
    async fn login_con_config_cliente_guarda_sesion_y_conexion() {
        let fx = fixture().await;
        let st = ClientState::new();
        let info = st
            .login_with_config(&cfg_cliente(&fx), "ana", "secreto")
            .await
            .unwrap();
        assert_eq!(info.role, "admin");
        assert_eq!(st.session.bearer().as_deref(), Some("tok-123"));
        let conn = st.conn().expect("debe quedar la conexión");
        assert_eq!(conn.base_url, fx.base_url);
    }

    #[tokio::test]
    async fn config_en_modo_local_se_rechaza() {
        let fx = fixture().await;
        let st = ClientState::new();
        let mut cfg = cfg_cliente(&fx);
        cfg.mode = AppMode::Local;
        let err = st
            .login_with_config(&cfg, "ana", "secreto")
            .await
            .unwrap_err();
        assert!(err.contains("modo cliente"));
        assert!(st.conn().is_none());
        assert!(st.session.bearer().is_none());
    }

    #[tokio::test]
    async fn login_sin_direccion_no_descubre_ni_autentica_automaticamente() {
        let st = ClientState::new();
        let cfg = ClientConfig {
            mode: AppMode::Client,
            server_url: None,
            server_cert_pem: None,
            server_primary_ip: None,
            device_id: None,
        };
        let err = st
            .login_with_config(&cfg, "ana", "secreto")
            .await
            .unwrap_err();
        assert!(err.contains("Configurar conexión"));
        assert!(st.conn().is_none());
        assert!(st.session.bearer().is_none());
    }

    #[tokio::test]
    async fn certificado_de_otro_servidor_se_rechaza() {
        let fx = fixture().await;
        let tmp2 = TempDir::new().unwrap();
        let dir2 = tmp2.path().join("tls");
        ensure_server_cert(&dir2, &desired_names(&[])).unwrap();
        let otro_pem = std::fs::read_to_string(dir2.join("server-cert.pem")).unwrap();

        let st = ClientState::new();
        let mut cfg = cfg_cliente(&fx);
        cfg.server_cert_pem = Some(otro_pem);
        let err = st
            .login_with_config(&cfg, "ana", "secreto")
            .await
            .unwrap_err();
        assert!(err.contains("TLS") || err.contains("certificado"));
        assert!(st.conn().is_none());
        assert!(st.session.bearer().is_none());
    }

    #[tokio::test]
    async fn un_login_fallido_borra_sesion_y_conexion_anteriores() {
        let fx = fixture().await;
        let st = ClientState::new();
        st.login_with_config(&cfg_cliente(&fx), "ana", "secreto")
            .await
            .unwrap();
        assert!(st.conn().is_some());
        let err = st
            .login_with_config(&cfg_cliente(&fx), "ana", "mala")
            .await
            .unwrap_err();
        assert!(err.contains("incorrectos"));
        assert!(st.conn().is_none());
        assert!(st.session.bearer().is_none());
    }

    #[tokio::test]
    async fn logout_borra_sesion_y_conexion() {
        let fx = fixture().await;
        let st = ClientState::new();
        st.login_with_config(&cfg_cliente(&fx), "ana", "secreto")
            .await
            .unwrap();
        st.logout();
        assert!(st.conn().is_none());
        assert!(st.session.info().is_none());
    }
}
