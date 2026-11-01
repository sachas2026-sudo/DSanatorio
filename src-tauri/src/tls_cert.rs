//! Nombres (DNS e IP) que el certificado TLS del servidor debe cubrir.
//!
//! Paso 4.3-A: solo funciones puras (sin disco ni red). La generación del
//! certificado llega en el paso 4.3-B.

const MAX_NAME_LEN: usize = 253;

/// Lee una lista de nombres o IPs, uno por línea.
///
/// - Ignora líneas vacías y las que empiezan con `#`.
/// - Quita el BOM inicial (el Bloc de notas y PowerShell 5 lo agregan).
/// - Rechaza espacios internos, `/`, `\`, caracteres de control o no ASCII,
///   y nombres de más de 253 caracteres.
/// - Elimina duplicados (sin distinguir mayúsculas) conservando el orden.
pub fn parse_tls_names(texto: &str) -> Result<Vec<String>, String> {
    let texto = texto.strip_prefix('\u{feff}').unwrap_or(texto);
    let mut out: Vec<String> = Vec::new();
    for (idx, raw) in texto.lines().enumerate() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let n = idx + 1;
        if !line.is_ascii() {
            return Err(format!("línea {n}: '{line}' tiene caracteres no ASCII"));
        }
        if line.chars().any(|c| c.is_whitespace() || c.is_control()) {
            return Err(format!("línea {n}: '{line}' contiene espacios o caracteres de control"));
        }
        if line.contains('/') || line.contains('\\') {
            return Err(format!("línea {n}: '{line}' contiene '/' o '\\'"));
        }
        if line.len() > MAX_NAME_LEN {
            return Err(format!("línea {n}: el nombre supera {MAX_NAME_LEN} caracteres"));
        }
        if !out.iter().any(|existing| existing.eq_ignore_ascii_case(line)) {
            out.push(line.to_string());
        }
    }
    Ok(out)
}

/// Lista final de nombres del certificado: siempre `localhost` y `127.0.0.1`
/// primero, después los extras, sin duplicados.
pub fn desired_names(extra: &[String]) -> Vec<String> {
    let mut out: Vec<String> = vec!["localhost".to_string(), "127.0.0.1".to_string()];
    for name in extra {
        if !out.iter().any(|existing| existing.eq_ignore_ascii_case(name)) {
            out.push(name.clone());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ignora_comentarios_y_lineas_vacias() {
        let texto = "# servidor\n\n192.168.1.50\n   \n# otro\npcservidor\n";
        assert_eq!(
            parse_tls_names(texto).unwrap(),
            vec!["192.168.1.50".to_string(), "pcservidor".to_string()]
        );
    }

    #[test]
    fn parse_elimina_duplicados() {
        let texto = "pcservidor\n192.168.1.50\nPCSERVIDOR\n192.168.1.50\n";
        assert_eq!(
            parse_tls_names(texto).unwrap(),
            vec!["pcservidor".to_string(), "192.168.1.50".to_string()]
        );
    }

    #[test]
    fn parse_rechaza_espacios_internos() {
        assert!(parse_tls_names("mi servidor\n").is_err());
    }

    #[test]
    fn parse_rechaza_barra() {
        assert!(parse_tls_names("srv/algo\n").is_err());
        assert!(parse_tls_names("srv\\algo\n").is_err());
    }

    #[test]
    fn parse_acepta_ip_y_nombre_de_red() {
        let r = parse_tls_names("10.0.0.5\nsanatorio-srv.local\nPC_SERVIDOR\n").unwrap();
        assert_eq!(r, vec!["10.0.0.5", "sanatorio-srv.local", "PC_SERVIDOR"]);
    }

    #[test]
    fn parse_quita_bom_inicial() {
        let r = parse_tls_names("\u{feff}192.168.1.50\npcservidor\n").unwrap();
        assert_eq!(r, vec!["192.168.1.50", "pcservidor"]);
    }

    #[test]
    fn parse_rechaza_no_ascii_y_control() {
        assert!(parse_tls_names("servidór\n").is_err());
        assert!(parse_tls_names("srv\u{0}x\n").is_err());
    }

    #[test]
    fn parse_rechaza_nombre_demasiado_largo() {
        let largo = "a".repeat(254);
        assert!(parse_tls_names(&format!("{largo}\n")).is_err());
        let justo = "a".repeat(253);
        assert!(parse_tls_names(&format!("{justo}\n")).is_ok());
    }

    #[test]
    fn desired_siempre_incluye_localhost_y_loopback() {
        assert_eq!(desired_names(&[]), vec!["localhost", "127.0.0.1"]);
    }

    #[test]
    fn desired_no_duplica_los_base_ni_los_extras() {
        let extra = vec![
            "LOCALHOST".to_string(),
            "127.0.0.1".to_string(),
            "192.168.1.50".to_string(),
            "192.168.1.50".to_string(),
        ];
        assert_eq!(
            desired_names(&extra),
            vec!["localhost", "127.0.0.1", "192.168.1.50"]
        );
    }
}
