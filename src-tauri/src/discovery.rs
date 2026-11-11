use std::net::{SocketAddr, UdpSocket, IpAddr, Ipv4Addr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};

use crate::client_mode::{self, AppMode, ClientConfig};

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
pub struct DiscoveredServer {
    pub ip: String,
    pub port: u16,
    pub server_name: String,
    pub server_url: String,
    pub cert_pem: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NetworkStatusInfo {
    pub mode: String,
    pub is_online: bool,
    pub server_url: Option<String>,
    pub server_name: String,
    pub is_server_host: bool,
    pub message: String,
}

static RESPONDER_RUNNING: AtomicBool = AtomicBool::new(false);

/// Inicia el listener UDP en el puerto 8788 para responder a clientes en la red.
pub fn start_udp_responder(server_name: String, cert_pem: String) {
    if RESPONDER_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::Builder::new()
        .name("sanatorio-udp-discovery".to_string())
        .spawn(move || {
            let socket = match UdpSocket::bind(("0.0.0.0", DISCOVERY_PORT)) {
                Ok(s) => s,
                Err(e) => {
                    log::warn!("No se pudo bindear listener UDP en puerto {DISCOVERY_PORT}: {e}");
                    RESPONDER_RUNNING.store(false, Ordering::SeqCst);
                    return;
                }
            };
            let _ = socket.set_read_timeout(Some(Duration::from_millis(500)));
            let _ = socket.set_broadcast(true);

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
                                    let _ = socket.send_to(&bytes, peer);
                                }
                            }
                        }
                    }
                    Err(ref e)
                        if e.kind() == std::io::ErrorKind::TimedOut
                            || e.kind() == std::io::ErrorKind::WouldBlock => {}
                    Err(_) => break,
                }
            }
            RESPONDER_RUNNING.store(false, Ordering::SeqCst);
        })
        .ok();
}

