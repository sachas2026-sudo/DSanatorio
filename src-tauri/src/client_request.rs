//! Comando genérico del modo cliente: `client_api(método, ruta, cuerpo)`.
//!
//! Agrega el token desde la memoria de Rust (la interfaz nunca lo ve), solo
//! acepta rutas `/api/...` del servidor configurado y devuelve estado + cuerpo
//! JSON. La autorización real la sigue haciendo el servidor.
//!
//! Paso 4.4-C.

use crate::client_commands::ClientState;
use crate::audit_log::record_client_request;
use serde::Serialize;
use serde_json::Value;
use std::time::{Duration, Instant};

const MAX_PATH_LEN: usize = 2048;
const NO_SESSION: &str = "No hay sesión iniciada: ingresá primero";
pub const SESSION_EXPIRED: &str = "SESSION_EXPIRED: La sesión venció, iniciá sesión de nuevo";

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApiReply {
    pub status: u16,
    pub body: Value,
}

pub fn parse_method(m: &str) -> Result<reqwest::Method, String> {
    match m.trim().to_ascii_uppercase().as_str() {
        "GET" => Ok(reqwest::Method::GET),
        "POST" => Ok(reqwest::Method::POST),
        "PUT" => Ok(reqwest::Method::PUT),
        "DELETE" => Ok(reqwest::Method::DELETE),
        other => Err(format!("Método no permitido: '{other}'")),
    }
}

/// La ruta tiene que ser `/api/...` en el servidor configurado: nada de otros
/// hosts, subidas de directorio ni el endpoint de login (eso es `client_login`).
pub fn validate_path(path: &str) -> Result<(), String> {
    let err = || Err(format!("Ruta no permitida: '{path}'"));
    if path.len() > MAX_PATH_LEN
        || !path.is_ascii()
        || path.chars().any(|c| c.is_control() || c.is_whitespace())
    {
        return err();
    }
    if !path.starts_with("/api/") {
        return err();
    }
    if path.contains("..") || path.contains('\\') || path.contains('#') || path.contains("//") {
        return err();
    }
    let lower = path.to_ascii_lowercase();
    if lower.contains("%2e") || lower.contains("%2f") || lower.contains("%5c") {
        return err();
    }
    if lower == "/api/login" || lower.starts_with("/api/login/") || lower.starts_with("/api/login?")
    {
        return err();
    }
    Ok(())
}

impl ClientState {
    pub async fn api_call(
        &self,
        method: &str,
        path: &str,
        body: Option<Value>,
    ) -> Result<ApiReply, String> {
        let method = parse_method(method)?;
        validate_path(path)?;
        let conn = self.conn().ok_or_else(|| NO_SESSION.to_string())?;
        let token = self.session.bearer().ok_or_else(|| NO_SESSION.to_string())?;
        let username = self.session.info().map(|info| info.username);
        let method_name = method.as_str().to_string();
        let started = Instant::now();

        let url = format!("{}{}", conn.base_url.trim_end_matches('/'), path);
        let request_shape = body.clone();
        let response = if method == reqwest::Method::GET {
            let mut final_result = None;
            for attempt in 0..3 {
                let mut request = conn
                    .client
                    .get(&url)
                    .bearer_auth(&token)
                    .timeout(Duration::from_secs(5));
                if let Some(value) = request_shape.as_ref() {
                    request = request.json(value);
                }
                let result = request.send().await;
                let retry = match &result {
                    Ok(response) => response.status().is_server_error(),
                    Err(error) => error.is_timeout() || error.is_connect(),
                };
                if retry && attempt < 2 {
                    tokio::time::sleep(Duration::from_millis(250 * (1 << attempt))).await;
                    continue;
                }
                final_result = Some(result);
                break;
            }
            final_result
        } else {
            let mut request = conn.client.request(method, &url).bearer_auth(&token);
            if let Some(value) = body {
                request = request.json(&value);
            }
            Some(request.send().await)
        };
        let resp = match response {
            Some(Ok(response)) => response,
            Some(Err(error)) => {
                let kind = if error.is_timeout() {
                    "timeout"
                } else if error.is_connect() {
                    "connection"
                } else if error.is_builder() {
                    "request_configuration"
                } else {
                    "transport"
                };
                record_client_request(
                    &method_name,
                    path,
                    username.as_deref(),
                    request_shape.as_ref(),
                    None,
                    None,
                    None,
                    started.elapsed().as_millis(),
                    Some(kind),
                );
                return Err(format!("No se pudo conectar con el servidor: {error}"));
            }
            None => return Err("No se pudo completar la solicitud al servidor.".to_string()),
        };

        let status = resp.status();
        crate::discovery::mark_connection_success();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            record_client_request(
                &method_name,
                path,
                username.as_deref(),
                request_shape.as_ref(),
                Some(status.as_u16()),
                None,
                Some(0),
                started.elapsed().as_millis(),
                Some("session_expired"),
            );
            self.logout();
            return Err(SESSION_EXPIRED.to_string());
        }
        let bytes = match resp.bytes().await {
            Ok(bytes) => bytes,
            Err(error) => {
                record_client_request(
                    &method_name,
                    path,
                    username.as_deref(),
                    request_shape.as_ref(),
                    Some(status.as_u16()),
                    None,
                    None,
                    started.elapsed().as_millis(),
                    Some("response_read"),
                );
                return Err(format!("No se pudo leer la respuesta del servidor: {error}"));
            }
        };
        let response_bytes = bytes.len();
        let body = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes)
                .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned()))
        };
        record_client_request(
            &method_name,
            path,
            username.as_deref(),
            request_shape.as_ref(),
            Some(status.as_u16()),
            Some(&body),
            Some(response_bytes),
            started.elapsed().as_millis(),
            None,
        );
        Ok(ApiReply {
            status: status.as_u16(),
            body,
        })
    }
}

