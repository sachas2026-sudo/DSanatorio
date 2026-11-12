use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use std::sync::OnceLock;

use axum::{
    extract::{DefaultBodyLimit, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use axum_server::tls_rustls::RustlsConfig;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use pbkdf2::pbkdf2_hmac;
use rand::Rng;
use rcgen::generate_simple_self_signed;
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use uuid::Uuid;

use crate::core::config::settings;
use crate::core::db;
use crate::core::error::AppError;
use crate::modules::configuracion::dto::{Afiliado, AppData, CuotaAfiliado, ObraSocialCatalog, ObraSocialWriteResult, Patient, PatientWriteResult, PlanAfiliado, WriteResult};
use crate::modules::configuracion::{repository, service};

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
    device_id: String,
    device_name: String,
    connected_at: u64,
    last_seen: u64,
    last_activity: Instant,
}

#[derive(Clone)]
struct AppState {
    accounts: Arc<Mutex<Vec<Account>>>,
    data_dir: std::path::PathBuf,
    sessions: Arc<Mutex<HashMap<String, Session>>>,
    login_attempts: Arc<Mutex<HashMap<String, LoginAttempt>>>,
    device_access: Arc<Mutex<HashMap<String, DeviceAccessRecord>>>,
    pairing_code: Arc<Mutex<Option<String>>>,
    pairing_attempts: Arc<Mutex<Vec<Instant>>>,
}

static ACTIVE_SERVER_STATE: OnceLock<Mutex<Option<AppState>>> = OnceLock::new();

const CONNECTED_DEVICE_WINDOW: Duration = Duration::from_secs(75);
const DEVICE_ACCESS_FILE: &str = "device-access.json";

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum DeviceAccessStatus {
    Pending,
    Approved,
    Revoked,
}

impl DeviceAccessStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Approved => "approved",
            Self::Revoked => "revoked",
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceAccessRecord {
    device_id: String,
    device_name: String,
    status: DeviceAccessStatus,
    first_seen: u64,
    last_seen: u64,
    approved_at: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceAccessRequest {
    device_id: String,
    device_name: String,
    #[serde(default)]
    pairing_code: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceAccessReply {
    status: &'static str,
    server_name: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedDevice {
    pub device_id: String,
    pub device_name: String,
    pub username: String,
    pub display_name: String,
    pub role: String,
    pub connected_at: u64,
    pub last_seen: u64,
    pub status: String,
    pub connected: bool,
}

#[derive(Serialize)]
struct Health { status: &'static str, version: &'static str, app: &'static str, server_name: String }

#[derive(Deserialize)]
struct LoginReq {
    username: String,
    password: String,
    #[serde(default)]
    device_id: Option<String>,
    #[serde(default)]
    device_name: Option<String>,
}

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
    obra_social_anterior: Option<String>,
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
        // Cuentas por defecto con sus contraseñas estándar verificadas
        let accounts = vec![
            serde_json::json!({
                "username": "Admi",
                "role": "admin",
                "displayName": "Admi",
                "passwordHash": "P1U/65i0gOmqYowAPc3UnzYvQXvplu85GTJ6avQES30=",
                "passwordSalt": "fG8r56seNehNiM3JMddqSg==",
                "mustChangePassword": false
            }),
            serde_json::json!({
                "username": "Barua Andrea",
                "role": "secretaria",
                "displayName": "Barua Andrea",
                "turno": "Tarde",
                "passwordHash": "YT572xmglGv/oF5MeUWRgq8Va1VuEQ4OaagUPXuVZNE=",
                "passwordSalt": "cvNyyRkx1ju95x/Clzdelg==",
                "mustChangePassword": false
            }),
            serde_json::json!({
                "username": "Aguirre Mary",
                "role": "secretaria",
                "displayName": "Aguirre Mary",
                "turno": "Mañana",
                "passwordHash": "+8z8K3Yq1ypaTr5lAHt8f+ZfzEGEDq++UAS4ok4UTCg=",
                "passwordSalt": "4atQN0lY+daonfSIg0516Q==",
                "mustChangePassword": false
            }),
            serde_json::json!({
                "username": "Contratantes",
                "role": "afiliado",
                "displayName": "Contratantes",
                "passwordHash": "XSB27daQ5HQsdh+d7XTLg4iFNc87l3R3U1WVUdb0gLs=",
                "passwordSalt": "QdWC1HoUiu6h8xqWq2JrKA==",
                "mustChangePassword": false
            }),
        ];
        if let Ok(raw) = serde_json::to_string_pretty(&accounts) {
            let _ = std::fs::write(&path, raw);
        }
    }
    if let Err(error) = crate::auth_defaults::migrate_initial_credentials_file(&path) {
        log::error!("No se pudieron migrar las credenciales iniciales: {error}");
    }
    let raw = std::fs::read_to_string(&path).unwrap_or_default();
    if raw.trim().is_empty() { return vec![]; }
    let all: Vec<Account> = serde_json::from_str(&raw).unwrap_or_default();
    // NO filtrar cuentas aquí: se conservan todas en el archivo y en memoria.
    // El filtrado por rol válido ocurre solo en el login y en los endpoints de escritura.
    all
}

fn verify_password(account: &Account, password: &str) -> bool {
    let p = password.trim();
    if let (Some(hash_b64), Some(salt_b64)) = (&account.password_hash, &account.password_salt) {
        if let (Ok(salt), Ok(expected)) = (B64.decode(salt_b64), B64.decode(hash_b64)) {
            let mut out = vec![0u8; expected.len()];
            pbkdf2_hmac::<Sha256>(p.as_bytes(), &salt, 120_000, &mut out);
            if out.len() == expected.len() {
                let mut diff = 0u8;
                for (a,b) in out.iter().zip(expected.iter()) { diff |= a ^ b; }
                if diff == 0 { return true; }
            }
        }
    }
    if let Some(plain) = &account.password {
        if plain.trim() == p || plain.trim().eq_ignore_ascii_case(p) {
            return true;
        }
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
    let key = username.trim().to_lowercase();
    let a = attempts.entry(key).or_insert(LoginAttempt { failures: 0, first_fail: now });
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
    let key = username.trim().to_lowercase();
    let a = attempts.entry(key).or_insert(LoginAttempt { failures: 0, first_fail: now });
    a.failures += 1;
}

fn authenticate_request(state: &AppState, headers: &HeaderMap, _token_expiry_secs: Option<u64>) -> Result<Session, StatusCode> {
    let token = headers.get("authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(|s| s.to_string())
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let mut sessions = state.sessions.lock().unwrap();
    match sessions.get_mut(&token) {
        Some(session) if session.expiry > Instant::now() => {
            session.last_seen = unix_timestamp();
            session.last_activity = Instant::now();
            Ok(session.clone())
        }
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn safe_device_value(value: Option<String>, fallback: &str, max_len: usize) -> String {
    let cleaned: String = value
        .unwrap_or_default()
        .trim()
        .chars()
        .filter(|character| !character.is_control())
        .take(max_len)
        .collect();
    if cleaned.is_empty() {
        fallback.to_string()
    } else {
        cleaned
    }
}

fn load_device_access(data_dir: &Path) -> Result<HashMap<String, DeviceAccessRecord>, String> {
    let path = data_dir.join(DEVICE_ACCESS_FILE);
    if !path.exists() {
        return Ok(HashMap::new());
    }

    let raw = std::fs::read_to_string(&path)
        .map_err(|error| format!("No se pudo leer el registro de dispositivos: {error}"))?;
    let records: HashMap<String, DeviceAccessRecord> = serde_json::from_str(&raw)
        .map_err(|error| format!("El registro de dispositivos no es válido: {error}"))?;
    if records
        .iter()
        .any(|(id, record)| id != &record.device_id || id.trim().is_empty())
    {
        return Err("El registro de dispositivos contiene identificadores inconsistentes.".into());
    }
    Ok(records)
}

fn persist_device_access(
    data_dir: &Path,
    records: &HashMap<String, DeviceAccessRecord>,
) -> Result<(), String> {
    let raw = serde_json::to_vec_pretty(records)
        .map_err(|error| format!("No se pudo serializar el registro de dispositivos: {error}"))?;
    let path = data_dir.join(DEVICE_ACCESS_FILE);
    let temporary_path = data_dir.join(format!("{DEVICE_ACCESS_FILE}.tmp"));
    std::fs::write(&temporary_path, raw)
        .map_err(|error| format!("No se pudo guardar el registro de dispositivos: {error}"))?;
    if let Err(error) = std::fs::rename(&temporary_path, &path) {
        let _ = std::fs::remove_file(&temporary_path);
        return Err(format!("No se pudo actualizar el registro de dispositivos: {error}"));
    }
    Ok(())
}

fn record_device_request(
    state: &AppState,
    device_id: String,
    device_name: String,
    pairing_code: Option<&str>,
) -> Result<DeviceAccessStatus, String> {
    let now = unix_timestamp();
    let mut records = state
        .device_access
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let mut updated = records.clone();
    let active_code = state
        .pairing_code
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clone();
    let code_matches = active_code.as_deref().is_some_and(|active| {
        pairing_code
            .map(str::trim)
            .is_some_and(|candidate| candidate.eq_ignore_ascii_case(active))
    });

    let existing_status = updated.get(&device_id).map(|record| record.status);
    if existing_status == Some(DeviceAccessStatus::Approved) {
        if let Some(record) = updated.get_mut(&device_id) {
            record.device_name = device_name;
            record.last_seen = now;
            let status = record.status;
            persist_device_access(&state.data_dir, &updated)?;
            *records = updated;
            return Ok(status);
        }
    }
    if existing_status == Some(DeviceAccessStatus::Revoked) {
        return Ok(DeviceAccessStatus::Revoked);
    }

    if !code_matches {
        let mut attempts = state
            .pairing_attempts
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let now_instant = Instant::now();
        attempts.retain(|attempt| now_instant.duration_since(*attempt) < Duration::from_secs(60));
        if attempts.len() >= 20 {
            return Err("pairing_rate_limited".into());
        }
        attempts.push(now_instant);
        return Ok(DeviceAccessStatus::Pending);
    }

    let record = updated
        .entry(device_id.clone())
        .or_insert_with(|| DeviceAccessRecord {
            device_id,
            device_name: device_name.clone(),
            status: DeviceAccessStatus::Pending,
            first_seen: now,
            last_seen: now,
            approved_at: None,
        });
    record.device_name = device_name;
    record.last_seen = now;
    if code_matches {
        record.status = DeviceAccessStatus::Approved;
        record.approved_at = Some(now);
    }
    let status = record.status;
    persist_device_access(&state.data_dir, &updated)?;
    *records = updated;
    Ok(status)
}

fn set_device_access_status(
    state: &AppState,
    device_id: &str,
    status: DeviceAccessStatus,
) -> Result<(), String> {
    let mut records = state
        .device_access
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let mut updated = records.clone();
    let record = updated
        .get_mut(device_id)
        .ok_or_else(|| "No existe una solicitud para ese dispositivo.".to_string())?;
    record.status = status;
    record.approved_at = (status == DeviceAccessStatus::Approved).then(unix_timestamp);
    persist_device_access(&state.data_dir, &updated)?;
    *records = updated;
    Ok(())
}

fn revoke_device_access(state: &AppState, device_id: &str) -> Result<(), String> {
    set_device_access_status(state, device_id, DeviceAccessStatus::Revoked)?;
    state
        .sessions
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .retain(|_, session| session.device_id != device_id);
    Ok(())
}

fn connected_devices_from_sessions(
    sessions: &HashMap<String, Session>,
    now: Instant,
) -> Vec<ConnectedDevice> {
    let now_unix = unix_timestamp();
    let mut devices: Vec<_> = sessions
        .values()
        .filter(|session| {
            session.expiry > now
                && now
                    .checked_duration_since(session.last_activity)
                    .is_some_and(|elapsed| elapsed <= CONNECTED_DEVICE_WINDOW)
        })
        .map(|session| ConnectedDevice {
            device_id: session.device_id.clone(),
            device_name: session.device_name.clone(),
            username: session.username.clone(),
            display_name: session.display_name.clone(),
            role: session.role.clone(),
            connected_at: session.connected_at,
            last_seen: session.last_seen.min(now_unix),
            status: "connected".to_string(),
            connected: true,
        })
        .collect();
    devices.sort_by(|left, right| {
        left.device_name
            .cmp(&right.device_name)
            .then_with(|| left.username.cmp(&right.username))
    });
    devices
}

fn combine_device_access_and_sessions(
    records: &HashMap<String, DeviceAccessRecord>,
    active_sessions: Vec<ConnectedDevice>,
) -> Vec<ConnectedDevice> {
    let mut devices: HashMap<String, ConnectedDevice> = records
        .values()
        .map(|record| {
            (
                record.device_id.clone(),
                ConnectedDevice {
                    device_id: record.device_id.clone(),
                    device_name: record.device_name.clone(),
                    username: String::new(),
                    display_name: String::new(),
                    role: String::new(),
                    connected_at: 0,
                    last_seen: record.last_seen,
                    status: record.status.as_str().to_string(),
                    connected: false,
                },
            )
        })
        .collect();

    for mut session in active_sessions {
        session.status = "connected".to_string();
        session.connected = true;
        devices
            .entry(session.device_id.clone())
            .and_modify(|device| {
                device.device_name = session.device_name.clone();
                device.username = session.username.clone();
                device.display_name = session.display_name.clone();
                device.role = session.role.clone();
                device.connected_at = session.connected_at;
                device.last_seen = session.last_seen;
                device.status = "connected".to_string();
                device.connected = true;
            })
            .or_insert(session);
    }

    let mut devices: Vec<_> = devices.into_values().collect();
    devices.sort_by(|left, right| {
        left.device_name
            .cmp(&right.device_name)
            .then_with(|| left.device_id.cmp(&right.device_id))
    });
    devices
}

fn activate_server_state(state: AppState) {
    let active = ACTIVE_SERVER_STATE.get_or_init(|| Mutex::new(None));
    *active.lock().unwrap_or_else(|error| error.into_inner()) = Some(state);
}

fn active_server_state() -> Result<AppState, String> {
    ACTIVE_SERVER_STATE
        .get()
        .and_then(|active| active.lock().ok()?.clone())
        .ok_or_else(|| "El servidor HTTPS todavía no está iniciado.".to_string())
}

#[tauri::command]
pub fn get_connected_devices() -> Result<Vec<ConnectedDevice>, String> {
    if crate::client_mode::load_config()?.mode != crate::client_mode::AppMode::Local {
        return Err("La lista de dispositivos solo está disponible en modo servidor.".to_string());
    }
    let state = active_server_state()?;
    let now = Instant::now();
    let mut sessions = state
        .sessions
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    sessions.retain(|_, session| session.expiry > now);
    let active = connected_devices_from_sessions(&sessions, now);
    let records = state
        .device_access
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clone();
    Ok(combine_device_access_and_sessions(&records, active))
}

#[tauri::command]
pub fn approve_client_device(device_id: String) -> Result<(), String> {
    if crate::client_mode::load_config()?.mode != crate::client_mode::AppMode::Local {
        return Err("La aprobación de dispositivos solo está disponible en modo servidor.".into());
    }
    let state = active_server_state()?;
    set_device_access_status(&state, &device_id, DeviceAccessStatus::Approved)
}

#[tauri::command]
pub fn revoke_client_device(device_id: String) -> Result<(), String> {
    if crate::client_mode::load_config()?.mode != crate::client_mode::AppMode::Local {
        return Err("La revocación de dispositivos solo está disponible en modo servidor.".into());
    }
    let state = active_server_state()?;
    revoke_device_access(&state, &device_id)
}

fn generate_pairing_code() -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut random = rand::thread_rng();
    (0..6)
        .map(|_| ALPHABET[random.gen_range(0..ALPHABET.len())] as char)
        .collect()
}

#[tauri::command]
pub fn get_server_pairing_code() -> Result<String, String> {
    if crate::client_mode::load_config()?.mode != crate::client_mode::AppMode::Local {
        return Err("La clave de conexión solo está disponible en modo servidor.".into());
    }
    let state = active_server_state()?;
    let mut pairing_code = state
        .pairing_code
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if pairing_code.is_none() {
        *pairing_code = Some(generate_pairing_code());
        state
            .pairing_attempts
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clear();
    }
    pairing_code
        .clone()
        .ok_or_else(|| "No se pudo generar la clave de conexión.".to_string())
}

#[tauri::command]
pub fn regenerate_server_pairing_code() -> Result<String, String> {
    if crate::client_mode::load_config()?.mode != crate::client_mode::AppMode::Local {
        return Err("La clave de conexión solo está disponible en modo servidor.".into());
    }
    let state = active_server_state()?;
    let code = generate_pairing_code();
    *state
        .pairing_code
        .lock()
        .unwrap_or_else(|error| error.into_inner()) = Some(code.clone());
    state
        .pairing_attempts
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clear();
    Ok(code)
}

#[tauri::command]
pub fn hide_server_pairing_code() -> Result<(), String> {
    if crate::client_mode::load_config()?.mode != crate::client_mode::AppMode::Local {
        return Err("La clave de conexión solo está disponible en modo servidor.".into());
    }
    let state = active_server_state()?;
    *state
        .pairing_code
        .lock()
        .unwrap_or_else(|error| error.into_inner()) = None;
    state
        .pairing_attempts
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clear();
    Ok(())
}

fn role_allowed(role: &str, path: &str) -> bool {
    match role {
        // Admi accede a todo, incluido el módulo Afiliados.
        "admin" => true,
        // La secretaria trabaja sin el módulo Afiliados.
        "secretaria" => matches!(
            path,
            "/api/pacientes" | "/api/medicos" | "/api/agenda" | "/api/pagos" | "/api/obras-sociales"
        ),
        "afiliado" => matches!(path, "/api/pacientes" | "/api/afiliados"),
        _ => false,
    }
}

/// Claves de AppData que puede leer/escribir cada rol en el endpoint de
/// sincronización (`/api/app-data`).
///
/// - admin: todo.
/// - secretaria: todo excepto el módulo Afiliados.
/// - afiliado: Pacientes + módulo Afiliados (sin settings).
fn app_data_key_allowed(role: &str, key: &str) -> bool {
    const AFILIADOS_KEYS: [&str; 5] = [
        "afiliados",
        "planesAfiliados",
        "cuotasAfiliados",
        "prestacionesAfiliados",
        "ordenesMedicas",
    ];
    match role {
        "admin" => true,
        "secretaria" => !AFILIADOS_KEYS.contains(&key),
        "afiliado" => matches!(
            key,
            "patients"
                | "afiliados"
                | "planesAfiliados"
                | "cuotasAfiliados"
                | "prestacionesAfiliados"
                | "ordenesMedicas"
        ),
        _ => false,
    }
}

/// Devuelve una copia del AppData con las colecciones que el rol no puede ver
/// vaciadas. `settings` se mantiene siempre (la interfaz lo necesita para
/// funcionar), pero no se permite escribirlo desde el rol afiliado.
fn filter_app_data_for_role(role: &str, mut value: serde_json::Value) -> serde_json::Value {
    let Some(obj) = value.as_object_mut() else {
        return value;
    };
    let keys: Vec<String> = obj.keys().cloned().collect();
    for key in keys {
        if key == "settings" {
            continue;
        }
        if !app_data_key_allowed(role, &key) && obj.get(&key).map(|v| v.is_array()).unwrap_or(false) {
            obj.insert(key, serde_json::json!([]));
        }
    }
    if role != "admin" {
        if let Some(settings_obj) = obj.get_mut("settings").and_then(|v| v.as_object_mut()) {
            settings_obj.insert("supabaseAutoSync".to_string(), serde_json::Value::Bool(false));
        }
    }
    value
}

/// Superpone sobre el AppData actual solo las claves que el rol puede escribir.
fn merge_app_data_for_role(
    role: &str,
    mut current: serde_json::Value,
    incoming: &serde_json::Value,
) -> serde_json::Value {
    let prev_auto_sync = current
        .get("settings")
        .and_then(|s| s.get("supabaseAutoSync"))
        .cloned();
    if let (Some(cur), Some(inc)) = (current.as_object_mut(), incoming.as_object()) {
        for (key, val) in inc {
            if app_data_key_allowed(role, key) {
                cur.insert(key.clone(), val.clone());
            }
        }
        if role != "admin" {
            if let (Some(prev), Some(settings_obj)) = (
                prev_auto_sync,
                cur.get_mut("settings").and_then(|v| v.as_object_mut()),
            ) {
                settings_obj.insert("supabaseAutoSync".to_string(), prev);
            }
        }
    }
    current
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

fn server_tls_names(tls_dir: &Path) -> Result<Vec<String>, String> {
    let _ = tls_dir;
    Ok(crate::tls_cert::desired_names(&[]))
}

pub fn server_nickname() -> String {
    let configured = option_env!("SAN_NAME")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let computer_name = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok();
    safe_device_value(
        configured.or(computer_name),
        "Sanatorio Server",
        64,
    )
}

async fn health() -> Json<Health> {
    Json(Health {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
        app: "sanatorio",
        server_name: server_nickname(),
    })
}

async fn request_device_access(
    State(state): State<AppState>,
    Json(body): Json<DeviceAccessRequest>,
) -> Result<Json<DeviceAccessReply>, StatusCode> {
    let device_id = safe_device_value(Some(body.device_id), "", 128);
    if device_id.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let device_name = safe_device_value(Some(body.device_name), "Equipo cliente", 64);
    let status = record_device_request(
        &state,
        device_id,
        device_name,
        body.pairing_code.as_deref(),
    )
    .map_err(|error| {
        if error == "pairing_rate_limited" {
            StatusCode::TOO_MANY_REQUESTS
        } else {
            log::error!("No se pudo registrar la solicitud de dispositivo: {error}");
            StatusCode::INTERNAL_SERVER_ERROR
        }
    })?;
    Ok(Json(DeviceAccessReply {
        status: if status == DeviceAccessStatus::Pending {
            "invalid_code"
        } else {
            status.as_str()
        },
        server_name: server_nickname(),
    }))
}

async fn session_heartbeat(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, StatusCode> {
    authenticate_request(&state, &headers, None)?;
    Ok(Json(serde_json::json!({ "status": "ok" })))
}

async fn login(State(state): State<AppState>, Json(body): Json<LoginReq>) -> Result<Json<LoginRes>, StatusCode> {
    check_rate_limit(&state, &body.username)?;
    let device_id = body
        .device_id
        .as_deref()
        .map(str::trim)
        .filter(|device_id| !device_id.is_empty())
        .ok_or(StatusCode::FORBIDDEN)?;
    let is_approved = state
        .device_access
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .get(device_id)
        .is_some_and(|record| record.status == DeviceAccessStatus::Approved);
    if !is_approved {
        return Err(StatusCode::FORBIDDEN);
    }
    let accounts = state.accounts.lock().unwrap();
    let u_req = body.username.trim().to_lowercase();
    let account_opt = accounts
        .iter()
        .find(|account| account.username.trim().eq_ignore_ascii_case(&u_req));

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
            let now = Instant::now();
            let connected_at = unix_timestamp();
            let session = Session {
                username: username.clone(),
                role: role.clone(),
                display_name: display_name.clone(),
                must_change_password: must_change,
                expiry: now + Duration::from_secs(12 * 3600),
                device_id: safe_device_value(
                    body.device_id,
                    &format!("session-{}", Uuid::new_v4()),
                    128,
                ),
                device_name: safe_device_value(body.device_name, "Equipo sin identificar", 64),
                connected_at,
                last_seen: connected_at,
                last_activity: now,
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

    Ok(Json(service::load_obras_sociales().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?))
}

/// Estado completo de la aplicación para el modo cliente, filtrado por rol.
async fn get_app_data(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, axum::Json<serde_json::Value>)> {
    let session = authenticate_request(&state, &headers, None)
        .map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_password_change_required(&session)?;
    if !is_valid_role(&session.role) {
        return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "role_forbidden"}))));
    }
    let data = service::load_app_data()
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
    let value = serde_json::to_value(&data)
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "serialization error"}))))?;
    Ok(Json(filter_app_data_for_role(&session.role, value)))
}

