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
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use uuid::Uuid;

use crate::core::config::settings;
use crate::core::db;
use crate::modules::configuracion::dto::{Afiliado, CuotaAfiliado, PlanAfiliado, WriteResult};
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
fn check_password_change_required(session: &Session) -> Result<(), StatusCode> {
    if session.must_change_password {
        Err(StatusCode::FORBIDDEN)
    } else {
        Ok(())
    }
}

async fn check_write_enabled(state: &AppState) -> Result<(), StatusCode> {
    let conn = db::open_connection().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let enabled = service::get_write_enabled(&conn).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !enabled {
        Err(StatusCode::FORBIDDEN)
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

async fn get_pacientes(State(state): State<AppState>, headers: HeaderMap) -> Result<impl IntoResponse, StatusCode> {
    let session = authenticate_request(&state, &headers, None)?;
    check_password_change_required(&session)?;
    if session.must_change_password { return Err(StatusCode::FORBIDDEN); }
    if !role_allowed(&session.role, "/api/pacientes") { return Err(StatusCode::FORBIDDEN); }
    let data = service::load_app_data().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(data.patients))
}

async fn get_medicos(State(state): State<AppState>, headers: HeaderMap) -> Result<impl IntoResponse, StatusCode> {
    let session = authenticate_request(&state, &headers, None)?;
    check_password_change_required(&session)?;
    if session.must_change_password { return Err(StatusCode::FORBIDDEN); }
    if !role_allowed(&session.role, "/api/medicos") { return Err(StatusCode::FORBIDDEN); }
    let data = service::load_app_data().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(data.doctors))
}

async fn get_agenda(State(state): State<AppState>, headers: HeaderMap) -> Result<impl IntoResponse, StatusCode> {
    let session = authenticate_request(&state, &headers, None)?;
    check_password_change_required(&session)?;
    if session.must_change_password { return Err(StatusCode::FORBIDDEN); }
    if !role_allowed(&session.role, "/api/agenda") { return Err(StatusCode::FORBIDDEN); }
    let data = service::load_app_data().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(data.appointments))
}

async fn get_pagos(State(state): State<AppState>, headers: HeaderMap) -> Result<impl IntoResponse, StatusCode> {
    let session = authenticate_request(&state, &headers, None)?;
    check_password_change_required(&session)?;
    if session.must_change_password { return Err(StatusCode::FORBIDDEN); }
    if !role_allowed(&session.role, "/api/pagos") { return Err(StatusCode::FORBIDDEN); }
    let data = service::load_app_data().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(data.payments))
}

async fn get_afiliados(State(state): State<AppState>, headers: HeaderMap) -> Result<impl IntoResponse, StatusCode> {
    let session = authenticate_request(&state, &headers, None)?;
    check_password_change_required(&session)?;
    if session.must_change_password { return Err(StatusCode::FORBIDDEN); }
    if !role_allowed(&session.role, "/api/afiliados") { return Err(StatusCode::FORBIDDEN); }
    let data = service::load_app_data().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(data.afiliados.unwrap_or_default()))
}

