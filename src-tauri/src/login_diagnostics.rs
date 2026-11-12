use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;

use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

#[derive(Clone, Copy)]
enum DiagnosticEvent {
    StartupNoServer,
    InvalidCredentials,
    NetworkError,
    NetworkDiagnosticOk,
    NetworkDiagnosticTcpError,
    NetworkDiagnosticTlsError,
    NetworkDiagnosticApiError,
    NetworkDiagnosticTimeout,
    NetworkDiagnosticNotFound,
    ServerStartupError,
    DiscoveryStartupWarning,
    FirewallRuleWarning,
}

impl DiagnosticEvent {
    fn as_str(self) -> &'static str {
        match self {
            Self::StartupNoServer => "INICIO_SIN_SERVIDOR",
            Self::InvalidCredentials => "LOGIN_CREDENCIALES_RECHAZADAS",
            Self::NetworkError => "LOGIN_ERROR_CONEXION",
            Self::NetworkDiagnosticOk => "DIAGNOSTICO_RED_OK",
            Self::NetworkDiagnosticTcpError => "DIAGNOSTICO_RED_ERROR_TCP",
            Self::NetworkDiagnosticTlsError => "DIAGNOSTICO_RED_ERROR_TLS",
            Self::NetworkDiagnosticApiError => "DIAGNOSTICO_RED_ERROR_API",
            Self::NetworkDiagnosticTimeout => "DIAGNOSTICO_RED_TIMEOUT",
            Self::NetworkDiagnosticNotFound => "DIAGNOSTICO_RED_SIN_SERVIDOR",
            Self::ServerStartupError => "INICIO_SERVIDOR_ERROR",
            Self::DiscoveryStartupWarning => "INICIO_DISCOVERY_UDP_WARNING",
            Self::FirewallRuleWarning => "FIREWALL_REGLA_REVISAR",
        }
    }
}

fn append_event_to_path(path: &Path, event: DiagnosticEvent) -> Result<(), String> {
    let timestamp = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| format!("No se pudo generar la fecha del log: {e}"))?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| format!("No se pudo abrir {}: {e}", path.display()))?;
    writeln!(file, "[{timestamp}] {}", event.as_str())
        .map_err(|e| format!("No se pudo escribir {}: {e}", path.display()))
}

fn append_event(event: DiagnosticEvent) -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let directory = executable
        .parent()
        .ok_or_else(|| "No se pudo determinar la carpeta del programa".to_string())?;
    append_event_to_path(&directory.join("Erroes.log"), event)
}

pub fn record_startup_no_server() -> Result<(), String> {
    append_event(DiagnosticEvent::StartupNoServer)
}

pub fn record_connection_diagnostic(kind: &str) -> Result<(), String> {
    let event = match kind {
        "ok" => DiagnosticEvent::NetworkDiagnosticOk,
        "tcp" => DiagnosticEvent::NetworkDiagnosticTcpError,
        "tls" => DiagnosticEvent::NetworkDiagnosticTlsError,
        "timeout" => DiagnosticEvent::NetworkDiagnosticTimeout,
        "api" => DiagnosticEvent::NetworkDiagnosticApiError,
        "not_found" => DiagnosticEvent::NetworkDiagnosticNotFound,
        _ => return Err("Tipo de diagnóstico de red no permitido".to_string()),
    };
    append_event(event)
}

pub fn record_server_startup_diagnostic(kind: &str) -> Result<(), String> {
    let event = match kind {
        "server" => DiagnosticEvent::ServerStartupError,
        "discovery" => DiagnosticEvent::DiscoveryStartupWarning,
        "firewall" => DiagnosticEvent::FirewallRuleWarning,
        _ => return Err("Tipo de diagnóstico de inicio no permitido".to_string()),
    };
    append_event(event)
}

#[tauri::command]
pub fn write_login_diagnostic(kind: String) -> Result<(), String> {
    let event = match kind.as_str() {
        "invalid_credentials" => DiagnosticEvent::InvalidCredentials,
        "network_error" => DiagnosticEvent::NetworkError,
        _ => return Err("Tipo de diagnóstico no permitido".to_string()),
    };
    append_event(event)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn appends_safe_events_to_log() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("Erroes.log");

        append_event_to_path(&path, DiagnosticEvent::InvalidCredentials).unwrap();
        append_event_to_path(&path, DiagnosticEvent::NetworkError).unwrap();

        let contents = std::fs::read_to_string(path).unwrap();
        let lines: Vec<_> = contents.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].ends_with("LOGIN_CREDENCIALES_RECHAZADAS"));
        assert!(lines[1].ends_with("LOGIN_ERROR_CONEXION"));
    }

    #[test]
    fn rejects_unrecognized_diagnostic_kind() {
        assert!(write_login_diagnostic("password=456".to_string()).is_err());
    }
}