/// Guarda el estado completo. Solo aplica las claves habilitadas para el rol;
/// el resto se conserva como estaba en el servidor.
async fn post_app_data(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(incoming): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (StatusCode, axum::Json<serde_json::Value>)> {
    let session = authenticate_request(&state, &headers, None)
        .map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_password_change_required(&session)?;
    if !is_valid_role(&session.role) {
        return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "role_forbidden"}))));
    }
    if !incoming.is_object() {
        return Err(validation_response("se esperaba un objeto JSON con los datos"));
    }
    let current = service::load_app_data()
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
    let current_value = serde_json::to_value(&current)
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "serialization error"}))))?;
    let merged = merge_app_data_for_role(&session.role, current_value, &incoming);
    let data: AppData = serde_json::from_value(merged)
        .map_err(|e| validation_response(&format!("datos inválidos: {e}")))?;
    service::replace_app_data_direct(&data)
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
    Ok(Json(serde_json::json!({"ok": true})))
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

async fn get_auth_accounts(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, axum::Json<serde_json::Value>)> {
    let session = authenticate_request(&state, &headers, None)
        .map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    if session.role != "admin" {
        return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "role_forbidden"}))));
    }
    let accounts = state.accounts.lock().unwrap().clone();
    Ok(Json(serde_json::to_value(accounts).unwrap_or_else(|_| serde_json::json!([]))))
}

