use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::{
    extract::{Request, State},
    http::{HeaderMap, StatusCode},
    middleware::{from_fn_with_state, Next},
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use axum_server::tls_rustls::RustlsConfig;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use pbkdf2::pbkdf2_hmac;
use rcgen::generate_simple_self_signed;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use uuid::Uuid;

use crate::core::config::settings;
use crate::modules::configuracion::service;

#[derive(Clone, serde::Deserialize)]
struct Account {
    username: String,
    role: String,
    #[serde(rename = "displayName")]
    display_name: String,
    #[serde(default)]
    turno: Option<String>,
    #[serde(default)]
    password: Option<String>,
    #[serde(rename = "passwordHash")]
    password_hash: Option<String>,
    #[serde(rename = "passwordSalt")]
    password_salt: Option<String>,
    #[serde(rename = "mustChangePassword", default)]
    must_change_password: bool,
}

#[derive(Clone)]
struct Session {
    username: String,
    role: String,
    display_name: String,
    expiry: Instant,
}

#[derive(Clone)]
struct AppState {
    accounts: Arc<Vec<Account>>,
    data_dir: std::path::PathBuf,
    sessions: Arc<Mutex<HashMap<String, Session>>>,
}

#[derive(Serialize)]
struct Health { status: &'static str, version: &'static str }

#[derive(Deserialize)]
struct LoginReq { username: String, password: String }

#[derive(Serialize)]
struct LoginRes {
    token: String,
    role: String,
    display_name: String,
    must_change_password: bool,
}

#[derive(Serialize)]
struct ApiError { error: String }

fn load_accounts(data_dir: &std::path::Path) -> Vec<Account> {
    let path = data_dir.join("auth-accounts.json");
    if !path.is_file() {
        // Crear cuentas por defecto con contraseñas aleatorias de un solo uso
        let make_pass = || uuid::Uuid::new_v4().to_string()[..12].to_string();
        let p_admi = make_pass();
        let p_mary = make_pass();
        let p_andrea = make_pass();
        let p_afiliados = make_pass();
        let accounts = vec![
            serde_json::json!({"username":"Admi","role":"admin","displayName":"Admi","password":p_admi,"mustChangePassword":true}),
            serde_json::json!({"username":"Aguirre Mary","role":"secretaria","displayName":"Aguirre Mary","turno":"Mañana","password":p_mary,"mustChangePassword":true}),
            serde_json::json!({"username":"Barua Andrea","role":"secretaria","displayName":"Barua Andrea","turno":"Tarde","password":p_andrea,"mustChangePassword":true}),
            serde_json::json!({"username":"Afiliados","role":"afiliado","displayName":"Afiliados","password":p_afiliados,"mustChangePassword":true}),
        ];
        let raw = serde_json::to_string_pretty(&accounts).unwrap();
        let _ = std::fs::write(&path, raw);
        println!("=== CUENTAS CREADAS (contraseña de un solo uso) ===");
        println!("Admi: {}", p_admi);
        println!("Aguirre Mary: {}", p_mary);
        println!("Barua Andrea: {}", p_andrea);
        println!("Afiliados: {}", p_afiliados);
        println!("==================================================");
    }
    let raw = std::fs::read_to_string(&path).unwrap_or_default();
    if raw.trim().is_empty() { return vec![]; }
    serde_json::from_str(&raw).unwrap_or_default()
}

fn verify_password(account: &Account, password: &str) -> bool {
    if let (Some(hash_b64), Some(salt_b64)) = (&account.password_hash, &account.password_salt) {
        let salt = match B64.decode(salt_b64) { Ok(b) => b, Err(_) => return false };
        let expected = match B64.decode(hash_b64) { Ok(b) => b, Err(_) => return false };
        let mut out = vec![0u8; expected.len()];
        pbkdf2_hmac::<Sha256>(password.as_bytes(), &salt, 120_000, &mut out);
        // constant-time compare
        if out.len() != expected.len() { return false; }
        let mut diff = 0u8;
        for (a,b) in out.iter().zip(expected.iter()) { diff |= a ^ b; }
        return diff == 0;
    }
    if let Some(plain) = &account.password {
        return plain == password;
    }
    false
}

fn authenticate_request(state: &AppState, headers: &HeaderMap) -> Result<Session, StatusCode> {
    let token = headers.get("authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(|s| s.to_string())
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let sessions = state.sessions.lock().unwrap();
    match sessions.get(&token) {
        Some(s) if s.expiry > Instant::now() => Ok(s.clone()),
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}

fn role_allowed(role: &str, path: &str) -> bool {
    match role {
        "admin" => true,
        "secretaria" => matches!(path, "/api/pacientes" | "/api/medicos" | "/api/agenda" | "/api/pagos" | "/api/afiliados"),
        "afiliado" => matches!(path, "/api/pacientes" | "/api/afiliados"),
        _ => false,
    }
}

async fn health() -> Json<Health> {
    Json(Health { status: "ok", version: "15.0.0" })
}

async fn login(State(state): State<AppState>, Json(body): Json<LoginReq>) -> Result<Json<LoginRes>, StatusCode> {
    let account = state.accounts.iter().find(|a| a.username.eq_ignore_ascii_case(&body.username))
        .ok_or(StatusCode::UNAUTHORIZED)?;
    if !verify_password(account, &body.password) { return Err(StatusCode::UNAUTHORIZED); }
    let token = Uuid::new_v4().to_string();
    let session = Session {
        username: account.username.clone(),
        role: account.role.clone(),
        display_name: account.display_name.clone(),
        expiry: Instant::now() + Duration::from_secs(12 * 3600),
    };
    state.sessions.lock().unwrap().insert(token.clone(), session);
    Ok(Json(LoginRes {
        token,
        role: account.role.clone(),
        display_name: account.display_name.clone(),
        must_change_password: account.must_change_password,
    }))
}

async fn get_pacientes(State(state): State<AppState>, headers: HeaderMap) -> Result<impl IntoResponse, StatusCode> {
    let session = authenticate_request(&state, &headers)?;
    if !role_allowed(&session.role, "/api/pacientes") { return Err(StatusCode::FORBIDDEN); }
    let data = service::load_app_data().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(data.patients))
}

async fn get_medicos(State(state): State<AppState>, headers: HeaderMap) -> Result<impl IntoResponse, StatusCode> {
    let session = authenticate_request(&state, &headers)?;
    if !role_allowed(&session.role, "/api/medicos") { return Err(StatusCode::FORBIDDEN); }
    let data = service::load_app_data().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(data.doctors))
}

async fn get_agenda(State(state): State<AppState>, headers: HeaderMap) -> Result<impl IntoResponse, StatusCode> {
    let session = authenticate_request(&state, &headers)?;
    if !role_allowed(&session.role, "/api/agenda") { return Err(StatusCode::FORBIDDEN); }
    let data = service::load_app_data().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(data.appointments))
}

