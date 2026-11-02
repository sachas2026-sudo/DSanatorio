//! Sesión del modo cliente: login contra el servidor y token en memoria.
//!
//! El token vive solo dentro de este módulo (memoria de Rust). A la interfaz
//! se le entrega únicamente `SessionInfo`, nunca el token.
//!
//! Paso 4.4-B1: lógica y tests. Los comandos de Tauri llegan en 4.4-B2.
#![allow(dead_code)] // temporal: se usa desde el paso 4.4-B2

use serde::{Deserialize, Serialize};
use std::sync::{Mutex, MutexGuard};

/// Lo único que se le muestra a la interfaz. No incluye el token.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub role: String,
    pub display_name: String,
    pub must_change_password: bool,
}

#[derive(Deserialize)]
struct LoginResponse {
    token: String,
    role: String,
    display_name: String,
    must_change_password: bool,
}

// Sin `Debug` a propósito: evita que el token termine en un log.
struct Session {
    token: String,
    info: SessionInfo,
}

#[derive(Default)]
pub struct ClientSession {
    inner: Mutex<Option<Session>>,
}

impl ClientSession {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> MutexGuard<'_, Option<Session>> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn info(&self) -> Option<SessionInfo> {
        self.lock().as_ref().map(|s| s.info.clone())
    }

    /// Token para el encabezado `Authorization: Bearer`. Solo para uso interno
    /// del cliente HTTP en Rust; nunca se devuelve a la interfaz.
    pub fn bearer(&self) -> Option<String> {
        self.lock().as_ref().map(|s| s.token.clone())
    }

    pub fn logout(&self) {
        *self.lock() = None;
    }

    /// Inicia sesión. Cualquier sesión anterior se descarta antes de intentar,
    /// de modo que un login fallido nunca deja viva la sesión de otro usuario.
    pub async fn login(
        &self,
        client: &reqwest::Client,
        base_url: &str,
        username: &str,
        password: &str,
    ) -> Result<SessionInfo, String> {
        self.logout();
        if username.trim().is_empty() || password.is_empty() {
            return Err("Ingresá usuario y contraseña".into());
        }
        let url = format!("{}/api/login", base_url.trim_end_matches('/'));
        let resp = client
            .post(&url)
            .json(&serde_json::json!({ "username": username, "password": password }))
            .send()
            .await
            .map_err(|e| format!("No se pudo conectar con el servidor: {e}"))?;

        let status = resp.status();
        if !status.is_success() {
            if status == reqwest::StatusCode::UNAUTHORIZED {
                return Err("Usuario o contraseña incorrectos".into());
            }
            return Err(format!("El servidor respondió con error {}", status.as_u16()));
        }
        let body: LoginResponse = resp
            .json()
            .await
            .map_err(|_| "Respuesta de login inválida del servidor".to_string())?;

        let info = SessionInfo {
            role: body.role,
            display_name: body.display_name,
            must_change_password: body.must_change_password,
        };
        *self.lock() = Some(Session {
            token: body.token,
            info: info.clone(),
        });
        Ok(info)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api_client::build_http_client;
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
        client: reqwest::Client,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            self.handle.shutdown();
        }
    }

    async fn fixture(app: Router) -> Fixture {
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
        tokio::spawn(async move {
            axum_server::bind_rustls("127.0.0.1:0".parse().unwrap(), cfg)
                .handle(h)
                .serve(app.into_make_service())
                .await
                .unwrap();
        });
        let addr = handle.listening().await.expect("el servidor de prueba no arrancó");
        let pem = std::fs::read_to_string(dir.join("server-cert.pem")).unwrap();
        let client = build_http_client(&pem).unwrap();
        Fixture {
            _tmp: tmp,
            handle,
            base_url: format!("https://127.0.0.1:{}", addr.port()),
            client,
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

    fn app_ok() -> Router {
        Router::new().route("/api/login", post(fake_login))
    }

    #[tokio::test]
    async fn login_ok_guarda_sesion_sin_exponer_el_token() {
        let fx = fixture(app_ok()).await;
        let s = ClientSession::new();
        let info = s.login(&fx.client, &fx.base_url, "ana", "secreto").await.unwrap();
        assert_eq!(
            info,
            SessionInfo {
                role: "admin".into(),
                display_name: "Ana".into(),
                must_change_password: false
            }
        );
        assert_eq!(s.bearer().as_deref(), Some("tok-123"));
        assert_eq!(s.info(), Some(info.clone()));
        let json = serde_json::to_string(&info).unwrap();
        assert!(!json.contains("tok-123"));
        assert!(json.contains("displayName"));
    }

    #[tokio::test]
    async fn credenciales_malas_dan_error_y_no_dejan_sesion() {
        let fx = fixture(app_ok()).await;
        let s = ClientSession::new();
        let err = s.login(&fx.client, &fx.base_url, "ana", "mala").await.unwrap_err();
        assert!(err.contains("incorrectos"));
        assert!(s.bearer().is_none());
        assert!(s.info().is_none());
    }

    #[tokio::test]
    async fn un_login_fallido_borra_la_sesion_anterior() {
        let fx = fixture(app_ok()).await;
        let s = ClientSession::new();
        s.login(&fx.client, &fx.base_url, "ana", "secreto").await.unwrap();
        assert!(s.bearer().is_some());
        assert!(s.login(&fx.client, &fx.base_url, "ana", "mala").await.is_err());
        assert!(s.bearer().is_none());
        assert!(s.info().is_none());
    }

    #[tokio::test]
    async fn logout_borra_el_token() {
        let fx = fixture(app_ok()).await;
        let s = ClientSession::new();
        s.login(&fx.client, &fx.base_url, "ana", "secreto").await.unwrap();
        s.logout();
        assert!(s.bearer().is_none());
        assert!(s.info().is_none());
    }

    #[tokio::test]
    async fn servidor_caido_da_error_de_conexion() {
        let fx = fixture(app_ok()).await;
        let s = ClientSession::new();
        let err = s
            .login(&fx.client, "https://127.0.0.1:1", "ana", "secreto")
            .await
            .unwrap_err();
        assert!(err.contains("conectar"));
        assert!(s.bearer().is_none());
    }

    #[tokio::test]
    async fn respuesta_que_no_es_json_da_error() {
        let app = Router::new().route("/api/login", post(|| async { "esto no es json" }));
        let fx = fixture(app).await;
        let s = ClientSession::new();
        let err = s.login(&fx.client, &fx.base_url, "ana", "secreto").await.unwrap_err();
        assert!(err.contains("inválida"));
        assert!(s.bearer().is_none());
    }

    #[tokio::test]
    async fn campos_vacios_no_llegan_al_servidor() {
        let fx = fixture(app_ok()).await;
        let s = ClientSession::new();
        let err = s.login(&fx.client, &fx.base_url, "  ", "secreto").await.unwrap_err();
        assert!(err.contains("usuario"));
        assert!(s.login(&fx.client, &fx.base_url, "ana", "").await.is_err());
    }
}