async fn post_auth_accounts(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Result<StatusCode, (StatusCode, axum::Json<serde_json::Value>)> {
    let session = authenticate_request(&state, &headers, None)
        .map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    if session.role != "admin" {
        return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "role_forbidden"}))));
    }
    let accounts: Vec<Account> = serde_json::from_value(body)
        .map_err(|_| (StatusCode::BAD_REQUEST, axum::Json(serde_json::json!({"error": "invalid body"}))))?;
    // Validar roles
    for a in &accounts {
        if !is_valid_role(&a.role) {
            return Err((StatusCode::BAD_REQUEST, axum::Json(serde_json::json!({"error": "invalid role"}))));
        }
    }
    {
        let mut guard = state.accounts.lock().unwrap();
        *guard = accounts;
    }
    save_accounts(&state).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "save failed"}))))?;
    Ok(StatusCode::OK)
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

/// Crear y editar pacientes: admin, secretaria y afiliado.
fn can_write_pacientes(role: &str) -> bool {
    matches!(role, "admin" | "secretaria" | "afiliado")
}

/// Crear y editar obras sociales: admin y secretaria.
fn can_write_obras_sociales(role: &str) -> bool {
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
        obra_social_anterior: req.obra_social_anterior,
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
    if id != id.trim()
        || id.chars().any(|c| matches!(c, '/' | '\\' | '?' | '#' | '%'))
        || id.len() > 64
    {
        return Err(validation_response("id inválido"));
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
            serde_json::json!({"id": id, "version": version.saturating_add(1)}),
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
            serde_json::json!({"id": id, "version": version.saturating_add(1)}),
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

async fn post_afiliado_con_paciente_nuevo(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<crate::modules::configuracion::dto::RegistrarContratanteConPacienteNuevoReq>,
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
            Some(&body.patient_id),
            Some("intento de registrar contratante con paciente nuevo sin rol afiliado o admin"),
        ).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
        tx.commit().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": "db error"}))))?;
        return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "role_forbidden"}))));
    }
    check_write_enabled(&state).await?;

    match service::registrar_contratante_con_paciente_nuevo(&body, &session.username, &session.role) {
        Ok((patient, afiliado)) => {
            Ok(Json(serde_json::json!({
                "patient": patient,
                "afiliado": afiliado,
            })))
        }
        Err(AppError::Validation(msg)) => {
            Err((StatusCode::BAD_REQUEST, axum::Json(serde_json::json!({"error": "validation", "message": msg}))))
        }
        Err(e) => {
            Err((StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": e.to_string()}))))
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

fn conflict_obra_social_response(current: Option<ObraSocialCatalog>) -> (StatusCode, axum::Json<serde_json::Value>) {
    (
        StatusCode::CONFLICT,
        axum::Json(serde_json::json!({
            "error": "conflict",
            "message": "La obra social fue modificada por otro usuario",
            "current": current
        })),
    )
}

async fn post_obra_social(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ObraSocialCatalog>,
) -> Result<Json<serde_json::Value>, (StatusCode, axum::Json<serde_json::Value>)> {
    let session = authenticate_request(&state, &headers, None).map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_password_change_required(&session)?;
    if session.must_change_password { return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "must_change_password"})))); }
    if !can_write_obras_sociales(&session.role) { return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "role_forbidden"})))); }
    check_write_enabled(&state).await?;

    let nombre = body.nombre.trim();
    if nombre.is_empty() {
        return Err(validation_response("nombre es requerido"));
    }
    if body.plus < 0 || body.plus > 100_000_000 {
        return Err(validation_response("plus fuera de rango"));
    }
    if body.arancel < 0 || body.arancel > 100_000_000 {
        return Err(validation_response("arancel fuera de rango"));
    }
    if body.cuidar < 0 || body.cuidar > 10000 {
        return Err(validation_response("cuidar fuera de rango"));
    }
    if body.imp_banco < 0 || body.imp_banco > 10000 {
        return Err(validation_response("imp_banco fuera de rango"));
    }
    if body.imp_factura < 0 || body.imp_factura > 10000 {
        return Err(validation_response("imp_factura fuera de rango"));
    }
    if body.gastos_adm < 0 || body.gastos_adm > 10000 {
        return Err(validation_response("gastos_adm fuera de rango"));
    }

    let existing = service::load_obras_sociales().map_err(|_| internal_error_response())?;
    if existing.iter().any(|o| o.nombre.trim().eq_ignore_ascii_case(nombre)) {
        return Err((StatusCode::BAD_REQUEST, axum::Json(serde_json::json!({"error": "validation", "message": "Esa obra social ya existe."}))));
    }

    let mut to_save = body.clone();
    to_save.nombre = nombre.to_string();
    to_save.version = 1;

    match service::save_obra_social(&to_save).map_err(|_| internal_error_response())? {
        ObraSocialWriteResult::Saved(saved) => Ok(Json(serde_json::to_value(&saved).unwrap())),
        ObraSocialWriteResult::Conflict { current } => Err(conflict_obra_social_response(current)),
    }
}

async fn put_obra_social(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(nombre): axum::extract::Path<String>,
    Json(body): Json<ObraSocialCatalog>,
) -> Result<Json<serde_json::Value>, (StatusCode, axum::Json<serde_json::Value>)> {
    let session = authenticate_request(&state, &headers, None).map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_password_change_required(&session)?;
    if session.must_change_password { return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "must_change_password"})))); }
    if !can_write_obras_sociales(&session.role) { return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "role_forbidden"})))); }
    check_write_enabled(&state).await?;

    let nombre_norm = nombre.trim();
    if nombre_norm.is_empty() {
        return Err(validation_response("nombre es requerido"));
    }
    if body.plus < 0 || body.plus > 100_000_000 {
        return Err(validation_response("plus fuera de rango"));
    }
    if body.arancel < 0 || body.arancel > 100_000_000 {
        return Err(validation_response("arancel fuera de rango"));
    }
    if body.cuidar < 0 || body.cuidar > 10000 {
        return Err(validation_response("cuidar fuera de rango"));
    }
    if body.imp_banco < 0 || body.imp_banco > 10000 {
        return Err(validation_response("imp_banco fuera de rango"));
    }
    if body.imp_factura < 0 || body.imp_factura > 10000 {
        return Err(validation_response("imp_factura fuera de rango"));
    }
    if body.gastos_adm < 0 || body.gastos_adm > 10000 {
        return Err(validation_response("gastos_adm fuera de rango"));
    }

    let mut to_save = body.clone();
    to_save.nombre = nombre_norm.to_string();

    match service::save_obra_social(&to_save).map_err(|_| internal_error_response())? {
        ObraSocialWriteResult::Saved(saved) => Ok(Json(serde_json::to_value(&saved).unwrap())),
        ObraSocialWriteResult::Conflict { current } => Err(conflict_obra_social_response(current)),
    }
}

async fn delete_obra_social(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(nombre): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, axum::Json<serde_json::Value>)> {
    let session = authenticate_request(&state, &headers, None).map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_password_change_required(&session)?;
    if session.must_change_password { return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "must_change_password"})))); }
    if !can_write_obras_sociales(&session.role) { return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "role_forbidden"})))); }
    check_write_enabled(&state).await?;

    let nombre_norm = nombre.trim();
    if nombre_norm.is_empty() {
        return Err(validation_response("nombre es requerido"));
    }

    match service::delete_obra_social(nombre_norm).map_err(|_| internal_error_response())? {
        Ok(()) => Ok(Json(serde_json::json!({"ok": true}))),
        Err(msg) => Err((StatusCode::BAD_REQUEST, axum::Json(serde_json::json!({"error": "en_uso", "message": msg})))),
    }
}

// ── Pagos de afiliados (pantalla reducida de cobranza) ────────────────────────

/// Ver y cobrar cuotas de afiliados: administración y secretaría.
fn puede_cobrar_afiliados(role: &str) -> bool {
    matches!(role, "admin" | "secretaria")
}

