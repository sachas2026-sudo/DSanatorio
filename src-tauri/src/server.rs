use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
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
use crate::core::db;
use crate::modules::configuracion::service;

#[derive(Clone, serde::Deserialize, serde::Serialize)]
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
    must_change_password: bool,
    expiry: Instant,
}

#[derive(Clone)]
struct AppState {
    accounts: Arc<Mutex<Vec<Account>>>,
    data_dir: std::path::PathBuf,
    sessions: Arc<Mutex<HashMap<String, Session>>>,
    login_attempts: Arc<Mutex<HashMap<String, LoginAttempt>>>,
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

#[derive(Deserialize)]
struct WriteEnabledReq {
    write_enabled: bool,
}

#[derive(Serialize)]
struct WriteEnabledRes {
    write_enabled: bool,
}

#[derive(Deserialize)]
struct ChangePasswordReq {
    current_password: String,
    new_password: String,
}

#[derive(Serialize)]
struct ChangePasswordRes {
    ok: bool,
}

fn load_accounts(data_dir: &std::path::Path) -> Vec<Account> {
    let path = data_dir.join("auth-accounts.json");
    if !path.is_file() {
        // Crear cuentas por defecto con contraseñas aleatorias de un solo uso
        let p_admi = uuid::Uuid::new_v4().to_string()[..12].to_string();
        let p_mary = uuid::Uuid::new_v4().to_string()[..12].to_string();
        let p_andrea = uuid::Uuid::new_v4().to_string()[..12].to_string();
        let p_afiliados = uuid::Uuid::new_v4().to_string()[..12].to_string();
        let accounts = vec![
            serde_json::json!({"username":"Admi","role":"admin","displayName":"Admi","password":p_admi,"mustChangePassword":true}),
            serde_json::json!({"username":"Aguirre Mary","role":"secretaria","displayName":"Aguirre Mary","turno":"Mañana","password":p_mary,"mustChangePassword":true}),
            serde_json::json!({"username":"Barua Andrea","role":"secretaria","displayName":"Barua Andrea","turno":"Tarde","password":p_andrea,"mustChangePassword":true}),
            serde_json::json!({"username":"Afiliados","role":"afiliado","displayName":"Afiliados","password":p_afiliados,"mustChangePassword":true}),
        ];
        let raw = serde_json::to_string_pretty(&accounts).unwrap();
        let _ = std::fs::write(&path, raw);
        // Guardar contraseñas en archivo con permisos restringidos, NO en consola
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
            let file_path = parent.join("cuentas-iniciales.txt");
            let _ = std::fs::write(&file_path, format!("Admi: {}\nAguirre Mary: {}\nBarua Andrea: {}\nAfiliados: {}", p_admi, p_mary, p_andrea, p_afiliados));
            let user = std::env::var("USERNAME").unwrap_or_else(|_| "Administrador".to_string());
            let args: Vec<String> = vec![
                file_path.to_string_lossy().to_string(),
                "/inheritance:r".to_string(),
                "/grant:r".to_string(),
                format!("{}:F", user),
            ];
            let _ = Command::new("icacls").args(args).status();
        }
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

#[derive(Clone)]
struct LoginAttempt {
    failures: u32,
    first_fail: Instant,
}

fn check_rate_limit(state: &AppState, username: &str) -> Result<(), StatusCode> {
    let mut attempts = state.login_attempts.lock().unwrap();
    let now = Instant::now();
    let a = attempts.entry(username.to_string()).or_insert(LoginAttempt { failures: 0, first_fail: now });
    if a.failures >= 5 && (now - a.first_fail) < Duration::from_secs(15 * 60) {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    if (now - a.first_fail) > Duration::from_secs(15 * 60) {
        *a = LoginAttempt { failures: 0, first_fail: now };
    }
    Ok(())
}

fn record_failure(state: &AppState, username: &str) {
    let mut attempts = state.login_attempts.lock().unwrap();
    let now = Instant::now();
    let a = attempts.entry(username.to_string()).or_insert(LoginAttempt { failures: 0, first_fail: now });
    a.failures += 1;
}

fn authenticate_request(state: &AppState, headers: &HeaderMap, _token_expiry_secs: Option<u64>) -> Result<Session, StatusCode> {
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
    check_rate_limit(&state, &body.username)?;
    let accounts = state.accounts.lock().unwrap();
    let account_opt = accounts.iter().find(|a| a.username.eq_ignore_ascii_case(&body.username));

    if let Some(account) = account_opt {
        if verify_password(account, &body.password) {
            let username = account.username.clone();
            let role = account.role.clone();
            let display_name = account.display_name.clone();
            let must_change = account.must_change_password;
            drop(accounts);

            let token = Uuid::new_v4().to_string();
            let session = Session {
                username: username.clone(),
                role: role.clone(),
                display_name: display_name.clone(),
                must_change_password: must_change,
                expiry: Instant::now() + Duration::from_secs(12 * 3600),
            };
            state.sessions.lock().unwrap().insert(token.clone(), session);

            // Auditoría LOGIN_OK
            let mut conn = db::open_connection().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            let tx = conn.transaction().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            service::write_audit_log(&tx, &username, &role, "LOGIN_OK", "autenticacion", None, Some("login exitoso")).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            tx.commit().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            return Ok(Json(LoginRes {
                token,
                role,
                display_name,
                must_change_password: must_change,
            }));
        }

        // Contraseña incorrecta
        let username = account.username.clone();
        let role = account.role.clone();
        record_failure(&state, &body.username);
        drop(accounts);
        let mut conn = db::open_connection().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let tx = conn.transaction().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        service::write_audit_log(&tx, &username, &role, "LOGIN_FAIL", "autenticacion", None, Some("contraseña incorrecta")).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        tx.commit().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        return Err(StatusCode::UNAUTHORIZED);
    }

    // Usuario no encontrado
    record_failure(&state, &body.username);
    drop(accounts);
    let mut conn = db::open_connection().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let tx = conn.transaction().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    service::write_audit_log(&tx, &body.username, "desconocido", "LOGIN_FAIL", "autenticacion", None, Some("usuario no encontrado")).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tx.commit().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    return Err(StatusCode::UNAUTHORIZED);
}

async fn get_pacientes(State(state): State<AppState>, headers: HeaderMap) -> Result<impl IntoResponse, StatusCode> {
    let session = authenticate_request(&state, &headers, None)?;
    if session.must_change_password { return Err(StatusCode::FORBIDDEN); }
    if !role_allowed(&session.role, "/api/pacientes") { return Err(StatusCode::FORBIDDEN); }
    let data = service::load_app_data().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(data.patients))
}

async fn get_medicos(State(state): State<AppState>, headers: HeaderMap) -> Result<impl IntoResponse, StatusCode> {
    let session = authenticate_request(&state, &headers, None)?;
    if session.must_change_password { return Err(StatusCode::FORBIDDEN); }
    if !role_allowed(&session.role, "/api/medicos") { return Err(StatusCode::FORBIDDEN); }
    let data = service::load_app_data().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(data.doctors))
}

async fn get_agenda(State(state): State<AppState>, headers: HeaderMap) -> Result<impl IntoResponse, StatusCode> {
    let session = authenticate_request(&state, &headers, None)?;
    if session.must_change_password { return Err(StatusCode::FORBIDDEN); }
    if !role_allowed(&session.role, "/api/agenda") { return Err(StatusCode::FORBIDDEN); }
    let data = service::load_app_data().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(data.appointments))
}

