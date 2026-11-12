use serde::{Deserialize, Serialize};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::client_mode::{self, AppMode};

pub const DISCOVERY_PORT: u16 = 8788;
pub const SERVER_PORT: u16 = 8787;
pub const DISCOVERY_REQUEST: &str = "SANATORIO_DISCOVER";
pub const DISCOVERY_RESPONSE: &str = "SANATORIO_DISCOVER_RESPONSE";

#[derive(Serialize, Deserialize, Debug)]
pub struct DiscoveryMessage {
    pub r#type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cert_pem: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredServer {
    pub ip: String,
    pub port: u16,
    pub server_name: String,
    pub server_url: String,
    pub cert_pem: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NetworkStatusInfo {
    pub mode: String,
    pub is_online: bool,
    pub server_url: Option<String>,
    pub server_name: String,
    pub is_server_host: bool,
    pub message: String,
    pub error_kind: Option<String>,
    pub last_successful_communication: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticCheck {
    pub name: String,
    pub status: String,
    pub detail: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionDiagnostic {
    pub server_url: Option<String>,
    pub checks: Vec<DiagnosticCheck>,
    pub completed_at: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInterfaceInfo {
    pub name: String,
    pub ip: String,
    pub mask: String,
    pub gateway: Option<String>,
    pub server_endpoint: String,
    pub is_primary: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalNetworkInfo {
    pub interfaces: Vec<NetworkInterfaceInfo>,
    pub primary_ip: Option<String>,
}

static RESPONDER_RUNNING: AtomicBool = AtomicBool::new(false);
static LAST_SUCCESSFUL_COMMUNICATION: OnceLock<Mutex<Option<String>>> = OnceLock::new();

pub fn mark_connection_success() {
    let timestamp = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .ok();
    if let Some(timestamp) = timestamp {
        *LAST_SUCCESSFUL_COMMUNICATION
            .get_or_init(|| Mutex::new(None))
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(timestamp);
    }
}

fn last_successful_communication() -> Option<String> {
    LAST_SUCCESSFUL_COMMUNICATION
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

fn diagnostic_check(name: &str, status: &str, detail: impl Into<String>) -> DiagnosticCheck {
    DiagnosticCheck {
        name: name.to_string(),
        status: status.to_string(),
        detail: detail.into(),
    }
}

fn append_skipped_connection_checks(
    checks: &mut Vec<DiagnosticCheck>,
    names: &[&str],
    reason: &str,
) {
    checks.extend(
        names
            .iter()
            .map(|name| diagnostic_check(name, "skipped", reason)),
    );
}

#[tauri::command]
pub async fn diagnose_connection() -> Result<ConnectionDiagnostic, String> {
    let cfg = client_mode::load_config()?;
    if cfg.mode != AppMode::Client {
        return Err(
            "El diagnóstico de conexión remota solo aplica al modo cliente. El estado del servidor local se verifica en el panel de red.".to_string(),
        );
    }
    let mut checks = vec![diagnostic_check("Configuración", "ok", "Modo cliente")];
    let mut target_url = cfg.server_url.clone().filter(|url| !url.trim().is_empty());
    let mut cert_pem = cfg.server_cert_pem.clone();

    if target_url.is_none() && cfg.mode == AppMode::Client {
        match discover_servers_async(1800).await {
            Ok(servers) => {
                if let Some(server) = servers.into_iter().next() {
                    target_url = Some(server.server_url);
                    cert_pem = server.cert_pem;
                    checks.push(diagnostic_check(
                        "Descubrimiento UDP",
                        "ok",
                        "Se recibió una respuesta Sanatorio por UDP 8788.",
                    ));
                } else {
                    checks.push(diagnostic_check(
                        "Descubrimiento UDP",
                        "error",
                        "No hubo respuesta; el descubrimiento puede estar bloqueado por la red.",
                    ));
                }
            }
            Err(error) => checks.push(diagnostic_check(
                "Descubrimiento UDP",
                "error",
                format!("No se pudo ejecutar: {error}"),
            )),
        }
    } else {
        checks.push(diagnostic_check(
            "Descubrimiento UDP",
            "skipped",
            "No se ejecutó: se utiliza el servidor configurado.",
        ));
    }

    let Some(target_url) = target_url else {
        checks.push(diagnostic_check(
            "Dirección del servidor",
            "error",
            "No hay una dirección guardada ni un servidor descubierto.",
        ));
        append_skipped_connection_checks(
            &mut checks,
            &[
                "Resolución DNS",
                "TCP",
                "Certificado TLS",
                "API HTTPS",
                "Autenticación",
            ],
            "No se puede probar sin una dirección de servidor.",
        );
        crate::login_diagnostics::record_connection_diagnostic("not_found")?;
        return Ok(ConnectionDiagnostic {
            server_url: None,
            checks,
            completed_at: time::OffsetDateTime::now_utc()
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default(),
        });
    };
    checks.push(diagnostic_check(
        "Dirección del servidor",
        "ok",
        target_url.clone(),
    ));

    let parsed = match url::Url::parse(&target_url) {
        Ok(url) if url.scheme() == "https" => url,
        Ok(_) => {
            checks.push(diagnostic_check(
                "Resolución DNS",
                "skipped",
                "La dirección no usa HTTPS.",
            ));
            append_skipped_connection_checks(
                &mut checks,
                &["TCP", "Certificado TLS", "API HTTPS", "Autenticación"],
                "La dirección no es HTTPS.",
            );
            return Ok(ConnectionDiagnostic {
                server_url: Some(target_url),
                checks,
                completed_at: time::OffsetDateTime::now_utc()
                    .format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default(),
            });
        }
        Err(error) => {
            checks.push(diagnostic_check(
                "Resolución DNS",
                "error",
                format!("IP/URL incorrecta: {error}"),
            ));
            append_skipped_connection_checks(
                &mut checks,
                &["TCP", "Certificado TLS", "API HTTPS", "Autenticación"],
                "No se puede probar sin una dirección válida.",
            );
            return Ok(ConnectionDiagnostic {
                server_url: Some(target_url),
                checks,
                completed_at: time::OffsetDateTime::now_utc()
                    .format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default(),
            });
        }
    };
    let Some(host) = parsed.host_str() else {
        checks.push(diagnostic_check(
            "Resolución DNS",
            "error",
            "La dirección no contiene un host válido.",
        ));
        append_skipped_connection_checks(
            &mut checks,
            &["TCP", "Certificado TLS", "API HTTPS", "Autenticación"],
            "No se puede probar sin un host válido.",
        );
        return Ok(ConnectionDiagnostic {
            server_url: Some(target_url),
            checks,
            completed_at: time::OffsetDateTime::now_utc()
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default(),
        });
    };
    let port = parsed.port_or_known_default().unwrap_or(SERVER_PORT);
    let resolved = tokio::time::timeout(
        Duration::from_secs(2),
        tokio::net::lookup_host((host, port)),
    )
    .await;
    let addresses: Vec<SocketAddr> = match resolved {
        Ok(Ok(addresses)) => {
            let addresses: Vec<_> = addresses.collect();
            checks.push(diagnostic_check(
                "Resolución DNS",
                "ok",
                format!("{host} resolvió a {} dirección(es).", addresses.len()),
            ));
            addresses
        }
        Ok(Err(error)) => {
            checks.push(diagnostic_check(
                "Resolución DNS",
                "error",
                format!("No se pudo resolver {host}: {error}"),
            ));
            Vec::new()
        }
        Err(_) => {
            checks.push(diagnostic_check(
                "Resolución DNS",
                "error",
                "Tiempo de espera agotado resolviendo el servidor.",
            ));
            Vec::new()
        }
    };

    let mut tcp_connected = false;
    let mut tcp_detail = "No se pudo resolver una dirección para probar TCP.".to_string();
    for address in addresses {
        match tokio::time::timeout(
            Duration::from_secs(2),
            tokio::net::TcpStream::connect(address),
        )
        .await
        {
            Ok(Ok(_stream)) => {
                tcp_connected = true;
                tcp_detail = format!("Conexión TCP establecida con {address}.");
                break;
            }
            Ok(Err(error)) => tcp_detail = format!("No se pudo conectar a {address}: {error}"),
            Err(_) => tcp_detail = format!("Tiempo de espera agotado conectando a {address}."),
        }
    }
    checks.push(diagnostic_check(
        "TCP",
        if tcp_connected { "ok" } else { "error" },
        tcp_detail,
    ));

    if tcp_connected {
        match cert_pem.as_deref() {
            Some(pem) => match check_server_health(&target_url, pem).await {
                Ok(name) => {
                    checks.push(diagnostic_check(
                        "Certificado TLS",
                        "ok",
                        "Identidad y nombre/IP del servidor verificados.",
                    ));
                    checks.push(diagnostic_check(
                        "API HTTPS",
                        "ok",
                        format!("API Sanatorio disponible: {name}."),
                    ));
                    checks.push(diagnostic_check(
                        "Autenticación",
                        "skipped",
                        "No se enviaron credenciales; se valida durante el inicio de sesión.",
                    ));
                    crate::login_diagnostics::record_connection_diagnostic("ok")?;
                }
                Err((kind, message)) => {
                    let tls_failed = kind == "tls";
                    checks.push(diagnostic_check(
                        "Certificado TLS",
                        if tls_failed { "error" } else { "ok" },
                        if tls_failed {
                            message.clone()
                        } else {
                            "Handshake TLS verificado.".to_string()
                        },
                    ));
                    checks.push(diagnostic_check(
                        "API HTTPS",
                        if tls_failed { "skipped" } else { "error" },
                        message.clone(),
                    ));
                    checks.push(diagnostic_check(
                        "Autenticación",
                        "skipped",
                        "No se enviaron credenciales.",
                    ));
                    crate::login_diagnostics::record_connection_diagnostic(if tls_failed {
                        "tls"
                    } else if kind == "timeout" {
                        "timeout"
                    } else {
                        "api"
                    })?;
                }
            },
            None => {
                checks.push(diagnostic_check(
                    "Certificado TLS",
                    "error",
                    "No hay certificado fijado; no se deshabilitó la validación TLS.",
                ));
                checks.push(diagnostic_check(
                    "API HTTPS",
                    "skipped",
                    "No se consultó la API sin una identidad TLS confiable.",
                ));
                checks.push(diagnostic_check(
                    "Autenticación",
                    "skipped",
                    "No se enviaron credenciales.",
                ));
                crate::login_diagnostics::record_connection_diagnostic("tls")?;
            }
        }
    } else {
        checks.push(diagnostic_check(
            "Certificado TLS",
            "skipped",
            "No se alcanzó el puerto TCP.",
        ));
        checks.push(diagnostic_check(
            "API HTTPS",
            "skipped",
            "No se alcanzó el puerto TCP.",
        ));
        checks.push(diagnostic_check(
            "Autenticación",
            "skipped",
            "No se enviaron credenciales.",
        ));
        crate::login_diagnostics::record_connection_diagnostic("tcp")?;
    }

    Ok(ConnectionDiagnostic {
        server_url: Some(target_url),
        checks,
        completed_at: time::OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default(),
    })
}

/// Inicia el listener UDP en el puerto 8788 para responder a clientes en la red.
pub fn start_udp_responder(server_name: String, cert_pem: String) -> Result<(), String> {
    if RESPONDER_RUNNING.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let socket = match UdpSocket::bind(("0.0.0.0", DISCOVERY_PORT)) {
        Ok(socket) => socket,
        Err(error) => {
            RESPONDER_RUNNING.store(false, Ordering::SeqCst);
            return Err(format!("No se pudo abrir UDP {DISCOVERY_PORT}: {error}"));
        }
    };
    socket
        .set_read_timeout(Some(Duration::from_millis(500)))
        .map_err(|error| {
            RESPONDER_RUNNING.store(false, Ordering::SeqCst);
            format!("No se pudo configurar el listener UDP {DISCOVERY_PORT}: {error}")
        })?;
    socket.set_broadcast(true).map_err(|error| {
        RESPONDER_RUNNING.store(false, Ordering::SeqCst);
        format!("No se pudo habilitar broadcast UDP: {error}")
    })?;
    std::thread::Builder::new()
        .name("sanatorio-udp-discovery".to_string())
        .spawn(move || {
            let mut buf = [0u8; 2048];
            while RESPONDER_RUNNING.load(Ordering::SeqCst) {
                match socket.recv_from(&mut buf) {
                    Ok((size, peer)) => {
                        if size == 0 {
                            continue;
                        }
                        if let Ok(msg) = serde_json::from_slice::<DiscoveryMessage>(&buf[..size]) {
                            if msg.r#type == DISCOVERY_REQUEST {
                                let resp = DiscoveryMessage {
                                    r#type: DISCOVERY_RESPONSE.to_string(),
                                    server_name: Some(server_name.clone()),
                                    port: Some(SERVER_PORT),
                                    cert_pem: Some(cert_pem.clone()),
                                };
                                if let Ok(bytes) = serde_json::to_vec(&resp) {
                                    if let Err(error) = socket.send_to(&bytes, peer) {
                                        log::warn!("No se pudo responder a discovery UDP de {peer}: {error}");
                                    }
                                }
                            }
                        }
                    }
                    Err(ref e)
                        if e.kind() == std::io::ErrorKind::TimedOut
                            || e.kind() == std::io::ErrorKind::WouldBlock => {}
                    Err(error) => {
                        log::error!("Falló el listener UDP {DISCOVERY_PORT}: {error}");
                        break;
                    }
                }
            }
            RESPONDER_RUNNING.store(false, Ordering::SeqCst);
        })
        .map_err(|error| {
            RESPONDER_RUNNING.store(false, Ordering::SeqCst);
            format!("No se pudo iniciar el listener UDP: {error}")
        })?;
    Ok(())
}

/// Obtiene las interfaces IPv4 LAN filtradas por `get_local_network_info`.
fn get_active_ipv4_interfaces() -> Vec<IpAddr> {
    get_local_network_info()
        .map(|network| {
            network
                .interfaces
                .into_iter()
                .filter_map(|interface| interface.ip.parse::<Ipv4Addr>().ok().map(IpAddr::V4))
                .collect()
        })
        .unwrap_or_default()
}

fn calculate_broadcast(ip: Ipv4Addr, mask: Ipv4Addr) -> Ipv4Addr {
    Ipv4Addr::from(u32::from(ip) | !u32::from(mask))
}

/// Envía broadcast UDP en la red local buscando el servidor Sanatorio.
/// Usa broadcast dinámico por cada interfaz IPv4 activa, además de 255.255.255.255.
/// Usa los broadcasts dirigidos calculados con las máscaras reales de cada
/// interfaz y el broadcast limitado. No enumera equipos ni subredes.
pub fn discover_servers(timeout_ms: u64) -> Result<Vec<DiscoveredServer>, String> {
    let socket = UdpSocket::bind("0.0.0.0:0")
        .map_err(|e| format!("Error creando socket UDP discovery: {e}"))?;
    socket
        .set_broadcast(true)
        .map_err(|e| format!("Error habilitando broadcast: {e}"))?;
    socket
        .set_read_timeout(Some(Duration::from_millis(100)))
        .map_err(|e| format!("Error seteando timeout: {e}"))?;

    let req = DiscoveryMessage {
        r#type: DISCOVERY_REQUEST.to_string(),
        server_name: None,
        port: None,
        cert_pem: None,
    };
    let req_bytes =
        serde_json::to_vec(&req).map_err(|e| format!("Error serializando request: {e}"))?;

    let mut found_set: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut found: Vec<DiscoveredServer> = Vec::new();

    let mut broadcast_addrs = Vec::new();
    if let Ok(network) = get_local_network_info() {
        for interface in network.interfaces {
            if let (Ok(ip), Ok(mask)) = (
                interface.ip.parse::<Ipv4Addr>(),
                interface.mask.parse::<Ipv4Addr>(),
            ) {
                let broadcast = calculate_broadcast(ip, mask);
                if broadcast != ip && broadcast != Ipv4Addr::BROADCAST {
                    broadcast_addrs.push(SocketAddr::new(IpAddr::V4(broadcast), DISCOVERY_PORT));
                }
            }
        }
    }
    broadcast_addrs.push(SocketAddr::new(
        IpAddr::V4(Ipv4Addr::BROADCAST),
        DISCOVERY_PORT,
    ));

    for addr in broadcast_addrs {
        if let Err(error) = socket.send_to(&req_bytes, addr) {
            log::debug!("No se pudo enviar discovery UDP a {addr}: {error}");
        }
    }

    // 2. Esperar respuestas con timeout
    let deadline = Instant::now() + Duration::from_millis(timeout_ms.max(1200));
    let mut buf = [0u8; 4096];

    while Instant::now() < deadline {
        match socket.recv_from(&mut buf) {
            Ok((size, peer)) => {
                if let Ok(msg) = serde_json::from_slice::<DiscoveryMessage>(&buf[..size]) {
                    if msg.r#type == DISCOVERY_RESPONSE
                        && msg.port.unwrap_or(SERVER_PORT) == SERVER_PORT
                    {
                        let ip = peer.ip().to_string();
                        let port = msg.port.unwrap_or(SERVER_PORT);
                        let name = msg
                            .server_name
                            .unwrap_or_else(|| "Sanatorio Server".to_string());
                        let url = format!("https://{}:{}", ip, port);
                        if !found_set.contains(&url) && !found.iter().any(|s| s.server_url == url) {
                            found_set.insert(url.clone());
                            found.push(DiscoveredServer {
                                ip,
                                port,
                                server_name: name,
                                server_url: url,
                                cert_pem: msg.cert_pem,
                            });
                        }
                    }
                }
            }
            Err(ref error)
                if error.kind() == std::io::ErrorKind::WouldBlock
                    || error.kind() == std::io::ErrorKind::TimedOut => {}
            Err(error) => {
                log::warn!("Error recibiendo respuestas de discovery UDP: {error}");
                break;
            }
        }
    }

    // Eliminar duplicados manteniendo orden
    let mut found_unique: Vec<DiscoveredServer> = Vec::new();
    for s in &found {
        if !found_unique.iter().any(|f| f.server_url == s.server_url) {
            found_unique.push(s.clone());
        }
    }

    Ok(found_unique)
}

pub async fn discover_servers_async(timeout_ms: u64) -> Result<Vec<DiscoveredServer>, String> {
    tokio::task::spawn_blocking(move || discover_servers(timeout_ms))
        .await
        .map_err(|error| format!("Falló la tarea de descubrimiento: {error}"))?
}

/// Descubre servidores Sanatorio en la red local.
/// El timeout por defecto es de 3000ms con 2 rondas de descubrimiento.
#[tauri::command]
pub async fn discover_sanatorio_servers(
    timeout_ms: Option<u64>,
) -> Result<Vec<DiscoveredServer>, String> {
    let timeout = timeout_ms.unwrap_or(3000);
    discover_servers_async(timeout).await
}

fn classify_connection_error(error: &reqwest::Error) -> (&'static str, String) {
    let details = format!("{error:?}").to_ascii_lowercase();
    let detail = format!("{error:#}");
    if details.contains("certificate") || details.contains("certificado") || details.contains("tls")
    {
        ("tls", format!("Error de certificado TLS: {detail}"))
    } else if error.is_timeout() {
        ("timeout", format!("Tiempo de espera agotado: {detail}"))
    } else if error.is_connect() {
        (
            "unreachable",
            format!("Servidor inaccesible o puerto TCP {SERVER_PORT} bloqueado: {detail}"),
        )
    } else {
        ("network", format!("Error de red: {detail}"))
    }
}

pub(crate) async fn check_server_health(
    url: &str,
    cert_pem: &str,
) -> Result<String, (String, String)> {
    let client = crate::api_client::build_http_client(cert_pem).map_err(|error| {
        (
            "tls".to_string(),
            format!("No se pudo validar la identidad TLS: {error}"),
        )
    })?;
    let health_url = format!("{}/api/health", url.trim_end_matches('/'));
    let mut last_error = None;
    for attempt in 0..3 {
        let response =
            tokio::time::timeout(Duration::from_secs(3), client.get(&health_url).send()).await;
        match response {
            Ok(Ok(response)) if response.status().is_success() => {
                let body = response
                    .json::<serde_json::Value>()
                    .await
                    .map_err(|error| {
                        (
                            "api".to_string(),
                            format!("La API devolvió una respuesta inválida: {error}"),
                        )
                    })?;
                if body.get("app").and_then(|value| value.as_str()) != Some("sanatorio") {
                    return Err((
                        "api".to_string(),
                        "El endpoint respondió, pero no es la API de Sanatorio.".to_string(),
                    ));
                }
                mark_connection_success();
                return Ok(body
                    .get("server_name")
                    .and_then(|value| value.as_str())
                    .unwrap_or("Servidor Sanatorio")
                    .to_string());
            }
            Ok(Ok(response)) => {
                return Err((
                    "api".to_string(),
                    format!("La API respondió con HTTP {}.", response.status().as_u16()),
                ));
            }
            Ok(Err(error)) => {
                let (kind, message) = classify_connection_error(&error);
                if kind == "tls" || kind == "network" {
                    return Err((kind.to_string(), message));
                }
                last_error = Some((kind.to_string(), message));
            }
            Err(_) => {
                last_error = Some((
                    "timeout".to_string(),
                    "Tiempo de espera agotado al consultar /api/health.".to_string(),
                ));
            }
        }
        if attempt < 2 {
            tokio::time::sleep(Duration::from_millis(250 * (1 << attempt))).await;
        }
    }
    Err(last_error.unwrap_or_else(|| {
        (
            "unreachable".to_string(),
            "Servidor inaccesible.".to_string(),
        )
    }))
}

/// Descubre un servidor candidato sin confiar ni guardar su certificado.
#[tauri::command]
pub async fn auto_connect_sanatorio_server() -> Result<DiscoveredServer, String> {
    discover_servers_async(3000)
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| {
            "No se encontró ningún servidor Sanatorio por UDP 8788. Ingresá su IP manualmente."
                .to_string()
        })
}

/// Devuelve el estado de la conexión de red.
#[tauri::command]
pub async fn get_network_connection_status() -> Result<NetworkStatusInfo, String> {
    let cfg = client_mode::load_config()?;

    if cfg.mode == AppMode::Local {
        let network = get_local_network_info()?;
        let active_ips: Vec<IpAddr> = network
            .interfaces
            .iter()
            .filter_map(|interface| interface.ip.parse::<Ipv4Addr>().ok().map(IpAddr::V4))
            .collect();
        let lan_ip = active_ips
            .first()
            .map(|ip| ip.to_string())
            .unwrap_or_else(|| "127.0.0.1".to_string());
        let ips_str = if active_ips.is_empty() {
            lan_ip.clone()
        } else {
            active_ips
                .iter()
                .map(|ip| ip.to_string())
                .collect::<Vec<_>>()
                .join(", ")
        };
        let tls_dir = crate::core::config::settings::sanatorio_root()
            .join("config")
            .join("tls");
        let cert_path = tls_dir.join("server-cert.pem");
        let health = match std::fs::read_to_string(&cert_path) {
            Ok(cert) => {
                check_server_health(&format!("https://{lan_ip}:{SERVER_PORT}"), &cert).await
            }
            Err(error) => Err((
                "tls".to_string(),
                format!("No se pudo leer el certificado HTTPS del servidor: {error}"),
            )),
        };
        return Ok(NetworkStatusInfo {
            mode: "local".to_string(),
            is_online: health.is_ok(),
            server_url: Some(format!("https://{lan_ip}:{SERVER_PORT}")),
            server_name: if health.is_ok() {
                crate::server::server_nickname()
            } else {
                "Servidor local no disponible".to_string()
            },
            is_server_host: true,
            message: health
                .as_ref()
                .map(|_| format!("API local operativa. IP LAN: {ips_str}."))
                .unwrap_or_else(|(_, message)| message.clone()),
            error_kind: health.err().map(|(kind, _)| kind),
            last_successful_communication: last_successful_communication(),
        });
    }

    if cfg
        .server_url
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
    {
        if let Some(server) = discover_servers_async(1800).await?.into_iter().next() {
            return Ok(NetworkStatusInfo {
                mode: "client".to_string(),
                is_online: false,
                server_url: Some(server.server_url),
                server_name: server.server_name,
                is_server_host: false,
                message: "Servidor detectado por UDP, pero todavía no autenticado. Verificá el certificado TLS antes de confiar.".to_string(),
                error_kind: Some("trust_required".to_string()),
                last_successful_communication: last_successful_communication(),
            });
        }
        return Ok(NetworkStatusInfo {
            mode: "client".to_string(),
            is_online: false,
            server_url: None,
            server_name: "Sin servidor configurado".to_string(),
            is_server_host: false,
            message: "No hay una dirección guardada y no se encontró un servidor por UDP. Ingresá la IP manualmente.".to_string(),
            error_kind: Some("not_found".to_string()),
            last_successful_communication: last_successful_communication(),
        });
    }

    let url = cfg.server_url.clone().unwrap_or_default();
    let cert_pem = cfg.server_cert_pem.as_deref().unwrap_or("auto");
    let health = check_server_health(&url, cert_pem).await;
    let (is_online, server_name, message, error_kind) = match health {
        Ok(name) => (
            true,
            name,
            "API disponible y certificado TLS verificado.".to_string(),
            None,
        ),
        Err((kind, message)) => (
            false,
            "Servidor no disponible".to_string(),
            message,
            Some(kind),
        ),
    };
    Ok(NetworkStatusInfo {
        mode: "client".to_string(),
        is_online,
        server_url: Some(url),
        server_name,
        is_server_host: false,
        message,
        error_kind,
        last_successful_communication: last_successful_communication(),
    })
}

/// Establece la URL manual del servidor.
#[tauri::command]
pub async fn set_manual_server_url(url: String, cert_pem: Option<String>) -> Result<(), String> {
    let clean = normalize_manual_server_url(&url)?;
    let mut cfg = client_mode::load_config()?;
    if cfg.mode != AppMode::Client {
        return Err(
            "La configuración de conexión solo puede modificarse en modo cliente.".to_string(),
        );
    }
    let existing_pin = cfg.server_url.as_deref() == Some(clean.as_str());
    let existing_certificate = if existing_pin {
        cfg.server_cert_pem
            .as_deref()
            .filter(|pem| pem.contains("-----BEGIN CERTIFICATE-----"))
    } else {
        None
    };
    let mut discovered_cert = if cert_pem.is_none() && existing_certificate.is_none() {
        discover_servers_async(1200)
            .await?
            .into_iter()
            .find(|server| server.server_url == clean)
            .and_then(|server| server.cert_pem)
    } else {
        None
    };
    let trust_pem = cert_pem
        .as_deref()
        .or(discovered_cert.as_deref())
        .or(existing_certificate)
        .unwrap_or("auto")
        .to_string();
    check_server_health(&clean, &trust_pem)
        .await
        .map_err(|(kind, message)| {
        let recovery = if kind == "tls" {
            " Si se reinstaló el servidor, usá «Buscar servidor LAN por UDP 8788» y pulsá «Conectar» en el candidato correcto para actualizar explícitamente el certificado."
        } else {
            ""
        };
        format!(
            "No se guardó la nueva dirección; se conserva la configuración anterior. {message}{recovery}"
        )
    })?;
    if let Some(cert_pem) = cert_pem.or(discovered_cert) {
        cfg.server_cert_pem = Some(cert_pem);
    } else if !existing_pin {
        cfg.server_cert_pem = Some("auto".to_string());
    }
    cfg.server_url = Some(clean);
    client_mode::save_config(&cfg)?;
    client_mode::set_runtime_mode(AppMode::Client);
    Ok(())
}

fn normalize_manual_server_url(value: &str) -> Result<String, String> {
    let value = value.trim();
    let candidate = if value.starts_with("http://") {
        return Err("Solo se admite HTTPS; use https:// o ingrese una IP/host.".to_string());
    } else if value.starts_with("https://") {
        value.to_string()
    } else {
        format!("https://{value}")
    };
    let mut parsed = url::Url::parse(&candidate)
        .map_err(|error| format!("Dirección del servidor inválida: {error}"))?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || parsed.username() != ""
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || (parsed.path() != "/" && !parsed.path().is_empty())
    {
        return Err(
            "Ingresá únicamente la IP o el host del servidor y el puerto opcional.".to_string(),
        );
    }
    if parsed.port().is_none() {
        parsed
            .set_port(Some(SERVER_PORT))
            .map_err(|_| "No se pudo aplicar el puerto HTTPS predeterminado.".to_string())?;
    }
    Ok(parsed.to_string().trim_end_matches('/').to_string())
}

/// Cambia la aplicación al modo servidor local.
#[tauri::command]
pub fn set_mode_local() -> Result<(), String> {
    let mut cfg = client_mode::load_config()?;
    cfg.mode = AppMode::Local;
    cfg.server_url = None;
    cfg.server_cert_pem = None;
    client_mode::save_config(&cfg)?;
    client_mode::set_runtime_mode(AppMode::Local);
    crate::server::start_background_server();
    Ok(())
}

#[tauri::command]
pub async fn set_server_primary_ip(ip: String) -> Result<LocalNetworkInfo, String> {
    let mut cfg = client_mode::load_config()?;
    if cfg.mode != AppMode::Local {
        return Err("La dirección principal solo se configura en modo servidor.".to_string());
    }

    let network = get_local_network_info()?;
    if !network
        .interfaces
        .iter()
        .any(|interface| interface.ip == ip)
    {
        return Err("La IP seleccionada no pertenece a una interfaz LAN disponible.".to_string());
    }

    let tls_dir = crate::core::config::settings::sanatorio_root()
        .join("config")
        .join("tls");
    let cert_pem = std::fs::read_to_string(tls_dir.join("server-cert.pem"))
        .map_err(|error| format!("No se pudo leer el certificado HTTPS del servidor: {error}"))?;
    check_server_health(&format!("https://{ip}:{SERVER_PORT}"), &cert_pem)
        .await
        .map_err(|(_, message)| {
            format!("La dirección no quedó seleccionada porque HTTPS/TLS no la verifica: {message}. Reiniciá el servidor para renovar el certificado si cambió la IP.")
        })?;

    cfg.server_primary_ip = Some(ip);
    client_mode::save_config(&cfg)?;
    get_local_network_info()
}

/// Obtiene la información detallada de adaptadores de red IPv4 de esta PC.
#[tauri::command]
pub fn get_local_network_info() -> Result<LocalNetworkInfo, String> {
    let mut interfaces: Vec<NetworkInterfaceInfo> = Vec::new();

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        if let Ok(output) = Command::new("ipconfig")
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            let mut current_name = String::new();
            let mut current_ip: Option<String> = None;
            let mut current_mask: Option<String> = None;
            let mut current_gateway: Option<String> = None;

            let flush_interface =
                |name: &str,
                 ip: &Option<String>,
                 mask: &Option<String>,
                 gateway: &Option<String>,
                 list: &mut Vec<NetworkInterfaceInfo>| {
                    if let Some(ref ip_str) = ip {
                        if let Ok(ipv4) = ip_str.parse::<Ipv4Addr>() {
                            let octets = ipv4.octets();
                            // Filtrar loopback 127.x.x.x y link-local APIPA 169.254.x.x
                            if octets[0] != 127 && !(octets[0] == 169 && octets[1] == 254) {
                                if should_include_lan_interface(name, ipv4) {
                                    let friendly_name = if name.contains(':') {
                                        name.trim_end_matches(':').trim().to_string()
                                    } else {
                                        name.trim().to_string()
                                    };
                                    let has_gw = gateway
                                        .as_ref()
                                        .map(|g| !g.trim().is_empty() && g.trim() != "0.0.0.0")
                                        .unwrap_or(false);
                                    list.push(NetworkInterfaceInfo {
                                        name: friendly_name,
                                        ip: ip_str.clone(),
                                        mask: mask
                                            .clone()
                                            .unwrap_or_else(|| "Desconocida".to_string()),
                                        gateway: if has_gw { gateway.clone() } else { None },
                                        server_endpoint: format!("{}:{}", ip_str, SERVER_PORT),
                                        is_primary: has_gw,
                                    });
                                }
                            }
                        }
                    }
                };

            for raw_line in text.lines() {
                let line = raw_line.trim_end();
                // Nuevo bloque de adaptador (línea no indentada o con encabezado de adaptador)
                if (!line.starts_with(' ') && !line.starts_with('\t') && line.ends_with(':'))
                    || line.starts_with("Adaptador")
                    || line.starts_with("Ethernet adapter")
                    || line.starts_with("Wireless LAN adapter")
                {
                    flush_interface(
                        &current_name,
                        &current_ip,
                        &current_mask,
                        &current_gateway,
                        &mut interfaces,
                    );
                    current_name = line.to_string();
                    current_ip = None;
                    current_mask = None;
                    current_gateway = None;
                    continue;
                }

                if line.contains("IPv4") || line.contains("Direcci") {
                    if let Some(pos) = line.rfind(':') {
                        let candidate = line[pos + 1..].trim();
                        let clean = candidate.split_whitespace().next().unwrap_or("");
                        if clean.parse::<Ipv4Addr>().is_ok() {
                            current_ip = Some(clean.to_string());
                        }
                    }
                } else if line.contains("Máscara")
                    || line.contains("Mascara")
                    || line.contains("Subnet Mask")
                {
                    if let Some(pos) = line.rfind(':') {
                        let candidate = line[pos + 1..].trim();
                        let clean = candidate.split_whitespace().next().unwrap_or("");
                        if clean.parse::<Ipv4Addr>().is_ok() {
                            current_mask = Some(clean.to_string());
                        }
                    }
                } else if line.contains("Puerta de enlace") || line.contains("Default Gateway") {
                    if let Some(pos) = line.rfind(':') {
                        let candidate = line[pos + 1..].trim();
                        let clean = candidate.split_whitespace().next().unwrap_or("");
                        if clean.parse::<Ipv4Addr>().is_ok() {
                            current_gateway = Some(clean.to_string());
                        }
                    }
                }
            }
            flush_interface(
                &current_name,
                &current_ip,
                &current_mask,
                &current_gateway,
                &mut interfaces,
            );
        }
    }

    // Fallback si no se encontró nada por ipconfig
    if interfaces.is_empty() {
        for target in &["8.8.8.8:80", "1.1.1.1:80", "192.168.1.1:80"] {
            if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
                if socket.connect(target).is_ok() {
                    if let Ok(local) = socket.local_addr() {
                        let ip = local.ip();
                        if !ip.is_loopback() && !ip.is_unspecified() {
                            if let IpAddr::V4(v4) = ip {
                                if should_include_lan_interface("Conexión de red", v4) {
                                    let ip_str = v4.to_string();
                                    interfaces.push(NetworkInterfaceInfo {
                                        name: "Conexión de red".to_string(),
                                        ip: ip_str.clone(),
                                        mask: "Desconocida".to_string(),
                                        gateway: None,
                                        server_endpoint: format!("{ip_str}:{SERVER_PORT}"),
                                        is_primary: true,
                                    });
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let cfg = client_mode::load_config()?;
    select_primary_interface(&mut interfaces, cfg.server_primary_ip.as_deref());
    interfaces.sort_by(|a, b| b.is_primary.cmp(&a.is_primary));
    let primary_ip = interfaces
        .iter()
        .find(|i| i.is_primary)
        .map(|i| i.ip.clone());

    Ok(LocalNetworkInfo {
        interfaces,
        primary_ip,
    })
}

fn should_include_lan_interface(name: &str, ip: Ipv4Addr) -> bool {
    let name = name.to_ascii_lowercase();
    let virtual_or_non_lan = [
        "vethernet",
        "virtual",
        "vmware",
        "hyper-v",
        "hyperv",
        "wsl",
        "teredo",
        "loopback",
        "bluetooth",
        "pseudo",
        "virtualbox",
        "vbox",
        "docker",
        "container",
        "vpn",
        "wireguard",
        "tunnel",
        "tap",
        "tun",
    ];
    !ip.is_loopback()
        && !ip.is_link_local()
        && !ip.is_unspecified()
        && !ip.is_multicast()
        && !ip.is_broadcast()
        && !virtual_or_non_lan
            .iter()
            .any(|marker| name.contains(marker))
}

fn select_primary_interface(interfaces: &mut [NetworkInterfaceInfo], preferred_ip: Option<&str>) {
    let selected = preferred_ip
        .and_then(|ip| interfaces.iter().position(|interface| interface.ip == ip))
        .or_else(|| {
            interfaces
                .iter()
                .position(|interface| interface.gateway.is_some())
        })
        .or_else(|| (!interfaces.is_empty()).then_some(0));
    for (index, interface) in interfaces.iter_mut().enumerate() {
        interface.is_primary = Some(index) == selected;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::get, Json, Router};

    #[test]
    fn broadcast_usa_la_mascara_real_y_no_asume_24() {
        assert_eq!(
            calculate_broadcast(
                Ipv4Addr::new(192, 168, 7, 42),
                Ipv4Addr::new(255, 255, 240, 0)
            ),
            Ipv4Addr::new(192, 168, 15, 255)
        );
        assert_eq!(
            calculate_broadcast(
                Ipv4Addr::new(192, 168, 7, 42),
                Ipv4Addr::new(255, 255, 255, 128)
            ),
            Ipv4Addr::new(192, 168, 7, 127)
        );
    }

    #[test]
    fn serialize_status_includes_last_success_and_error_kind() {
        let status = NetworkStatusInfo {
            mode: "client".to_string(),
            is_online: false,
            server_url: Some("https://192.168.1.10:8787".to_string()),
            server_name: "Servidor".to_string(),
            is_server_host: false,
            message: "TLS falló".to_string(),
            error_kind: Some("tls".to_string()),
            last_successful_communication: Some("2026-11-11T00:00:00Z".to_string()),
        };
        let json = serde_json::to_value(status).unwrap();
        assert_eq!(json["errorKind"], "tls");
        assert_eq!(json["lastSuccessfulCommunication"], "2026-11-11T00:00:00Z");
        assert!(json.get("tlsFingerprint").is_none());
    }

    #[test]
    fn primary_ip_prefers_saved_interface_and_falls_back_when_it_disappears() {
        let mut interfaces = vec![
            NetworkInterfaceInfo {
                name: "Wi-Fi".to_string(),
                ip: "192.168.1.10".to_string(),
                mask: "255.255.255.0".to_string(),
                gateway: Some("192.168.1.1".to_string()),
                server_endpoint: "192.168.1.10:8787".to_string(),
                is_primary: true,
            },
            NetworkInterfaceInfo {
                name: "Ethernet".to_string(),
                ip: "10.0.0.15".to_string(),
                mask: "255.255.0.0".to_string(),
                gateway: Some("10.0.0.1".to_string()),
                server_endpoint: "10.0.0.15:8787".to_string(),
                is_primary: false,
            },
        ];
        select_primary_interface(&mut interfaces, Some("10.0.0.15"));
        assert!(!interfaces[0].is_primary);
        assert!(interfaces[1].is_primary);

        select_primary_interface(&mut interfaces, Some("192.168.99.99"));
        assert!(interfaces[0].is_primary);
        assert!(!interfaces[1].is_primary);
    }

    #[test]
    fn excludes_loopback_and_virtual_network_interfaces() {
        assert!(!should_include_lan_interface(
            "Ethernet adapter Loopback Pseudo-Interface",
            Ipv4Addr::new(192, 168, 1, 4)
        ));
        assert!(!should_include_lan_interface(
            "Ethernet",
            Ipv4Addr::new(127, 0, 0, 1)
        ));
        assert!(should_include_lan_interface(
            "Wi-Fi",
            Ipv4Addr::new(192, 168, 1, 4)
        ));
    }

    #[test]
    fn manual_server_url_keeps_custom_port_and_defaults_to_https_port() {
        assert_eq!(
            normalize_manual_server_url("192.168.10.5").unwrap(),
            "https://192.168.10.5:8787"
        );
        assert_eq!(
            normalize_manual_server_url("https://sanatorio.local:9443").unwrap(),
            "https://sanatorio.local:9443"
        );
        assert!(normalize_manual_server_url("http://192.168.10.5:8787").is_err());
        assert!(normalize_manual_server_url("https://user@192.168.10.5:8787").is_err());
    }

    #[tokio::test]
    async fn direct_https_health_verifies_custom_port_and_tls_identity() {
        let app = Router::new().route(
            "/api/health",
            get(|| async {
                Json(serde_json::json!({
                    "app": "sanatorio",
                    "server_name": "Servidor de prueba"
                }))
            }),
        );
        let server = crate::test_support::start_tls_server(app).await;
        let normalized = normalize_manual_server_url(&server.base_url).unwrap();
        assert_eq!(
            url::Url::parse(&normalized).unwrap().port(),
            url::Url::parse(&server.base_url).unwrap().port()
        );
        assert_eq!(
            check_server_health(&normalized, &server.pem).await.unwrap(),
            "Servidor de prueba"
        );

        let other = crate::test_support::start_tls_server(Router::new()).await;
        assert!(check_server_health(&normalized, &other.pem).await.is_err());
    }
}
