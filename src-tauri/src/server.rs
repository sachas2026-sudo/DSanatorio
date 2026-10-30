use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::{
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use axum_server::tls_rustls::RustlsConfig;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use pbkdf2::pbkdf2_hmac;
use rcgen::generate_simple_self_signed;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use uuid::Uuid;

use crate::core::config::settings;
use crate::core::db;
use crate::modules::configuracion::dto::{Afiliado, CuotaAfiliado, Patient, PatientWriteResult, PlanAfiliado, WriteResult};
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
struct AfiliadoReq {
    id: String,
    nombre: String,
    version: i32,
}

#[derive(Serialize)]
struct AfiliadoRes {
    id: String,
    nombre: String,
    version: i32,
}

#[derive(Deserialize)]
struct PlanReq {
    id: String,
    nombre: String,
    version: i32,
}

#[derive(Serialize)]
struct PlanRes {
    id: String,
    nombre: String,
    version: i32,
}

#[derive(Deserialize)]
struct CuotaReq {
    id: String,
    monto: f64,
    version: i32,
}

#[derive(Serialize)]
struct CuotaRes {
    id: String,
    monto: f64,
    version: i32,
}

/// Body de POST/PUT de pacientes. Todos los campos editables de la tabla.
/// `version` es Option para poder exigirla explícitamente en PUT y baja (400 si falta).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PatientReq {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    nombre: String,
    #[serde(default)]
    apellido: String,
    #[serde(default)]
    dni: String,
    #[serde(default)]
    telefono: String,
    #[serde(default)]
    email: String,
    #[serde(default)]
    domicilio: String,
    #[serde(default)]
    localidad: String,
    #[serde(default)]
    fecha_nacimiento: String,
    #[serde(default)]
    obra_social: String,
    #[serde(default)]
    notas: String,
    #[serde(default)]
    activo: Option<bool>,
    #[serde(default)]
    version: Option<i32>,
}

#[derive(Deserialize)]
struct BajaPacienteReq {
    #[serde(default)]
    version: Option<i32>,
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
            serde_json::json!({"username":"Admin","role":"admin","displayName":"Admin","password":p_admi,"mustChangePassword":true}),
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
            let _ = std::fs::write(&file_path, format!("Admin: {}\nAguirre Mary: {}\nBarua Andrea: {}\nAfiliados: {}", p_admi, p_mary, p_andrea, p_afiliados));
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
    let all: Vec<Account> = serde_json::from_str(&raw).unwrap_or_default();
    // NO filtrar cuentas aquí: se conservan todas en el archivo y en memoria.
    // El filtrado por rol válido ocurre solo en el login y en los endpoints de escritura.
    all
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

/// Devuelve true solo si el rol es uno de los válidos: admin, secretaria o afiliado.
/// Cualquier otro rol se considera inválido y se deniega por defecto.
fn is_valid_role(role: &str) -> bool {
    matches!(role, "admin" | "secretaria" | "afiliado")
}

/// Verifica que el usuario no tenga must_change_password pendiente.
/// Si lo tiene, solo puede acceder a /api/change-password.
fn check_password_change_required(session: &Session) -> Result<(), (StatusCode, axum::Json<serde_json::Value>)> {
    if session.must_change_password {
        Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "must_change_password"}))))
    } else {
        Ok(())
    }
}

async fn check_write_enabled(state: &AppState) -> Result<(), (StatusCode, axum::Json<serde_json::Value>)> {
    let conn = db::open_connection().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
    let enabled = service::get_write_enabled(&conn).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
    if !enabled {
        Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "writes_disabled"}))))
    } else {
        Ok(())
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

            // Rechazar roles desconocidos: solo admin, secretaria o afiliado pueden iniciar sesión.
            if !is_valid_role(&role) {
                // Auditoría LOGIN_FAIL por rol inválido
                let detalle = format!("rol invalido: {}", role);
                let mut conn = db::open_connection().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                let tx = conn.transaction().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                service::write_audit_log(&tx, &username, &role, "LOGIN_FAIL", "autenticacion", None, Some(&detalle)).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                tx.commit().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                return Err(StatusCode::FORBIDDEN);
            }

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

async fn get_pacientes(State(state): State<AppState>, headers: HeaderMap) -> Result<impl IntoResponse, (StatusCode, axum::Json<serde_json::Value>)> {
    let session = authenticate_request(&state, &headers, None).map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_password_change_required(&session)?;
    if session.must_change_password { return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "must_change_password"})))); }
    if !role_allowed(&session.role, "/api/pacientes") { return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "role_forbidden"})))); }
    let data = service::load_app_data().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
    // Los dados de baja no se exponen por la API (load_patients ya los filtra en SQL;
    // se deja el filtro explícito como defensa).
    let activos: Vec<Patient> = data
        .patients
        .into_iter()
        .filter(|p| p.deleted_at.is_none())
        .collect();
    Ok(Json(activos))
}

async fn get_medicos(State(state): State<AppState>, headers: HeaderMap) -> Result<impl IntoResponse, (StatusCode, axum::Json<serde_json::Value>)> {
    let session = authenticate_request(&state, &headers, None).map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_password_change_required(&session)?;
    if session.must_change_password { return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "must_change_password"})))); }
    if !role_allowed(&session.role, "/api/medicos") { return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "role_forbidden"})))); }
    let data = service::load_app_data().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
    Ok(Json(data.doctors))
}

async fn get_agenda(State(state): State<AppState>, headers: HeaderMap) -> Result<impl IntoResponse, (StatusCode, axum::Json<serde_json::Value>)> {
    let session = authenticate_request(&state, &headers, None).map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_password_change_required(&session)?;
    if session.must_change_password { return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "must_change_password"})))); }
    if !role_allowed(&session.role, "/api/agenda") { return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "role_forbidden"})))); }
    let data = service::load_app_data().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
    Ok(Json(data.appointments))
}

async fn get_pagos(State(state): State<AppState>, headers: HeaderMap) -> Result<impl IntoResponse, (StatusCode, axum::Json<serde_json::Value>)> {
    let session = authenticate_request(&state, &headers, None).map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_password_change_required(&session)?;
    if session.must_change_password { return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "must_change_password"})))); }
    if !role_allowed(&session.role, "/api/pagos") { return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "role_forbidden"})))); }
    let data = service::load_app_data().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
    Ok(Json(data.payments))
}

async fn get_afiliados(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Vec<serde_json::Value>>, (StatusCode, axum::Json<serde_json::Value>)> {
    let session = authenticate_request(&state, &headers, None).map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_password_change_required(&session)?;
    if session.must_change_password { return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "must_change_password"})))); }
    if !role_allowed(&session.role, "/api/afiliados") { return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "role_forbidden"})))); }
    let data = service::load_app_data().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
    Ok(Json(data.afiliados.unwrap_or_default()))
}

async fn get_obras_sociales(State(state): State<AppState>, headers: HeaderMap) -> Result<impl IntoResponse, (StatusCode, axum::Json<serde_json::Value>)> {
    let session = authenticate_request(&state, &headers, None).map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_password_change_required(&session)?;
    if session.must_change_password { return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "must_change_password"})))); }
    if !role_allowed(&session.role, "/api/obras-sociales") { return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "role_forbidden"})))); }
    let data = service::load_app_data().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
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
    let session = authenticate_request(&state, &headers, None)?; /* change-password está exenta */
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
) -> Result<Json<WriteEnabledRes>, (StatusCode, axum::Json<serde_json::Value>)> {
    let _session = authenticate_request(&state, &headers, None).map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?; // auth requerido
    check_password_change_required(&_session)?;
    let conn = db::open_connection().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
    let enabled = service::get_write_enabled(&conn).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
    Ok(Json(WriteEnabledRes { write_enabled: enabled }))
}

async fn post_write_enabled(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<WriteEnabledReq>,
) -> Result<Json<WriteEnabledRes>, (StatusCode, axum::Json<serde_json::Value>)> {
    let session = authenticate_request(&state, &headers, None).map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_password_change_required(&session)?;
    if session.role != "admin" {
        // Auditoría PERMISO_DENEGADO
        let mut conn = db::open_connection().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
        let tx = conn.transaction().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
        service::write_audit_log(
            &tx,
            &session.username,
            &session.role,
            "PERMISO_DENEGADO",
            "configuracion",
            None,
            Some("intento de modificar write_enabled sin rol admin"),
        ).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
        tx.commit().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
        return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "role_forbidden"}))));
    }
    let mut conn = db::open_connection().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
    let tx = conn.transaction().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
    service::set_write_enabled(&tx, body.write_enabled).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
    service::write_audit_log(
        &tx,
        &session.username,
        &session.role,
        "SET_WRITE_ENABLED",
        "configuracion",
        None,
        Some(&format!("write_enabled={}", body.write_enabled)),
    ).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
    tx.commit().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
    Ok(Json(WriteEnabledRes { write_enabled: body.write_enabled }))
}

async fn get_audit_log(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<crate::modules::configuracion::dto::AuditLogEntry>>, (StatusCode, axum::Json<serde_json::Value>)> {
    let session = authenticate_request(&state, &headers, None).map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_password_change_required(&session)?;
    if session.role != "admin" {
        return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "role_forbidden"}))));
    }
    let conn = db::open_connection().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
    let log = service::load_audit_log(&conn).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
    Ok(Json(log))
}

/// Verifica si un rol puede escribir afiliados/planes/cuotas.
fn can_write_afiliados(role: &str) -> bool {
    matches!(role, "afiliado" | "admin")
}

/// Helper: construye una respuesta 409 con el registro actual.
fn conflict_response(current: Option<serde_json::Value>) -> (StatusCode, axum::Json<serde_json::Value>) {
    (
        StatusCode::CONFLICT,
        axum::Json(serde_json::json!({
            "error": "conflict",
            "message": "El registro fue modificado por otro usuario",
            "current": current
        })),
    )
}

/// Crear y editar pacientes: admin y secretaria.
fn can_write_pacientes(role: &str) -> bool {
    matches!(role, "admin" | "secretaria")
}

/// Baja lógica de pacientes: solo admin.
fn can_baja_pacientes(role: &str) -> bool {
    matches!(role, "admin")
}

fn validation_response(message: &str) -> (StatusCode, axum::Json<serde_json::Value>) {
    (
        StatusCode::BAD_REQUEST,
        axum::Json(serde_json::json!({"error": "validation", "message": message})),
    )
}

fn internal_error_response() -> (StatusCode, axum::Json<serde_json::Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        axum::Json(serde_json::json!({"error": "internal"})),
    )
}

fn not_found_response() -> (StatusCode, axum::Json<serde_json::Value>) {
    (
        StatusCode::NOT_FOUND,
        axum::Json(serde_json::json!({"error": "not_found"})),
    )
}

/// 409 con el paciente completo (camelCase, incluye version y deletedAt) o null.
fn conflict_paciente_response(
    current: Option<Patient>,
) -> (StatusCode, axum::Json<serde_json::Value>) {
    let current = current
        .map(|p| serde_json::to_value(&p).unwrap_or(serde_json::Value::Null))
        .unwrap_or(serde_json::Value::Null);
    (
        StatusCode::CONFLICT,
        axum::Json(serde_json::json!({"error": "conflict", "current": current})),
    )
}

/// Parsea el body ya autenticado. Cualquier error de JSON es 400 (no 422).
fn parse_patient_req(
    body: &[u8],
) -> Result<PatientReq, (StatusCode, axum::Json<serde_json::Value>)> {
    serde_json::from_slice(body).map_err(|_| validation_response("JSON inválido"))
}

fn patient_from_req(req: PatientReq, id: String, version: i32) -> Patient {
    Patient {
        id,
        nombre: req.nombre,
        apellido: req.apellido,
        dni: req.dni,
        telefono: req.telefono,
        email: req.email,
        domicilio: req.domicilio,
        localidad: req.localidad,
        fecha_nacimiento: req.fecha_nacimiento,
        obra_social: req.obra_social,
        notas: req.notas,
        activo: req.activo,
        version,
        deleted_at: None,
    }
}

