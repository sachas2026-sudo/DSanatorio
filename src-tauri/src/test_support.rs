//! Utilidades compartidas por los tests: servidor HTTPS de prueba en loopback.

use crate::tls_cert::desired_names;
use crate::tls_files::ensure_server_cert;
use axum::Router;
use axum_server::tls_rustls::RustlsConfig;
use tempfile::TempDir;

pub(crate) fn ensure_crypto() {
    // Idempotente: si ya hay un proveedor instalado, el error se ignora.
    let _ = rustls::crypto::ring::default_provider().install_default();
}

pub(crate) struct TlsServer {
    _tmp: TempDir,
    handle: axum_server::Handle,
    pub base_url: String,
    pub pem: String,
}

impl Drop for TlsServer {
    fn drop(&mut self) {
        self.handle.shutdown();
    }
}

/// Levanta `app` por HTTPS en 127.0.0.1 (puerto libre) con un certificado
/// autofirmado recién generado.
pub(crate) async fn start_tls_server(app: Router) -> TlsServer {
    ensure_crypto();
    let tmp = TempDir::new().unwrap();
    let dir = tmp.path().join("tls");
    ensure_server_cert(&dir, &desired_names(&[])).unwrap();
    let cfg = RustlsConfig::from_pem_file(dir.join("server-cert.pem"), dir.join("server-key.pem"))
        .await
        .unwrap();
    let handle = axum_server::Handle::new();
    let h = handle.clone();
    tokio::spawn(async move {
        axum_server::bind_rustls("127.0.0.1:0".parse().unwrap(), cfg)
            .handle(h)
            .serve(app.into_make_service())
            .await
            .unwrap();
    });
    let addr = handle.listening().await.expect("el servidor de prueba no arrancó");
    let pem = std::fs::read_to_string(dir.join("server-cert.pem")).unwrap();
    TlsServer {
        _tmp: tmp,
        handle,
        base_url: format!("https://127.0.0.1:{}", addr.port()),
        pem,
    }
}
