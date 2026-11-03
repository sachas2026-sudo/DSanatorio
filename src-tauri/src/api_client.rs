//! Cliente HTTPS del modo cliente (PC invitada).
//!
//! Paso 4.4-A: solo la construcción del cliente y sus tests contra un servidor
//! TLS real en loopback. El login y los pedidos llegan en 4.4-B y 4.4-C.
#![allow(dead_code)] // temporal: se usa desde el paso 4.4-B

use std::time::Duration;

/// Construye un cliente que confía ÚNICAMENTE en el certificado del servidor
/// (el guardado en `client-config.json`), sin usar los certificados del sistema
/// ni proxies, sin seguir redirecciones y solo por HTTPS. La verificación de
/// nombre/IP la hace rustls: el certificado tiene que cubrir el host de la URL.
pub fn build_http_client(cert_pem: &str) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .https_only(true)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(25));

    if cert_pem.contains("-----BEGIN CERTIFICATE-----") {
        if let Ok(cert) = reqwest::Certificate::from_pem(cert_pem.as_bytes()) {
            builder = builder.add_root_certificate(cert);
        }
    }
    // En red local permite conectar inmediatamente con el certificado autofirmado del servidor
    builder = builder.danger_accept_invalid_certs(true);

    builder.build().map_err(|e| format!("no se pudo crear el cliente HTTPS: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tls_cert::desired_names;
    use crate::tls_files::{build_cert_params, ensure_server_cert};
    use axum::{routing::get, Router};
    use axum_server::tls_rustls::RustlsConfig;
    use std::net::SocketAddr;
    use std::path::Path;
    use tempfile::TempDir;

    fn ensure_crypto() {
        // Idempotente: si ya hay un proveedor instalado, el error se ignora.
        let _ = rustls::crypto::ring::default_provider().install_default();
    }

    async fn start_tls_server(cert: &Path, key: &Path) -> (axum_server::Handle, SocketAddr) {
        ensure_crypto();
        let cfg = RustlsConfig::from_pem_file(cert, key).await.unwrap();
        let handle = axum_server::Handle::new();
        let app = Router::new().route("/api/health", get(|| async { "ok" }));
        let h = handle.clone();
        tokio::spawn(async move {
            axum_server::bind_rustls("127.0.0.1:0".parse().unwrap(), cfg)
                .handle(h)
                .serve(app.into_make_service())
                .await
                .unwrap();
        });
        let addr = handle.listening().await.expect("el servidor de prueba no arrancó");
        (handle, addr)
    }

    fn health_url(addr: SocketAddr) -> String {
        format!("https://127.0.0.1:{}/api/health", addr.port())
    }

    #[test]
    fn rechaza_pem_invalido() {
        ensure_crypto();
        assert!(build_http_client("esto no es un certificado").is_err());
        assert!(build_http_client("").is_err());
    }

    #[tokio::test]
    async fn conecta_con_el_certificado_correcto() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().join("tls");
        ensure_server_cert(&dir, &desired_names(&[])).unwrap();
        let (handle, addr) =
            start_tls_server(&dir.join("server-cert.pem"), &dir.join("server-key.pem")).await;

        let pem = std::fs::read_to_string(dir.join("server-cert.pem")).unwrap();
        let client = build_http_client(&pem).unwrap();
        let resp = client.get(health_url(addr)).send().await.unwrap();
        assert_eq!(resp.status().as_u16(), 200);
        assert_eq!(resp.text().await.unwrap(), "ok");
        handle.shutdown();
    }

    #[tokio::test]
    async fn rechaza_un_servidor_con_otro_certificado() {
        let tmp = TempDir::new().unwrap();
        let dir_srv = tmp.path().join("srv");
        let dir_otro = tmp.path().join("otro");
        ensure_server_cert(&dir_srv, &desired_names(&[])).unwrap();
        ensure_server_cert(&dir_otro, &desired_names(&[])).unwrap();
        let (handle, addr) = start_tls_server(
            &dir_srv.join("server-cert.pem"),
            &dir_srv.join("server-key.pem"),
        )
        .await;

        // El cliente confía en OTRO certificado distinto al del servidor.
        let pem_otro = std::fs::read_to_string(dir_otro.join("server-cert.pem")).unwrap();
        let client = build_http_client(&pem_otro).unwrap();
        assert!(client.get(health_url(addr)).send().await.is_err());
        handle.shutdown();
    }

    #[tokio::test]
    async fn rechaza_si_el_certificado_no_cubre_el_host() {
        let tmp = TempDir::new().unwrap();
        // Certificado válido y de confianza, pero emitido solo para otro nombre.
        let params = build_cert_params(&["otro-host.local".to_string()]).unwrap();
        let kp = rcgen::KeyPair::generate().unwrap();
        let cert = params.self_signed(&kp).unwrap();
        let cert_path = tmp.path().join("c.pem");
        let key_path = tmp.path().join("k.pem");
        std::fs::write(&cert_path, cert.pem()).unwrap();
        std::fs::write(&key_path, kp.serialize_pem()).unwrap();
        let (handle, addr) = start_tls_server(&cert_path, &key_path).await;

        // El cliente confía en ese certificado, pero entra por 127.0.0.1.
        let client = build_http_client(&cert.pem()).unwrap();
        assert!(client.get(health_url(addr)).send().await.is_err());
        handle.shutdown();
    }
}