/// Audita PERMISO_DENEGADO en su propia transacción corta y devuelve el 403.
fn denegar_permiso_pacientes(
    session: &Session,
    entidad_id: Option<&str>,
    detalle: &str,
) -> (StatusCode, axum::Json<serde_json::Value>) {
    let mut conn = match db::open_connection() {
        Ok(c) => c,
        Err(_) => return internal_error_response(),
    };
    let tx = match conn.transaction() {
        Ok(t) => t,
        Err(_) => return internal_error_response(),
    };
    if service::write_audit_log(
        &tx,
        &session.username,
        &session.role,
        "PERMISO_DENEGADO",
        "pacientes",
        entidad_id,
        Some(detalle),
    )
    .is_err()
    {
        return internal_error_response();
    }
    if tx.commit().is_err() {
        return internal_error_response();
    }
    (
        StatusCode::FORBIDDEN,
        axum::Json(serde_json::json!({"error": "role_forbidden"})),
    )
}

async fn post_paciente(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<Json<serde_json::Value>, (StatusCode, axum::Json<serde_json::Value>)> {
    let session = authenticate_request(&state, &headers, None)
        .map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_password_change_required(&session)?;
    if !can_write_pacientes(&session.role) {
        return Err(denegar_permiso_pacientes(
            &session,
            None,
            "intento de crear paciente sin rol admin o secretaria",
        ));
    }
    check_write_enabled(&state).await?;

    let req = parse_patient_req(&body)?;
    let id = req.id.clone().unwrap_or_default();
    if id.trim().is_empty() {
        return Err(validation_response("id es requerido"));
    }
    if req.nombre.trim().is_empty() {
        return Err(validation_response("nombre es requerido"));
    }
    if req.apellido.trim().is_empty() {
        return Err(validation_response("apellido es requerido"));
    }

    // POST ignora la versión del body y fuerza 1.
    let patient = patient_from_req(req, id.clone(), 1);
    match service::create_paciente(&patient, &session.username, &session.role) {
        Ok((PatientWriteResult::Saved, _)) => {
            Ok(Json(serde_json::json!({"id": id, "version": 1})))
        }
        Ok((PatientWriteResult::Conflict { .. }, current)) => {
            Err(conflict_paciente_response(current))
        }
        Ok((PatientWriteResult::NotFound, _)) => Err(not_found_response()),
        Err(_) => Err(internal_error_response()),
    }
}

/// PUT con reemplazo total salvo `activo` ausente = conservar el valor actual.
async fn put_paciente(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<String>,
    body: axum::body::Bytes,
) -> Result<Json<serde_json::Value>, (StatusCode, axum::Json<serde_json::Value>)> {
    let session = authenticate_request(&state, &headers, None)
        .map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_password_change_required(&session)?;
    if !can_write_pacientes(&session.role) {
        return Err(denegar_permiso_pacientes(
            &session,
            Some(&id),
            "intento de editar paciente sin rol admin o secretaria",
        ));
    }
    check_write_enabled(&state).await?;

    let req = parse_patient_req(&body)?;
    let body_id = req.id.clone().unwrap_or_default();
    if body_id.trim().is_empty() {
        return Err(validation_response("id es requerido"));
    }
    if body_id != id {
        return Err(validation_response(
            "id del body no coincide con el id de la ruta",
        ));
    }
    if req.nombre.trim().is_empty() {
        return Err(validation_response("nombre es requerido"));
    }
    if req.apellido.trim().is_empty() {
        return Err(validation_response("apellido es requerido"));
    }
    let version = match req.version {
        Some(v) => v,
        None => return Err(validation_response("version es requerida")),
    };

    let patient = patient_from_req(req, id.clone(), version);
    match service::update_paciente(&patient, &session.username, &session.role) {
        Ok((PatientWriteResult::Saved, _)) => Ok(Json(
            serde_json::json!({"id": id, "version": version + 1}),
        )),
        Ok((PatientWriteResult::Conflict { .. }, current)) => {
            Err(conflict_paciente_response(current))
        }
        Ok((PatientWriteResult::NotFound, _)) => Err(not_found_response()),
        Err(_) => Err(internal_error_response()),
    }
}

/// Baja lógica: setea deleted_at, nunca borra físicamente. Solo admin.
async fn baja_paciente(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<String>,
    body: axum::body::Bytes,
) -> Result<Json<serde_json::Value>, (StatusCode, axum::Json<serde_json::Value>)> {
    let session = authenticate_request(&state, &headers, None)
        .map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_password_change_required(&session)?;
    if !can_baja_pacientes(&session.role) {
        return Err(denegar_permiso_pacientes(
            &session,
            Some(&id),
            "intento de dar de baja paciente sin rol admin",
        ));
    }
    check_write_enabled(&state).await?;

    let req: BajaPacienteReq = serde_json::from_slice(&body)
        .map_err(|_| validation_response("JSON inválido"))?;
    let version = match req.version {
        Some(v) => v,
        None => return Err(validation_response("version es requerida")),
    };

    match service::baja_paciente(&id, version, &session.username, &session.role) {
        Ok((PatientWriteResult::Saved, _)) => Ok(Json(
            serde_json::json!({"id": id, "version": version + 1}),
        )),
        Ok((PatientWriteResult::Conflict { .. }, current)) => {
            Err(conflict_paciente_response(current))
        }
        Ok((PatientWriteResult::NotFound, _)) => Err(not_found_response()),
        Err(_) => Err(internal_error_response()),
    }
}

async fn post_afiliado(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<AfiliadoReq>,
) -> Result<Json<serde_json::Value>, (StatusCode, axum::Json<serde_json::Value>)> {
    let session = authenticate_request(&state, &headers, None).map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_password_change_required(&session)?;
    if !can_write_afiliados(&session.role) {
        let mut conn = db::open_connection().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
        let tx = conn.transaction().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
        service::write_audit_log(
            &tx,
            &session.username,
            &session.role,
            "PERMISO_DENEGADO",
            "afiliados",
            Some(&body.id),
            Some("intento de crear afiliado sin rol afiliado o admin"),
        ).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
        tx.commit().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
        return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "role_forbidden"}))));
    }
    check_write_enabled(&state).await?;

    let afiliado = Afiliado { id: body.id.clone(), nombre: body.nombre.clone(), version: body.version };
    match service::save_afiliado(&afiliado).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": e.to_string()}))))? {
        WriteResult::Saved => {
            let mut conn = db::open_connection().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            let current: Option<serde_json::Value> = conn.query_row(
                "SELECT id, nombre, version FROM afiliados WHERE id = ?1",
                params![&body.id],
                |row| Ok(serde_json::json!({"id": row.get::<_, String>(0)?, "nombre": row.get::<_, String>(1)?, "version": row.get::<_, i32>(2)?})),
            ).optional().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
            // Auditoría
            let mut conn2 = db::open_connection().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            let tx = conn2.transaction().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            service::write_audit_log(
                &tx,
                &session.username,
                &session.role,
                "CREATE_AFILIADO",
                "afiliados",
                Some(&body.id),
                Some("crear afiliado"),
            ).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            tx.commit().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            Ok(Json(serde_json::json!({
                "id": body.id,
                "nombre": body.nombre,
                "version": current.and_then(|v| v.get("version").and_then(|x| x.as_i64())).unwrap_or(1) as i32
            })))
        }
        WriteResult::Conflict { current_version } => {
            let mut conn = db::open_connection().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            let current: Option<serde_json::Value> = conn.query_row(
                "SELECT id, nombre, version FROM afiliados WHERE id = ?1",
                params![&body.id],
                |row| Ok(serde_json::json!({"id": row.get::<_, String>(0)?, "nombre": row.get::<_, String>(1)?, "version": row.get::<_, i32>(2)?})),
            ).optional().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
            Err(conflict_response(current))
        }
    }
}

async fn put_afiliado(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(body): Json<AfiliadoReq>,
) -> Result<Json<serde_json::Value>, (StatusCode, axum::Json<serde_json::Value>)> {
    let session = authenticate_request(&state, &headers, None).map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_password_change_required(&session)?;
    if !can_write_afiliados(&session.role) {
        let mut conn = db::open_connection().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
        let tx = conn.transaction().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
        service::write_audit_log(
            &tx,
            &session.username,
            &session.role,
            "PERMISO_DENEGADO",
            "afiliados",
            None,
            Some("intento de escritura sin rol afiliado o admin"),
        ).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
        tx.commit().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
        return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "role_forbidden"}))));
    }
    check_write_enabled(&state).await?;
    let afiliado = Afiliado { id: id.clone(), nombre: body.nombre.clone(), version: body.version };
    match service::save_afiliado(&afiliado).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": e.to_string()}))))? {
        WriteResult::Saved => {
            let mut conn = db::open_connection().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            let current: Option<serde_json::Value> = conn.query_row(
                "SELECT id, nombre, version FROM afiliados WHERE id = ?1",
                params![&id],
                |row| Ok(serde_json::json!({"id": row.get::<_, String>(0)?, "nombre": row.get::<_, String>(1)?, "version": row.get::<_, i32>(2)?})),
            ).optional().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
            let mut conn2 = db::open_connection().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            let tx = conn2.transaction().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            service::write_audit_log(
                &tx,
                &session.username,
                &session.role,
                "UPDATE_AFILIADO",
                "afiliados",
                Some(&id),
                Some("actualizar afiliado"),
            ).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            tx.commit().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            Ok(Json(serde_json::json!({
                "id": id,
                "nombre": body.nombre,
                "version": current.and_then(|v| v.get("version").and_then(|x| x.as_i64())).unwrap_or(1) as i32
            })))
        }
        WriteResult::Conflict { current_version } => {
            let mut conn = db::open_connection().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            let current: Option<serde_json::Value> = conn.query_row(
                "SELECT id, nombre, version FROM afiliados WHERE id = ?1",
                params![&id],
                |row| Ok(serde_json::json!({"id": row.get::<_, String>(0)?, "nombre": row.get::<_, String>(1)?, "version": row.get::<_, i32>(2)?})),
            ).optional().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
            Err(conflict_response(current))
        }
    }
}

async fn post_plan(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PlanReq>,
) -> Result<Json<serde_json::Value>, (StatusCode, axum::Json<serde_json::Value>)> {
    let session = authenticate_request(&state, &headers, None).map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_password_change_required(&session)?;
    if !can_write_afiliados(&session.role) {
        let mut conn = db::open_connection().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
        let tx = conn.transaction().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
        service::write_audit_log(
            &tx,
            &session.username,
            &session.role,
            "PERMISO_DENEGADO",
            "afiliados",
            None,
            Some("intento de escritura sin rol afiliado o admin"),
        ).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
        tx.commit().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
        return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "role_forbidden"}))));
    }
    check_write_enabled(&state).await?;
    let plan = PlanAfiliado { id: body.id.clone(), nombre: body.nombre.clone(), version: body.version };
    match service::save_plan_afiliado(&plan).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": e.to_string()}))))? {
        WriteResult::Saved => {
            let mut conn = db::open_connection().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            let current: Option<serde_json::Value> = conn.query_row(
                "SELECT id, nombre, version FROM planes_afiliados WHERE id = ?1",
                params![&body.id],
                |row| Ok(serde_json::json!({"id": row.get::<_, String>(0)?, "nombre": row.get::<_, String>(1)?, "version": row.get::<_, i32>(2)?})),
            ).optional().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
            let mut conn2 = db::open_connection().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            let tx = conn2.transaction().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            service::write_audit_log(
                &tx,
                &session.username,
                &session.role,
                "CREATE_PLAN",
                "planes",
                Some(&body.id),
                Some("crear plan"),
            ).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            tx.commit().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            Ok(Json(serde_json::json!({
                "id": body.id,
                "nombre": body.nombre,
                "version": current.and_then(|v| v.get("version").and_then(|x| x.as_i64())).unwrap_or(1) as i32
            })))
        }
        WriteResult::Conflict { current_version } => {
            let mut conn = db::open_connection().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            let current: Option<serde_json::Value> = conn.query_row(
                "SELECT id, nombre, version FROM planes_afiliados WHERE id = ?1",
                params![&body.id],
                |row| Ok(serde_json::json!({"id": row.get::<_, String>(0)?, "nombre": row.get::<_, String>(1)?, "version": row.get::<_, i32>(2)?})),
            ).optional().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
            Err(conflict_response(current))
        }
    }
}