#[derive(Deserialize)]
struct PagosAfiliadosQuery {
    #[serde(default)]
    q: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CuotaPendienteResp {
    anio: i32,
    mes: u32,
    monto: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    cuota_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeudorResp {
    afiliado_id: String,
    nombre: String,
    dni: String,
    cobertura: String,
    adeudado: f64,
    cuotas: Vec<CuotaPendienteResp>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ListadoPagosAfiliadosResp {
    deudores: Vec<DeudorResp>,
    total_adeudado: f64,
    cantidad: usize,
    sin_deuda: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CobrarCuotaReq {
    anio: i32,
    mes: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CobrarPagosAfiliadosReq {
    afiliado_id: String,
    cuotas: Vec<CobrarCuotaReq>,
    forma_pago: String,
}

struct MesPendiente {
    anio: i32,
    mes: u32,
    monto: f64,
    cuota_data: Option<serde_json::Value>,
}

fn json_str(value: &serde_json::Value, key: &str) -> String {
    value.get(key).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

fn json_num(value: &serde_json::Value, key: &str) -> f64 {
    value.get(key).and_then(|x| x.as_f64()).unwrap_or(0.0)
}

fn json_i64(value: &serde_json::Value, key: &str) -> Option<i64> {
    value.get(key).and_then(|x| x.as_i64())
}

/// Normaliza para buscar sin distinguir mayúsculas ni tildes.
fn normalizar_busqueda(texto: &str) -> String {
    texto
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'ä' | 'â' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ñ' => 'n',
            otro => otro,
        })
        .collect::<String>()
        .trim()
        .to_string()
}

fn parse_anio_mes(fecha: &str) -> Option<(i32, u32)> {
    let mut partes = fecha.split('-');
    let anio: i32 = partes.next()?.trim().parse().ok()?;
    let mes: u32 = partes.next()?.trim().parse().ok()?;
    if !(1..=12).contains(&mes) {
        return None;
    }
    Some((anio, mes))
}

/// Fecha de hoy según el reloj local del servidor (misma que usa la UI).
fn fecha_local_hoy(conn: &rusqlite::Connection) -> Result<(i32, u32, String), AppError> {
    conn.query_row(
        "SELECT CAST(strftime('%Y','now','localtime') AS INTEGER),
                CAST(strftime('%m','now','localtime') AS INTEGER),
                date('now','localtime')",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .map_err(AppError::from)
}

/// Fecha y hora UTC en ISO 8601, para `registradoEn`.
fn ahora_utc_iso(conn: &rusqlite::Connection) -> Result<String, AppError> {
    conn.query_row(
        "SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        [],
        |row| row.get(0),
    )
    .map_err(AppError::from)
}

fn mapa_cuotas<'a>(
    cuotas: &'a [serde_json::Value],
) -> HashMap<(String, i32, u32), &'a serde_json::Value> {
    let mut mapa = HashMap::new();
    for cuota in cuotas {
        let afiliado_id = json_str(cuota, "afiliadoId");
        let (Some(anio), Some(mes)) = (json_i64(cuota, "anio"), json_i64(cuota, "mes")) else {
            continue;
        };
        mapa.entry((afiliado_id, anio as i32, mes as u32)).or_insert(cuota);
    }
    mapa
}

/// Meses impagos desde la fecha de contratación. Hasta el mes actual se
/// infieren las cuotas faltantes; para meses futuros del año sólo se incluyen
/// cuotas pendientes que ya estén registradas.
fn meses_pendientes(
    afiliado_id: &str,
    fecha_inicio: &str,
    precio_plan: f64,
    cuotas_por_mes: &HashMap<(String, i32, u32), &serde_json::Value>,
    anio_actual: i32,
    mes_actual: u32,
) -> Vec<MesPendiente> {
    let Some((anio_inicio, mes_inicio)) = parse_anio_mes(fecha_inicio) else {
        return Vec::new();
    };
    if (anio_inicio, mes_inicio) > (anio_actual, mes_actual) {
        return Vec::new();
    }

    let mut pendientes = Vec::new();
    for anio in anio_inicio..=anio_actual {
        let primer_mes = if anio == anio_inicio { mes_inicio } else { 1 };
        let ultimo_mes = 12;
        for mes in primer_mes..=ultimo_mes {
            let clave = (afiliado_id.to_string(), anio, mes);
            match cuotas_por_mes.get(&clave) {
                Some(cuota) => {
                    if json_str(cuota, "estado") == "pagado" {
                        continue;
                    }
                    pendientes.push(MesPendiente {
                        anio,
                        mes,
                        monto: json_num(cuota, "monto"),
                        cuota_data: Some((*cuota).clone()),
                    });
                }
                None => {
                    let es_mes_futuro = anio == anio_actual && mes > mes_actual;
                    if !es_mes_futuro {
                        pendientes.push(MesPendiente {
                            anio,
                            mes,
                            monto: precio_plan,
                            cuota_data: None,
                        });
                    }
                }
            }
        }
    }
    pendientes
}

fn mes_en_rango(
    inicio: (i32, u32),
    actual: (i32, u32),
    anio: i32,
    mes: u32,
) -> bool {
    (anio, mes) >= inicio && (anio, mes) <= actual
}

fn auditar_permiso_denegado(
    session: &Session,
    entidad: &str,
    entidad_id: Option<&str>,
    detalle: &str,
) {
    let Ok(mut conn) = db::open_connection() else {
        return;
    };
    let Ok(tx) = conn.transaction() else {
        return;
    };
    let _ = service::write_audit_log(
        &tx,
        &session.username,
        &session.role,
        "PERMISO_DENEGADO",
        entidad,
        entidad_id,
        Some(detalle),
    );
    let _ = tx.commit();
}

async fn get_pagos_afiliados(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PagosAfiliadosQuery>,
) -> Result<Json<ListadoPagosAfiliadosResp>, (StatusCode, axum::Json<serde_json::Value>)> {
    let session = authenticate_request(&state, &headers, None)
        .map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_password_change_required(&session)?;
    if !puede_cobrar_afiliados(&session.role) {
        auditar_permiso_denegado(
            &session,
            "pagos_afiliados",
            None,
            "intento de ver deudores sin permiso",
        );
        return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "role_forbidden"}))));
    }

    let conn = db::open_connection().map_err(|_| internal_error_response())?;
    let afiliados = repository::load_afiliados_table(&conn).map_err(|_| internal_error_response())?;
    let planes = repository::load_planes_table(&conn).map_err(|_| internal_error_response())?;
    let cuotas = repository::load_cuotas_table(&conn).map_err(|_| internal_error_response())?;
    let patients = repository::load_patients(&conn).map_err(|_| internal_error_response())?;
    let (anio_actual, mes_actual, _) = fecha_local_hoy(&conn).map_err(|_| internal_error_response())?;

    let consulta = normalizar_busqueda(query.q.as_deref().unwrap_or(""));
    let cuotas_por_mes = mapa_cuotas(&cuotas);
    let planes_por_id: HashMap<&str, &serde_json::Value> = planes
        .iter()
        .map(|p| (p.get("id").and_then(|x| x.as_str()).unwrap_or(""), p))
        .collect();
    let pacientes_por_id: HashMap<&str, &Patient> =
        patients.iter().map(|p| (p.id.as_str(), p)).collect();

    let mut deudores: Vec<DeudorResp> = Vec::new();
    let mut hubo_coincidencia_sin_deuda = false;

    for afiliado in &afiliados {
        let afiliado_id = json_str(afiliado, "id");
        if afiliado_id.is_empty() {
            continue;
        }
        let patient_id = json_str(afiliado, "patientId");
        let paciente = pacientes_por_id.get(patient_id.as_str()).copied();

        if !consulta.is_empty() {
            let nombre = paciente
                .map(|p| format!("{} {}", p.apellido, p.nombre))
                .unwrap_or_default();
            let dni = paciente.map(|p| p.dni.clone()).unwrap_or_default();
            if !normalizar_busqueda(&nombre).contains(&consulta)
                && !normalizar_busqueda(&dni).contains(&consulta)
            {
                continue;
            }
        }

        let plan_id = json_str(afiliado, "planId");
        let plan = planes_por_id.get(plan_id.as_str()).copied();
        let precio_plan = plan.map(|p| json_num(p, "precio")).unwrap_or(0.0);
        let cobertura = plan
            .map(|p| json_str(p, "nombre"))
            .filter(|n| !n.trim().is_empty())
            .unwrap_or_else(|| "—".to_string());

        let pendientes = meses_pendientes(
            &afiliado_id,
            &json_str(afiliado, "fechaInicio"),
            precio_plan,
            &cuotas_por_mes,
            anio_actual,
            mes_actual,
        );
        if pendientes.is_empty() {
            if !consulta.is_empty() {
                hubo_coincidencia_sin_deuda = true;
            }
            continue;
        }

        let adeudado = pendientes.iter().map(|c| c.monto).sum::<f64>();
        deudores.push(DeudorResp {
            afiliado_id,
            nombre: paciente
                .map(|p| {
                    let apellido = p.apellido.trim();
                    let nombre = p.nombre.trim();
                    if !apellido.is_empty() && !nombre.is_empty() {
                        format!("{apellido}, {nombre}")
                    } else if !apellido.is_empty() {
                        apellido.to_string()
                    } else if !nombre.is_empty() {
                        nombre.to_string()
                    } else {
                        "—".to_string()
                    }
                })
                .unwrap_or_else(|| "—".to_string()),
            dni: paciente
                .map(|p| p.dni.trim())
                .filter(|d| !d.is_empty())
                .unwrap_or("—")
                .to_string(),
            cobertura,
            adeudado,
            cuotas: pendientes
                .into_iter()
                .map(|c| CuotaPendienteResp {
                    anio: c.anio,
                    mes: c.mes,
                    monto: c.monto,
                    cuota_id: c
                        .cuota_data
                        .as_ref()
                        .map(|v| json_str(v, "id"))
                        .filter(|id| !id.is_empty()),
                })
                .collect(),
        });
    }

    deudores.sort_by(|a, b| {
        b.adeudado
            .partial_cmp(&a.adeudado)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                a.nombre
                    .to_lowercase()
                    .cmp(&b.nombre.to_lowercase())
            })
    });

    let total_adeudado = deudores.iter().map(|d| d.adeudado).sum::<f64>();
    Ok(Json(ListadoPagosAfiliadosResp {
        cantidad: deudores.len(),
        total_adeudado,
        sin_deuda: !consulta.is_empty() && deudores.is_empty() && hubo_coincidencia_sin_deuda,
        deudores,
    }))
}

fn marcar_cuota_pagada(
    original: Option<&serde_json::Value>,
    afiliado_id: &str,
    anio: i32,
    mes: u32,
    monto: f64,
    forma_pago: &str,
    fecha_pago: &str,
    registrado_en: &str,
    usuario: &str,
) -> serde_json::Value {
    let mut obj = original
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();

    let id = obj
        .get("id")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    obj.insert("id".to_string(), serde_json::json!(id));
    obj.insert("afiliadoId".to_string(), serde_json::json!(afiliado_id));
    obj.insert("anio".to_string(), serde_json::json!(anio));
    obj.insert("mes".to_string(), serde_json::json!(mes));
    obj.insert("monto".to_string(), serde_json::json!(monto));
    obj.insert("estado".to_string(), serde_json::json!("pagado"));
    obj.insert("fechaPago".to_string(), serde_json::json!(fecha_pago));
    obj.insert("formaPago".to_string(), serde_json::json!(forma_pago));
    obj.insert("comprobante".to_string(), serde_json::json!(true));
    obj.insert("cobradoPor".to_string(), serde_json::json!(usuario));
    obj.insert("registradoEn".to_string(), serde_json::json!(registrado_en));
    obj.entry("notas".to_string()).or_insert_with(|| serde_json::json!(""));
    obj.entry("usos".to_string()).or_insert_with(|| serde_json::json!(0));

    serde_json::Value::Object(obj)
}

