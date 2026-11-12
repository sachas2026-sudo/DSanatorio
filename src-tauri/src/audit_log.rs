use serde_json::Value;
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Mutex;

static LOG_LOCK: Mutex<()> = Mutex::new(());

fn timestamp() -> String {
    let now = time::OffsetDateTime::now_utc();
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        now.year(),
        u8::from(now.month()),
        now.day(),
        now.hour(),
        now.minute(),
        now.second()
    )
}

fn safe_value(value: &str) -> String {
    value
        .chars()
        .map(|c| if c.is_control() || c == ' ' { '_' } else { c })
        .take(160)
        .collect()
}

fn safe_route(path: &str) -> String {
    let route = path.split('?').next().unwrap_or(path);
    for prefix in [
        "/api/pacientes/",
        "/api/afiliados/",
        "/api/planes/",
        "/api/cuotas/",
        "/api/obras-sociales/",
    ] {
        if let Some(rest) = route.strip_prefix(prefix) {
            if rest == "con-paciente-nuevo" {
                return route.to_string();
            }
            let suffix = rest.find('/').map(|i| &rest[i..]).unwrap_or("");
            return format!("{prefix}{{id}}{suffix}");
        }
    }
    if let Some(api_route) = route.strip_prefix("/api/") {
        if let Some((resource, _)) = api_route.split_once('/') {
            return format!("/api/{resource}/{{id}}");
        }
    }
    route.to_string()
}

fn data_shape(value: Option<&Value>) -> String {
    let Some(value) = value else {
        return "none".to_string();
    };
    let Some(object) = value.as_object() else {
        return match value {
            Value::Array(values) => format!("array:{}", values.len()),
            Value::Null => "null".to_string(),
            _ => "value".to_string(),
        };
    };

    let mut fields = object
        .iter()
        .map(|(key, value)| {
            let shape = value
                .as_array()
                .map(|items| format!("[{}]", items.len()))
                .unwrap_or_else(|| {
                    if value.is_object() {
                        "{...}".to_string()
                    } else {
                        String::new()
                    }
                });
            format!("{key}{shape}")
        })
        .collect::<Vec<_>>();
    fields.sort();
    fields.join(",")
}

fn log_path() -> Result<std::path::PathBuf, String> {
    if cfg!(test) {
        if let Some(path) = std::env::var_os("SANATORIO_AUDIT_LOG") {
            return Ok(path.into());
        }
    }
    let executable = std::env::current_exe()
        .map_err(|error| format!("No se pudo ubicar el ejecutable: {error}"))?;
    let directory = executable
        .parent()
        .ok_or_else(|| "El ejecutable no tiene una carpeta contenedora.".to_string())?;
    Ok(directory.join("Transacciones.txt"))
}

pub fn record_client_request(
    method: &str,
    path: &str,
    username: Option<&str>,
    request: Option<&Value>,
    status: Option<u16>,
    response: Option<&Value>,
    response_bytes: Option<usize>,
    duration_ms: u128,
    error: Option<&str>,
) {
    let profile = match crate::install_profile::load() {
        Ok(Some(profile)) if profile.is_client() => profile,
        Ok(_) => return,
        Err(error) => {
            log::error!("No se pudo determinar el perfil para Transacciones.txt: {error}");
            return;
        }
    };

    let line = format!(
        "{} profile={} user={} method={} route={} status={} duration_ms={} request={} response={} response_bytes={} error={}\n",
        timestamp(),
        profile.as_str(),
        username.map(safe_value).unwrap_or_else(|| "sin_sesion".to_string()),
        safe_value(method),
        safe_route(path),
        status.map(|value| value.to_string()).unwrap_or_else(|| "sin_respuesta".to_string()),
        duration_ms,
        data_shape(request),
        data_shape(response),
        response_bytes.map(|value| value.to_string()).unwrap_or_else(|| "unknown".to_string()),
        error.map(safe_value).unwrap_or_else(|| "none".to_string()),
    );

    let result = (|| {
        let _guard = LOG_LOCK.lock().unwrap_or_else(|error| error.into_inner());
        let path = log_path()?;
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .map_err(|error| format!("No se pudo abrir Transacciones.txt: {error}"))?;
        file.write_all(line.as_bytes())
            .map_err(|error| format!("No se pudo escribir Transacciones.txt: {error}"))
    })();
    if let Err(error) = result {
        log::error!("{error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registra_forma_de_datos_sin_volcar_valores() {
        let data = serde_json::json!({
            "patient": {"nombre": "Dato privado", "dni": "12345678"},
            "patients": [{"id": "p1"}, {"id": "p2"}],
            "password": "no-debe-aparecer"
        });
        let shape = data_shape(Some(&data));
        assert!(shape.contains("patients[2]"));
        assert!(shape.contains("patient{...}"));
        assert!(!shape.contains("Dato privado"));
        assert!(!shape.contains("12345678"));
        assert!(!shape.contains("no-debe-aparecer"));
    }

    #[test]
    fn oculta_consultas_e_identificadores_de_ruta() {
        assert_eq!(safe_route("/api/pacientes/paciente-123?dni=12345678"), "/api/pacientes/{id}");
        assert_eq!(
            safe_route("/api/pagos-afiliados?q=Nombre%20Paciente"),
            "/api/pagos-afiliados"
        );
        assert_eq!(
            safe_route("/api/afiliados/con-paciente-nuevo"),
            "/api/afiliados/con-paciente-nuevo"
        );
        assert_eq!(
            safe_route("/api/medicos/med-123?dni=12345678"),
            "/api/medicos/{id}"
        );
    }
}