/// Obtiene las interfaces IPv4 activas tanto cableadas (Ethernet) como inalámbricas (Wi-Fi).
fn get_active_ipv4_interfaces() -> Vec<IpAddr> {
    let mut interfaces: Vec<IpAddr> = Vec::new();

    // 1. En Windows, consultar ipconfig para obtener todas las interfaces reales (Ethernet y Wi-Fi)
    #[cfg(windows)]
    {
        use std::process::Command;
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        if let Ok(output) = Command::new("ipconfig")
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                // Busca líneas con "IPv4" o "Direcci" (Dirección IPv4)
                if line.contains("IPv4") || line.contains("Direcci") {
                    if let Some(pos) = line.rfind(':') {
                        let candidate = line[pos + 1..].trim();
                        // Limpiar sufijos como "(Preferido)" o similares
                        let clean_ip = candidate.split_whitespace().next().unwrap_or("");
                        if let Ok(ip) = clean_ip.parse::<Ipv4Addr>() {
                            let octets = ip.octets();
                            // Filtrar loopback (127.x.x.x) y link-local APIPA (169.254.x.x)
                            if octets[0] != 127 && !(octets[0] == 169 && octets[1] == 254) {
                                let ip_addr = IpAddr::V4(ip);
                                if !interfaces.contains(&ip_addr) {
                                    interfaces.push(ip_addr);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Fallback: conectar un socket UDP a un host externo para descubrir la interfaz default
    if interfaces.is_empty() {
        for target in &["8.8.8.8:80", "1.1.1.1:80", "192.168.1.1:80", "192.168.0.1:80"] {
            if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
                if socket.connect(target).is_ok() {
                    if let Ok(local) = socket.local_addr() {
                        let ip = local.ip();
                        if !ip.is_loopback() && !ip.is_unspecified() {
                            if let IpAddr::V4(v4) = ip {
                                let octets = v4.octets();
                                if !(octets[0] == 169 && octets[1] == 254) && !interfaces.contains(&ip) {
                                    interfaces.push(ip);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    interfaces
}

/// Calcula el broadcast address para una IP dada asumiendo máscara /24.
fn calculate_broadcast(ip: IpAddr) -> Option<IpAddr> {
    if let IpAddr::V4(ip_v4) = ip {
        let octets = ip_v4.octets();
        // Máscara /24: los primeros 3 octetos son la red, el último es el broadcast
        let broadcast_ip = Ipv4Addr::new(octets[0], octets[1], octets[2], 255);
        Some(IpAddr::V4(broadcast_ip))
    } else {
        None
    }
}

/// Si el broadcast UDP no devolvió ningún servidor, escanea la subred /24 por TCP
/// probando el puerto 8787 y el endpoint /api/health en paralelo.
fn scan_subnets_health(interfaces: &[IpAddr]) -> Vec<DiscoveredServer> {
    use std::net::TcpStream;
    use std::sync::{Arc, Mutex};
    use std::thread;

    let discovered = Arc::new(Mutex::new(Vec::new()));
    let client = match reqwest::blocking::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_millis(700))
        .build()
    {
        Ok(c) => Arc::new(c),
        Err(_) => return Vec::new(),
    };

    for iface in interfaces {
        if let IpAddr::V4(v4) = iface {
            let octets = v4.octets();
            let mut handles = Vec::new();
            for last in 1..=254 {
                if last == octets[3] {
                    continue;
                }
                let target_ip = Ipv4Addr::new(octets[0], octets[1], octets[2], last);
                let target_socket = SocketAddr::new(IpAddr::V4(target_ip), SERVER_PORT);
                let disc = Arc::clone(&discovered);
                let cli = Arc::clone(&client);

                handles.push(thread::spawn(move || {
                    if TcpStream::connect_timeout(&target_socket, Duration::from_millis(180)).is_ok() {
                        let url = format!("https://{}:{SERVER_PORT}/api/health", target_ip);
                        if let Ok(resp) = cli.get(&url).send() {
                            if resp.status().is_success() {
                                if let Ok(body) = resp.json::<serde_json::Value>() {
                                    let is_sanatorio = body.get("app").and_then(|v| v.as_str()) == Some("sanatorio")
                                        || body.get("status").and_then(|v| v.as_str()) == Some("ok");
                                    if is_sanatorio {
                                        let name = body.get("server_name")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("Servidor Sanatorio")
                                            .to_string();
                                        let server_url = format!("https://{}:{SERVER_PORT}", target_ip);
                                        let mut guard = disc.lock().unwrap();
                                        guard.push(DiscoveredServer {
                                            ip: target_ip.to_string(),
                                            port: SERVER_PORT,
                                            server_name: name,
                                            server_url,
                                            cert_pem: None,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }));

                if handles.len() >= 64 {
                    for h in handles.drain(..) {
                        let _ = h.join();
                    }
                }
            }
            for h in handles {
                let _ = h.join();
            }
        }
    }

    let result = discovered.lock().unwrap().clone();
    result
}

/// Envía broadcast UDP en la red local buscando el servidor Sanatorio.
/// Usa broadcast dinámico por cada interfaz IPv4 activa, además de 255.255.255.255.
/// Incluye health check de respaldo por subred /24.
pub fn discover_servers(timeout_ms: u64) -> Result<Vec<DiscoveredServer>, String> {
    let socket = UdpSocket::bind("0.0.0.0:0")
        .map_err(|e| format!("Error creando socket UDP discovery: {e}"))?;
    socket
        .set_broadcast(true)
        .map_err(|e| format!("Error habilitando broadcast: {e}"))?;
    socket
        .set_read_timeout(Some(Duration::from_millis(300)))
        .map_err(|e| format!("Error seteando timeout: {e}"))?;

    let req = DiscoveryMessage {
        r#type: DISCOVERY_REQUEST.to_string(),
        server_name: None,
        port: None,
        cert_pem: None,
    };
    let req_bytes = serde_json::to_vec(&req)
        .map_err(|e| format!("Error serializando request: {e}"))?;

    let mut found_set: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut found: Vec<DiscoveredServer> = Vec::new();

    // 1. Broadcast dinámico por cada interfaz IPv4 activa (Ethernet y Wi-Fi)
    let active_ips = get_active_ipv4_interfaces();
    let mut broadcast_addrs = Vec::new();

    for ip in &active_ips {
        if let Some(broadcast) = calculate_broadcast(*ip) {
            broadcast_addrs.push(format!("{}:{DISCOVERY_PORT}", broadcast));
        }
    }
    broadcast_addrs.push(format!("255.255.255.255:{DISCOVERY_PORT}"));

    for addr_str in &broadcast_addrs {
        if let Ok(addr) = addr_str.parse::<SocketAddr>() {
            let _ = socket.send_to(&req_bytes, addr);
        }
    }

    // 2. Esperar respuestas con timeout
    let deadline = Instant::now() + Duration::from_millis(timeout_ms.max(1200));
    let mut buf = [0u8; 4096];

    while Instant::now() < deadline {
        match socket.recv_from(&mut buf) {
            Ok((size, peer)) => {
                if let Ok(msg) = serde_json::from_slice::<DiscoveryMessage>(&buf[..size]) {
                    if msg.r#type == DISCOVERY_RESPONSE {
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
            Err(_) => break,
        }
    }

    // 3. Si por broadcast UDP no encontramos nada (ej. router bloquea broadcast UDP),
    // hacer barrido TCP en las subredes de las interfaces activas
    if found.is_empty() {
        let tcp_servers = scan_subnets_health(&active_ips);
        for s in tcp_servers {
            if !found_set.contains(&s.server_url) {
                found_set.insert(s.server_url.clone());
                found.push(s);
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

/// Descubre servidores Sanatorio en la red local.
/// El timeout por defecto es de 3000ms con 2 rondas de descubrimiento.
#[tauri::command]
pub fn discover_sanatorio_servers(timeout_ms: Option<u64>) -> Result<Vec<DiscoveredServer>, String> {
    let timeout = timeout_ms.unwrap_or(3000);
    discover_servers(timeout)
}

/// Intenta conectar automáticamente al servidor Sanatorio de la red.
#[tauri::command]
pub async fn auto_connect_sanatorio_server() -> Result<DiscoveredServer, String> {
    let servers = discover_servers(3000)?;
    let first = servers.into_iter().next().ok_or_else(|| {
        "No se encontró ningún servidor Sanatorio en la red local. Asegurate de que la PC Servidor esté encendida con el programa abierto.".to_string()
    })?;

    let mut cfg = client_mode::load_config().unwrap_or(ClientConfig {
        mode: AppMode::Client,
        server_url: None,
        server_cert_pem: None,
    });
    cfg.mode = AppMode::Client;
    cfg.server_url = Some(first.server_url.clone());
    cfg.server_cert_pem = Some("auto".to_string());
    client_mode::save_config(&cfg)?;
    client_mode::set_runtime_mode(AppMode::Client);

    Ok(first)
}

/// Devuelve el estado de la conexión de red.
#[tauri::command]
pub async fn get_network_connection_status() -> Result<NetworkStatusInfo, String> {
    let cfg = client_mode::load_config().unwrap_or(ClientConfig {
        mode: AppMode::Local,
        server_url: None,
        server_cert_pem: None,
    });

    if cfg.mode == AppMode::Local {
        let lan_ip = UdpSocket::bind("0.0.0.0:0")
            .and_then(|s| {
                s.connect("8.8.8.8:80").ok();
                s.local_addr()
            })
            .map(|addr| addr.ip().to_string())
            .unwrap_or_else(|_| "127.0.0.1".to_string());
        return Ok(NetworkStatusInfo {
            mode: "local".to_string(),
            is_online: true,
            server_url: Some(format!("https://{lan_ip}:{SERVER_PORT}")),
            server_name: "Servidor local (activo)".to_string(),
            is_server_host: true,
            message: "Esta PC actúa como Servidor principal en la red.".to_string(),
        });
    }

    // Modo cliente
    let url = match &cfg.server_url {
        Some(u) if !u.trim().is_empty() => u.clone(),
        _ => {
            // Intentar descubrimiento automático si no hay URL configurada
            if let Ok(servers) = discover_servers(3000) {
                if let Some(srv) = servers.into_iter().next() {
                    let mut updated = cfg.clone();
                    updated.server_url = Some(srv.server_url.clone());
                    updated.server_cert_pem = Some("auto".to_string());
                    let _ = client_mode::save_config(&updated);
                    return Ok(NetworkStatusInfo {
                        mode: "client".to_string(),
                        is_online: true,
                        server_url: Some(srv.server_url),
                        server_name: srv.server_name,
                        is_server_host: false,
                        message: "Servidor detectado y vinculado automáticamente.".to_string(),
                    });
                }
            }
            return Ok(NetworkStatusInfo {
                mode: "client".to_string(),
                is_online: false,
                server_url: None,
                server_name: "Sin servidor vinculado".to_string(),
                is_server_host: false,
                message: "Buscando servidor en la red local...".to_string(),
            });
        }
    };

    // Verificar si el servidor configurado responde al endpoint /api/health
    let health_url = format!("{}/api/health", url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_millis(1500))
        .build();

    let is_online = match client {
        Ok(c) => match c.get(&health_url).send().await {
            Ok(resp) => resp.status().is_success(),
            Err(_) => false,
        },
        Err(_) => false,
    };

    // Si está offline, intentar auto-redescubrir en caso de que haya cambiado la IP del router
    if !is_online {
        if let Ok(servers) = discover_servers(1000) {
            if let Some(srv) = servers.into_iter().next() {
                if srv.server_url != url {
                    let mut updated = cfg.clone();
                    updated.server_url = Some(srv.server_url.clone());
                    updated.server_cert_pem = Some("auto".to_string());
                    let _ = client_mode::save_config(&updated);
                    return Ok(NetworkStatusInfo {
                        mode: "client".to_string(),
                        is_online: true,
                        server_url: Some(srv.server_url),
                        server_name: srv.server_name,
                        is_server_host: false,
                        message: "Servidor reubicado y conectado automáticamente.".to_string(),
                    });
                }
            }
        }
    }

    Ok(NetworkStatusInfo {
        mode: "client".to_string(),
        is_online,
        server_url: Some(url),
        server_name: if is_online { "Servidor conectado".to_string() } else { "Servidor desconectado o apagado".to_string() },
        is_server_host: false,
        message: if is_online {
            "Conectado a la base de datos central en tiempo real.".to_string()
        } else {
            "No se pudo conectar con el servidor. Verificá que la PC principal esté encendida.".to_string()
        },
    })
}

/// Establece la URL manual del servidor.
#[tauri::command]
pub fn set_manual_server_url(url: String) -> Result<(), String> {
    let clean = url.trim().trim_end_matches('/').to_string();
    if !clean.starts_with("https://") && !clean.starts_with("http://") {
        return Err("La dirección debe comenzar con https:// o http://".to_string());
    }
    let mut cfg = client_mode::load_config().unwrap_or(ClientConfig {
        mode: AppMode::Client,
        server_url: None,
        server_cert_pem: None,
    });
    cfg.mode = AppMode::Client;
    cfg.server_url = Some(clean);
    if cfg.server_cert_pem.is_none() {
        cfg.server_cert_pem = Some("auto".to_string());
    }
    client_mode::save_config(&cfg)?;
    client_mode::set_runtime_mode(AppMode::Client);
    Ok(())
}

/// Cambia la aplicación al modo servidor local.
#[tauri::command]
pub fn set_mode_local() -> Result<(), String> {
    let cfg = ClientConfig {
        mode: AppMode::Local,
        server_url: None,
        server_cert_pem: None,
    };
    client_mode::save_config(&cfg)?;
    client_mode::set_runtime_mode(AppMode::Local);
    Ok(())
}