async fn put_plan(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(body): Json<PlanReq>,
) -> Result<Json<serde_json::Value>, (StatusCode, axum::Json<serde_json::Value>)> {
    let session = authenticate_request(&state, &headers, None).map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_password_change_required(&session)?;
    if !can_write_afiliados(&session.role) {
        let mut conn = db::open_connection().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
        let tx = conn.transaction().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
        service::write_audit_log(
            &tx,
            &session.username,
            &session.role,
            "PERMISO_DENEGADO",
            "afiliados",
            None,
            Some("intento de escritura sin rol afiliado o admin"),
        ).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
        tx.commit().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
        return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "role_forbidden"}))));
    }
    check_write_enabled(&state).await?;
    let plan = PlanAfiliado { id: id.clone(), nombre: body.nombre.clone(), version: body.version };
    match service::save_plan_afiliado(&plan).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": e.to_string()}))))? {
        WriteResult::Saved => {
            let mut conn = db::open_connection().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            let current: Option<serde_json::Value> = conn.query_row(
                "SELECT id, nombre, version FROM planes_afiliados WHERE id = ?1",
                params![&id],
                |row| Ok(serde_json::json!({"id": row.get::<_, String>(0)?, "nombre": row.get::<_, String>(1)?, "version": row.get::<_, i32>(2)?})),
            ).optional().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
            let mut conn2 = db::open_connection().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            let tx = conn2.transaction().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            service::write_audit_log(
                &tx,
                &session.username,
                &session.role,
                "UPDATE_PLAN",
                "planes",
                Some(&id),
                Some("actualizar plan"),
            ).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            tx.commit().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            Ok(Json(serde_json::json!({
                "id": id,
                "nombre": body.nombre,
                "version": current.and_then(|v| v.get("version").and_then(|x| x.as_i64())).unwrap_or(1) as i32
            })))
        }
        WriteResult::Conflict { current_version } => {
            let mut conn = db::open_connection().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            let current: Option<serde_json::Value> = conn.query_row(
                "SELECT id, nombre, version FROM planes_afiliados WHERE id = ?1",
                params![&id],
                |row| Ok(serde_json::json!({"id": row.get::<_, String>(0)?, "nombre": row.get::<_, String>(1)?, "version": row.get::<_, i32>(2)?})),
            ).optional().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
            Err(conflict_response(current))
        }
    }
}

async fn post_cuota(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CuotaReq>,
) -> Result<Json<serde_json::Value>, (StatusCode, axum::Json<serde_json::Value>)> {
    let session = authenticate_request(&state, &headers, None).map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_password_change_required(&session)?;
    if !can_write_afiliados(&session.role) {
        let mut conn = db::open_connection().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
        let tx = conn.transaction().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
        service::write_audit_log(
            &tx,
            &session.username,
            &session.role,
            "PERMISO_DENEGADO",
            "afiliados",
            None,
            Some("intento de escritura sin rol afiliado o admin"),
        ).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
        tx.commit().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
        return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "role_forbidden"}))));
    }
    check_write_enabled(&state).await?;
    let cuota = CuotaAfiliado { id: body.id.clone(), monto: body.monto, version: body.version };
    match service::save_cuota_afiliado(&cuota).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": e.to_string()}))))? {
        WriteResult::Saved => {
            let mut conn = db::open_connection().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            let current: Option<serde_json::Value> = conn.query_row(
                "SELECT id, monto, version FROM cuotas_afiliados WHERE id = ?1",
                params![&body.id],
                |row| Ok(serde_json::json!({"id": row.get::<_, String>(0)?, "monto": row.get::<_, f64>(1)?, "version": row.get::<_, i32>(2)?})),
            ).optional().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
            let mut conn2 = db::open_connection().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            let tx = conn2.transaction().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            service::write_audit_log(
                &tx,
                &session.username,
                &session.role,
                "CREATE_CUOTA",
                "cuotas",
                Some(&body.id),
                Some("crear cuota"),
            ).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            tx.commit().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            Ok(Json(serde_json::json!({
                "id": body.id,
                "monto": body.monto,
                "version": current.and_then(|v| v.get("version").and_then(|x| x.as_i64())).unwrap_or(1) as i32
            })))
        }
        WriteResult::Conflict { current_version } => {
            let mut conn = db::open_connection().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            let current: Option<serde_json::Value> = conn.query_row(
                "SELECT id, monto, version FROM cuotas_afiliados WHERE id = ?1",
                params![&body.id],
                |row| Ok(serde_json::json!({"id": row.get::<_, String>(0)?, "monto": row.get::<_, f64>(1)?, "version": row.get::<_, i32>(2)?})),
            ).optional().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
            Err(conflict_response(current))
        }
    }
}