async fn get_obras_sociales(State(state): State<AppState>, headers: HeaderMap) -> Result<impl IntoResponse, StatusCode> {
    let session = authenticate_request(&state, &headers, None)?;
    check_password_change_required(&session)?;
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
) -> Result<Json<WriteEnabledRes>, StatusCode> {
    let _session = authenticate_request(&state, &headers, None)?; // auth requerido
    check_password_change_required(&_session)?;
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
    check_password_change_required(&session)?;
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
    check_password_change_required(&session)?;
    if session.role != "admin" {
        return Err(StatusCode::FORBIDDEN);
    }
    let conn = db::open_connection().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let log = service::load_audit_log(&conn).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
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

async fn post_afiliado(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<AfiliadoReq>,
) -> Result<Json<serde_json::Value>, (StatusCode, axum::Json<serde_json::Value>)> {
    let session = authenticate_request(&state, &headers, None).map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_password_change_required(&session).map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_write_enabled(&state).await.map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
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
        return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "forbidden"}))));
    }

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
    check_password_change_required(&session).map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_write_enabled(&state).await.map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    if !can_write_afiliados(&session.role) {
        return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "forbidden"}))));
    }
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
    check_password_change_required(&session).map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_write_enabled(&state).await.map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    if !can_write_afiliados(&session.role) {
        return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "forbidden"}))));
    }
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
    check_password_change_required(&session).map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_write_enabled(&state).await.map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    if !can_write_afiliados(&session.role) {
        return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "forbidden"}))));
    }
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
    check_password_change_required(&session).map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_write_enabled(&state).await.map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    if !can_write_afiliados(&session.role) {
        return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "forbidden"}))));
    }
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
    check_password_change_required(&session).map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_write_enabled(&state).await.map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    if !can_write_afiliados(&session.role) {
        return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "forbidden"}))));
    }
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
    use serde_json;

    use tower::ServiceExt;
    use axum::body::{Body, to_bytes};
    use axum::http::{StatusCode, header, Request, Method};

    use super::*;

    /// Construye un router de prueba con las cuentas dadas y SANATORIO_DATA_DIR
    /// apuntando a un directorio temporal. Retorna (Router, temp_dir).
    fn build_test_router(accounts: Vec<Account>) -> (Router, std::path::PathBuf) {
        let temp_dir = std::env::temp_dir().join(format!("sanatorio_it_{}", std::process::id()));
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

    /// Hace una petición POST con body JSON y retorna (status, body_text)
    async fn post_json(app: &Router, uri: &str, body: &str) -> (StatusCode, String) {
        let request = Request::builder()
            .method(Method::POST)
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap();
        let response = app.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let body_text = String::from_utf8_lossy(&body_bytes).to_string();
        (status, body_text)
    }

    /// Hace una petición PUT con body JSON y retorna (status, body_text)
    async fn put_json(app: &Router, uri: &str, body: &str) -> (StatusCode, String) {
        let request = Request::builder()
            .method(Method::PUT)
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap();
        let response = app.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let body_text = String::from_utf8_lossy(&body_bytes).to_string();
        (status, body_text)
    }

    /// Hace una petición GET y retorna (status, body_text)
    async fn get(app: &Router, uri: &str) -> (StatusCode, String) {
        let request = Request::builder()
            .method(Method::GET)
            .uri(uri)
            .body(Body::empty())
            .unwrap();
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
        let (app, _temp_dir) = {
            let accounts = vec![
                Account {
                    username: "Admin".to_string(),
                    role: "admin".to_string(),
                    display_name: "Admin".to_string(),
                    turno: None,
                    password: Some("admin123".to_string()),
                    password_hash: None,
                    password_salt: None,
                    must_change_password: true,
                },
            ];
            build_test_router(accounts)
        };

        // Login con Admin (debe funcionar, devuelve token)
        let (status, body) = post_json(&app, "/api/login", r#"{"username":"Admin","password":"admin123"}"#).await;
        assert_eq!(status, StatusCode::OK);
        let login_res: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(login_res["must_change_password"], true);
        let token = login_res["token"].as_str().unwrap();

        // POST /api/afiliados con must_change_password=true -> 403
        let (status, body) = post_json(
            &app,
            "/api/afiliados",
            &format!(r#"{{"id":"afil-1","nombre":"Test","version":1}}"#),
        ).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "Debe ser 403 por must_change_password: {}", body);
    }

    #[tokio::test]
    async fn test_write_enabled_apagado_retorna_403_en_escritura() {
        let (app, _temp_dir) = {
            let accounts = vec![
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
            ];
            build_test_router(accounts)
        };

        // Login
        let (status, body) = post_json(&app, "/api/login", r#"{"username":"Admin","password":"admin123"}"#).await;
        assert_eq!(status, StatusCode::OK);
        let login_res: serde_json::Value = serde_json::from_str(&body).unwrap();
        let token = login_res["token"].as_str().unwrap();

        // write_enabled debe ser false por defecto -> POST /api/afiliados = 403
        let (status, body) = post_json(
            &app,
            "/api/afiliados",
            &format!(r#"{{"id":"afil-1","nombre":"Test","version":1}}"#),
        ).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "Debe ser 403 con write_enabled apagado: {}", body);

        // Encender write_enabled
        let (status, _) = post_json(
            &app,
            "/api/write-enabled",
            &format!(r#"{{"write_enabled":true}}"#),
        ).await;
        assert_eq!(status, StatusCode::OK, "write_enabled=true debe ser 200: {}", status);

        // Ahora POST /api/afiliados = 200
        let (status, body) = post_json(
            &app,
            "/api/afiliados",
            &format!(r#"{{"id":"afil-1","nombre":"Test","version":1}}"#),
        ).await;
        assert_eq!(status, StatusCode::OK, "Debe ser 200 con write_enabled encendido: {}", body);
    }

    #[tokio::test]
    async fn test_secretaria_no_puede_escribir_afiliados() {
        let (app, _temp_dir) = {
            let accounts = vec![
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
            ];
            build_test_router(accounts)
        };

        // Login como secretaria
        let (status, body) = post_json(
            &app,
            "/api/login",
            r#"{"username":"Mary","password":"mary123"}"#,
        ).await;
        assert_eq!(status, StatusCode::OK);
        let login_res: serde_json::Value = serde_json::from_str(&body).unwrap();
        let token = login_res["token"].as_str().unwrap();

        // POST /api/afiliados como secretaria -> 403
        let (status, body) = post_json(
            &app,
            "/api/afiliados",
            &format!(
                r#"{{"id":"afil-1","nombre":"Test","version":1}}"#
            ),
        ).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "Secretaria no puede escribir afiliados: {}", body);

        // Verificar entrada PERMISO_DENEGADO en audit-log
        let (status, body) = get(&app, "/api/audit-log").await;
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
        // Admin puede escribir
        let (app, _temp_dir) = {
            let accounts = vec![
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
            ];
            build_test_router(accounts)
        };

        let (status, body) = post_json(
            &app,
            "/api/login",
            r#"{"username":"Admin","password":"admin123"}"#,
        ).await;
        assert_eq!(status, StatusCode::OK);
        let token: String = serde_json::from_str::<serde_json::Value>(&body)
            .unwrap()["token"].as_str().unwrap().to_string();

        let (status, _) = post_json(
            &app,
            "/api/afiliados",
            &format!(
                r#"{{"id":"afil-1","nombre":"Juan","version":1}}"#
            ),
        ).await;
        assert_eq!(status, StatusCode::OK, "Admin puede escribir afiliados: {}", status);

        // Afiliado puede escribir afiliados
        let (app2, _temp_dir2) = {
            let accounts = vec![
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
            ];
            build_test_router(accounts)
        };

        let (status, _) = post_json(
            &app2,
            "/api/login",
            r#"{"username":"Afiliado1","password":"afi123"}"#,
        ).await;
        assert_eq!(status, StatusCode::OK);

        let (status, _) = post_json(
            &app2,
            "/api/afiliados",
            &format!(
                r#"{{"id":"afil-2","nombre":"Ana","version":1}}"#
            ),
        ).await;
        assert_eq!(status, StatusCode::OK, "Afiliado puede escribir afiliados: {}", status);
    }

    #[tokio::test]
    async fn test_put_afiliado_version_vieja_retorna_409() {
        let (app, _temp_dir) = {
            let accounts = vec![
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
            ];
            build_test_router(accounts)
        };

        // Login
        let (_, body) = post_json(&app, "/api/login", r#"{"username":"Admin","password":"admin123"}"#).await;
        let token: String = serde_json::from_str::<serde_json::Value>(&body)
            .unwrap()["token"].as_str().unwrap().to_string();

        // Crear afiliado con versión 1
        let (status, _) = post_json(
            &app,
            "/api/afiliados",
            r#"{"id":"afil-1","nombre":"Juan","version":1}"#,
        ).await;
        assert_eq!(status, StatusCode::OK);

        // PUT con versión 1 (correcto) -> debería actualizar a versión 2
        let (status, body) = put_json(
            &app,
            "/api/afiliados/afil-1",
            r#"{"id":"afil-1","nombre":"Juan Modificado","version":1}"#,
        ).await;
        assert_eq!(status, StatusCode::OK, "PUT con versión correcta debe ser 200: {}", body);

        // PUT con versión 1 (ya es 2) -> 409
        let (status, body) = put_json(
            &app,
            "/api/afiliados/afil-1",
            r#"{"id":"afil-1","nombre":"Juan Conflicto","version":1}"#,
        ).await;
        assert_eq!(status, StatusCode::CONFLICT, "PUT con versión vieja debe ser 409: {}", body);
        let resp: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(resp["error"], "conflict");
        assert_eq!(resp["current"]["version"], 2);
    }

    #[tokio::test]
    async fn test_put_plan_version_vieja_retorna_409() {
        let (app, _temp_dir) = {
            let accounts = vec![
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
            ];
            build_test_router(accounts)
        };

        let (_, body) = post_json(&app, "/api/login", r#"{"username":"Admin","password":"admin123"}"#).await;
        let _token: String = serde_json::from_str::<serde_json::Value>(&body)
            .unwrap()["token"].as_str().unwrap().to_string();

        // Crear plan con versión 1
        let (status, _) = post_json(
            &app,
            "/api/planes",
            r#"{"id":"plan-1","nombre":"Plan Oro","version":1}"#,
        ).await;
        assert_eq!(status, StatusCode::OK);

        // PUT con versión 1 (ya es 2) -> 409
        let (status, body) = put_json(
            &app,
            "/api/planes/plan-1",
            r#"{"id":"plan-1","nombre":"Plan Oro Conflicto","version":1}"#,
        ).await;
        assert_eq!(status, StatusCode::CONFLICT, "PUT plan con versión vieja debe ser 409: {}", body);
        let resp: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(resp["error"], "conflict");
        assert_eq!(resp["current"]["version"], 2);
    }

    #[tokio::test]
    async fn test_put_cuota_version_vieja_retorna_409() {
        let (app, _temp_dir) = {
            let accounts = vec![
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
            ];
            build_test_router(accounts)
        };

        let (_, body) = post_json(&app, "/api/login", r#"{"username":"Admin","password":"admin123"}"#).await;
        let _token: String = serde_json::from_str::<serde_json::Value>(&body)
            .unwrap()["token"].as_str().unwrap().to_string();

        // Crear cuota con versión 1
        let (status, _) = post_json(
            &app,
            "/api/cuotas",
            r#"{"id":"cuota-1","monto":100.0,"version":1}"#,
        ).await;
        assert_eq!(status, StatusCode::OK);

        // PUT con versión 1 (ya es 2) -> 409
        let (status, body) = put_json(
            &app,
            "/api/cuotas/cuota-1",
            r#"{"id":"cuota-1","monto":200.0,"version":1}"#,
        ).await;
        assert_eq!(status, StatusCode::CONFLICT, "PUT cuota con versión vieja debe ser 409: {}", body);
        let resp: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(resp["error"], "conflict");
        assert_eq!(resp["current"]["version"], 2);
    }

    #[tokio::test]
    async fn test_post_afiliado_id_existente_no_pisa() {
        let (app, _temp_dir) = {
            let accounts = vec![
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
            ];
            build_test_router(accounts)
        };

        let (_, body) = post_json(&app, "/api/login", r#"{"username":"Admin","password":"admin123"}"#).await;
        let _token: String = serde_json::from_str::<serde_json::Value>(&body)
            .unwrap()["token"].as_str().unwrap().to_string();

        // Crear afiliado con versión 1
        let (status, _) = post_json(
            &app,
            "/api/afiliados",
            r#"{"id":"afil-1","nombre":"Juan","version":1}"#,
        ).await;
        assert_eq!(status, StatusCode::OK);

        // POST con mismo id y versión 1 (no coincide con versión actual 2) -> 409
        let (status, body) = post_json(
            &app,
            "/api/afiliados",
            r#"{"id":"afil-1","nombre":"Duplicado","version":1}"#,
        ).await;
        assert_eq!(status, StatusCode::CONFLICT, "POST con id existente y versión vieja debe ser 409: {}", body);
        let resp: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(resp["error"], "conflict");
        assert_eq!(resp["current"]["id"], "afil-1");
    }

    #[tokio::test]
    async fn test_cuerpo_mal_formado_retorna_400() {
        let (app, _temp_dir) = {
            let accounts = vec![
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
            ];
            build_test_router(accounts)
        };

        let (_, body) = post_json(&app, "/api/login", r#"{"username":"Admin","password":"admin123"}"#).await;
        let token: String = serde_json::from_str::<serde_json::Value>(&body)
            .unwrap()["token"].as_str().unwrap().to_string();

        // Cuerpo no es JSON válido
        let (status, _) = post_json(
            &app,
            "/api/afiliados",
            "esto no es json",
        ).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "Cuerpo mal formado debe ser 400");
    }

    #[tokio::test]
    async fn test_rol_invalido_no_tiene_acceso() {
        let temp_dir = std::env::temp_dir().join(format!("sanatorio_it_inv_{}", std::process::id()));
        fs::create_dir_all(&temp_dir).unwrap();

        let accounts_json = r#"[
            {"username":"Invalido","role":"invitado","displayName":"Invitado","password":"inv123","mustChangePassword":false}
        ]"#;
        let accounts_path = temp_dir.join("auth-accounts.json");
        fs::write(&accounts_path, accounts_json).unwrap();

        env::set_var("SANATORIO_DATA_DIR", temp_dir.to_str().unwrap());
        service::ensure_initialized().unwrap();
        let loaded = load_accounts(&temp_dir);
        let state = AppState {
            accounts: Arc::new(Mutex::new(loaded)),
            data_dir: temp_dir.clone(),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            login_attempts: Arc::new(Mutex::new(HashMap::new())),
        };
        let app = build_router(state);

        // Login con rol invitado -> 403
        let (status, body) = post_json(
            &app,
            "/api/login",
            r#"{"username":"Invalido","password":"inv123"}"#,
        ).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "Rol inválido no debe poder iniciar sesión: {}", body);

        env::remove_var("SANATORIO_DATA_DIR");
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_audit_log_solo_admin_y_con_entradas() {
        let (app, _temp_dir) = {
            let accounts = vec![
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
            ];
            build_test_router(accounts)
        };

        // Login admin
        let (_, body) = post_json(&app, "/api/login", r#"{"username":"Admin","password":"admin123"}"#).await;
        let token_admin: String = serde_json::from_str::<serde_json::Value>(&body)
            .unwrap()["token"].as_str().unwrap().to_string();

        // Login afiliado
        let (_, body) = post_json(&app, "/api/login", r#"{"username":"Afiliado1","password":"afi123"}"#).await;
        let token_afiliado: String = serde_json::from_str::<serde_json::Value>(&body)
            .unwrap()["token"].as_str().unwrap().to_string();

        // Afiliado intenta escribir afiliados (tiene permiso) -> crea entrada en auditoría
        let (status, _) = post_json(
            &app,
            "/api/afiliados",
            r#"{"id":"afil-1","nombre":"Test","version":1}"#,
        ).await;
        assert_eq!(status, StatusCode::OK);

        // Afiliado intenta escribir write-enabled (no tiene permiso) -> PERMISO_DENEGADO
        let (status, _) = post_json(
            &app,
            "/api/write-enabled",
            r#"{"write_enabled":true}"#,
        ).await;
        assert_eq!(status, StatusCode::FORBIDDEN);

        // Admin obtiene audit-log
        let (status, body) = get(&app, "/api/audit-log").await;
        assert_eq!(status, StatusCode::OK, "admin debe leer audit-log: {}", status);
        let audit: serde_json::Value = serde_json::from_str(&body).unwrap();
        let entries = audit.as_array().unwrap();

        let acciones: Vec<String> = entries.iter()
            .filter_map(|e| e.get("accion").and_then(|v| v.as_str().map(String::from)))
            .collect();

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
        let (status, _) = get(&app, "/api/audit-log").await;
        assert_eq!(status, StatusCode::FORBIDDEN, "Afiliado no puede leer audit-log: {}", status);
    }

    fn entradas_contienen(entries: &[serde_json::Value], accion: &str) -> bool {
        entries.iter().any(|e| e.get("accion").and_then(|v| v.as_str()) == Some(accion))
    }
}

