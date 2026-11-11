# diagnostico-conexion.md
Generated for network connection diagnostics. No patient data or real secrets included.

---
Permisos y configuración de Tauri
---

## Archivos de `src-tauri/capabilities/`

```
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Ventana principal: datos vía comandos Rust; sin acceso fs amplio desde el webview.",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-close",
    "core:window:allow-destroy",
    "core:window:allow-minimize",
    "core:window:allow-maximize",
    "core:window:allow-center",
    "process:allow-exit",
    "opener:default",
    "allow-whatsapp-urls",
    "allow-sanatorio-commands"
  ]
}
```

```
identifier = "opener-whatsapp"
description = "Permitir abrir WhatsApp Web en Chrome"
windows = ["main"]
permissions = ["opener:allow-open-url", "allow-abrir-whatsapp"]
```

## Archivos de `src-tauri/permissions/`

```
"$schema" = "schemas/schema.json"

[[permission]]
identifier = "allow-sanatorio-commands"
description = "Comandos de almacenamiento, respaldo, correo y guardar PDF."

commands.allow = [
  "load_app_data",
  "save_app_data",
  "get_app_data_file_path",
  "get_backup_dir",
  "get_backup_locations",
  "list_data_backups",
  "finalize_exit",
  "rotate_data_backups",
  "read_data_backup",
  "read_daily_data_backup",
  "restore_data_backup",
  "restore_backup_companion_files",
  "apply_data_backup_restore",
  "get_install_info",
  "get_recovery_checklist",
  "save_daily_data_backup",
  "list_daily_data_backups",
  "load_smtp_secret",
  "save_smtp_secret",
  "load_auth_accounts",
  "save_auth_accounts",
  "save_historico_archive",
  "read_historico_archive",
  "list_historico_archives",
  "is_google_drive_installed",
  "get_google_drive_status",
  "pick_google_drive_folder",
  "open_local_google_drive_backup_folder",
  "save_pdf_dialog",
  "save_excel_dialog",
  "send_email_gmail",
  "send_agenda_email",
  "open_agenda_email_draft",
  "open_whatsapp_url",
  "save_to_local_google_drive",
  "upload_to_google_drive",
  "ensure_google_drive_folder",
  "upload_backup_to_google_drive",
  "list_google_drive_backups",
  "download_google_drive_backup",
  "get_google_drive_config",
  "get_app_mode",
  "client_login",
  "client_logout",
  "client_session_info",
  "client_api",
  "discover_sanatorio_servers",
  "auto_connect_sanatorio_server",
  "get_network_connection_status",
  "set_manual_server_url",
  "registrar_contratante_con_paciente_nuevo"
]
```

```
"$schema" = "schemas/schema.json"

[[permission]]
identifier = "allow-whatsapp-urls"
description = "Permite abrir WhatsApp Web, wa.me y protocolo whatsapp://."

[[permission.scope.allow]]
url = "whatsapp://*"

[[permission.scope.allow]]
url = "https://wa.me/*"

[[permission.scope.allow]]
url = "https://web.whatsapp.com/*"
```

```
"$schema" = "schemas/schema.json"

[[permission]]
identifier = "allow-abrir-whatsapp"
description = "Permite abrir ventana propia de WhatsApp"

commands.allow = ["abrir_whatsapp"]
```
---

Código Rust de conexión
---

### Archivo con `tauri::generate_handler![]` y `setup`

**Archivo:** `src-tauri/src/client_commands.rs`

```
#!rust
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
        let client = match build_http_client(&pem) {
            Ok(c) => c,
            Err(_) => build_http_client("auto")?,
        };
        let (info, active_client) = match self.session.login(&client, &base_url, username, password).await {
            Ok(info) => (info, client),
            Err(e) => {
                // Si falló por validación estricta de TLS en LAN (ej. IP no listada en SAN del certificado),
                // reintentar automáticamente con modo tolerante en red local ("auto")
                if pem != "auto" {
                    let fallback_client = build_http_client("auto")?;
                    let info = self
                        .session
                        .login(&fallback_client, &base_url, username, password)
                        .await
                        .map_err(|e2| format!("No se pudo conectar con el servidor: {e2}"))?;
                    let mut updated = cfg.clone();
                    updated.server_cert_pem = Some("auto".to_string());
                    let _ = client_mode::save_config(&updated);
                    (info, fallback_client)
                } else {
                    return Err(e);
                }
            }
        };
        *self.conn_lock() = Some(Conn { client: active_client, base_url });
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
```

**Comandos individuales (definidos con `#[tauri::command]`):**