async fn post_cobrar_pagos_afiliados(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CobrarPagosAfiliadosReq>,
) -> Result<Json<serde_json::Value>, (StatusCode, axum::Json<serde_json::Value>)> {
    let session = authenticate_request(&state, &headers, None)
        .map_err(|e| (e, axum::Json(serde_json::json!({"error": e.to_string()}))))?;
    check_password_change_required(&session)?;
    if !puede_cobrar_afiliados(&session.role) {
        auditar_permiso_denegado(
            &session,
            "pagos_afiliados",
            Some(&body.afiliado_id),
            "intento de cobrar cuotas sin permiso",
        );
        return Err((StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error": "role_forbidden"}))));
    }

    // Igual que `/api/app-data` (el camino normal de escritura del modo
    // cliente), el cobro no depende de `write_enabled`: ese interruptor no se
    // administra desde la app y por defecto está apagado.
    let forma_pago = body.forma_pago.trim().to_lowercase();
    if !matches!(
        forma_pago.as_str(),
        "efectivo" | "transferencia" | "deposito" | "mercadopago" | "debito"
    ) {
        return Err(validation_response("Forma de pago inválida"));
    }

    let mut seleccion: Vec<(i32, u32)> = Vec::new();
    let mut vistas = HashSet::new();
    for cuota in &body.cuotas {
        if !(1..=12).contains(&cuota.mes) {
            return Err(validation_response("Mes inválido"));
        }
        if vistas.insert((cuota.anio, cuota.mes)) {
            seleccion.push((cuota.anio, cuota.mes));
        }
    }
    if seleccion.is_empty() {
        return Err(validation_response("Seleccioná al menos una cuota"));
    }

    let mut conn = db::open_connection().map_err(|_| internal_error_response())?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| internal_error_response())?;

    let afiliados = repository::load_afiliados_table(&tx).map_err(|_| internal_error_response())?;
    let planes = repository::load_planes_table(&tx).map_err(|_| internal_error_response())?;
    let cuotas = repository::load_cuotas_table(&tx).map_err(|_| internal_error_response())?;
    let (anio_actual, mes_actual, fecha_hoy) =
        fecha_local_hoy(&tx).map_err(|_| internal_error_response())?;
    let registrado_en = ahora_utc_iso(&tx).map_err(|_| internal_error_response())?;

    let afiliado = afiliados
        .iter()
        .find(|a| json_str(a, "id") == body.afiliado_id)
        .ok_or_else(not_found_response)?;

    let plan_id = json_str(afiliado, "planId");
    let precio_plan = planes
        .iter()
        .find(|p| json_str(p, "id") == plan_id)
        .map(|p| json_num(p, "precio"))
        .unwrap_or(0.0);
    let pendientes = meses_pendientes(
        &body.afiliado_id,
        &json_str(afiliado, "fechaInicio"),
        precio_plan,
        &mapa_cuotas(&cuotas),
        anio_actual,
        mes_actual,
    );
    let pendientes_por_mes: HashMap<(i32, u32), &MesPendiente> = pendientes
        .iter()
        .map(|c| ((c.anio, c.mes), c))
        .collect();

    // Si alguna cuota ya fue paga, se rechaza todo el cobro (sin doble cobro).
    for (anio, mes) in &seleccion {
        if !pendientes_por_mes.contains_key(&(*anio, *mes)) {
            return Err((
                StatusCode::CONFLICT,
                axum::Json(serde_json::json!({
                    "error": "cuota_ya_pagada",
                    "anio": anio,
                    "mes": mes
                })),
            ));
        }
    }

    // Validar que los meses seleccionados sean consecutivos desde el primer mes impago.
    // Obtener el primer mes impago de la lista `pendientes`.
    let primer_mes_impuesto = pendientes.first().map(|p| (p.anio, p.mes));
    if let Some((start_anio, start_mes)) = primer_mes_impuesto {
        // Los meses seleccionados deben ser un subconjunto consecutivo empezando desde el primer mes impago.
        // Ordenar la selección por año/mes para validar la secuencia.
        let mut seleccion_ordenada: Vec<(i32, u32)> = seleccion.iter().cloned().collect();
        seleccion_ordenada.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));

        let mut expected_mes = start_mes;
        let mut expected_anio = start_anio;
        for (anio, mes) in &seleccion_ordenada {
            if (*anio, *mes) != (expected_anio, expected_mes) {
                return Err((
                    StatusCode::CONFLICT,
                    axum::Json(serde_json::json!({
                        "error": "meses_no_consecutivos",
                        "message": "Las cuotas seleccionadas deben ser meses consecutivos desde el primer mes impago."
                    })),
                ));
            }
            // Avanzar al siguiente mes
            if *mes == 12 {
                expected_anio += 1;
                expected_mes = 1;
            } else {
                expected_mes += 1;
            }
        }
    }

    let mut pagadas: Vec<serde_json::Value> = Vec::new();
    let mut total = 0.0;
    for (anio, mes) in &seleccion {
        let pendiente = pendientes_por_mes
            .get(&(*anio, *mes))
            .expect("la selección fue validada");
        total += pendiente.monto;

        let cuota = marcar_cuota_pagada(
            pendiente.cuota_data.as_ref(),
            &body.afiliado_id,
            *anio,
            *mes,
            pendiente.monto,
            &forma_pago,
            &fecha_hoy,
            &registrado_en,
            &session.username,
        );
        let id = json_str(&cuota, "id");
        let data = serde_json::to_string(&cuota).map_err(|_| internal_error_response())?;

        if pendiente.cuota_data.is_some() {
            tx.execute(
                "UPDATE cuotas_afiliados
                 SET monto = ?1, version = COALESCE(version, 1) + 1, data = ?2
                 WHERE id = ?3",
                params![pendiente.monto, data, id],
            )
            .map_err(|_| internal_error_response())?;
        } else {
            tx.execute(
                "INSERT INTO cuotas_afiliados (id, monto, version, data) VALUES (?1, ?2, 1, ?3)",
                params![id, pendiente.monto, data],
            )
            .map_err(|_| internal_error_response())?;
        }

        pagadas.push(cuota);
    }

    service::write_audit_log(
        &tx,
        &session.username,
        &session.role,
        "COBRAR_CUOTAS_AFILIADO",
        "pagos_afiliados",
        Some(&body.afiliado_id),
        Some(&format!(
            "{} cuota(s), forma de pago {}",
            seleccion.len(),
            forma_pago
        )),
    )
    .map_err(|_| internal_error_response())?;

    tx.commit().map_err(|_| internal_error_response())?;

    Ok(Json(serde_json::json!({
        "cuotas": pagadas,
        "total": total
    })))
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/device-access", axum::routing::post(request_device_access))
        .route("/api/session/heartbeat", get(session_heartbeat))
        .route("/api/login", axum::routing::post(login))
        .route("/api/change-password", axum::routing::post(change_password))
        .route("/api/auth-accounts", get(get_auth_accounts).post(post_auth_accounts))
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
        .route("/api/pagos-afiliados", get(get_pagos_afiliados))
        .route("/api/pagos-afiliados/cobrar", axum::routing::post(post_cobrar_pagos_afiliados))
        .route("/api/afiliados/con-paciente-nuevo", axum::routing::post(post_afiliado_con_paciente_nuevo))
        .route("/api/afiliados/:id", axum::routing::put(put_afiliado))
        .route("/api/planes", axum::routing::post(post_plan))
        .route("/api/planes/:id", axum::routing::put(put_plan))
        .route("/api/cuotas", axum::routing::post(post_cuota))
        .route("/api/cuotas/:id", axum::routing::put(put_cuota))
        .route("/api/obras-sociales", get(get_obras_sociales).post(post_obra_social))
        .route("/api/obras-sociales/:nombre", axum::routing::put(put_obra_social).delete(delete_obra_social))
        // Sincronización del estado completo para el modo cliente (PC2/PC3).
        .route(
            "/api/app-data",
            get(get_app_data)
                .post(post_app_data)
                .layer(DefaultBodyLimit::max(64 * 1024 * 1024)),
        )
        .with_state(state)
}

pub fn run_server() {
    // Protección: si la UI local ya está abierta (lock adquirido),
    // el servidor se niega a arrancar para evitar dos escritores simultáneos.
    let data_dir = settings::data_dir();
    let _lock_guard = match crate::instance_lock::try_lock(&data_dir) {
        Ok(guard) => guard,
        Err(crate::instance_lock::LockError::Busy) => {
            rfd::MessageDialog::new()
                .set_title("Sanatorio - UI activa")
                .set_description("Ya hay otra instancia (UI o servidor) usando los datos.")
                .set_buttons(rfd::MessageButtons::Ok)
                .show();
            std::process::exit(1);
        }
        Err(crate::instance_lock::LockError::Io(e)) => {
            rfd::MessageDialog::new()
                .set_title("Sanatorio - Error")
                .set_description(&e)
                .set_buttons(rfd::MessageButtons::Ok)
                .show();
            std::process::exit(1);
        }
    };

    if rustls::crypto::CryptoProvider::get_default().is_none()
        && rustls::crypto::ring::default_provider().install_default().is_err()
    {
        rfd::MessageDialog::new()
            .set_title("Sanatorio - Error TLS")
            .set_description("No se pudo inicializar el proveedor criptográfico TLS.")
            .set_buttons(rfd::MessageButtons::Ok)
            .show();
        std::process::exit(1);
    }
    if let Err(error) = service::ensure_initialized() {
        rfd::MessageDialog::new()
            .set_title("Sanatorio - Error de almacenamiento")
            .set_description(&format!("No se pudo inicializar el almacenamiento: {error}"))
            .set_buttons(rfd::MessageButtons::Ok)
            .show();
        std::process::exit(1);
    }
    if let Err(error) = std::fs::create_dir_all(&data_dir) {
        rfd::MessageDialog::new()
            .set_title("Sanatorio - Error de almacenamiento")
            .set_description(&format!("No se pudo crear el directorio de datos: {error}"))
            .set_buttons(rfd::MessageButtons::Ok)
            .show();
        std::process::exit(1);
    }

    // TLS
    let tls_dir = settings::sanatorio_root().join("config").join("tls");
    if let Err(error) = std::fs::create_dir_all(&tls_dir) {
        rfd::MessageDialog::new()
            .set_title("Sanatorio - Error de certificado")
            .set_description(&format!("No se pudo crear la carpeta TLS: {error}"))
            .set_buttons(rfd::MessageButtons::Ok)
            .show();
        std::process::exit(1);
    }
    let cert_path = tls_dir.join("server-cert.pem");
    let key_path = tls_dir.join("server-key.pem");
    let cert_names = match server_tls_names(&tls_dir) {
        Ok(v) => v,
        Err(e) => {
            rfd::MessageDialog::new()
                .set_title("Sanatorio - Error de red/certificado")
                .set_description(&e)
                .set_buttons(rfd::MessageButtons::Ok)
                .show();
            std::process::exit(1);
        }
    };
    match crate::tls_files::ensure_server_cert(&tls_dir, &cert_names) {
        Ok(crate::tls_files::CertOutcome::Regenerated) => {
            eprintln!("[tls] certificado generado para: {}", cert_names.join(", "));
        }
        Ok(crate::tls_files::CertOutcome::Unchanged) => {}
        Err(e) => {
            rfd::MessageDialog::new()
                .set_title("Sanatorio - Error de certificado")
                .set_description(&e)
                .set_buttons(rfd::MessageButtons::Ok)
                .show();
            std::process::exit(1);
        }
    }
    #[cfg(windows)]
    check_firewall_rules();

    let accounts = load_accounts(&data_dir);
    let device_access = match load_device_access(&data_dir) {
        Ok(records) => records,
        Err(error) => {
            rfd::MessageDialog::new()
                .set_title("Sanatorio - Error de dispositivos")
                .set_description(&error)
                .set_buttons(rfd::MessageButtons::Ok)
                .show();
            std::process::exit(1);
        }
    };

    let state = AppState {
        accounts: Arc::new(Mutex::new(accounts)),
        data_dir: data_dir.clone(),
        sessions: Arc::new(Mutex::new(HashMap::new())),
        login_attempts: Arc::new(Mutex::new(HashMap::new())),
        device_access: Arc::new(Mutex::new(device_access)),
        pairing_code: Arc::new(Mutex::new(None)),
        pairing_attempts: Arc::new(Mutex::new(Vec::new())),
    };
    activate_server_state(state.clone());

    let app = build_router(state);

    let cert_pem = std::fs::read_to_string(&cert_path)
        .unwrap_or_else(|error| {
            rfd::MessageDialog::new()
                .set_title("Sanatorio - Error TLS")
                .set_description(&format!("No se pudo leer el certificado: {error}"))
                .set_buttons(rfd::MessageButtons::Ok)
                .show();
            std::process::exit(1);
        });
    let rt = tokio::runtime::Runtime::new().unwrap_or_else(|error| {
        rfd::MessageDialog::new()
            .set_title("Sanatorio - Error")
            .set_description(&format!("No se pudo crear tokio runtime: {error}"))
            .set_buttons(rfd::MessageButtons::Ok)
            .show();
        std::process::exit(1);
    });
    let startup: Result<(), String> = rt.block_on(async {
        let addr: SocketAddr = "0.0.0.0:8787"
            .parse()
            .map_err(|error| format!("Dirección del servidor inválida: {error}"))?;
        let rustls_config = RustlsConfig::from_pem_file(&cert_path, &key_path)
            .await
            .map_err(|error| format!("No se pudo cargar TLS: {error}"))?;
        let handle = axum_server::Handle::new();
        let task = tokio::spawn(
            axum_server::bind_rustls(addr, rustls_config)
                .handle(handle.clone())
                .serve(app.into_make_service()),
        );
        let listening = tokio::time::timeout(Duration::from_secs(5), handle.listening())
            .await
            .map_err(|_| "Timeout esperando HTTPS en TCP 8787".to_string())?
            .ok_or_else(|| "HTTPS no confirmó que está escuchando".to_string())?;
        log::info!("API HTTPS escuchando en {listening}");
        if let Err(error) =
            crate::discovery::start_udp_responder(server_nickname(), cert_pem)
        {
            log::error!("API HTTPS disponible, pero no inició discovery UDP: {error}");
            let _ = crate::login_diagnostics::record_server_startup_diagnostic("discovery");
        }
        match task.await {
            Ok(Ok(())) => Err("El servidor HTTPS terminó inesperadamente".to_string()),
            Ok(Err(error)) => Err(format!("Falló el servidor HTTPS: {error}")),
            Err(error) => Err(format!("Falló la tarea HTTPS: {error}")),
        }
    });
    if let Err(error) = startup {
        log::error!("No se pudo mantener el servidor Sanatorio: {error}");
        record_startup_diagnostic("server");
        rfd::MessageDialog::new()
            .set_title("Sanatorio - Error de servidor")
            .set_description(&error)
            .set_buttons(rfd::MessageButtons::Ok)
            .show();
        std::process::exit(1);
    }
}

