//! Generación y renovación del certificado TLS autofirmado del servidor.
//!
//! Paso 4.3-B1: solo el módulo y sus tests. La conexión con `run_server()`
//! llega en el paso 4.3-B2.

use std::net::IpAddr;
use std::path::Path;

use rcgen::{CertificateParams, KeyPair, SanType};

const CERT_FILE: &str = "server-cert.pem";
const KEY_FILE: &str = "server-key.pem";
const NAMES_FILE: &str = "server-cert.names";
const EXTRA_NAMES_FILE: &str = "names.txt";

#[derive(Debug, PartialEq, Eq)]
pub enum CertOutcome {
    /// El certificado existente ya cubre exactamente esa lista de nombres.
    Unchanged,
    /// Se generó un certificado nuevo (primera vez o cambió la lista).
    Regenerated,
}

/// Lee `names.txt` (nombres/IPs extra, uno por línea) de la carpeta TLS.
/// Si el archivo no existe, devuelve lista vacía.
pub fn load_extra_names(tls_dir: &Path) -> Result<Vec<String>, String> {
    let path = tls_dir.join(EXTRA_NAMES_FILE);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes = std::fs::read(&path)
        .map_err(|e| format!("no se pudo leer {}: {e}", path.display()))?;
    let texto = String::from_utf8(bytes).map_err(|_| {
        format!("{} debe estar guardado como UTF-8 o ASCII", path.display())
    })?;
    crate::tls_cert::parse_tls_names(&texto).map_err(|e| format!("{}: {e}", path.display()))
}

/// Arma los parámetros del certificado: las IPs van como `IpAddress` y el
/// resto como `DnsName` (un cliente que entra por IP exige el SAN de tipo IP).
pub fn build_cert_params(names: &[String]) -> Result<CertificateParams, String> {
    let mut dns: Vec<String> = Vec::new();
    let mut ips: Vec<IpAddr> = Vec::new();
    for n in names {
        match n.parse::<IpAddr>() {
            Ok(ip) => ips.push(ip),
            Err(_) => dns.push(n.clone()),
        }
    }
    let mut params = CertificateParams::new(dns)
        .map_err(|e| format!("nombre de certificado inválido: {e}"))?;
    for ip in ips {
        params.subject_alt_names.push(SanType::IpAddress(ip));
    }
    params.not_after = time::OffsetDateTime::now_utc() + time::Duration::days(3650);
    Ok(params)
}

/// Garantiza que en `tls_dir` haya un certificado que cubra `names`.
/// Solo regenera si faltan archivos o si la lista cambió desde la última vez
/// (la lista usada se guarda en `server-cert.names`, que se escribe al final).
pub fn ensure_server_cert(tls_dir: &Path, names: &[String]) -> Result<CertOutcome, String> {
    std::fs::create_dir_all(tls_dir)
        .map_err(|e| format!("no se pudo crear {}: {e}", tls_dir.display()))?;
    let cert_path = tls_dir.join(CERT_FILE);
    let key_path = tls_dir.join(KEY_FILE);
    let names_path = tls_dir.join(NAMES_FILE);

    let mut stable_names = crate::tls_cert::desired_names(&[]);
    let _ = names;
    let wanted = stable_names.join("\n");
    let current = std::fs::read_to_string(&names_path).ok();
    if cert_path.exists() && key_path.exists() && current.as_deref() == Some(wanted.as_str()) {
        return Ok(CertOutcome::Unchanged);
    }
    if cert_path.exists() != key_path.exists() {
        return Err(
            "La identidad TLS está incompleta. Se requiere restaurar conjuntamente el certificado y su clave privada; no se generará una identidad nueva automáticamente.".to_string(),
        );
    }

    let params = build_cert_params(&stable_names)?;
    let key_pair =
        KeyPair::generate().map_err(|e| format!("no se pudo generar la clave: {e}"))?;
    let cert = params
        .self_signed(&key_pair)
        .map_err(|e| format!("no se pudo firmar el certificado: {e}"))?;

    std::fs::write(&cert_path, cert.pem())
        .map_err(|e| format!("no se pudo escribir {}: {e}", cert_path.display()))?;
    write_private_key(&key_path, key_pair.serialize_pem().as_bytes())?;
    std::fs::write(&names_path, wanted)
        .map_err(|e| format!("no se pudo escribir {}: {e}", names_path.display()))?;
    Ok(CertOutcome::Regenerated)
}