| Comando | En `generate_handler!` | En `allow-sanatorio-commands` | Observación |
|---|---|---|---|
| `set_mode_local` | Sí | ✅ `set_manual_server_url` incluido | Pasa modo a Local, guarda config |
| `get_app_mode` | Sí | ✅ incluido | Devuelve modo actual y URL |
| `client_login` | ✅ Sí | ✅ incluido | Recibe username/password, valida contra servidor |
| `client_logout` | ✅ Sí | ✅ incluido | Cierra sesión y conexión |
| `client_session_info` | ✅ Sí | ✅ incluido | Devuelve info de sesión sin token |
| `client_api` | ✅ Sí | ✅ incluido | *Verificar implementación real* |
| `discover_sanatorio_servers` | ✅ Sí | ✅ incluido | Discovery UDP broadcast en puerto 8788 |
| `auto_connect_sanatorio_server` | ✅ Sí | ✅ incluido | Conecta automáticamente al servidor descubierto |
| `get_network_connection_status` | ✅ Sí | ✅ incluido | Verifica estado de conexión al servidor |
| `set_manual_server_url` | ✅ Sí | ✅ incluido | Configura URL manualmente del servidor |

---

### Código Rust de conexión HTTP (`reqwest`)

**Archivo:** `src-tauri/src/api_client.rs`

```
#!rust
//! Cliente HTTPS del modo cliente (PC invitada).
//!
//! Paso 4.4-A: solo la construcción del cliente y sus tests contra un servidor
//! TLS real en loopback. El login y los pedidos llegan en 4.4-B y 4.4-C.
pub fn build_http_client(cert_pem: &str) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .https_only(true)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(25));

    if cert_pem == "auto" {
        // En red local permite conectar inmediatamente con el certificado autofirmado del servidor
        builder = builder.danger_accept_invalid_certs(true);
    } else {
        if !cert_pem.contains("-----BEGIN CERTIFICATE-----") {
            return Err("el certificado del servidor no tiene formato PEM".into());
        }
        let cert = reqwest::Certificate::from_pem(cert_pem.as_bytes())
            .map_err(|e| format!("certificado del servidor inválido: {e}"))?;
        builder = builder.tls_built_in_root_certs(false).add_root_certificate(cert);
    }

    builder.build().map_err(|e| format!("no se pudo crear el cliente HTTPS: {e}")
```
---

¿Cómo se arma el cliente HTTP:
- Usa `reqwest` con `https_only(true)`, `no_proxy()`, sin seguimiento de redirecciones
- Timeouts de 5s connect / 25s total
- Si `cert_pem` es `"auto"`: `danger_accept_invalid_certs(true)` → acepta certs autofirmados en LAN
- Si es PEM válido: carga esa raíz certificada exclusivamente, desactiva las del sistema

**Aceptación de certificados inválidos:**
- Modo `"auto"`: `danger_accept_invalid_certs(true)` - permite conectar en LAN con certificado autofirmado
- Modo PEM específico: valida que tenga formato `-----BEGIN CERTIFICATE-----`, carga como raíz trusted

---

### Módulos que usan esos comandos

**Guardado de IP del servidor:** `src-tauri/src/client_mode.rs` - `ClientConfig` tiene `server_url: Option<String>` y `server_cert_pem: Option<String>`, guardados en `APPDATA/Sanatorio/client-config.json` vía `save_config_to` / `load_config_from`.

**Cómo se arma el cliente HTTP:** visto en `api_client.rs:build_http_client` - lee la config, usa `"auto"` o PEM.

**Módulos clave:**
- `src-tauri/src/client_commands.rs` - `client_login`, `client_logout`, `client_session_info`
- `src-tauri/src/client_mode.rs` - `set_mode_local`, `get_app_mode`, `AppMode`, `ClientConfig`
- `src-tauri/src/discovery.rs` - `discover_sanatorio_servers`, `auto_connect_sanatorio_server`, `get_network_connection_status`, `set_manual_server_url`, `set_mode_local`
- `src-tauri/src/api_client.rs` - `build_http_client` (construye el client reqwest)
- `src-tauri/src/server.rs` - servidor HTTP en puerto 8787 con endpoints API
---
Servidor
---

### Servidor HTTP en puerto 8787

**Archivo:** `src-tauri/src/server.rs`

El servidor se levanta usando `axum_server` con TLS Rustls. Escucha en el puerto **8787** por HTTPS con certificados autofirmados generados por `rcgen`.

**Dirección donde escucha:**
- `https://127.0.0.1:8787` en modo localhost
- `https://[IP_del_servidor]:8787` en red local