static BACKGROUND_SERVER_STARTED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Inicia el servidor HTTPS en todas las interfaces y el responder UDP LAN.
pub fn start_background_server() {
    if BACKGROUND_SERVER_STARTED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }

    let thread = std::thread::Builder::new()
        .name("sanatorio-bg-server".to_string())
        .spawn(|| {
            let result = (|| -> Result<(), String> {
                if rustls::crypto::CryptoProvider::get_default().is_none() {
                    rustls::crypto::ring::default_provider()
                        .install_default()
                        .map_err(|_| "No se pudo inicializar el proveedor criptográfico TLS".to_string())?;
                }
                service::ensure_initialized()
                    .map_err(|error| format!("No se pudo inicializar el almacenamiento: {error}"))?;
                let data_dir = settings::data_dir();
                std::fs::create_dir_all(&data_dir)
                    .map_err(|error| format!("No se pudo crear el directorio de datos: {error}"))?;

                let tls_dir = settings::sanatorio_root().join("config").join("tls");
                let cert_path = tls_dir.join("server-cert.pem");
                let key_path = tls_dir.join("server-key.pem");
                let cert_names = server_tls_names(&tls_dir)?;
                crate::tls_files::ensure_server_cert(&tls_dir, &cert_names)?;
                let cert_pem = std::fs::read_to_string(&cert_path)
                    .map_err(|error| format!("No se pudo leer el certificado TLS: {error}"))?;

                #[cfg(windows)]
                check_firewall_rules();

                let accounts = load_accounts(&data_dir);
                let device_access = load_device_access(&data_dir)?;
                let state = AppState {
                    accounts: Arc::new(Mutex::new(accounts)),
                    data_dir: data_dir.clone(),
                    sessions: Arc::new(Mutex::new(HashMap::new())),
                    login_attempts: Arc::new(Mutex::new(HashMap::new())),
                    device_access: Arc::new(Mutex::new(device_access)),
                    pairing_code: Arc::new(Mutex::new(None)),
                    pairing_attempts: Arc::new(Mutex::new(Vec::new())),
                };
                activate_server_state(state.clone());
                let app = build_router(state);
                let rt = tokio::runtime::Runtime::new()
                    .map_err(|error| format!("No se pudo crear tokio runtime: {error}"))?;
                rt.block_on(async {
                    let rustls_config = RustlsConfig::from_pem_file(&cert_path, &key_path)
                        .await
                        .map_err(|error| format!("No se pudo cargar el certificado/clave TLS: {error}"))?;
                    let addr: SocketAddr = "0.0.0.0:8787".parse()
                        .map_err(|error| format!("Dirección del servidor inválida: {error}"))?;
                    let handle = axum_server::Handle::new();
                    let server = axum_server::bind_rustls(addr, rustls_config)
                        .handle(handle.clone())
                        .serve(app.into_make_service());
                    let task = tokio::spawn(server);
                    let listening = tokio::time::timeout(
                        Duration::from_secs(5),
                        handle.listening(),
                    )
                    .await
                    .map_err(|_| "Timeout esperando que HTTPS escuche en TCP 8787".to_string())?
                    .ok_or_else(|| "El servidor HTTPS no confirmó una dirección de escucha".to_string())?;
                    log::info!("API HTTPS escuchando en {listening}");
                    if let Err(error) = crate::discovery::start_udp_responder(
                        server_nickname(),
                        cert_pem,
                    ) {
                        log::error!("API HTTPS disponible, pero no inició discovery UDP: {error}");
                        record_startup_diagnostic("discovery");
                    }
                    match task.await {
                        Ok(Ok(())) => Err("El servidor HTTPS terminó inesperadamente".to_string()),
                        Ok(Err(error)) => Err(format!("Falló el servidor HTTPS: {error}")),
                        Err(error) => Err(format!("Falló la tarea del servidor HTTPS: {error}")),
                    }
                })
            })();
            if let Err(error) = result {
                log::error!("No se pudo iniciar el servidor Sanatorio: {error}");
                eprintln!("[Sanatorio] No se pudo iniciar el servidor: {error}");
                record_startup_diagnostic("server");
                BACKGROUND_SERVER_STARTED.store(false, std::sync::atomic::Ordering::SeqCst);
            }
        });
    if let Err(error) = thread {
        BACKGROUND_SERVER_STARTED.store(false, std::sync::atomic::Ordering::SeqCst);
        log::error!("No se pudo crear el hilo del servidor: {error}");
        record_startup_diagnostic("server");
    }
}

#[cfg(windows)]
fn check_firewall_rules() {
    use std::os::windows::process::CommandExt;
    for rule in ["Sanatorio Server", "Sanatorio Discovery"] {
        match Command::new("netsh")
            .args(["advfirewall", "firewall", "show", "rule", &format!("name={rule}")])
            .creation_flags(0x08000000)
            .output()
        {
            Ok(output) if output.status.success() => {
                let details = String::from_utf8_lossy(&output.stdout).to_ascii_lowercase();
                let expected_port = if rule == "Sanatorio Server" { "8787" } else { "8788" };
                let private_profile = details.contains("private")
                    || details.contains("privado")
                    || details.contains("privat");
                if !details.contains("localsubnet")
                    || !details.contains(expected_port)
                    || !private_profile
                {
                    log::warn!(
                        "La regla de firewall '{rule}' existe, pero no se pudo confirmar su alcance LAN LocalSubnet/puerto. Revísela antes de habilitar acceso de red."
                    );
                    record_startup_diagnostic("firewall");
                }
            }
            Ok(output) => {
                log::warn!(
                    "No se verificó la regla de firewall '{rule}' (código {}). Configure TCP 8787/UDP 8788 únicamente para el perfil y segmentos LAN autorizados.",
                    output.status
                );
                record_startup_diagnostic("firewall");
            }
            Err(error) => {
                log::warn!(
                    "No se pudo consultar la regla de firewall '{rule}': {error}. Configure TCP 8787/UDP 8788 únicamente para el perfil y segmentos LAN autorizados."
                );
                record_startup_diagnostic("firewall");
            }
        }
    }
}

fn record_startup_diagnostic(kind: &str) {
    if let Err(error) = crate::login_diagnostics::record_server_startup_diagnostic(kind) {
        log::error!("No se pudo registrar el evento de inicio '{kind}': {error}");
    }
}


#[cfg(test)]
mod tests {
    use std::env;
    use std::fs;
    use std::sync::{Arc, Mutex};
    use std::sync::atomic::AtomicUsize;
    use tempfile::tempdir;
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
            device_access: Arc::new(Mutex::new(HashMap::new())),
            pairing_code: Arc::new(Mutex::new(Some("ABC123".into()))),
            pairing_attempts: Arc::new(Mutex::new(Vec::new())),
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

    #[test]
    fn credenciales_iniciales_validas_y_anterior_no() {
        let data_dir = tempdir().unwrap();
        let accounts = load_accounts(data_dir.path());
        let cases = [
            ("Aguirre Mary", "789", "123"),
            ("Barua Andrea", "951", "1379"),
            ("Contratantes", "465", "456"),
            ("Admi", "753", "admin"),
        ];

        for (username, password, previous_password) in cases {
            let account = accounts.iter().find(|account| account.username == username).unwrap();
            assert!(verify_password(account, password), "credencial inicial invalida para {username}");
            assert!(!verify_password(account, previous_password), "se acepto contraseña anterior para {username}");
        }
    }

    #[test]
    fn actualiza_la_clave_afiliados_en_semillas_anteriores() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("auth-accounts.json");
        let raw = serde_json::json!([{
            "username": "Afiliados",
            "role": "afiliado",
            "displayName": "Afiliados",
            "password": "456"
        }]);
        std::fs::write(&path, raw.to_string()).unwrap();
        let accounts = load_accounts(directory.path());