async fn get_pagos(State(state): State<AppState>, headers: HeaderMap) -> Result<impl IntoResponse, StatusCode> {
    let session = authenticate_request(&state, &headers)?;
    if !role_allowed(&session.role, "/api/pagos") { return Err(StatusCode::FORBIDDEN); }
    let data = service::load_app_data().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(data.payments))
}

async fn get_afiliados(State(state): State<AppState>, headers: HeaderMap) -> Result<impl IntoResponse, StatusCode> {
    let session = authenticate_request(&state, &headers)?;
    if !role_allowed(&session.role, "/api/afiliados") { return Err(StatusCode::FORBIDDEN); }
    let data = service::load_app_data().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(data.afiliados.unwrap_or_default()))
}

async fn get_obras_sociales(State(state): State<AppState>, headers: HeaderMap) -> Result<impl IntoResponse, StatusCode> {
    let session = authenticate_request(&state, &headers)?;
    if !role_allowed(&session.role, "/api/obras-sociales") { return Err(StatusCode::FORBIDDEN); }
    let data = service::load_app_data().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(data.obras_sociales_custom))
}

pub fn run_server() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    service::ensure_initialized().expect("init storage");
    let data_dir = settings::data_dir();
    let _ = std::fs::create_dir_all(&data_dir);

    // TLS
    let tls_dir = settings::sanatorio_root().join("config").join("tls");
    let _ = std::fs::create_dir_all(&tls_dir);
    let cert_path = tls_dir.join("server-cert.pem");
    let key_path = tls_dir.join("server-key.pem");
    if !cert_path.exists() || !key_path.exists() {
        let key_pair = rcgen::KeyPair::generate().expect("key");
        let mut params = rcgen::CertificateParams::new(vec!["localhost".to_string()]).expect("params");
        params.not_after = time::OffsetDateTime::now_utc() + time::Duration::days(3650);
        let cert = params.self_signed(&key_pair).expect("cert");
        std::fs::write(&cert_path, cert.pem()).expect("write cert");
        std::fs::write(&key_path, key_pair.serialize_pem()).expect("write key");
    }

    let accounts = load_accounts(&data_dir);

    let rt = tokio::runtime::Runtime::new().expect("runtime");
    rt.block_on(async {
        let state = AppState {
            accounts: Arc::new(accounts),
            data_dir: data_dir.clone(),
            sessions: Arc::new(Mutex::new(HashMap::new())),
        };

        let app = Router::new()
            .route("/api/health", get(health))
            .route("/api/login", axum::routing::post(login))
            .route("/api/pacientes", get(get_pacientes))
            .route("/api/medicos", get(get_medicos))
            .route("/api/agenda", get(get_agenda))
            .route("/api/pagos", get(get_pagos))
            .route("/api/afiliados", get(get_afiliados))
            .route("/api/obras-sociales", get(get_obras_sociales))
            .with_state(state);

        let addr: SocketAddr = "0.0.0.0:8787".parse().unwrap();
        let rustls_config = RustlsConfig::from_pem_file(&cert_path, &key_path)
            .await
            .expect("rustls config");

        println!("Servidor Sanatorio en https://0.0.0.0:8787");
        axum_server::bind_rustls(addr, rustls_config)
            .serve(app.into_make_service())
            .await
            .expect("server");
    });
}