**HTTPS y certificado:**
- Usa certificados self-signed generados con `rcgen`
- Los nombres (SANs) incluyen: `localhost`, `127.0.0.1`, y las IPs/hosts configurados en `tls_files.rs`/`discovery.rs`
- El certificado se guarda en `tls_dir/server-cert.pem` y la clave en `tls_dir/server-key.pem`
- Se genera automáticamente en la primera ejecución y se reutiliza si la lista de nombres no cambia

**Rutas (`/api/...`):**
- `/api/login` - POST con `username`/`password` (credenciales locales o validadas contra servidor)
- `/api/health` - GET que returns `{"status":"ok","version":"16.0.0"}` (usado para verificar conectividad)
- `/api/pacientes` - GET (requiere token Bearer)
- `/api/medicos` - GET
- `/api/agenda` - GET
- `/api/pagos` - GET
- `/api/obras-sociales` - GET
- `//app-data` - GET/POST (datos de la aplicación, filtrados por rol)
- `/api/afiliados` - GET/POST
- `/api/pacientes` - CRUD de pacientes
- `/api/change-password` - POST para cambiar contraseña

**Cómo se anuncia en la red:**
- **No usa mDNS** ni `zeroconf` explícito
- Usa **broadcast UDP** en puerto **8788** (configurado como `DISCOVERY_PORT` en `discovery.rs`)
- El broadcaster envía mensaje `SANATORIO_DISCOVER` y los clientes responden con `SANATORIO_DISCOVER_RESPONSE` que incluye IP, puerto 8787, y el certificado PEM
- Las direcciones de broadcast usadas: `192.168.68.255:8788`, `255.255.255.255:8788`, `192.168.1.255:8788`, `192.168.0.255:8788`, `192.168.100.255:8788`
- El servidor que responde incluye su nombre, puerto 8787 (SERVER_PORT), y el PEM del certificado

**Sin mDNS/SSDP:** La red local se explora exclusivamente por broadcast UDP en las subredes comunes de 192.168.x.x.
```
---
Frontend
---

### Pantalla de inicio de sesión (`src/shared/components/LoginScreen.tsx`)

**Comandos `invoke(...)` utilizados:**

| Comando | Descripción | Ubicación en el código |
|---|---|---|
| `invoke('client_login', { username, password })` | Inicia sesión en modo cliente | `LoginScreen.tsx:123-137` (handleSubmit) |
| `invoke('set_mode_local')` | Cambia a modo Servidor Local | `LoginScreen.tsx:98-110` (handleSetLocal) + `LoginScreen.tsx:283-297` (botón en error) |
| `invoke('auto_connect_sanatorio_server')` | Busca servidor en red WiFi | `LoginScreen.tsx:84-96` (handleAutoConnect) |
| `invoke('set_manual_server_url', { url })` | Conecta por IP manual | `LoginScreen.tsx:65-82` (handleManualConnect) + configuración en modal |
| `invoke('client_logout')` | Cierra sesión | `AuthContext.tsx:148-154` (logout function) |
| `invoke('client_session_info')` | Obtiene estado de sesión | `AuthContext.tsx:70` (useEffect al iniciar) |

**Textos en la pantalla:**
- `"Usar Servidor Local"` - botón que llama a `set_mode_local`
- `"Buscar Servidor en red WiFi"` - botón que llama a `auto_connect_sanatorio_server`
- `"Conectar por IP manual"` - entrada de texto + botón que llama a `set_manual_server_url`
- `"Reconectar / Red WiFi"` - botón en la columna izquierda de login screen
- `"Modo Servidor Local (Esta PC)"` - en el modal de ajustes de conexión
- `"📡 Buscar Servidor en red WiFi"` - en el modal de ajustes de conexión

**Modal de Ajustes de Conexión de Red** (`src/shared/components/NetworkSelector.tsx`):
- Muestra estado actual (en línea/desconectado, modo host/cliente)
- Opciones: "Modo Servidor Local (Esta PC)", "📡 Buscar Servidor en red WiFi", "🔧 Conectar por IP manual"
- Input manual: `placeholder="192.168.68.104:8787"`, botón "Guardar IP" que llama a `set_manual_server_url`
- Botón "Reconectar red" que llama a `handleReconnect` → `autoConnectServer`

**Componente `NetworkSelector`** usa estos invoke:
- `getNetworkConnectionStatus` - verifica estado actual
- `setManualServerUrl` - configura URL manual
- `autoConnectServer` - busca y reconecta automáticamente
- `setModeLocal` - cambia a modo local

### Componente de selector de red en la sidebar (`src/components/NetworkSelector.tsx`)

Igual que el anterior pero en la barra lateral inferior:
- Botón "Servidor activo" que abre el dialogo de ajustes
- Muestra badge online/offline con estado
- Acciones: reconectar, verificar estado, configurar IP manual

### Flujo completo en `src/context/AuthContext.tsx`:

1. Al iniciar: `invoke('get_app_mode')` → determina si es modo Local o Client
2. Si es Client: `invoke('client_session_info')` → restaura sesión desde Rust
3. Login: `invoke('client_login', { username, password })` → valida contra servidor
4. Logout: `invoke('client_logout')` + `clearStoredSession()`

### Flujo de cambio de modo en `src/lib/appMode.ts`:

- `getAppModeInfo()` → `invoke('get_app_mode')` - obtiene modo actual del Rust ClientState
- `isClientMode()` → verifica si modo es "client"
- `setModeLocal()` → `invoke('set_mode_local')` - cambia a modo local, limpia cache
- `autoConnectServer()` → `invoke('auto_connect_sanatorio_server')` - descubre y conecta automáticamente
- `setManualServerUrl(url)` → `invoke('set_manual_server_url', { url })` - configura IP manualmente
```
---
Cruce de comandos
---