async fn put_cuota(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(body): Json<CuotaReq>,
) -> Result<Json<serde_json::Value>, (StatusCode, axum::Json<serde_json::Value>)> {
    let session = authenticate_request(&state, &headers, None).map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_password_change_required(&session)?;
    if !can_write_afiliados(&session.role) {
        let mut conn = db::open_connection().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
        let tx = conn.transaction().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
        service::write_audit_log(
            &tx,
            &session.username,
            &session.role,
            "PERMISO_DENEGADO",
            "afiliados",
            None,
            Some("intento de escritura sin rol afiliado o admin"),
        ).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
        tx.commit().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
        return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "role_forbidden"}))));
    }
    check_write_enabled(&state).await?;
    let cuota = CuotaAfiliado { id: id.clone(), monto: body.monto, version: body.version };
    match service::save_cuota_afiliado(&cuota).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": e.to_string()}))))? {
        WriteResult::Saved => {
            let mut conn = db::open_connection().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            let current: Option<serde_json::Value> = conn.query_row(
                "SELECT id, monto, version FROM cuotas_afiliados WHERE id = ?1",
                params![&id],
                |row| Ok(serde_json::json!({"id": row.get::<_, String>(0)?, "monto": row.get::<_, f64>(1)?, "version": row.get::<_, i32>(2)?})),
            ).optional().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
            let mut conn2 = db::open_connection().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            let tx = conn2.transaction().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            service::write_audit_log(
                &tx,
                &session.username,
                &session.role,
                "UPDATE_CUOTA",
                "cuotas",
                Some(&id),
                Some("actualizar cuota"),
            ).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            tx.commit().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            Ok(Json(serde_json::json!({
                "id": id,
                "monto": body.monto,
                "version": current.and_then(|v| v.get("version").and_then(|x| x.as_i64())).unwrap_or(1) as i32
            })))
        }
        WriteResult::Conflict { current_version } => {
            let mut conn = db::open_connection().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
            let current: Option<serde_json::Value> = conn.query_row(
                "SELECT id, monto, version FROM cuotas_afiliados WHERE id = ?1",
                params![&id],
                |row| Ok(serde_json::json!({"id": row.get::<_, String>(0)?, "monto": row.get::<_, f64>(1)?, "version": row.get::<_, i32>(2)?})),
            ).optional().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
            Err(conflict_response(current))
        }
    }
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/login", axum::routing::post(login))
        .route("/api/change-password", axum::routing::post(change_password))
        .route("/api/write-enabled", get(get_write_enabled).post(post_write_enabled))
        .route("/api/audit-log", get(get_audit_log))
        .route("/api/pacientes", get(get_pacientes))
        .route("/api/pacientes", axum::routing::post(post_paciente).layer(DefaultBodyLimit::max(64 * 1024)))
        .route("/api/pacientes/:id", axum::routing::put(put_paciente).layer(DefaultBodyLimit::max(64 * 1024)))
        .route("/api/pacientes/:id/baja", axum::routing::post(baja_paciente).layer(DefaultBodyLimit::max(64 * 1024)))
        .route("/api/medicos", get(get_medicos))
        .route("/api/agenda", get(get_agenda))
        .route("/api/pagos", get(get_pagos))
        .route("/api/afiliados", get(get_afiliados))
        .route("/api/afiliados", axum::routing::post(post_afiliado))
        .route("/api/afiliados/:id", axum::routing::put(put_afiliado))
        .route("/api/planes", axum::routing::post(post_plan))
        .route("/api/planes/:id", axum::routing::put(put_plan))
        .route("/api/cuotas", axum::routing::post(post_cuota))
        .route("/api/cuotas/:id", axum::routing::put(put_cuota))
        .route("/api/obras-sociales", get(get_obras_sociales))
        .with_state(state)
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

    let state = AppState {
        accounts: Arc::new(Mutex::new(accounts)),
        data_dir: data_dir.clone(),
        sessions: Arc::new(Mutex::new(HashMap::new())),
        login_attempts: Arc::new(Mutex::new(HashMap::new())),
    };

    let app = build_router(state);

    let rt = tokio::runtime::Runtime::new().expect("runtime");
    rt.block_on(async {
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

#[cfg(test)]
mod tests {
    use std::env;
    use std::fs;
    use std::sync::{Arc, Mutex};
    use std::sync::atomic::AtomicUsize;
    use serde_json;

    use tower::ServiceExt;
    use axum::body::{Body, to_bytes};
    use axum::http::{StatusCode, header, Request, Method};

    use super::*;

    /// Construye un router de prueba con las cuentas dadas y SANATORIO_DATA_DIR
    /// apuntando a un directorio temporal. Retorna (Router, temp_dir).
    fn build_test_router(accounts: Vec<Account>) -> (Router, std::path::PathBuf) {
        let _guard = crate::core::db::TEST_MUTEX.lock().unwrap();
        let temp_dir = std::env::temp_dir().join(format!("sanatorio_it_{}", COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst)));
        fs::create_dir_all(&temp_dir).unwrap();

        // Escribir auth-accounts.json con las cuentas dadas
        let accounts_json = serde_json::to_string_pretty(&accounts).unwrap();
        let accounts_path = temp_dir.join("auth-accounts.json");
        fs::write(&accounts_path, accounts_json).unwrap();

        // Configurar SANATORIO_DATA_DIR
        let _orig = env::var("SANATORIO_DATA_DIR").ok();
        env::set_var("SANATORIO_DATA_DIR", temp_dir.to_str().unwrap());

        // Inicializar SQLite (aplica migraciones)
        service::ensure_initialized().unwrap();

        // Cargar cuentas
        let loaded = load_accounts(&temp_dir);

        let state = AppState {
            accounts: Arc::new(Mutex::new(loaded)),
            data_dir: temp_dir.clone(),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            login_attempts: Arc::new(Mutex::new(HashMap::new())),
        };

        let app = build_router(state);
        (app, temp_dir)
    }

    /// Helper que crea cuentas, hace login y retorna (token, must_change_password_bool)


    async fn enable_writes(app: &Router, token_admin: &str) -> StatusCode {
        let (status, _) = post_json(app, "/api/write-enabled", r#"{"write_enabled":true}"#, Some(token_admin)).await;
        assert_eq!(status, StatusCode::OK, "enable_writes debe ser 200: {}", status);
        status
    }

    static COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(1);
    async fn post_json(app: &Router, uri: &str, body: &str, auth: Option<&str>) -> (StatusCode, String) {
        let mut request = Request::builder()
            .method(Method::POST)
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap();
        if let Some(token) = auth {
            request.headers_mut().insert(header::AUTHORIZATION, format!("Bearer {}", token).parse().unwrap());
        }
        let response = app.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let body_text = String::from_utf8_lossy(&body_bytes).to_string();
        (status, body_text)
    }

    /// Hace una petición PUT con body JSON y retorna (status, body_text)
    async fn put_json(app: &Router, uri: &str, body: &str, auth: Option<&str>) -> (StatusCode, String) {
        let mut request = Request::builder()
            .method(Method::PUT)
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap();
        if let Some(token) = auth {
            request.headers_mut().insert(header::AUTHORIZATION, format!("Bearer {}", token).parse().unwrap());
        }
        let response = app.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let body_text = String::from_utf8_lossy(&body_bytes).to_string();
        (status, body_text)
    }

    /// Hace una petición GET y retorna (status, body_text)
    async fn get(app: &Router, uri: &str, auth: Option<&str>) -> (StatusCode, String) {
        let mut builder = Request::builder()
            .method(Method::GET)
            .uri(uri);
        if let Some(token) = auth {
            builder = builder.header(header::AUTHORIZATION, format!("Bearer {}", token));
        }
        let request = builder.body(Body::empty()).unwrap();
        let response = app.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let body_text = String::from_utf8_lossy(&body_bytes).to_string();
        (status, body_text)
    }

    #[test]
    fn test_is_valid_role_solo_admin_secretaria_afiliado() {
        assert!(is_valid_role("admin"));
        assert!(is_valid_role("secretaria"));
        assert!(is_valid_role("afiliado"));
        assert!(!is_valid_role("invitado"));
        assert!(!is_valid_role("gerente"));
        assert!(!is_valid_role("ADMIN"));
        assert!(!is_valid_role(""));
        assert!(!is_valid_role("root"));
    }

    #[tokio::test]
    async fn test_admin_must_change_password_bloquea_escritura() {
        let test = TestApp::new(Some(vec![Account {
            username: "Admin".to_string(),
            role: "admin".to_string(),
            display_name: "Admin".to_string(),
            turno: None,
            password: Some("admin123".to_string()),
            password_hash: None,
            password_salt: None,
            must_change_password: true,
        }])).await.unwrap();

        // Login con Admin (debe funcionar, devuelve token)
        let (status, body) = test.post("/api/login", r#"{"username":"Admin","password":"admin123"}"#, None).await;
        assert_eq!(status, StatusCode::OK);
        let login_res: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(login_res["must_change_password"], true);
        let token = login_res["token"].as_str().unwrap();

        // POST /api/afiliados con must_change_password=true -> 403
        let (status, body) = test.post(
            "/api/afiliados",
            &format!(r#"{{"id":"afil-1","nombre":"Test","version":1}}"#),
            Some(&token),
        ).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "Debe ser 403 por must_change_password: {}", body);
    }

    #[tokio::test]
    async fn test_write_enabled_apagado_retorna_403_en_escritura() {
        let test = TestApp::new(Some(vec![Account {
            username: "Admin".to_string(),
            role: "admin".to_string(),
            display_name: "Admin".to_string(),
            turno: None,
            password: Some("admin123".to_string()),
            password_hash: None,
            password_salt: None,
            must_change_password: false,
        }])).await.unwrap();

        // Login
        let (status, body) = test.post("/api/login", r#"{"username":"Admin","password":"admin123"}"#, None).await;
        assert_eq!(status, StatusCode::OK);
        let login_res: serde_json::Value = serde_json::from_str(&body).unwrap();
        let token = login_res["token"].as_str().unwrap();

        // write_enabled debe ser false por defecto -> POST /api/afiliados = 403
        let (status, body) = test.post("/api/afiliados", &format!(r#"{{"id":"afil-1","nombre":"Test","version":1}}"#), Some(token)).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "Debe ser 403 con write_enabled apagado: {}", body);

        // Encender write_enabled
        let status = test.enable_writes(token).await;
        assert_eq!(status, StatusCode::OK, "write_enabled=true debe ser 200: {}", status);

        // Ahora POST /api/afiliados = 200
        let (status, body) = test.post("/api/afiliados", &format!(r#"{{"id":"afil-1","nombre":"Test","version":1}}"#), Some(token)).await;
        assert_eq!(status, StatusCode::OK, "Debe ser 200 con write_enabled encendido: {}", body);
    }

    #[tokio::test]
    async fn test_secretaria_no_puede_escribir_afiliados() {
        let test = TestApp::new(Some(vec![
            Account {
                username: "Admin".to_string(),
                role: "admin".to_string(),
                display_name: "Admin".to_string(),
                turno: None,
                password: Some("admin123".to_string()),
                password_hash: None,
                password_salt: None,
                must_change_password: false,
            },
            Account {
                username: "Mary".to_string(),
                role: "secretaria".to_string(),
                display_name: "Mary".to_string(),
                turno: None,
                password: Some("mary123".to_string()),
                password_hash: None,
                password_salt: None,
                must_change_password: false,
            },
        ])).await.unwrap();

        // Login como secretaria
        let token_mary = test.login_as("secretaria").await;
        let token_admin = test.login_as("admin").await;
        test.enable_writes(&token_admin).await;

        // POST /api/afiliados como secretaria -> 403 (el rol se chequea antes que write_enabled)
        let (status, body) = test.post("/api/afiliados", r#"{"id":"afil-1","nombre":"Test","version":1}"#, Some(&token_mary)).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "Secretaria no puede escribir afiliados: {}", body);

        // Verificar entrada PERMISO_DENEGADO en audit-log
        let (status, body) = test.get("/api/audit-log", Some(&token_admin)).await;
        assert_eq!(status, StatusCode::OK, "audit-log debe ser accesible por admin: {}", status);
        let audit: serde_json::Value = serde_json::from_str(&body).unwrap();
        let entries = audit.as_array().unwrap();
        let tiene_permiso_denegado = entries.iter().any(|e| {
            e.get("accion").and_then(|v| v.as_str()) == Some("PERMISO_DENEGADO")
                && e.get("usuario").and_then(|v| v.as_str()) == Some("Mary")
        });
        assert!(
            tiene_permiso_denegado,
            "Debe haber entrada PERMISO_DENEGADO para Mary en audit-log"
        );
    }

    #[tokio::test]
    async fn test_afiliado_y_admin_pueden_escribir_afiliados() {
        let test = TestApp::new(Some(vec![
            Account {
                username: "Admin".to_string(),
                role: "admin".to_string(),
                display_name: "Admin".to_string(),
                turno: None,
                password: Some("admin123".to_string()),
                password_hash: None,
                password_salt: None,
                must_change_password: false,
            },
            Account {
                username: "Afiliado1".to_string(),
                role: "afiliado".to_string(),
                display_name: "Afiliado1".to_string(),
                turno: None,
                password: Some("afi123".to_string()),
                password_hash: None,
                password_salt: None,
                must_change_password: false,
            },
        ])).await.unwrap();

        let token_admin = test.login_as("admin").await;
        test.enable_writes(&token_admin).await;

        let (status, body) = test.post("/api/afiliados", &format!(r#"{{"id":"afil-1","nombre":"Juan","version":1}}"#), Some(&token_admin)).await;
        assert_eq!(status, StatusCode::OK, "Admin puede escribir afiliados: {} body={}", status, body);

        let token_afiliado = test.login_as("afiliado").await;
        let (status, _) = test.post("/api/afiliados", &format!(r#"{{"id":"afil-2","nombre":"Ana","version":1}}"#), Some(&token_afiliado)).await;
        assert_eq!(status, StatusCode::OK, "Afiliado puede escribir afiliados: {}", status);

        let (status, _) = test.post("/api/afiliados", &format!(r#"{{"id":"afil-3","nombre":"Pedro","version":1}}"#), Some(&token_admin)).await;
        assert_eq!(status, StatusCode::OK, "Admin puede escribir afiliados tras afiliado: {}", status);
    }

    #[tokio::test]
    async fn test_afiliado_no_puede_cambiar_write_enabled() {
        let test = TestApp::new(Some(vec![Account {
            username: "Afiliado1".to_string(),
            role: "afiliado".to_string(),
            display_name: "Afiliado1".to_string(),
            turno: None,
            password: Some("afi123".to_string()),
            password_hash: None,
            password_salt: None,
            must_change_password: false,
        }])).await.unwrap();

        let token = test.login_as("afiliado").await;
        let (status, body) = test.post("/api/write-enabled", r#"{"write_enabled":true}"#, Some(&token)).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "Afiliado no debe cambiar write_enabled: {}", body);
    }

    #[tokio::test]
    async fn test_write_enabled_persistencia_minima() {
        let test = TestApp::new(Some(vec![Account {
            username: "Admin".to_string(),
            role: "admin".to_string(),
            display_name: "Admin".to_string(),
            turno: None,
            password: Some("admin123".to_string()),
            password_hash: None,
            password_salt: None,
            must_change_password: false,
        }])).await.unwrap();

        let token = test.login_as("admin").await;

        // 1. POST write_enabled {true}
        let (status, body) = test.post("/api/write-enabled", r#"{"write_enabled":true}"#, Some(&token)).await;
        assert_eq!(status, StatusCode::OK, "POST write_enabled: {}", body);

        // 2. GET write_enabled -> debe ser true
        let (status, body) = test.get("/api/write-enabled", Some(&token)).await;
        assert_eq!(status, StatusCode::OK, "GET write_enabled debe ser 200: {}", body);
        let resp: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(resp["write_enabled"], true, "write_enabled debe persistir como true");

        drop(test);
    }

    #[tokio::test]
    async fn test_put_afiliado_version_vieja_retorna_409() {
        let test = TestApp::new(Some(vec![Account {
            username: "Admin".to_string(),
            role: "admin".to_string(),
            display_name: "Admin".to_string(),
            turno: None,
            password: Some("admin123".to_string()),
            password_hash: None,
            password_salt: None,
            must_change_password: false,
        }])).await.unwrap();

        let login_token = test.login_as("admin").await;
        test.enable_writes(&login_token).await;

        // Crear afiliado con versión 1
        let (status, _) = test.post("/api/afiliados", &format!(r#"{{"id":"afil-1","nombre":"Juan","version":1}}"#), Some(&login_token)).await;
        assert_eq!(status, StatusCode::OK);

        // PUT con versión correcta -> debería actualizar a versión 2
        let (status, body) = test.put("/api/afiliados/afil-1", &format!(r#"{{"id":"afil-1","nombre":"Juan Modificado","version":1}}"#), Some(&login_token)).await;
        assert_eq!(status, StatusCode::OK, "PUT con versión correcta debe ser 200: {}", body);

        // PUT con versión 1 (ya es 2) -> 409
        let (status, body) = test.put("/api/afiliados/afil-1", &format!(r#"{{"id":"afil-1","nombre":"Juan Conflicto","version":1}}"#), Some(&login_token)).await;
        assert_eq!(status, StatusCode::CONFLICT, "PUT con versión vieja debe ser 409: {}", body);
        let resp: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(resp["error"], "conflict");
        assert_eq!(resp["current"]["version"], 2);

        drop(test);
    }

    #[tokio::test]
    async fn test_put_plan_version_vieja_retorna_409() {
        let test = TestApp::new(Some(vec![Account {
            username: "Admin".to_string(),
            role: "admin".to_string(),
            display_name: "Admin".to_string(),
            turno: None,
            password: Some("admin123".to_string()),
            password_hash: None,
            password_salt: None,
            must_change_password: false,
        }])).await.unwrap();

        let login_token = test.login_as("admin").await;
        test.enable_writes(&login_token).await;

        // Crear plan con versión 1
        let (status, _) = test.post("/api/planes", &format!(r#"{{"id":"plan-1","nombre":"Plan Oro","version":1}}"#), Some(&login_token)).await;
        assert_eq!(status, StatusCode::OK);

        // PUT con versión 1 (correcto) -> debería actualizar a versión 2
        let (status, body) = test.put("/api/planes/plan-1", &format!(r#"{{"id":"plan-1","nombre":"Plan Oro Modificado","version":1}}"#), Some(&login_token)).await;
        assert_eq!(status, StatusCode::OK, "PUT con versión correcta debe ser 200: {}", body);

        // PUT con versión 1 (ya es 2) -> 409
        let (status, body) = test.put("/api/planes/plan-1", &format!(r#"{{"id":"plan-1","nombre":"Plan Oro Conflicto","version":1}}"#), Some(&login_token)).await;
        assert_eq!(status, StatusCode::CONFLICT, "PUT plan con versión vieja debe ser 409: {}", body);
        let resp: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(resp["error"], "conflict");
        assert_eq!(resp["current"]["version"], 2);

        drop(test);
    }

    #[tokio::test]
    async fn test_put_cuota_version_vieja_retorna_409() {
        let test = TestApp::new(Some(vec![Account {
            username: "Admin".to_string(),
            role: "admin".to_string(),
            display_name: "Admin".to_string(),
            turno: None,
            password: Some("admin123".to_string()),
            password_hash: None,
            password_salt: None,
            must_change_password: false,
        }])).await.unwrap();

        let login_token = test.login_as("admin").await;
        test.enable_writes(&login_token).await;

        // Crear cuota con versión 1
        let (status, _) = test.post("/api/cuotas", &format!(r#"{{"id":"cuota-1","monto":100.0,"version":1}}"#), Some(&login_token)).await;
        assert_eq!(status, StatusCode::OK);

        // PUT con versión 1 (correcto) -> debería actualizar a versión 2
        let (status, body) = test.put("/api/cuotas/cuota-1", &format!(r#"{{"id":"cuota-1","monto":150.0,"version":1}}"#), Some(&login_token)).await;
        assert_eq!(status, StatusCode::OK, "PUT con versión correcta debe ser 200: {}", body);

        // PUT con versión 1 (ya es 2) -> 409
        let (status, body) = test.put("/api/cuotas/cuota-1", &format!(r#"{{"id":"cuota-1","monto":200.0,"version":1}}"#), Some(&login_token)).await;
        assert_eq!(status, StatusCode::CONFLICT, "PUT cuota con versión vieja debe ser 409: {}", body);
        let resp: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(resp["error"], "conflict");
        assert_eq!(resp["current"]["version"], 2);

        drop(test);
    }

    #[tokio::test]
    async fn test_post_afiliado_id_existente_no_pisa() {
        let test = TestApp::new(Some(vec![Account {
            username: "Admin".to_string(),
            role: "admin".to_string(),
            display_name: "Admin".to_string(),
            turno: None,
            password: Some("admin123".to_string()),
            password_hash: None,
            password_salt: None,
            must_change_password: false,
        }])).await.unwrap();

        let login_token = test.login_as("admin").await;
        test.enable_writes(&login_token).await;

        // Crear afiliado con versión 1
        let (status, _) = test.post("/api/afiliados", &format!(r#"{{"id":"afil-1","nombre":"Juan","version":1}}"#), Some(&login_token)).await;
        assert_eq!(status, StatusCode::OK);

        // PUT con versión 1 (correcto) -> debería actualizar a versión 2
        let (status, body) = test.put("/api/afiliados/afil-1", &format!(r#"{{"id":"afil-1","nombre":"Juan Modificado","version":1}}"#), Some(&login_token)).await;
        assert_eq!(status, StatusCode::OK, "PUT con versión correcta debe ser 200: {}", body);

        // POST con mismo id y versión 1 (no coincide con versión actual 2) -> 409
        let (status, body) = test.post("/api/afiliados", &format!(r#"{{"id":"afil-1","nombre":"Duplicado","version":1}}"#), Some(&login_token)).await;
        assert_eq!(status, StatusCode::CONFLICT, "POST con id existente y versión vieja debe ser 409: {}", body);
        let resp: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(resp["error"], "conflict");
        assert_eq!(resp["current"]["id"], "afil-1");

        drop(test);
    }

    #[tokio::test]
    async fn test_cuerpo_mal_formado_retorna_400() {
        let test = TestApp::new(Some(vec![Account {
            username: "Admin".to_string(),
            role: "admin".to_string(),
            display_name: "Admin".to_string(),
            turno: None,
            password: Some("admin123".to_string()),
            password_hash: None,
            password_salt: None,
            must_change_password: false,
        }])).await.unwrap();

        let (_, body) = test.post("/api/login", r#"{"username":"Admin","password":"admin123"}"#, None).await;
        let token: String = serde_json::from_str::<serde_json::Value>(&body)
            .unwrap()["token"].as_str().unwrap().to_string();

        // Cuerpo no es JSON válido
        let (status, _) = test.post("/api/afiliados", "esto no es json", Some(&token)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "Cuerpo mal formado debe ser 400");
    }

    #[tokio::test]
    async fn test_rol_invalido_no_tiene_acceso() {
        let test = TestApp::new(Some(vec![Account {
            username: "Invalido".to_string(),
            role: "invitado".to_string(),
            display_name: "Invitado".to_string(),
            turno: None,
            password: Some("inv123".to_string()),
            password_hash: None,
            password_salt: None,
            must_change_password: false,
        }])).await.unwrap();

        // Login con rol invitado -> 403
        let (status, body) = test.post("/api/login", r#"{"username":"Invalido","password":"inv123"}"#, None).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "Rol inválido no debe poder iniciar sesión: {}", body);
    }

    #[tokio::test]
    async fn test_audit_log_solo_admin_y_con_entradas() {
        let test = TestApp::new(Some(vec![
            Account {
                username: "Admin".to_string(),
                role: "admin".to_string(),
                display_name: "Admin".to_string(),
                turno: None,
                password: Some("admin123".to_string()),
                password_hash: None,
                password_salt: None,
                must_change_password: false,
            },
            Account {
                username: "Afiliado1".to_string(),
                role: "afiliado".to_string(),
                display_name: "Afiliado1".to_string(),
                turno: None,
                password: Some("afi123".to_string()),
                password_hash: None,
                password_salt: None,
                must_change_password: false,
            },
        ])).await.unwrap();

        let token_admin = test.login_as("admin").await;
        let token_afiliado = test.login_as("afiliado").await;
        test.enable_writes(&token_admin).await;

        // Afiliado escribe afiliados (tiene permiso) -> crea entrada en auditoría
        let (status, _) = test.post("/api/afiliados", &format!(r#"{{"id":"afil-1","nombre":"Test","version":1}}"#), Some(&token_afiliado)).await;
        assert_eq!(status, StatusCode::OK, "afiliado crea afiliado: {}", status);

        // Afiliado intenta cambiar write-enabled (no tiene permiso) -> PERMISO_DENEGADO
        let (status, _) = test.post("/api/write-enabled", r#"{"write_enabled":true}"#, Some(&token_afiliado)).await;
        assert_eq!(status, StatusCode::FORBIDDEN);

        // Admin obtiene audit-log
        let (status, body) = test.get("/api/audit-log", Some(&token_admin)).await;
        assert_eq!(status, StatusCode::OK, "admin debe leer audit-log: {}", status);
        let audit: serde_json::Value = serde_json::from_str(&body).unwrap();
        let entries = audit.as_array().unwrap();

        assert!(
            entradas_contienen(&entries, "LOGIN_OK"),
            "Debe haber entrada LOGIN_OK en audit-log"
        );
        assert!(
            entradas_contienen(&entries, "CREATE_AFILIADO"),
            "Debe haber entrada CREATE_AFILIADO en audit-log"
        );
        assert!(
            entradas_contienen(&entries, "PERMISO_DENEGADO"),
            "Debe haber entrada PERMISO_DENEGADO en audit-log"
        );

        // Afiliado NO puede leer audit-log
        let (status, _) = test.get("/api/audit-log", Some(&token_afiliado)).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "Afiliado no puede leer audit-log: {}", status);

        drop(test);
    }

#[tokio::test]
    async fn test_secretaria_post_afiliados_write_disabled_retorna_role_forbidden() {
        let test = TestApp::new(Some(vec![
            Account {
                username: "Admin".to_string(),
                role: "admin".to_string(),
                display_name: "Admin".to_string(),
                turno: None,
                password: Some("admin123".to_string()),
                password_hash: None,
                password_salt: None,
                must_change_password: false,
            },
            Account {
                username: "Mary".to_string(),
                role: "secretaria".to_string(),
                display_name: "Mary".to_string(),
                turno: None,
                password: Some("mary123".to_string()),
                password_hash: None,
                password_salt: None,
                must_change_password: false,
            },
        ])).await.unwrap();

        let token_mary = test.login_as("secretaria").await;
        let token_admin = test.login_as("admin").await;

        // POST /api/afiliados como secretaria con write_enabled APAGADO -> 403 role_forbidden
        let (status, body) = test.post("/api/afiliados", r#"{"id":"afil-1","nombre":"Test","version":1}"#, Some(&token_mary)).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "Secretaria no puede escribir afiliados: {}", body);
        let resp: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(resp["error"], "role_forbidden");

        // Verificar entrada PERMISO_DENEGADO en audit-log
        let (status, body) = test.get("/api/audit-log", Some(&token_admin)).await;
        assert_eq!(status, StatusCode::OK, "audit-log debe ser accesible por admin: {}", status);
        let audit: serde_json::Value = serde_json::from_str(&body).unwrap();
        let entries = audit.as_array().unwrap();
        let tiene_permiso_denegado = entries.iter().any(|e| {
            e.get("accion").and_then(|v| v.as_str()) == Some("PERMISO_DENEGADO")
                && e.get("usuario").and_then(|v| v.as_str()) == Some("Mary")
        });
        assert!(
            tiene_permiso_denegado,
            "Debe haber entrada PERMISO_DENEGADO para Mary en audit-log"
        );

        drop(test);
    }

    #[tokio::test]
    async fn test_admin_post_afiliados_write_disabled_retorna_writes_disabled() {
        let test = TestApp::new(Some(vec![Account {
            username: "Admin".to_string(),
            role: "admin".to_string(),
            display_name: "Admin".to_string(),
            turno: None,
            password: Some("admin123".to_string()),
            password_hash: None,
            password_salt: None,
            must_change_password: false,
        }])).await.unwrap();

        let token_admin = test.login_as("admin").await;

        // POST /api/afiliados como admin con write_enabled APAGADO -> 403 writes_disabled
        let (status, body) = test.post("/api/afiliados", r#"{"id":"afil-1","nombre":"Test","version":1}"#, Some(&token_admin)).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "Admin no puede escribir con write_enabled apagado: {}", body);
        let resp: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(resp["error"], "writes_disabled");

        drop(test);
    }

    fn entradas_contienen(entries: &[serde_json::Value], accion: &str) -> bool {
        entries.iter().any(|e| e.get("accion").and_then(|v| v.as_str()) == Some(accion))
    }

    /// Cuenta de prueba con los datos que espera `login_as`.
    fn account(username: &str, role: &str, password: &str) -> Account {
        Account {
            username: username.to_string(),
            role: role.to_string(),
            display_name: username.to_string(),
            turno: None,
            password: Some(password.to_string()),
            password_hash: None,
            password_salt: None,
            must_change_password: false,
        }
    }

    /// Admin + secretaria + afiliado con las credenciales estándar de `login_as`.
    fn cuentas_estandar() -> Vec<Account> {
        vec![
            account("Admin", "admin", "admin123"),
            account("Mary", "secretaria", "mary123"),
            account("Afiliado1", "afiliado", "afi123"),
        ]
    }

    /// Struct de ayuda que encapsula: Mutex global, carpeta temporal única con
    /// contador atómico, router de prueba y métodos de helper con auth Bearer.
    /// Se usa así:
    ///   let test = TestApp::new().await;
    ///   let token = test.login("admin").await;
    ///   test.enable_writes(&token).await;
    ///   let (status, body) = test.post("/api/afiliados", &json!, Some(&token)).await;
    ///   drop(test); // restaura SANATORIO_DATA_DIR y borra la carpeta
    pub struct TestApp {
        mutex: Arc<Mutex<()>>,
        _guard: std::sync::MutexGuard<'static, ()>,
        counter: usize,
        data_dir: std::path::PathBuf,
        router: Router,
        accounts: Arc<Mutex<Vec<Account>>>,
        _phantom: std::marker::PhantomData<()>,
    }

    impl TestApp {
        pub async fn new(accounts: Option<Vec<Account>>) -> Result<Self, String> {
            let guard = crate::core::db::TEST_MUTEX.lock().unwrap_or_else(|e| e.into_inner());
            let counter = COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let data_dir = std::env::temp_dir().join(format!("sanatorio_it_{}", counter));
            fs::create_dir_all(&data_dir).map_err(|e| format!("No se pudo crear temp dir: {e}"))?;

            // Si se proporcionaron cuentas, escribirlas en el archivo de configuración
            if let Some(ref accounts) = accounts {
                let raw = serde_json::to_string_pretty(accounts).unwrap();
                let _ = fs::write(data_dir.join("auth-accounts.json"), raw);
            }

            // Configurar SANATORIO_DATA_DIR para este test
            let _orig = env::var("SANATORIO_DATA_DIR").ok();
            env::set_var("SANATORIO_DATA_DIR", data_dir.to_str().unwrap());

            // Inicializar SQLite
            service::ensure_initialized().map_err(|e| format!("init SQLite: {e}"))?;

            // Cargar cuentas
            let loaded = load_accounts(&data_dir);
            let accounts = Arc::new(Mutex::new(loaded));

            let state = AppState {
                accounts: accounts.clone(),
                data_dir: data_dir.clone(),
                sessions: Arc::new(Mutex::new(HashMap::new())),
                login_attempts: Arc::new(Mutex::new(HashMap::new())),
            };

            let router = build_router(state);

            Ok(TestApp {
                mutex: Arc::new(std::sync::Mutex::new(())),
                _guard: guard,
                counter,
                data_dir,
                router,
                accounts,
                _phantom: std::marker::PhantomData,
            })
        }

        pub async fn login_as(&self, rol: &str) -> String {
            let accounts = self.accounts.lock().unwrap();
            let account_exists = accounts.iter().any(|a| a.role.eq_ignore_ascii_case(rol));
            drop(accounts);

            if !account_exists {
                eprintln!("[TestApp] Account role='{}' not found", rol);
                return String::new();
            }

            // Credenciales según rol
            let (username, password): (&str, &str) = match rol {
                "admin" => ("Admin", "admin123"),
                "afiliado" => ("Afiliado1", "afi123"),
                "secretaria" => ("Mary", "mary123"),
                _ => ("", ""),
            };

            let (status, body) = post_json(
                &self.router,
                "/api/login",
                &format!(r#"{{"username":"{}","password":"{}"}}"#, username, password),
                None,
            )
            .await;

            if status == StatusCode::OK {
                let res: serde_json::Value = serde_json::from_str(&body).unwrap();
                res["token"].as_str().unwrap_or("").to_string()
            } else {
                String::new()
            }
        }

        pub async fn enable_writes(&self, token: &str) -> StatusCode {
            let (status, _) = post_json(
                &self.router,
                "/api/write-enabled",
                r#"{"write_enabled":true}"#,
                Some(token),
            )
            .await;
            status
        }

        pub async fn get(&self, uri: &str, token: Option<&str>) -> (StatusCode, String) {
            get(&self.router, uri, token).await
        }

        pub async fn post(&self, uri: &str, body: &str, token: Option<&str>) -> (StatusCode, String) {
            post_json(&self.router, uri, body, token).await
        }

        pub async fn put(&self, uri: &str, body: &str, token: Option<&str>) -> (StatusCode, String) {
            put_json(&self.router, uri, body, token).await
        }
    }

    impl Drop for TestApp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.data_dir);
            let _ = env::remove_var("SANATORIO_DATA_DIR");
        }
    }

    #[tokio::test]
    async fn test_post_paciente_secretaria_crea_y_get_lo_lista() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        let token_admin = test.login_as("admin").await;
        let token_mary = test.login_as("secretaria").await;
        test.enable_writes(&token_admin).await;

        let (status, body) = test
            .post(
                "/api/pacientes",
                r#"{"id":"pac-1","nombre":"Ana","apellido":"Perez","dni":"12345678"}"#,
                Some(&token_mary),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "secretaria crea paciente: {}", body);
        let resp: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(resp["id"], "pac-1");
        assert_eq!(resp["version"], 1);

        let (status, body) = test.get("/api/pacientes", Some(&token_mary)).await;
        assert_eq!(status, StatusCode::OK, "GET pacientes: {}", body);
        let lista: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert!(
            lista.as_array().unwrap().iter().any(|p| p["id"] == "pac-1"),
            "el paciente creado debe aparecer en el GET"
        );

        let (status, body) = test.get("/api/audit-log", Some(&token_admin)).await;
        assert_eq!(status, StatusCode::OK, "audit-log: {}", body);
        let audit: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert!(
            entradas_contienen(audit.as_array().unwrap(), "CREATE_PACIENTE"),
            "debe quedar CREATE_PACIENTE en audit_log"
        );

        drop(test);
    }

    #[tokio::test]
    async fn test_post_paciente_id_repetido_retorna_409() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        let token = test.login_as("admin").await;
        test.enable_writes(&token).await;

        let (status, body) = test
            .post(
                "/api/pacientes",
                r#"{"id":"pac-dup","nombre":"Ana","apellido":"Perez"}"#,
                Some(&token),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "primer POST: {}", body);

        let (status, body) = test
            .post(
                "/api/pacientes",
                r#"{"id":"pac-dup","nombre":"Otra","apellido":"Persona"}"#,
                Some(&token),
            )
            .await;
        assert_eq!(
            status,
            StatusCode::CONFLICT,
            "id repetido debe ser 409: {}",
            body
        );
        let resp: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(resp["error"], "conflict");
        assert_eq!(resp["current"]["id"], "pac-dup");
        assert_eq!(resp["current"]["nombre"], "Ana");
        assert_eq!(resp["current"]["version"], 1);

        drop(test);
    }

    #[tokio::test]
    async fn test_post_paciente_campos_vacios_retorna_400() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        let token = test.login_as("admin").await;
        test.enable_writes(&token).await;

        let casos = [
            r#"{"id":"   ","nombre":"Ana","apellido":"Perez"}"#,
            r#"{"id":"pac-x","nombre":"   ","apellido":"Perez"}"#,
            r#"{"id":"pac-y","nombre":"Ana","apellido":"   "}"#,
        ];
        for body in casos {
            let (status, resp) = test.post("/api/pacientes", body, Some(&token)).await;
            assert_eq!(
                status,
                StatusCode::BAD_REQUEST,
                "campos vacíos deben ser 400. body={} resp={}",
                body,
                resp
            );
            let json: serde_json::Value = serde_json::from_str(&resp).unwrap();
            assert_eq!(json["error"], "validation", "body={} resp={}", body, resp);
        }

        // Ninguno de los tres casos debe haber creado un paciente.
        let (_, body) = test.get("/api/pacientes", Some(&token)).await;
        let lista: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert!(
            lista.as_array().unwrap().is_empty(),
            "no debe crearse ningún paciente: {}",
            body
        );

        drop(test);
    }

    #[tokio::test]
    async fn test_afiliado_post_put_baja_pacientes_role_forbidden() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        let token_admin = test.login_as("admin").await;
        let token_afiliado = test.login_as("afiliado").await;
        test.enable_writes(&token_admin).await;

        let (status, body) = test
            .post(
                "/api/pacientes",
                r#"{"id":"pac-1","nombre":"Ana","apellido":"Perez"}"#,
                Some(&token_admin),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "admin crea paciente: {}", body);

        let (status, body) = test
            .post(
                "/api/pacientes",
                r#"{"id":"pac-2","nombre":"Beto","apellido":"Gomez"}"#,
                Some(&token_afiliado),
            )
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "afiliado POST: {}", body);
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["error"], "role_forbidden");

        let (status, body) = test
            .put(
                "/api/pacientes/pac-1",
                r#"{"id":"pac-1","nombre":"Editado","apellido":"Perez","version":1}"#,
                Some(&token_afiliado),
            )
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "afiliado PUT: {}", body);
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["error"], "role_forbidden");

        let (status, body) = test
            .post(
                "/api/pacientes/pac-1/baja",
                r#"{"version":1}"#,
                Some(&token_afiliado),
            )
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "afiliado baja: {}", body);
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["error"], "role_forbidden");

        let (status, body) = test.get("/api/audit-log", Some(&token_admin)).await;
        assert_eq!(status, StatusCode::OK, "audit-log: {}", body);
        let audit: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert!(
            entradas_contienen(audit.as_array().unwrap(), "PERMISO_DENEGADO"),
            "debe quedar PERMISO_DENEGADO en audit_log"
        );

        // El paciente no se modificó ni se dio de baja.
        let (_, body) = test.get("/api/pacientes", Some(&token_admin)).await;
        let lista: serde_json::Value = serde_json::from_str(&body).unwrap();
        let p = lista
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == "pac-1")
            .expect("pac-1 debe seguir existiendo");
        assert_eq!(p["nombre"], "Ana");
        assert!(p["deletedAt"].is_null());

        drop(test);
    }

    #[tokio::test]
    async fn test_afiliado_write_disabled_sigue_role_forbidden() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        let token_afiliado = test.login_as("afiliado").await;
        // A propósito NO se habilitan las escrituras: el rol debe chequearse primero.

        let (status, body) = test
            .post(
                "/api/pacientes",
                r#"{"id":"pac-1","nombre":"Ana","apellido":"Perez"}"#,
                Some(&token_afiliado),
            )
            .await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "afiliado con writes off debe ser 403: {}",
            body
        );
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(
            json["error"], "role_forbidden",
            "el rol se chequea antes que write_enabled: {}",
            body
        );

        drop(test);
    }

    #[tokio::test]
    async fn test_sin_token_body_invalido_retorna_401() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();

        let (status, body) = test.post("/api/pacientes", "esto no es json", None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "POST sin token: {}", body);
        let (status, body) = test
            .put("/api/pacientes/pac-1", "esto no es json", None)
            .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "PUT sin token: {}", body);
        let (status, body) = test
            .post("/api/pacientes/pac-1/baja", "esto no es json", None)
            .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "baja sin token: {}", body);

        drop(test);
    }

    #[tokio::test]
    async fn test_secretaria_write_disabled_retorna_writes_disabled() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        let token = test.login_as("secretaria").await;
        // writes desactivadas por defecto.

        let (status, body) = test
            .post(
                "/api/pacientes",
                r#"{"id":"pac-1","nombre":"Ana","apellido":"Perez"}"#,
                Some(&token),
            )
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "POST: {}", body);
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["error"], "writes_disabled");

        let (status, body) = test
            .put(
                "/api/pacientes/pac-1",
                r#"{"id":"pac-1","nombre":"Ana","apellido":"Perez","version":1}"#,
                Some(&token),
            )
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "PUT: {}", body);
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["error"], "writes_disabled");

        // El rol se chequea antes que write_enabled: secretaria no puede dar de baja.
        let (status, body) = test
            .post("/api/pacientes/pac-1/baja", r#"{"version":1}"#, Some(&token))
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "baja secretaria: {}", body);
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["error"], "role_forbidden");

        // Admin sí puede dar de baja: con writes apagadas da writes_disabled.
        let token_admin = test.login_as("admin").await;
        let (status, body) = test
            .post(
                "/api/pacientes/pac-1/baja",
                r#"{"version":1}"#,
                Some(&token_admin),
            )
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "baja admin: {}", body);
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["error"], "writes_disabled");

        drop(test);
    }

    #[tokio::test]
    async fn test_must_change_password_bloquea_pacientes() {
        let mut admin = account("Admin", "admin", "admin123");
        admin.must_change_password = true;
        let test = TestApp::new(Some(vec![admin])).await.unwrap();
        let token = test.login_as("admin").await;

        let (status, body) = test
            .post(
                "/api/pacientes",
                r#"{"id":"pac-1","nombre":"Ana","apellido":"Perez"}"#,
                Some(&token),
            )
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "POST: {}", body);
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["error"], "must_change_password");

        let (status, body) = test
            .put(
                "/api/pacientes/pac-1",
                r#"{"id":"pac-1","nombre":"Ana","apellido":"Perez","version":1}"#,
                Some(&token),
            )
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "PUT: {}", body);
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["error"], "must_change_password");

        let (status, body) = test
            .post("/api/pacientes/pac-1/baja", r#"{"version":1}"#, Some(&token))
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "baja: {}", body);
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["error"], "must_change_password");

        drop(test);
    }

    #[tokio::test]
    async fn test_body_invalido_retorna_400_nunca_422() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        let token = test.login_as("admin").await;
        test.enable_writes(&token).await;

        let (status, body) = test
            .post("/api/pacientes", "esto no es json", Some(&token))
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "POST JSON inválido: {}", body);
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["error"], "validation");

        let (status, body) = test
            .put("/api/pacientes/pac-1", "esto no es json", Some(&token))
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "PUT JSON inválido: {}", body);
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["error"], "validation");

        let (status, body) = test
            .post("/api/pacientes/pac-1/baja", "esto no es json", Some(&token))
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "baja JSON inválido: {}", body);
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["error"], "validation");

        // Body válido pero sin "id" -> 400 (nunca 422).
        let (status, body) = test
            .post(
                "/api/pacientes",
                r#"{"nombre":"Ana","apellido":"Perez"}"#,
                Some(&token),
            )
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "POST sin id: {}", body);
        assert_ne!(status, StatusCode::UNPROCESSABLE_ENTITY);
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["error"], "validation");

        drop(test);
    }

    #[tokio::test]
    async fn test_post_paciente_body_grande_retorna_413() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        let token = test.login_as("admin").await;
        test.enable_writes(&token).await;

        let grande = "a".repeat(70 * 1024);
        let body = format!(
            r#"{{"id":"pac-big","nombre":"{}","apellido":"Perez"}}"#,
            grande
        );
        assert!(body.len() > 64 * 1024);

        let (status, resp) = test.post("/api/pacientes", &body, Some(&token)).await;
        assert_eq!(
            status,
            StatusCode::PAYLOAD_TOO_LARGE,
            "un body > 64 KB debe dar 413: {}",
            resp
        );

        drop(test);
    }

    #[tokio::test]
    async fn test_put_paciente_reemplaza_columnas_y_audita() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        let token_admin = test.login_as("admin").await;
        let token_mary = test.login_as("secretaria").await;
        test.enable_writes(&token_admin).await;

        let (status, body) = test
            .post(
                "/api/pacientes",
                r#"{"id":"pac-put","nombre":"Ana","apellido":"Perez","dni":"11111111","telefono":"111","email":"ana@old.com","domicilio":"Calle 1","localidad":"La Plata","fechaNacimiento":"1980-01-01","obraSocial":"OSDE","notas":"nota vieja","activo":true}"#,
                Some(&token_admin),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "POST inicial: {}", body);

        let (status, body) = test
            .put(
                "/api/pacientes/pac-put",
                r#"{"id":"pac-put","nombre":"Ana Maria","apellido":"Perez Diaz","dni":"22222222","telefono":"222","email":"ana@new.com","domicilio":"Calle 2","localidad":"Berisso","fechaNacimiento":"1990-02-02","obraSocial":"IOMA","notas":"nota nueva","activo":false,"version":1}"#,
                Some(&token_mary),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "PUT: {}", body);
        let resp: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(resp["id"], "pac-put");
        assert_eq!(resp["version"], 2);

        let (_, body) = test.get("/api/pacientes", Some(&token_admin)).await;
        let lista: serde_json::Value = serde_json::from_str(&body).unwrap();
        let p = lista
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == "pac-put")
            .expect("pac-put debe seguir existiendo");
        assert_eq!(p["nombre"], "Ana Maria");
        assert_eq!(p["apellido"], "Perez Diaz");
        assert_eq!(p["dni"], "22222222");
        assert_eq!(p["telefono"], "222");
        assert_eq!(p["email"], "ana@new.com");
        assert_eq!(p["domicilio"], "Calle 2");
        assert_eq!(p["localidad"], "Berisso");
        assert_eq!(p["fechaNacimiento"], "1990-02-02");
        assert_eq!(p["obraSocial"], "IOMA");
        assert_eq!(p["notas"], "nota nueva");
        assert_eq!(p["activo"], false);
        assert_eq!(p["version"], 2);

        let (status, body) = test.get("/api/audit-log", Some(&token_admin)).await;
        assert_eq!(status, StatusCode::OK, "audit-log: {}", body);
        let audit: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert!(
            entradas_contienen(audit.as_array().unwrap(), "UPDATE_PACIENTE"),
            "debe quedar UPDATE_PACIENTE en audit_log"
        );

        drop(test);
    }

    #[tokio::test]
    async fn test_put_siguiente_mismo_version_retorna_409() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        let token_admin = test.login_as("admin").await;
        test.enable_writes(&token_admin).await;

        // Crear paciente primero
        let (status, body) = test
            .post(
                "/api/pacientes",
                r#"{"id":"pac-version","nombre":"Primera","apellido":"Versión","dni":"99999999","telefono":"999","email":"v1@test.com","domicilio":"Dir 1","localidad":"Ciudad A","fechaNacimiento":"1980-01-01","obraSocial":"OSDE","notas":"nota 1","activo":true,"version":1}"#,
                Some(&token_admin),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "POST inicial: {}", body);

        // PUT con versión correcta -> debería actualizar a versión 2
        let (status, body) = test
            .put(
                "/api/pacientes/pac-version",
                r#"{"id":"pac-version","nombre":"Editado","apellido":"Versión","dni":"99999999","telefono":"999","email":"v1@test.com","domicilio":"Dir 1","localidad":"Ciudad A","fechaNacimiento":"1980-01-01","obraSocial":"OSDE","notas":"nota editada","activo":true,"version":1}"#,
                Some(&token_admin),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "primer PUT: {}", body);

        // PUT con misma versión (ya es 2) -> 409
        let (status, body) = test
            .put(
                "/api/pacientes/pac-version",
                r#"{"id":"pac-version","nombre":"Editado","apellido":"Versión","dni":"99999999","telefono":"999","email":"v1@test.com","domicilio":"Dir 1","localidad":"Ciudad A","fechaNacimiento":"1980-01-01","obraSocial":"OSDE","notas":"nota editada","activo":true,"version":1}"#,
                Some(&token_admin),
            )
            .await;
        assert_eq!(
            status,
            StatusCode::CONFLICT,
            "segundo PUT misma versión debe ser 409"
        );
        let resp: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(resp["error"], "conflict");
        assert_eq!(resp["current"]["version"], 2);

        drop(test);
    }

    #[tokio::test]
    async fn test_put_sin_version_retorna_400() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        let token_admin = test.login_as("admin").await;
        test.enable_writes(&token_admin).await;

        let (status, body) = test.put("/api/pacientes/pac-sin-ver", r#"{"id":"pac-sin-ver","nombre":"Sin","apellido":"Version","dni":"55555555","telefono":"555","email":"sin@test.com","domicilio":"Dir 5","localidad":"Ciudad E","fechaNacimiento":"1980-01-01","obraSocial":"OSDE","notas":"sin ver"}"#, Some(&token_admin)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "PUT sin version");
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["error"], "validation");
        assert_eq!(json["message"], "version es requerida");

        drop(test);
    }

    #[tokio::test]
    async fn test_put_id_body_distinto_ruta_retorna_400() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        let token_admin = test.login_as("admin").await;
        test.enable_writes(&token_admin).await;

        // Crear paciente primero con POST
        let (status, body) = test.post(
            "/api/pacientes",
            r#"{"id":"pac-distinto","nombre":"Otro","apellido":"Perez","dni":"55555555","telefono":"555","email":"otro@test.com","domicilio":"Dir 5","localidad":"Ciudad E","fechaNacimiento":"1980-01-01","obraSocial":"OSDE","notas":"nota inicial"}"#,
            Some(&token_admin),
        ).await;
        assert_eq!(status, StatusCode::OK, "POST inicial");

        let (status, body) = test.put("/api/pacientes/pac-distinto", r#"{"id":"pac-distinto","nombre":"Otro","apellido":"Perez","version":1}"#, Some(&token_admin)).await;
        assert_eq!(status, StatusCode::OK, "PUT inicial");

        let (status, body) = test.put("/api/pacientes/pac-distinto", r#"{"id":"pac-otro","nombre":"Edita","apellido":"Perez","version":1}"#, Some(&token_admin)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "PUT id!=ruta");
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["error"], "validation");
        assert_eq!(json["message"], "id del body no coincide con el id de la ruta");

        drop(test);
    }

    #[tokio::test]
    async fn test_put_sobre_id_inexistente_retorna_404() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        let token_admin = test.login_as("admin").await;
        test.enable_writes(&token_admin).await;

        let (status, body) = test.put("/api/pacientes/pac-inexistente", r#"{"id":"pac-inexistente","nombre":"Nadie","apellido":"Nadie","version":1}"#, Some(&token_admin)).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "PUT id inexistente");
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["error"], "not_found");

        drop(test);
    }

    #[tokio::test]
    async fn test_put_sin_activo_conserva_activo_falso() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        let token_admin = test.login_as("admin").await;
        test.enable_writes(&token_admin).await;

        let (status, body) = test.post("/api/pacientes", r#"{"id":"pac-activo","nombre":"Juan","apellido":"Perez","dni":"77777777","telefono":"777","email":"juan@test.com","domicilio":"Dir 7","localidad":"Ciudad G","fechaNacimiento":"1980-01-01","obraSocial":"OSDE","notas":"nota inicial","activo":true,"version":1}"#, Some(&token_admin)).await;
        assert_eq!(status, StatusCode::OK, "POST inicial");

        let (status, body) = test.put("/api/pacientes/pac-activo", r#"{"id":"pac-activo","nombre":"Juan","apellido":"Perez","version":1}"#, Some(&token_admin)).await;
        assert_eq!(status, StatusCode::OK, "PUT sin activo");
        let resp: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(resp["version"], 2);

        let (_, body) = test.get("/api/pacientes", Some(&token_admin)).await;
        let lista: serde_json::Value = serde_json::from_str(&body).unwrap();
        let p = lista.as_array().unwrap().iter().find(|p| p["id"] == "pac-activo").expect("pac-activo");
        assert_eq!(p["activo"], true);

        drop(test);
    }

    #[tokio::test]
    async fn test_put_sobre_paciente_version_null_version1_200() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        let token_admin = test.login_as("admin").await;
        test.enable_writes(&token_admin).await;

        let mut conn = db::open_connection().unwrap();
        conn.execute("INSERT INTO patients (id, nombre, apellido, dni, telefono, email, domicilio, localidad, fecha_nacimiento, obra_social, notas, activo, version, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, NULL, NULL)", params!["pac-version-null", "VersionNull", "Apellido", "88888888", "888", "vn@test.com", "Dir 8", "Ciudad H", "1980-01-01", "OSDE", "nota inicial"]).unwrap();
        drop(conn);

        let (status, body) = test.put("/api/pacientes/pac-version-null", r#"{"id":"pac-version-null","nombre":"VersionNull","apellido":"Actualizada","dni":"88888888","telefono":"888","email":"vn@test.com","domicilio":"Dir 8","localidad":"Ciudad H","fechaNacimiento":"1980-01-01","obraSocial":"OSDE","notas":"nota actualizada","version":1}"#, Some(&token_admin)).await;
        assert_eq!(status, StatusCode::OK, "PUT sobre version NULL");
        let resp: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(resp["version"], 2);

        drop(test);
    }
    #[tokio::test]
    async fn test_put_feliz_200_version_y_audita() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        let token_admin = test.login_as("admin").await;
        test.enable_writes(&token_admin).await;

        let (status, body) = test.post(
            "/api/pacientes",
            r#"{"id":"pac-test11","nombre":"Maria","apellido":"Lopez","dni":"12345678","telefono":"444","email":"maria@test.com","domicilio":"Calle Falsa 123","localidad":"Madrid","fechaNacimiento":"1980-01-01","obraSocial":"OSDE","notas":"nota inicial","activo":true,"version":1}"#,
            Some(&token_admin),
        ).await;
        assert_eq!(status, StatusCode::OK, "POST inicial");

        let (status, body) = test.put(
            "/api/pacientes/pac-test11",
            r#"{"id":"pac-test11","nombre":"Maria Actualizada","apellido":"Lopez Diaz","dni":"12345678","telefono":"444","email":"maria@nuevo.com","domicilio":"Calle Real 456","localidad":"Barcelona","fechaNacimiento":"1985-05-15","obraSocial":"IOMA","notas":"nota actualizada","activo":false,"version":1}"#,
            Some(&token_admin),
        ).await;
        assert_eq!(status, StatusCode::OK, "PUT feliz");
        let resp: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(resp["version"], 2);
        assert_eq!(resp["id"], "pac-test11");

        // Verificar en GET
        let (_, body) = test.get("/api/pacientes", Some(&token_admin)).await;
        let lista: serde_json::Value = serde_json::from_str(&body).unwrap();
        let p = lista.as_array().unwrap().iter().find(|p| p["id"] == "pac-test11").expect("pac-test11");
        assert_eq!(p["nombre"], "Maria Actualizada");
        assert_eq!(p["apellido"], "Lopez Diaz");
        assert_eq!(p["activo"], false);

        // Verificar audit log
        let (status, body) = test.get("/api/audit-log", Some(&token_admin)).await;
        assert_eq!(status, StatusCode::OK, "audit-log");
        let audit: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert!(
            entradas_contienen(audit.as_array().unwrap(), "UPDATE_PACIENTE"),
            "debe quedar UPDATE_PACIENTE en audit_log"
        );

        drop(test);
    }
    #[tokio::test]
    async fn test_baja_con_admin_retorna_200_y_filtra_get() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        let token_admin = test.login_as("admin").await;
        test.enable_writes(&token_admin).await;

        let (status, body) = test.post(
            "/api/pacientes",
            r#"{"id":"pac-baja-admin","nombre":"Luis","apellido":"Martinez","dni":"44444444","telefono":"444","email":"luis@test.com","domicilio":"Dir 4","localidad":"Ciudad D","fechaNacimiento":"1980-01-01","obraSocial":"OSDE","notas":"nota inicial","activo":true,"version":1}"#,
            Some(&token_admin),
        ).await;
        assert_eq!(status, StatusCode::OK, "POST inicial");

        let (status, body) = test.post(
            "/api/pacientes/pac-baja-admin/baja",
            r#"{"version":1}"#,
            Some(&token_admin),
        ).await;
        assert_eq!(status, StatusCode::OK, "baja admin");
        let resp: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(resp["version"], 2);
        assert_eq!(resp["id"], "pac-baja-admin");

        // Desaparece del GET
        let (_, body) = test.get("/api/pacientes", Some(&token_admin)).await;
        let lista: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert!(
            !lista.as_array().unwrap().iter().any(|p| p["id"] == "pac-baja-admin"),
            "paciente dado de baja no debe aparecer en GET"
        );

        // Audit log - BAJA_PACIENTE
        let (status, body) = test.get("/api/audit-log", Some(&token_admin)).await;
        assert_eq!(status, StatusCode::OK, "audit-log");
        let audit: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert!(
            entradas_contienen(audit.as_array().unwrap(), "BAJA_PACIENTE"),
            "debe quedar BAJA_PACIENTE en audit_log"
        );

        // Verificar en base: fila sigue existiendo con deleted_at no nulo y version = 2
        let conn = db::open_connection().unwrap();
        let deleted_at: Option<String> = conn.query_row(
            "SELECT deleted_at FROM patients WHERE id = 'pac-baja-admin'",
            [],
            |r| r.get(0),
        ).unwrap();
        assert!(deleted_at.is_some(), "deleted_at debe ser no nulo");
        let version: i32 = conn.query_row(
            "SELECT version FROM patients WHERE id = 'pac-baja-admin'",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(version, 2, "version debe ser 2 (anterior+1)");
        drop(conn);

        drop(test);
    }
    #[tokio::test]
    async fn test_baja_con_secretaria_retorna_403() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        let token_secretaria = test.login_as("secretaria").await;
        let token_admin = test.login_as("admin").await;
        test.enable_writes(&token_admin).await;

        let (status, body) = test.post(
            "/api/pacientes",
            r#"{"id":"pac-baja-secretaria","nombre":"Laura","apellido":"Gomez","dni":"55555555","telefono":"555","email":"laura@test.com","domicilio":"Dir 5","localidad":"Ciudad E","fechaNacimiento":"1980-01-01","obraSocial":"OSDE","notas":"nota inicial","activo":true,"version":1}"#,
            Some(&token_secretaria),
        ).await;
        assert_eq!(status, StatusCode::OK, "secretaria crea");

        let (status, body) = test.post(
            "/api/pacientes/pac-baja-secretaria/baja",
            r#"{"version":1}"#,
            Some(&token_secretaria),
        ).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "baja secretaria");
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["error"], "role_forbidden");

        // Verificar PERMISO_DENEGADO en audit
        let (status, body) = test.get("/api/audit-log", Some(&token_admin)).await;
        assert_eq!(status, StatusCode::OK, "audit-log");
        let audit: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert!(
            entradas_contienen(audit.as_array().unwrap(), "PERMISO_DENEGADO"),
            "debe quedar PERMISO_DENEGADO en audit_log"
        );

        drop(test);
    }
    #[tokio::test]
    async fn test_baja_sin_version_retorna_400_y_404_y_409() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        let token_admin = test.login_as("admin").await;
        test.enable_writes(&token_admin).await;

        let (status, body) = test.post(
            "/api/pacientes",
            r#"{"id":"pac-baja-sv","nombre":"Test","apellido":"User","dni":"66666666","telefono":"666","email":"test@test.com","domicilio":"Dir 6","localidad":"Ciudad F","fechaNacimiento":"1980-01-01","obraSocial":"OSDE","notas":"nota"}"#,
            Some(&token_admin),
        ).await;
        assert_eq!(status, StatusCode::OK, "POST");

        let (status, body) = test.post(
            "/api/pacientes/pac-baja-sv/baja",
            r#"{"dummy":true}"#,
            Some(&token_admin),
        ).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "baja sin version");
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["error"], "validation");
        assert_eq!(json["message"], "version es requerida");

        let (status, body) = test.post(
            "/api/pacientes/pac-inexistente/baja",
            r#"{"version":99}"#,
            Some(&token_admin),
        ).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "baja id inexistente");
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["error"], "not_found");

        let (status, body) = test.post(
            "/api/pacientes",
            r#"{"id":"pac-version-vieja","nombre":"Version","apellido":"Vieja","dni":"99999999","telefono":"999","email":"vv@test.com","domicilio":"Dir 9","localidad":"Ciudad I","fechaNacimiento":"1980-01-01","obraSocial":"OSDE","notas":"nota version vieja","activo":true,"version":1}"#,
            Some(&token_admin),
        ).await;
        assert_eq!(status, StatusCode::OK, "POST pac-version-vieja");

        let (status, body) = test.post(
            "/api/pacientes/pac-version-vieja/baja",
            r#"{"version":1}"#,
            Some(&token_admin),
        ).await;
        assert_eq!(status, StatusCode::OK, "baja version 1 inicial");

        let (status, body) = test.post(
            "/api/pacientes/pac-version-vieja/baja",
            r#"{"version":1}"#,
            Some(&token_admin),
        ).await;
        assert_eq!(status, StatusCode::CONFLICT, "baja version vieja segunda vez");

        drop(test);
    }
    #[tokio::test]
    async fn test_sobre_paciente_dado_de_baja_put_y_post_y_segunda_baja() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        let token_admin = test.login_as("admin").await;
        test.enable_writes(&token_admin).await;

        let (status, _body) = test.post(
            "/api/pacientes",
            r#"{"id":"pac-baja-final","nombre":"Pedro","apellido":"Sanchez","dni":"88888888","telefono":"888","email":"pedro@test.com","domicilio":"Dir 8","localidad":"Ciudad H","fechaNacimiento":"1980-01-01","obraSocial":"OSDE","notas":"nota","activo":true,"version":1}"#,
            Some(&token_admin),
        ).await;
        assert_eq!(status, StatusCode::OK, "POST inicial");

        let (status, _body) = test.post(
            "/api/pacientes/pac-baja-final/baja",
            r#"{"version":1}"#,
            Some(&token_admin),
        ).await;
        assert_eq!(status, StatusCode::OK, "primera baja");

        let (status, body) = test.put(
            "/api/pacientes/pac-baja-final",
            r#"{"id":"pac-baja-final","nombre":"Editado","apellido":"Sanchez","version":2}"#,
            Some(&token_admin),
        ).await;
        assert_eq!(status, StatusCode::CONFLICT, "PUT sobre dado de baja");
        let resp: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(resp["error"], "conflict", "PUT error debe ser conflict");
        assert!(resp["current"]["deletedAt"].is_string(), "PUT current.deletedAt debe ser string");

        let (status, body) = test.post(
            "/api/pacientes",
            r#"{"id":"pac-baja-final","nombre":"Otro","apellido":"Perez"}"#,
            Some(&token_admin),
        ).await;
        assert_eq!(status, StatusCode::CONFLICT, "POST id dado de baja");
        let resp: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(resp["error"], "conflict", "POST error debe ser conflict");
        assert!(resp["current"]["deletedAt"].is_string(), "POST current.deletedAt debe ser string");
        assert_eq!(resp["current"]["version"], 2, "POST current.version debe ser 2");
        assert_eq!(resp["current"]["nombre"], "Pedro", "POST current.nombre debe ser Pedro");

        let (status, body) = test.post(
            "/api/pacientes/pac-baja-final/baja",
            r#"{"version":2}"#,
            Some(&token_admin),
        ).await;
        assert_eq!(status, StatusCode::CONFLICT, "segunda baja");
        let resp: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(resp["error"], "conflict", "segunda baja error debe ser conflict");
        if let Some(current) = resp.get("current") {
            assert!(current["deletedAt"].is_string(), "segunda baja current.deletedAt debe ser string");
        }

        // Verificar en base: nombre sigue "Pedro", version == 2
        let conn = db::open_connection().unwrap();
        let nombre: String = conn.query_row(
            "SELECT nombre FROM patients WHERE id = 'pac-baja-final'",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(nombre, "Pedro", "nombre debe seguir siendo Pedro");
        let version: i32 = conn.query_row(
            "SELECT version FROM patients WHERE id = 'pac-baja-final'",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(version, 2, "version debe ser 2");

        // Verificar audit_log: exactamente 1 BAJA_PACIENTE y 0 UPDATE_PACIENTE para pac-baja-final
        let baja_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM audit_log WHERE accion = 'BAJA_PACIENTE' AND entidad_id = 'pac-baja-final'",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(baja_count, 1, "debe haber exactamente 1 BAJA_PACIENTE");
        let update_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM audit_log WHERE accion = 'UPDATE_PACIENTE' AND entidad_id = 'pac-baja-final'",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(update_count, 0, "no debe haber UPDATE_PACIENTE para pac-baja-final");
        drop(conn);

        drop(test);
    }

}
