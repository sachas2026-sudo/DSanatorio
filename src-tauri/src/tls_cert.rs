use std::collections::HashSet;

pub fn parse_tls_names(texto: &str) -> Result<Vec<String>, String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for linea in texto.lines() {
        let linea = linea.trim();
        if linea.is_empty() || linea.starts_with('#') {
            continue;
        }

        if linea.contains(' ') || linea.contains('/') || linea.contains('\\') {
            return Err(format!("nombre inválido: {}", linea));
        }
        if linea.len() > 253 {
            return Err(format!("nombre demasiado largo: {}", linea));
        }

        if seen.insert(linea.to_string()) {
            out.push(linea.to_string());
        }
    }

    Ok(out)
}

pub fn desired_names(extra: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for nombre in ["localhost", "127.0.0.1"] {
        if seen.insert(nombre.to_string()) {
            out.push(nombre.to_string());
        }
    }

    for nombre in extra {
        if seen.insert(nombre.clone()) {
            out.push(nombre.clone());
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_tls_names_ignora_comentarios_y_lineas_vacias() {
        let texto = "\n# comentario\n\nlocalhost\n127.0.0.1\n   \n# otro\n";
        let resultado = parse_tls_names(texto).unwrap();
        assert_eq!(
            resultado,
            vec![
                "localhost".to_string(),
                "127.0.0.1".to_string()
            ]
        );
    }

    #[test]
    fn parse_tls_names_elimina_duplicados() {
        let texto = "localhost\n127.0.0.1\nlocalhost\n127.0.0.1\nserver.local\n";
        let resultado = parse_tls_names(texto).unwrap();
        assert_eq!(
            resultado,
            vec![
                "localhost".to_string(),
                "127.0.0.1".to_string(),
                "server.local".to_string()
            ]
        );
    }

    #[test]
    fn parse_tls_names_rechaza_nombre_con_espacios_internos() {
        let texto = "localhost\nmi servidor.local\n";
        let resultado = parse_tls_names(texto);
        assert!(resultado.is_err());
    }

    #[test]
    fn parse_tls_names_rechaza_nombre_con_barra() {
        let texto = "localhost\nfoo/bar\n";
        let resultado = parse_tls_names(texto);
        assert!(resultado.is_err());
    }

    #[test]
    fn parse_tls_names_acepta_ip_y_nombre_de_red() {
        let texto = "192.168.1.10\nserver.red.local\n";
        let resultado = parse_tls_names(texto).unwrap();
        assert_eq!(
            resultado,
            vec![
                "192.168.1.10".to_string(),
                "server.red.local".to_string()
            ]
        );
    }

    #[test]
    fn desired_names_incluye_localhost_y_127_0_0_1_sin_duplicar() {
        let extra = vec![
            "localhost".to_string(),
            "127.0.0.1".to_string(),
            "server.local".to_string(),
        ];
        let resultado = desired_names(&extra);
        assert_eq!(
            resultado,
            vec![
                "localhost".to_string(),
                "127.0.0.1".to_string(),
                "server.local".to_string()
            ]
        );
    }
}