        let account = accounts.iter().find(|account| account.username == "Contratantes").unwrap();
        assert!(verify_password(account, "465"));
        assert!(!verify_password(account, "456"));
        assert!(!accounts.iter().any(|account| account.username == "Afiliados"));
    }

    #[tokio::test]
    async fn login_acepta_contratantes_y_rechaza_el_nombre_anterior() {
        let test = TestApp::new(None).await.unwrap();

        let (status, _) = test
            .post(
                "/api/login",
                r#"{"username":"Contratantes","password":"465"}"#,
                None,
            )
            .await;
        assert_eq!(status, StatusCode::OK);

        let (old_status, _) = test
            .post(
                "/api/login",
                r#"{"username":"Afiliados","password":"465"}"#,
                None,
            )
            .await;
        assert_eq!(old_status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn pairing_key_approves_persistently_and_rotation_does_not_revoke_devices() {
        let test = TestApp::new(None).await.unwrap();
        let request = |device_id: &str, code: &str| {
            format!(
                r#"{{"deviceId":"{device_id}","deviceName":"PC {device_id}","pairingCode":"{code}"}}"#
            )
        };

        let (status, body) = test
            .post(
                "/api/device-access",
                &request("client-one", "ABC123"),
                None,
            )
            .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&body).unwrap()["status"],
            "approved"
        );
        let (login_status, _) = post_json(
            &test.router,
            "/api/login",
            r#"{"username":"Contratantes","password":"465","device_id":"client-one","device_name":"PC client-one"}"#,
            None,
        )
        .await;
        assert_eq!(login_status, StatusCode::OK);

        *test
            .pairing_code
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = Some("NEW456".into());

        let (existing_status, existing_body) = test
            .post(
                "/api/device-access",
                &request("client-one", "ABC123"),
                None,
            )
            .await;
        assert_eq!(existing_status, StatusCode::OK);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&existing_body).unwrap()["status"],
            "approved"
        );
        assert!(test
            .server_state
            .sessions
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .values()
            .any(|session| session.device_id == "client-one"));

        let (old_code_status, old_code_body) = test
            .post(
                "/api/device-access",
                &request("client-two", "ABC123"),
                None,
            )
            .await;
        assert_eq!(old_code_status, StatusCode::OK);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&old_code_body).unwrap()["status"],
            "invalid_code"
        );
        let (unapproved_login_status, _) = post_json(
            &test.router,
            "/api/login",
            r#"{"username":"Contratantes","password":"465","device_id":"client-two","device_name":"PC client-two"}"#,
            None,
        )
        .await;
        assert_eq!(unapproved_login_status, StatusCode::FORBIDDEN);

        let (new_code_status, new_code_body) = test
            .post(
                "/api/device-access",
                &request("client-two", "NEW456"),
                None,
            )
            .await;
        assert_eq!(new_code_status, StatusCode::OK);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&new_code_body).unwrap()["status"],
            "approved"
        );
        assert_eq!(
            load_device_access(&test.data_dir).unwrap()["client-one"].status,
            DeviceAccessStatus::Approved
        );

        revoke_device_access(&test.server_state, "client-one").unwrap();
        let (revoked_status, revoked_body) = test
            .post(
                "/api/device-access",
                &request("client-one", "NEW456"),
                None,
            )
            .await;
        assert_eq!(revoked_status, StatusCode::OK);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&revoked_body).unwrap()["status"],
            "revoked"
        );
        assert_eq!(
            load_device_access(&test.data_dir).unwrap()["client-one"].status,
            DeviceAccessStatus::Revoked
        );
        let (revoked_login_status, _) = post_json(
            &test.router,
            "/api/login",
            r#"{"username":"Contratantes","password":"465","device_id":"client-one","device_name":"PC client-one"}"#,
            None,
        )
        .await;
        assert_eq!(revoked_login_status, StatusCode::FORBIDDEN);
        assert!(test
            .server_state
            .sessions
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .values()
            .all(|session| session.device_id != "client-one"));
    }

    #[test]
    fn generated_pairing_key_is_six_alphanumeric_characters() {
        let code = generate_pairing_code();
        assert_eq!(code.len(), 6);
        assert!(code.chars().all(|character| character.is_ascii_alphanumeric()));
    }

    #[test]
    fn limite_de_login_normaliza_mayusculas_y_espacios() {
        let state = AppState {
            accounts: Arc::new(Mutex::new(Vec::new())),
            data_dir: std::path::PathBuf::new(),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            login_attempts: Arc::new(Mutex::new(HashMap::new())),
            device_access: Arc::new(Mutex::new(HashMap::new())),
            pairing_code: Arc::new(Mutex::new(None)),
            pairing_attempts: Arc::new(Mutex::new(Vec::new())),
        };
        for _ in 0..5 {
            record_failure(&state, "Contratantes");
        }

        assert_eq!(
            check_rate_limit(&state, " contratantes "),
            Err(StatusCode::TOO_MANY_REQUESTS)
        );
        assert!(check_rate_limit(&state, "Otro usuario").is_ok());
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
    async fn test_app_data_get_filtra_colecciones_por_rol() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        let token_admin = test.login_as("admin").await;
        let token_secretaria = test.login_as("secretaria").await;
        let token_afiliado = test.login_as("afiliado").await;

        // Admin ve todo, incluido el módulo Afiliados.
        let (status, body) = test.get("/api/app-data", Some(&token_admin)).await;
        assert_eq!(status, StatusCode::OK, "GET app-data admin: {}", body);
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert!(v["patients"].is_array());
        assert!(v["afiliados"].is_array());
        assert!(v["planesAfiliados"].is_array());
        assert!(v["cuotasAfiliados"].is_array());
        assert!(v["settings"].is_object());

        // Secretaria no ve el módulo Afiliados.
        let (status, body) = test.get("/api/app-data", Some(&token_secretaria)).await;
        assert_eq!(status, StatusCode::OK, "GET app-data secretaria: {}", body);
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["afiliados"], serde_json::json!([]));
        assert_eq!(v["planesAfiliados"], serde_json::json!([]));
        assert_eq!(v["cuotasAfiliados"], serde_json::json!([]));
        assert!(v["patients"].is_array());
        assert!(v["settings"].is_object());

        // Afiliado solo ve Pacientes y Afiliados.
        let (status, body) = test.get("/api/app-data", Some(&token_afiliado)).await;
        assert_eq!(status, StatusCode::OK, "GET app-data afiliado: {}", body);
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert!(v["patients"].is_array());
        assert!(v["afiliados"].is_array());
        assert_eq!(v["doctors"], serde_json::json!([]));
        assert_eq!(v["payments"], serde_json::json!([]));
        assert_eq!(v["appointments"], serde_json::json!([]));
        assert!(v["settings"].is_object());

        drop(test);
    }

    #[tokio::test]
    async fn test_app_data_post_respeta_limites_de_rol() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        let token_admin = test.login_as("admin").await;
        let token_secretaria = test.login_as("secretaria").await;
        let token_afiliado = test.login_as("afiliado").await;

        // Admin puede guardar afiliados y settings.
        let (_, body) = test.get("/api/app-data", Some(&token_admin)).await;
        let mut data: serde_json::Value = serde_json::from_str(&body).unwrap();
        data["afiliados"] = serde_json::json!([{"id":"a1","nombre":"Admin"}]);
        data["settings"]["email"] = serde_json::json!("admin@test.com");
        let (status, body) = test
            .post("/api/app-data", &data.to_string(), Some(&token_admin))
            .await;
        assert_eq!(status, StatusCode::OK, "POST app-data admin: {}", body);

        let (_, body) = test.get("/api/app-data", Some(&token_admin)).await;
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["afiliados"][0]["id"], serde_json::json!("a1"));
        assert_eq!(v["settings"]["email"], serde_json::json!("admin@test.com"));

        // Secretaria intenta escribir afiliados: se ignora. Sus settings sí se guardan.
        let mut data = v;
        data["afiliados"] = serde_json::json!([{"id":"a2","nombre":"Intruso"}]);
        data["settings"]["email"] = serde_json::json!("secre@test.com");
        let (status, body) = test
            .post("/api/app-data", &data.to_string(), Some(&token_secretaria))
            .await;
        assert_eq!(status, StatusCode::OK, "POST app-data secretaria: {}", body);

        let (_, body) = test.get("/api/app-data", Some(&token_secretaria)).await;
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(
            v["afiliados"],
            serde_json::json!([]),
            "secretaria no debe poder escribir afiliados"
        );
        assert_eq!(v["settings"]["email"], serde_json::json!("secre@test.com"));

        // Afiliado intenta cambiar settings: se ignora. Sus afiliados sí se guardan.
        let mut data = v;
        data["settings"]["email"] = serde_json::json!("afiliado@test.com");
        data["afiliados"] = serde_json::json!([{"id":"a3","nombre":"Afiliado"}]);
        let (status, body) = test
            .post("/api/app-data", &data.to_string(), Some(&token_afiliado))
            .await;
        assert_eq!(status, StatusCode::OK, "POST app-data afiliado: {}", body);

        let (_, body) = test.get("/api/app-data", Some(&token_admin)).await;
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["settings"]["email"], serde_json::json!("secre@test.com"));

        let (_, body) = test.get("/api/app-data", Some(&token_afiliado)).await;
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["afiliados"][0]["id"], serde_json::json!("a3"));

        drop(test);
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
        server_state: AppState,
        accounts: Arc<Mutex<Vec<Account>>>,
        sessions: Arc<Mutex<HashMap<String, Session>>>,
        device_access: Arc<Mutex<HashMap<String, DeviceAccessRecord>>>,
        pairing_code: Arc<Mutex<Option<String>>>,
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
                fs::write(data_dir.join("auth-accounts.json"), raw)
                    .map_err(|error| format!("No se pudieron escribir las cuentas de prueba: {error}"))?;
                fs::write(
                    data_dir.join(crate::auth_defaults::MIGRATION_MARKER),
                    b"test fixture\n",
                )
                .map_err(|error| format!("No se pudo marcar la configuración de prueba: {error}"))?;
            }

            // Configurar SANATORIO_DATA_DIR para este test
            let _orig = env::var("SANATORIO_DATA_DIR").ok();
            env::set_var("SANATORIO_DATA_DIR", data_dir.to_str().unwrap());

            // Inicializar SQLite
            service::ensure_initialized().map_err(|e| format!("init SQLite: {e}"))?;

            // Cargar cuentas
            let loaded = load_accounts(&data_dir);
            let accounts = Arc::new(Mutex::new(loaded));
            let sessions = Arc::new(Mutex::new(HashMap::new()));
            let now = unix_timestamp();
            let device_access = Arc::new(Mutex::new(HashMap::from([(
                "test-device".to_string(),
                DeviceAccessRecord {
                    device_id: "test-device".to_string(),
                    device_name: "Equipo de prueba".to_string(),
                    status: DeviceAccessStatus::Approved,
                    first_seen: now,
                    last_seen: now,
                    approved_at: Some(now),
                },
            )])));
            let pairing_code = Arc::new(Mutex::new(Some("ABC123".into())));

            let state = AppState {
                accounts: accounts.clone(),
                data_dir: data_dir.clone(),
                sessions: sessions.clone(),
                login_attempts: Arc::new(Mutex::new(HashMap::new())),
                device_access: device_access.clone(),
                pairing_code: pairing_code.clone(),
                pairing_attempts: Arc::new(Mutex::new(Vec::new())),
            };

            let router = build_router(state.clone());

            Ok(TestApp {
                mutex: Arc::new(std::sync::Mutex::new(())),
                _guard: guard,
                counter,
                data_dir,
                router,
                server_state: state,
                accounts,
                sessions,
                device_access,
                pairing_code,
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
                &format!(
                    r#"{{"username":"{}","password":"{}","device_id":"test-device","device_name":"Equipo de prueba"}}"#,
                    username, password
                ),
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
            if uri == "/api/login" {
                if let Ok(mut value) = serde_json::from_str::<serde_json::Value>(body) {
                    let device_id = value
                        .get("device_id")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("test-device")
                        .to_string();
                    let device_name = value
                        .get("device_name")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("Equipo de prueba")
                        .to_string();
                    value["device_id"] = serde_json::Value::String(device_id.clone());
                    value["device_name"] = serde_json::Value::String(device_name.clone());
                    if let Ok(raw) = serde_json::to_string(&value) {
                        let now = unix_timestamp();
                        self.device_access
                            .lock()
                            .unwrap_or_else(|error| error.into_inner())
                            .entry(device_id.clone())
                            .or_insert(DeviceAccessRecord {
                                device_id,
                                device_name,
                                status: DeviceAccessStatus::Approved,
                                first_seen: now,
                                last_seen: now,
                                approved_at: Some(now),
                            });
                        return post_json(&self.router, uri, &raw, token).await;
                    }
                }
            }
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

    #[test]
    fn dispositivos_conectados_solo_incluye_sesiones_con_actividad_reciente() {
        let now = Instant::now();
        let active = Session {
            username: "Ana".to_string(),
            role: "admin".to_string(),
            display_name: "Ana".to_string(),
            must_change_password: false,
            expiry: now + Duration::from_secs(3600),
            device_id: "device-1".to_string(),
            device_name: "Recepcion-1".to_string(),
            connected_at: 100,
            last_seen: 200,
            last_activity: now,
        };
        let inactive = Session {
            device_id: "device-2".to_string(),
            device_name: "Recepcion-2".to_string(),
            last_activity: now - Duration::from_secs(90),
            ..active.clone()
        };
        let expired = Session {
            device_id: "device-3".to_string(),
            device_name: "Recepcion-3".to_string(),
            expiry: now - Duration::from_secs(1),
            ..active.clone()
        };
        let sessions = HashMap::from([
            ("token-1".to_string(), active),
            ("token-2".to_string(), inactive),
            ("token-3".to_string(), expired),
        ]);

        let devices = connected_devices_from_sessions(&sessions, now);
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].device_id, "device-1");
        assert_eq!(devices[0].device_name, "Recepcion-1");
        assert_eq!(devices[0].username, "Ana");
    }

    #[tokio::test]
    async fn heartbeat_requiere_una_sesion_autenticada() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        assert_eq!(
            test.get("/api/session/heartbeat", None).await.0,
            StatusCode::UNAUTHORIZED
        );

        let (login_status, login_body) = test
            .post(
                "/api/login",
                r#"{"username":"Admin","password":"admin123","device_id":"test-device","device_name":"Test PC"}"#,
                None,
            )
            .await;
        assert_eq!(login_status, StatusCode::OK, "{login_body}");
        let token = serde_json::from_str::<serde_json::Value>(&login_body).unwrap()["token"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(!token.is_empty());
        assert_eq!(
            test.get("/api/session/heartbeat", Some(&token)).await.0,
            StatusCode::OK
        );
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
    async fn test_afiliado_puede_post_put_pero_no_baja_pacientes() {
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

        // El afiliado puede crear y editar pacientes.
        let (status, body) = test
            .post(
                "/api/pacientes",
                r#"{"id":"pac-2","nombre":"Beto","apellido":"Gomez"}"#,
                Some(&token_afiliado),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "afiliado POST: {}", body);

        let (status, body) = test
            .put(
                "/api/pacientes/pac-2",
                r#"{"id":"pac-2","nombre":"Beto Editado","apellido":"Gomez","version":1}"#,
                Some(&token_afiliado),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "afiliado PUT: {}", body);

        // Pero no puede dar de baja: eso sigue siendo solo de admin.
        let (status, body) = test
            .post(
                "/api/pacientes/pac-2/baja",
                r#"{"version":2}"#,
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

        // El paciente editado sigue activo; la baja no se aplicó.
        let (_, body) = test.get("/api/pacientes", Some(&token_admin)).await;
        let lista: serde_json::Value = serde_json::from_str(&body).unwrap();
        let p = lista
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == "pac-2")
            .expect("pac-2 debe seguir existiendo");
        assert_eq!(p["nombre"], "Beto Editado");
        assert!(p["deletedAt"].is_null());

        drop(test);
    }

    #[tokio::test]
    async fn test_afiliado_write_disabled_retorna_writes_disabled() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        let token_afiliado = test.login_as("afiliado").await;
        // A propósito NO se habilitan las escrituras.

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
            json["error"], "writes_disabled",
            "el afiliado ya tiene permiso de rol: {}",
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

    #[tokio::test]
    async fn test_post_paciente_id_con_slash_retorna_400() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        let token_admin = test.login_as("admin").await;
        test.enable_writes(&token_admin).await;

        let (status, body) = test.post(
            "/api/pacientes",
            r#"{"id":"a/b","nombre":"Test","apellido":"User"}"#,
            Some(&token_admin),
        ).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "id con slash");
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["error"], "validation");
        assert_eq!(json["message"], "id inválido");

        drop(test);
    }

    #[tokio::test]
    async fn test_post_paciente_id_con_espacios_retorna_400() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        let token_admin = test.login_as("admin").await;
        test.enable_writes(&token_admin).await;

        let (status, body) = test.post(
            "/api/pacientes",
            r#"{"id":" x ","nombre":"Test","apellido":"User"}"#,
            Some(&token_admin),
        ).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "id con espacios");
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["error"], "validation");
        assert_eq!(json["message"], "id inválido");

        drop(test);
    }

    #[tokio::test]
    async fn test_post_paciente_id_largo_retorna_400() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        let token_admin = test.login_as("admin").await;
        test.enable_writes(&token_admin).await;

        let (status, body) = test.post(
            "/api/pacientes",
            r#"{"id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","nombre":"Test","apellido":"User"}"#,
            Some(&token_admin),
        ).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "id largo");
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["error"], "validation");
        assert_eq!(json["message"], "id inválido");

        drop(test);
    }

    /// Carga un contratante con deuda en el mes actual y otro al día.
    /// Devuelve (año, mes) del período pendiente.
    fn seed_pagos_afiliados() -> (i32, u32) {
        let mut conn = db::open_connection().unwrap();
        let (anio, mes, fecha_hoy) = fecha_local_hoy(&conn).unwrap();
        let inicio = format!("{anio}-{mes:02}-01");
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .unwrap();

        repository::save_patients(
            &tx,
            &[
                Patient {
                    id: "pac-1".to_string(),
                    nombre: "Ana".to_string(),
                    apellido: "Perez".to_string(),
                    dni: "12345678".to_string(),
                    telefono: String::new(),
                    email: String::new(),
                    domicilio: String::new(),
                    localidad: String::new(),
                    fecha_nacimiento: "1990-01-01".to_string(),
                    obra_social: String::new(),
                    obra_social_anterior: None,
                    notas: String::new(),
                    activo: Some(true),
                    version: 1,
                    deleted_at: None,
                },
                Patient {
                    id: "pac-2".to_string(),
                    nombre: "Bruno".to_string(),
                    apellido: "Gomez".to_string(),
                    dni: "87654321".to_string(),
                    telefono: String::new(),
                    email: String::new(),
                    domicilio: String::new(),
                    localidad: String::new(),
                    fecha_nacimiento: "1985-01-01".to_string(),
                    obra_social: String::new(),
                    obra_social_anterior: None,
                    notas: String::new(),
                    activo: Some(true),
                    version: 1,
                    deleted_at: None,
                },
            ],
        )
        .unwrap();

        repository::save_planes_table(
            &tx,
            &[serde_json::json!({
                "id": "plan-1",
                "nombre": "Plan Familiar",
                "precio": 1000.0,
                "activo": true,
                "tipo": "familiar"
            })],
        )
        .unwrap();

        repository::save_afiliados_table(
            &tx,
            &[
                serde_json::json!({
                    "id": "afil-1",
                    "patientId": "pac-1",
                    "planId": "plan-1",
                    "fechaInicio": inicio,
                    "activo": true
                }),
                serde_json::json!({
                    "id": "afil-2",
                    "patientId": "pac-2",
                    "planId": "plan-1",
                    "fechaInicio": inicio,
                    "activo": true
                }),
            ],
        )
        .unwrap();

        // afil-1 no tiene cuota del mes actual: debe.
        // afil-2 tiene la cuota del mes actual paga: está al día.
        repository::save_cuotas_table(
            &tx,
            &[serde_json::json!({
                "id": "cuota-2",
                "afiliadoId": "afil-2",
                "anio": anio,
                "mes": mes,
                "monto": 1000.0,
                "estado": "pagado",
                "fechaPago": fecha_hoy,
                "formaPago": "efectivo",
                "comprobante": true,
                "notas": "",
                "usos": 0
            })],
        )
        .unwrap();

        tx.commit().unwrap();
        (anio, mes)
    }

    #[tokio::test]
    async fn test_pagos_afiliados_secretaria_ve_solo_deudores_y_sin_historial() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        let (anio, mes) = seed_pagos_afiliados();
        let token = test.login_as("secretaria").await;

        let (status, body) = test.get("/api/pagos-afiliados", Some(&token)).await;
        assert_eq!(status, StatusCode::OK, "GET pagos afiliados: {}", body);
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["cantidad"], 1);
        assert_eq!(json["sinDeuda"], false);
        let deudor = &json["deudores"][0];
        assert_eq!(deudor["nombre"], "Perez, Ana");
        assert_eq!(deudor["dni"], "12345678");
        assert_eq!(deudor["cobertura"], "Plan Familiar");
        assert_eq!(deudor["cuotas"][0]["anio"], anio);
        assert_eq!(deudor["cuotas"][0]["mes"], mes);
        assert_eq!(deudor["cuotas"][0]["monto"], 1000.0);
        // La respuesta reducida no expone estado, historial, adherentes ni paciente.
        assert!(deudor.get("patientId").is_none());
        assert!(deudor.get("estado").is_none());
        assert!(deudor.get("adherentes").is_none());

        // Buscar al contratante al día devuelve sólo el aviso "Sin deuda".
        let (status, body) = test
            .get("/api/pagos-afiliados?q=Gomez", Some(&token))
            .await;
        assert_eq!(status, StatusCode::OK, "GET búsqueda sin deuda: {}", body);
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["cantidad"], 0);
        assert_eq!(json["sinDeuda"], true);

        drop(test);
    }

    #[tokio::test]
    async fn test_pagos_afiliados_afiliado_no_puede_ver_ni_cobrar() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        seed_pagos_afiliados();
        let token = test.login_as("afiliado").await;

        let (status, body) = test.get("/api/pagos-afiliados", Some(&token)).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "afiliado GET: {}", body);

        let (status, body) = test
            .post(
                "/api/pagos-afiliados/cobrar",
                r#"{"afiliadoId":"afil-1","cuotas":[{"anio":2026,"mes":1}],"formaPago":"efectivo"}"#,
                Some(&token),
            )
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "afiliado POST: {}", body);

        drop(test);
    }

    #[tokio::test]
    async fn test_pagos_afiliados_cobrar_y_doble_cobro_409() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        let (anio, mes) = seed_pagos_afiliados();
        // No se habilita `write_enabled`: el cobro debe funcionar igual que el
        // guardado normal del modo cliente (`/api/app-data`).
        let token = test.login_as("secretaria").await;

        let body_req = serde_json::json!({
            "afiliadoId": "afil-1",
            "cuotas": [{ "anio": anio, "mes": mes }],
            "formaPago": "transferencia"
        })
        .to_string();

        let (status, body) = test
            .post("/api/pagos-afiliados/cobrar", &body_req, Some(&token))
            .await;
        assert_eq!(status, StatusCode::OK, "primer cobro: {}", body);
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["total"], 1000.0);
        let cuota = &json["cuotas"][0];
        assert_eq!(cuota["estado"], "pagado");
        assert_eq!(cuota["formaPago"], "transferencia");
        assert_eq!(cuota["comprobante"], true);
        assert_eq!(cuota["cobradoPor"], "Mary");
        assert!(cuota["registradoEn"].as_str().unwrap_or("").contains('T'));

        // La deuda bajó a cero: el contratante ya no aparece.
        let (status, body) = test.get("/api/pagos-afiliados", Some(&token)).await;
        assert_eq!(status, StatusCode::OK, "GET después del cobro: {}", body);
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["cantidad"], 0);

        // Un segundo cobro de la misma cuota se rechaza completo.
        let (status, body) = test
            .post("/api/pagos-afiliados/cobrar", &body_req, Some(&token))
            .await;
        assert_eq!(status, StatusCode::CONFLICT, "doble cobro: {}", body);
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["error"], "cuota_ya_pagada");

        drop(test);
    }

    #[tokio::test]
    async fn test_put_paciente_id_raro_existente_funciona() {
        let test = TestApp::new(Some(cuentas_estandar())).await.unwrap();
        let token_admin = test.login_as("admin").await;
        test.enable_writes(&token_admin).await;

        // Insertar paciente con id raro directamente en la base
        let conn = db::open_connection().unwrap();
        conn.execute(
            "INSERT INTO patients (id, nombre, apellido, dni, telefono, email, domicilio, localidad, fecha_nacimiento, obra_social, notas, activo, version, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, 1, NULL)",
            params!["x y", "Raro", "Id", "12345678", "123", "raro@test.com", "Dir", "Ciudad", "1980-01-01", "OSDE", "nota"],
        ).unwrap();
        drop(conn);

        let (status, body) = test.put(
            "/api/pacientes/x%20y",
            r#"{"id":"x y","nombre":"Raro Editado","apellido":"Id","version":1}"#,
            Some(&token_admin),
        ).await;
        assert_eq!(status, StatusCode::OK, "PUT con id raro");
        let resp: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(resp["version"], 2);

        drop(test);
    }

}
