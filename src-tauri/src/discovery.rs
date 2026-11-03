use std::net::{SocketAddr, UdpSocket};
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

/// Envía broadcast UDP en la red local buscando el servidor Sanatorio.
pub fn discover_servers(timeout_ms: u64) -> Result<Vec<DiscoveredServer>, String> {
    let socket = UdpSocket::bind("0.0.0.0:0")
        .map_err(|e| format!("Error creando socket UDP discovery: {e}"))?;
    socket
        .set_broadcast(true)
        .map_err(|e| format!("Error habilitando broadcast: {e}"))?;
    socket
        .set_read_timeout(Some(Duration::from_millis(150)))
        .map_err(|e| format!("Error seteando timeout: {e}"))?;

    let req = DiscoveryMessage {
        r#type: DISCOVERY_REQUEST.to_string(),
        server_name: None,
        port: None,
        cert_pem: None,
    };
    let req_bytes = serde_json::to_vec(&req)
        .map_err(|e| format!("Error serializando request: {e}"))?;

    let broadcast_addrs = [
        format!("255.255.255.255:{DISCOVERY_PORT}"),
        format!("192.168.1.255:{DISCOVERY_PORT}"),
        format!("192.168.0.255:{DISCOVERY_PORT}"),
        format!("192.168.100.255:{DISCOVERY_PORT}"),
        format!("127.0.0.1:{DISCOVERY_PORT}"),
    ];

    for addr_str in &broadcast_addrs {
        if let Ok(addr) = addr_str.parse::<SocketAddr>() {
            let _ = socket.send_to(&req_bytes, addr);
        }
    }

    let deadline = Instant::now() + Duration::from_millis(timeout_ms.max(600));
    let mut found = Vec::new();
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
                        if !found.iter().any(|s: &DiscoveredServer| s.server_url == url) {
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
            Err(_) => {}
        }
    }

    Ok(found)
}

#[tauri::command]
pub fn discover_sanatorio_servers(timeout_ms: Option<u64>) -> Result<Vec<DiscoveredServer>, String> {
    discover_servers(timeout_ms.unwrap_or(1200))
}

#[tauri::command]
pub async fn auto_connect_sanatorio_server() -> Result<DiscoveredServer, String> {
    let servers = discover_servers(1500)?;
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
    cfg.server_cert_pem = first.cert_pem.clone().or_else(|| Some("auto".to_string()));
    client_mode::save_config(&cfg)?;
    client_mode::set_runtime_mode(AppMode::Client);

    Ok(first)
}

#[tauri::command]
pub async fn get_network_connection_status() -> Result<NetworkStatusInfo, String> {
    let cfg = client_mode::load_config().unwrap_or(ClientConfig {
        mode: AppMode::Local,
        server_url: None,
        server_cert_pem: None,
    });

    if cfg.mode == AppMode::Local {
        return Ok(NetworkStatusInfo {
            mode: "local".to_string(),
            is_online: true,
            server_url: Some(format!("https://127.0.0.1:{SERVER_PORT}")),
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
            if let Ok(servers) = discover_servers(800) {
                if let Some(srv) = servers.into_iter().next() {
                    let mut updated = cfg.clone();
                    updated.server_url = Some(srv.server_url.clone());
                    updated.server_cert_pem = srv.cert_pem.clone().or_else(|| Some("auto".to_string()));
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
                    updated.server_cert_pem = srv.cert_pem.clone().or_else(|| Some("auto".to_string()));
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
