//! Comandos de Tauri del modo cliente: login, logout y estado de sesión.
//!
//! El token y el cliente HTTPS viven solo en memoria de Rust (`ClientState`).
//! La interfaz recibe únicamente `SessionInfo`, nunca el token.
//!
//! Paso 4.4-B2. Los pedidos genéricos a la API llegan en 4.4-C.
use crate::api_client::build_http_client;
use crate::client_mode::{self, AppMode, ClientConfig};
use crate::client_session::{ClientSession, SessionInfo};
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
        let mut base_url_opt = cfg.server_url.clone();
        let mut pem_opt = cfg.server_cert_pem.clone();

        if base_url_opt.is_none() {
            if let Ok(servers) = crate::discovery::discover_servers(1200) {
                if let Some(srv) = servers.into_iter().find(|s| s.ip != "127.0.0.1" && !s.ip.starts_with("127.")) {
                    base_url_opt = Some(srv.server_url);
                    pem_opt = srv.cert_pem.or_else(|| Some("auto".to_string()));
                    let mut updated = cfg.clone();
                    updated.server_url = base_url_opt.clone();
                    updated.server_cert_pem = pem_opt.clone();
                    let _ = client_mode::save_config(&updated);
                }
            }
        }

        let base_url = base_url_opt.ok_or_else(|| {
            "No se encontró el servidor de Mesa de Entrada en la red local. Verificá que la PC principal esté encendida con el programa abierto.".to_string()
        })?;
        let pem = pem_opt.unwrap_or_else(|| "auto".to_string());
        let client = build_http_client(&pem)?;
        let info = self
            .session
            .login(&client, &base_url, username, password)
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
    let cfg = client_mode::load_config()?;
    state.login_with_config(&cfg, &username, &password).await
}

#[tauri::command]
pub fn client_logout(state: tauri::State<'_, ClientState>) {
    state.logout();
}

#[tauri::command]
pub fn client_session_info(state: tauri::State<'_, ClientState>) -> Option<SessionInfo> {
    state.session.info()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tls_cert::desired_names;
    use crate::tls_files::ensure_server_cert;
    use axum::{http::StatusCode, routing::post, Json, Router};
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
        let cfg = RustlsConfig::from_pem_file(
            dir.join("server-cert.pem"),
            dir.join("server-key.pem"),
        )
        .await
        .unwrap();
        let handle = axum_server::Handle::new();
        let h = handle.clone();
        let app = Router::new().route("/api/login", post(fake_login));
        tokio::spawn(async move {
            axum_server::bind_rustls("127.0.0.1:0".parse().unwrap(), cfg)
                .handle(h)
                .serve(app.into_make_service())
                .await
                .unwrap();
        });
        let addr = handle.listening().await.expect("el servidor de prueba no arrancó");
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

    fn cfg_cliente(fx: &Fixture) -> ClientConfig {
        ClientConfig {
            mode: AppMode::Client,
            server_url: Some(fx.base_url.clone()),
            server_cert_pem: Some(fx.pem.clone()),
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
        let err = st.login_with_config(&cfg, "ana", "secreto").await.unwrap_err();
        assert!(err.contains("modo cliente"));
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
        let err = st.login_with_config(&cfg, "ana", "secreto").await.unwrap_err();
        assert!(err.contains("conectar"));
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