async fn get_pagos(State(state): State<AppState>, headers: HeaderMap) -> Result<impl IntoResponse, StatusCode> {
    let session = authenticate_request(&state, &headers, None)?;
    if session.must_change_password { return Err(StatusCode::FORBIDDEN); }
    if !role_allowed(&session.role, "/api/pagos") { return Err(StatusCode::FORBIDDEN); }
    let data = service::load_app_data().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(data.payments))
}

async fn get_afiliados(State(state): State<AppState>, headers: HeaderMap) -> Result<impl IntoResponse, StatusCode> {
    let session = authenticate_request(&state, &headers, None)?;
    if session.must_change_password { return Err(StatusCode::FORBIDDEN); }
    if !role_allowed(&session.role, "/api/afiliados") { return Err(StatusCode::FORBIDDEN); }
    let data = service::load_app_data().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(data.afiliados.unwrap_or_default()))
}

async fn get_obras_sociales(State(state): State<AppState>, headers: HeaderMap) -> Result<impl IntoResponse, StatusCode> {
    let session = authenticate_request(&state, &headers, None)?;
    if session.must_change_password { return Err(StatusCode::FORBIDDEN); }
    if !role_allowed(&session.role, "/api/obras-sociales") { return Err(StatusCode::FORBIDDEN); }
    let data = service::load_app_data().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(data.obras_sociales_custom))
}

fn validate_new_password(username: &str, new: &str) -> Result<(), &'static str> {
    if new.len() < 8 { return Err("min 8 chars"); }
    if new.eq_ignore_ascii_case(username) { return Err("same as user"); }
    Ok(())
}