#[tauri::command]
pub async fn client_api(
    state: tauri::State<'_, ClientState>,
    method: String,
    path: String,
    body: Option<Value>,
) -> Result<ApiReply, String> {
    state.api_call(&method, &path, body).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client_mode::{AppMode, ClientConfig};
    use crate::test_support::{start_tls_server, TlsServer};
    use axum::{
        extract::State,
        http::{HeaderMap, StatusCode},
        routing::{get, post, put},
        Json, Router,
    };
    use serde_json::json;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    async fn fake_login(Json(body): Json<Value>) -> (StatusCode, Json<Value>) {
        if body["username"] == "ana" && body["password"] == "secreto" {
            (
                StatusCode::OK,
                Json(json!({
                    "token": "tok-123",
                    "role": "admin",
                    "display_name": "Ana",
                    "must_change_password": false
                })),
            )
        } else {
            (StatusCode::UNAUTHORIZED, Json(json!({ "error": "credenciales inválidas" })))
        }
    }

    async fn pacientes(h: HeaderMap) -> (StatusCode, Json<Value>) {
        let ok = h.get("authorization").and_then(|v| v.to_str().ok()) == Some("Bearer tok-123");
        if ok {
            (StatusCode::OK, Json(json!([{ "id": "p1" }])))
        } else {
            (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" })))
        }
    }

    async fn conflicto() -> (StatusCode, Json<Value>) {
        (
            StatusCode::CONFLICT,
            Json(json!({ "error": "conflict", "current": { "version": 3 } })),
        )
    }

    async fn expira() -> StatusCode {
        StatusCode::UNAUTHORIZED
    }

    async fn vacio() -> StatusCode {
        StatusCode::NO_CONTENT
    }

    async fn get_temporalmente_fallido(State(attempts): State<Arc<AtomicUsize>>) -> StatusCode {
        if attempts.fetch_add(1, Ordering::SeqCst) == 0 {
            StatusCode::SERVICE_UNAVAILABLE
        } else {
            StatusCode::OK
        }
    }

    fn app() -> Router {
        Router::new()
            .route(
                "/api/health",
                get(|| async {
                    Json(json!({
                        "status": "ok",
                        "app": "sanatorio",
                        "server_name": "Servidor de prueba"
                    }))
                }),
            )
            .route("/api/login", post(fake_login))
            .route("/api/pacientes", get(pacientes))
            .route("/api/afiliados/a1", put(conflicto))
            .route("/api/expira", get(expira))
            .route("/api/vacio", get(vacio))
    }

    async fn logged_in(srv: &TlsServer) -> ClientState {
        let st = ClientState::new();
        let cfg = ClientConfig {
            mode: AppMode::Client,
            server_url: Some(srv.base_url.clone()),
            server_cert_pem: Some(srv.pem.clone()),
            server_primary_ip: None,
            device_id: None,
        };
        st.login_with_config(&cfg, "ana", "secreto").await.unwrap();
        st
    }

    #[tokio::test]
    async fn get_con_token_devuelve_estado_y_cuerpo() {
        let srv = start_tls_server(app()).await;
        let st = logged_in(&srv).await;
        let reply = st.api_call("GET", "/api/pacientes", None).await.unwrap();
        assert_eq!(reply.status, 200);
        assert_eq!(reply.body[0]["id"], "p1");
    }

    #[tokio::test]
    async fn get_reintenta_falla_temporal_del_servidor() {
        let attempts = Arc::new(AtomicUsize::new(0));
        let app = Router::new()
            .route("/api/health", get(|| async {
                Json(json!({ "status": "ok", "app": "sanatorio", "server_name": "Test" }))
            }))
            .route("/api/login", post(fake_login))
            .route(
                "/api/retry",
                get(get_temporalmente_fallido).with_state(Arc::clone(&attempts)),
            );
        let srv = start_tls_server(app).await;
        let state = logged_in(&srv).await;

        let reply = state.api_call("GET", "/api/retry", None).await.unwrap();

        assert_eq!(reply.status, 200);
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn sin_sesion_no_hace_el_pedido() {
        let st = ClientState::new();
        let err = st.api_call("GET", "/api/pacientes", None).await.unwrap_err();
        assert!(err.contains("sesión"));
    }

    #[test]
    fn rutas_invalidas_se_rechazan_y_las_validas_pasan() {
        for mala in [
            "/api/../etc/passwd",
            "api/pacientes",
            "https://evil.example/api/x",
            "/otro/x",
            "/api/x#y",
            "/api/%2e%2e/x",
            "/api/%2E%2E/x",
            "/api//x",
            "/api/x y",
            "/api/login",
            "/api/login?x=1",
        ] {
            assert!(validate_path(mala).is_err(), "debería rechazar: {mala}");
        }
        for buena in [
            "/api/pacientes",
            "/api/pacientes?q=ab",
            "/api/afiliados/a1",
            "/api/pacientes/abc-123/baja",
        ] {
            assert!(validate_path(buena).is_ok(), "debería aceptar: {buena}");
        }
    }

    #[test]
    fn solo_se_permiten_los_metodos_esperados() {
        assert!(parse_method("get").is_ok());
        assert!(parse_method("POST").is_ok());
        assert!(parse_method("PUT").is_ok());
        assert!(parse_method("DELETE").is_ok());
        assert!(parse_method("PATCH").is_err());
        assert!(parse_method("").is_err());
    }

    #[tokio::test]
    async fn el_409_de_conflicto_llega_a_la_interfaz() {
        let srv = start_tls_server(app()).await;
        let st = logged_in(&srv).await;
        let reply = st
            .api_call("PUT", "/api/afiliados/a1", Some(json!({ "version": 2 })))
            .await
            .unwrap();
        assert_eq!(reply.status, 409);
        assert_eq!(reply.body["current"]["version"], 3);
    }

    #[tokio::test]
    async fn un_401_borra_la_sesion_y_avisa() {
        let srv = start_tls_server(app()).await;
        let st = logged_in(&srv).await;
        let err = st.api_call("GET", "/api/expira", None).await.unwrap_err();
        assert!(err.contains("SESSION_EXPIRED"));
        assert!(st.session.bearer().is_none());
        assert!(st.conn().is_none());
    }

    #[tokio::test]
    async fn respuesta_204_da_cuerpo_null() {
        let srv = start_tls_server(app()).await;
        let st = logged_in(&srv).await;
        let reply = st.api_call("GET", "/api/vacio", None).await.unwrap();
        assert_eq!(reply.status, 204);
        assert_eq!(reply.body, Value::Null);
    }
}