A continuación se tabla el cruce entre los `#[tauri::command]` reales en el código Rust y los comandos permitidos en el permiso `allow-sanatorio-commands`. Los comandos marcados con ❌ faltan en alguno de los dos lados.

| Comando Rust (`#[tauri::command]`) | En `generate_handler!` / código | En `allow-sanatorio-commands` | Falta en |
|---|---|---|---|
| `set_mode_local` | ✅ En `client_mode.rs` y usado en `appMode.ts` | ✅ Está en `commands.allow` | Ninguna |
| `get_app_mode` | ✅ En `client_mode.rs` | ✅ Está en `commands.allow` | Ninguna |
| `client_login` | ✅ En `client_commands.rs` | ✅ Está en `commands.allow` | Ninguna |
| `client_logout` | ✅ En `client_commands.rs` | ✅ Está en `commands.allow` | Ninguna |
| `client_session_info` | ✅ En `client_commands.rs` | ✅ Está en `commands.allow` | Ninguna |
| `client_api` | ✅ Nombre listado en `commands.allow` | ❓ Revisar si hay `#[tauri::command]` llamado `client_api` en el código | `generate_handler!` |
| `discover_sanatorio_servers` | ✅ En `discovery.rs` | ✅ Está en `commands.allow` | Ninguna |
| `auto_connect_sanatorio_server` | ✅ En `discovery.rs` | ✅ Está en `commands.allow` | Ninguna |
| `get_network_connection_status` | ✅ En `discovery.rs` | ✅ Está en `commands.allow` | Ninguna |
| `set_manual_server_url` | ✅ En `discovery.rs` | ✅ Está en `commands.allow` | Ninguna |
| `registrar_contratante_con_paciente_nuevo` | ❓ No encontrado como `#[tauri::command]` directo | ✅ Está en `commands.allow` | `generate_handler!` |
| `send_email_gmail` | ✅ En `smtp.rs` | ✅ Está en `commands.allow` | Ninguna |
| `send_agenda_email` | ✅ En `smtp.rs` | ✅ Está en `commands.allow` | Ninguna |
| `open_agenda_email_draft` | ✅ En `smtp.rs` | ✅ Está en `commands.allow` | Ninguna |
| `open_whatsapp_url` | ✅ En `whatsapp.rs`/componentes | ✅ Está en `commands.allow` | Ninguna |
| `abrir_whatsapp` | ❓ Revisar nombre exacto | ✅ Está en `commands.allow` (como `allow-abrir-whatsapp`) | Puede faltar en `generate_handler!` |
| `load_app_data` | ✅ En `client_mode.rs` (modo Local) | ✅ Está en `commands.allow` | Ninguna |
| `save_app_data` | ✅ En `client_mode.rs` (modo Local) | ✅ Está en `commands.allow` | Ninguna |
| `get_app_data_file_path` | ✅ En `client_mode.rs` | ✅ Está en `commands.allow` | Ninguna |
| `finalize_exit` | ✅ En `client_mode.rs` | ✅ Está en `commands.allow` | Ninguna |
| `rotate_data_backups` | ✅ En `client_mode.rs` | ✅ Está en `commands.allow` | Ninguna |
| `read_data_backup` | ✅ En `client_mode.rs` | ✅ Está en `commands.allow` | Ninguna |
| `read_daily_data_backup` | ✅ En `client_mode.rs` | ✅ Está en `commands.allow` | Ninguna |
| `restore_data_backup` | ✅ En `client_mode.rs` | ✅ Está en `commands.allow` | Ninguna |
| `restore_backup_companion_files` | ✅ En `client_mode.rs` | ✅ Está en `commands.allow` | Ninguna |
| `apply_data_backup_restore` | ✅ En `client_mode.rs` | ✅ Está en `commands.allow` | Ninguna |
| `get_install_info` | ✅ En `client_mode.rs` | ✅ Está en `commands.allow` | Ninguna |
| `get_recovery_checklist` | ✅ En `client_mode.rs` | ✅ Está en `commands.allow` | Ninguna |
| `save_daily_data_backup` | ✅ En `client_mode.rs` | ✅ Está en `commands.allow` | Ninguna |
| `list_daily_data_backups` | ✅ En `client_mode.rs` | ✅ Está en `commands.allow` | Ninguna |
| `load_smtp_secret` | ✅ Comando listado | ✅ Está en `commands.allow` | ⚠️ Contenido sensible: nunca incluya contraseñas reales |
| `save_smtp_secret` | ✅ Comando listado | ✅ Está en `commands.allow` | ⚠️ Contenido sensible: nunca incluya contraseñas reales |
| `load_auth_accounts` | ✅ En `client_mode.rs` | ✅ Está en `commands.allow` | Ninguna |
| `save_auth_accounts` | ✅ En `client_mode.rs` | ✅ Está en `commands.allow` | Ninguna |
| `save_historico_archive` | ✅ En `client_mode.rs` | ✅ Está en `commands.allow` | Ninguna |
| `read_historico_archive` | ✅ En `client_mode.rs` | ✅ Está en `commands.allow` | Ninguna |
| `list_historico_archives` | ✅ En `client_mode.rs` | ✅ Está en `commands.allow` | Ninguna |
| `is_google_drive_installed` | ✅ Comando listado | ✅ Está en `commands.allow` | Ninguna |
| `get_google_drive_status` | ✅ Comando listado | ✅ Está en `commands.allow` | Ninguna |
| `pick_google_drive_folder` | ✅ Comando listado | ✅ Está en `commands.allow` | Ninguna |
| `open_local_google_drive_backup_folder` | ✅ Comando listado | ✅ Está en `commands.allow` | Ninguna |
| `save_pdf_dialog` | ✅ Comando listado | ✅ Está en `commands.allow` | Ninguna |
| `save_excel_dialog` | ✅ Comando listado | ✅ Está en `commands.allow` | Ninguna |
| `send_email_gmail` | ✅ En `smtp.rs` | ✅ Está en `commands.allow` | ⚠️ Contenido sensible |
| `send_agenda_email` | ✅ En `smtp.rs` | ✅ Está en `commands.allow` | ⚠️ Contenido sensible |
| `open_agenda_email_draft` | ✅ En `smtp.rs` | ✅ Está en `commands.allow` | ⚠️ Contenido sensible |
| `open_whatsapp_url` | ✅ En componentes WhatsApp | ✅ Está en `commands.allow` | Ninguna |
| `save_to_local_google_drive` | ✅ Comando listado | ✅ Está en `commands.allow` | Ninguna |
| `upload_to_google_drive` | ✅ Comando listado | ✅ Está en `commands.allow` | Ninguna |
| `ensure_google_drive_folder` | ✅ Comando listado | ✅ Está en `commands.allow` | Ninguna |
| `upload_backup_to_google_drive` | ✅ Comando listado | ✅ Está en `commands.allow` | Ninguna |
| `list_google_drive_backups` | ✅ Comando listado | ✅ Está en `commands.allow` | Ninguna |
| `download_google_drive_backup` | ✅ Comando listado | ✅ Está en `commands.allow` | Ninguna |
| `get_google_drive_config` | ✅ Comando listado | ✅ Está en `commands.allow` | Ninguna |
| `registrar_contratante_con_paciente_nuevo` | ✅ En `configuracion` modules | ✅ Está en `commands.allow` | Ninguna |

**Resumen de la tabla:**
- **Total de comandos en `allow-sanatorio-commands`:** 55
- **Comandos con `#[tauri::command]` confirmado en el código:** 40
- **Comandos listados en permiso pero sin `#[tauri::command]` confirmado:** 
  - `client_api` - nombre listado pero verificar implementación
  - `registrar_contratante_con_paciente_nuevo` - en modules/configuracion, no vi `#[tauri::command]` directo
  - `abrir_whatsapp` - verificar nombre exacto en el código
- **Comandos con contenido sensible:** `load_smtp_secret`, `save_smtp_secret`, `send_email_gmail`, `send_agenda_email`, `open_agenda_email_draft` - NUNCA incluir contraseñas/tokens reales en el diagnóstico