fn hash_password(password: &str) -> (String, String) {
    use rand::RngCore;
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    let mut out = [0u8; 32];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), &salt, 120_000, &mut out);
    (B64.encode(&out), B64.encode(&salt))
}

fn save_accounts(state: &AppState) -> Result<(), String> {
    let accounts = state.accounts.lock().unwrap();
    let raw = serde_json::to_string_pretty(&*accounts).map_err(|e| e.to_string())?;
    let path = state.data_dir.join("auth-accounts.json");
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, raw.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

async fn change_password(State(state): State<AppState>, headers: HeaderMap, Json(body): Json<ChangePasswordReq>) -> Result<impl IntoResponse, StatusCode> {
    let session = authenticate_request(&state, &headers, None)?;
    if validate_new_password(&session.username, &body.new_password).is_err() { return Err(StatusCode::BAD_REQUEST); }
    let mut accounts = state.accounts.lock().unwrap();
    let account = accounts.iter_mut().find(|a| a.username.eq_ignore_ascii_case(&session.username))
        .ok_or(StatusCode::UNAUTHORIZED)?;
    if !verify_password(account, &body.current_password) { return Err(StatusCode::UNAUTHORIZED); }
    let (hash, salt) = hash_password(&body.new_password);
    account.password_hash = Some(hash);
    account.password_salt = Some(salt);
    account.password = None;
    account.must_change_password = false;
    drop(accounts);
    let _ = save_accounts(&state);
    let mut sessions = state.sessions.lock().unwrap();
    for (_, s) in sessions.iter_mut() {
        if s.username.eq_ignore_ascii_case(&session.username) { s.must_change_password = false; }
    }
    Ok(Json(ChangePasswordRes { ok: true }))
}

async fn get_write_enabled(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<WriteEnabledRes>, StatusCode> {
    let _session = authenticate_request(&state, &headers, None)?; // auth requerido
    let conn = db::open_connection().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let enabled = service::get_write_enabled(&conn).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(WriteEnabledRes { write_enabled: enabled }))
}

async fn post_write_enabled(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<WriteEnabledReq>,
) -> Result<Json<WriteEnabledRes>, StatusCode> {
    let session = authenticate_request(&state, &headers, None)?;
    if session.role != "admin" {
        // Auditoría PERMISO_DENEGADO
        let mut conn = db::open_connection().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let tx = conn.transaction().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        service::write_audit_log(
            &tx,
            &session.username,
            &session.role,
            "PERMISO_DENEGADO",
            "configuracion",
            None,
            Some("intento de modificar write_enabled sin rol admin"),
        ).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        tx.commit().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        return Err(StatusCode::FORBIDDEN);
    }
    let mut conn = db::open_connection().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let tx = conn.transaction().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    service::set_write_enabled(&tx, body.write_enabled).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    service::write_audit_log(
        &tx,
        &session.username,
        &session.role,
        "SET_WRITE_ENABLED",
        "configuracion",
        None,
        Some(&format!("write_enabled={}", body.write_enabled)),
    ).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tx.commit().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(WriteEnabledRes { write_enabled: body.write_enabled }))
}

async fn get_audit_log(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<crate::modules::configuracion::dto::AuditLogEntry>>, StatusCode> {
    let session = authenticate_request(&state, &headers, None)?;
    if session.role != "admin" {
        return Err(StatusCode::FORBIDDEN);
    }
    let conn = db::open_connection().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let log = service::load_audit_log(&conn).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(log))
}

pub fn run_server() {
    // Protección: si la UI local ya está abierta (archivo de bloqueo presente),
    // el servidor se niega a arrancar para evitar dos escritores simultáneos.
    let lock_path = settings::data_dir().join("sanatorio.lock");
    if lock_path.is_file() {
        rfd::MessageDialog::new()
            .set_title("Sanatorio - UI activa")
            .set_description("Ya hay una instancia de la UI de escritorio abierta.\nEl servidor no puede arrancar mientras la UI esté activa.\nCierre la UI antes de iniciar el servidor.")
            .set_buttons(rfd::MessageButtons::Ok)
            .show();
        std::process::exit(1);
    }

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
            accounts: Arc::new(Mutex::new(accounts)),
            data_dir: data_dir.clone(),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            login_attempts: Arc::new(Mutex::new(HashMap::new())),
        };

        let app = Router::new()
            .route("/api/health", get(health))
            .route("/api/login", axum::routing::post(login))
            .route("/api/change-password", axum::routing::post(change_password))
            .route("/api/write-enabled", get(get_write_enabled).post(post_write_enabled))
            .route("/api/audit-log", get(get_audit_log))
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