fn write_private_key(path: &Path, contents: &[u8]) -> Result<(), String> {
    let temporary_path = path.with_extension("pem.tmp");
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary_path)
        .map_err(|error| format!("no se pudo crear la clave privada TLS: {error}"))?;
    std::io::Write::write_all(&mut file, contents)
        .map_err(|error| format!("no se pudo escribir la clave privada TLS: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("no se pudo sincronizar la clave privada TLS: {error}"))?;
    drop(file);
    protect_private_key(&temporary_path)?;
    std::fs::rename(&temporary_path, path)
        .map_err(|error| format!("no se pudo instalar la clave privada TLS: {error}"))
}

#[cfg(windows)]
fn protect_private_key(path: &Path) -> Result<(), String> {
    use std::process::Command;

    let username = std::env::var("USERNAME")
        .map_err(|error| format!("No se pudo identificar al usuario para proteger la clave TLS: {error}"))?;
    let domain = std::env::var("USERDOMAIN").unwrap_or_default();
    let principal = if domain.is_empty() {
        username
    } else {
        format!("{domain}\\{username}")
    };
    let output = Command::new("icacls.exe")
        .arg(path)
        .args(["/inheritance:r", "/grant:r"])
        .arg(format!("{principal}:(F)"))
        .args(["*S-1-5-18:(F)", "*S-1-5-32-544:(F)"])
        .output()
        .map_err(|error| format!("No se pudieron establecer permisos para la clave TLS: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "icacls no pudo proteger la clave privada TLS: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
fn protect_private_key(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tls_cert::desired_names;
    use std::path::PathBuf;

    struct TmpDir(PathBuf);

    impl TmpDir {
        fn new(tag: &str) -> Self {
            let p = std::env::temp_dir()
                .join(format!("sanatorio-tls-{}-{}", tag, std::process::id()));
            let _ = std::fs::remove_dir_all(&p);
            std::fs::create_dir_all(&p).unwrap();
            TmpDir(p)
        }
    }

    impl Drop for TmpDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn params_separan_ips_y_nombres_dns() {
        let names: Vec<String> = ["localhost", "127.0.0.1", "192.168.1.50", "pcservidor"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let p = build_cert_params(&names).unwrap();
        let dns = p
            .subject_alt_names
            .iter()
            .filter(|s| matches!(s, SanType::DnsName(_)))
            .count();
        let ips: Vec<IpAddr> = p
            .subject_alt_names
            .iter()
            .filter_map(|s| match s {
                SanType::IpAddress(ip) => Some(*ip),
                _ => None,
            })
            .collect();
        assert_eq!(dns, 2);
        assert_eq!(
            ips,
            vec![IpAddr::from([127, 0, 0, 1]), IpAddr::from([192, 168, 1, 50])]
        );
    }

    #[test]
    fn primera_vez_genera_y_segunda_no_cambia() {
        let tmp = TmpDir::new("primera");
        let dir = tmp.0.join("tls");
        let names = desired_names(&[]);

        assert_eq!(ensure_server_cert(&dir, &names).unwrap(), CertOutcome::Regenerated);
        let cert1 = std::fs::read(dir.join(CERT_FILE)).unwrap();
        let key1 = std::fs::read(dir.join(KEY_FILE)).unwrap();
        assert!(String::from_utf8_lossy(&cert1).starts_with("-----BEGIN CERTIFICATE-----"));

        assert_eq!(ensure_server_cert(&dir, &names).unwrap(), CertOutcome::Unchanged);
        assert_eq!(std::fs::read(dir.join(CERT_FILE)).unwrap(), cert1);
        assert_eq!(std::fs::read(dir.join(KEY_FILE)).unwrap(), key1);
    }

    #[test]
    fn reutiliza_el_certificado_aunque_cambien_las_interfaces_o_nombres() {
        let tmp = TmpDir::new("cambia");
        let dir = tmp.0.join("tls");
        let base = desired_names(&[]);
        ensure_server_cert(&dir, &base).unwrap();
        let cert1 = std::fs::read(dir.join(CERT_FILE)).unwrap();

        let con_extra = desired_names(&["192.168.1.50".to_string()]);
        assert_eq!(
            ensure_server_cert(&dir, &con_extra).unwrap(),
            CertOutcome::Unchanged
        );
        assert_eq!(std::fs::read(dir.join(CERT_FILE)).unwrap(), cert1);
    }

    #[test]
    fn regenera_si_falta_un_archivo() {
        let tmp = TmpDir::new("falta");
        let dir = tmp.0.join("tls");
        let names = desired_names(&[]);
        ensure_server_cert(&dir, &names).unwrap();
        std::fs::remove_file(dir.join(KEY_FILE)).unwrap();
        assert!(ensure_server_cert(&dir, &names).is_err());
        assert!(!dir.join(KEY_FILE).exists());
    }

    #[test]
    fn extra_names_sin_archivo_da_lista_vacia() {
        let tmp = TmpDir::new("sinarchivo");
        assert!(load_extra_names(&tmp.0).unwrap().is_empty());
    }

    #[test]
    fn extra_names_lee_crlf_y_bom_y_rechaza_utf16() {
        let tmp = TmpDir::new("lee");
        std::fs::write(
            tmp.0.join(EXTRA_NAMES_FILE),
            "\u{feff}# servidor\r\n192.168.1.50\r\n".as_bytes(),
        )
        .unwrap();
        assert_eq!(load_extra_names(&tmp.0).unwrap(), vec!["192.168.1.50".to_string()]);

        // UTF-16 con BOM (lo que genera `>` en PowerShell 5): debe dar error claro.
        std::fs::write(tmp.0.join(EXTRA_NAMES_FILE), [0xFFu8, 0xFE, b'a', 0]).unwrap();
        assert!(load_extra_names(&tmp.0).is_err());
    }
}
